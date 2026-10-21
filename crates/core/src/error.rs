use std::collections::BTreeMap;

use serde_json::Value;

/// Errors returned by core document validation.
///
/// These are intentionally independent of HTTP, SQLite and any provider. The
/// server maps them to its own API error envelope.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DomainError {
    #[error("unsupported {document} schema version {found}; supported version is {supported}")]
    UnsupportedSchemaVersion {
        document: &'static str,
        found: u32,
        supported: u32,
    },

    #[error("{field} must not be empty")]
    EmptyField { field: &'static str },

    #[error("{field} is not a valid identifier")]
    InvalidIdentifier { field: &'static str },

    #[error("{field} is not a valid SHA-256 digest")]
    InvalidDigest { field: &'static str },

    #[error("{field} is not a valid UTC RFC 3339 timestamp (expected ...Z)")]
    InvalidTimestamp { field: &'static str },

    #[error("{field} is not a valid media type")]
    InvalidMediaType { field: &'static str },

    #[error("{field} must be a finite number")]
    NonFiniteNumber { field: &'static str },

    #[error("{field} is not a valid URI")]
    InvalidUri { field: &'static str },

    #[error("{field} contains raw secret material")]
    SecretMaterial { field: &'static str },

    #[error("metric '{metric_key}' is a forbidden invented performance score")]
    ForbiddenMetric { metric_key: String },

    #[error("job DAG contains a cycle")]
    CycleDetected,

    #[error("attempt {attempt} exceeds the bounded retry limit {max_attempts}")]
    RetryLimitExceeded { attempt: u32, max_attempts: u32 },

    #[error("job edge references nodes from different jobs")]
    CrossJobReference,

    #[error("{message}")]
    RuleViolation { message: String },
}

pub(crate) fn ensure_schema_version(
    document: &'static str,
    found: u32,
    supported: u32,
) -> Result<(), DomainError> {
    if found != supported {
        return Err(DomainError::UnsupportedSchemaVersion {
            document,
            found,
            supported,
        });
    }
    Ok(())
}

pub(crate) fn ensure_text(field: &'static str, value: &str) -> Result<(), DomainError> {
    if value.trim().is_empty() {
        return Err(DomainError::EmptyField { field });
    }
    Ok(())
}

pub(crate) fn ensure_identifier(field: &'static str, value: &str) -> Result<(), DomainError> {
    ensure_text(field, value)?;
    let valid = value.len() <= 200
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':' | '/'));
    if !valid {
        return Err(DomainError::InvalidIdentifier { field });
    }
    Ok(())
}

pub(crate) fn ensure_sha256(field: &'static str, value: &str) -> Result<(), DomainError> {
    let valid = value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if !valid {
        return Err(DomainError::InvalidDigest { field });
    }
    Ok(())
}

pub(crate) fn ensure_media_type(field: &'static str, value: &str) -> Result<(), DomainError> {
    let mut parts = value.split('/');
    let type_part = parts.next().unwrap_or_default();
    let subtype_part = parts.next().unwrap_or_default();
    let valid = !type_part.is_empty()
        && !subtype_part.is_empty()
        && parts.next().is_none()
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control);
    if !valid {
        return Err(DomainError::InvalidMediaType { field });
    }
    Ok(())
}

pub(crate) fn ensure_finite(field: &'static str, value: f64) -> Result<(), DomainError> {
    if !value.is_finite() {
        return Err(DomainError::NonFiniteNumber { field });
    }
    Ok(())
}

pub(crate) fn ensure_uri(field: &'static str, value: &str) -> Result<(), DomainError> {
    ensure_text(field, value)?;
    let Some((scheme, rest)) = value.split_once(':') else {
        return Err(DomainError::InvalidUri { field });
    };
    let valid_scheme = !scheme.is_empty()
        && scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !valid_scheme || rest.is_empty() {
        return Err(DomainError::InvalidUri { field });
    }
    Ok(())
}

/// Strict UTC RFC 3339 subset: `YYYY-MM-DDTHH:MM:SS[.fraction]Z`.
///
/// Rejecting offsets keeps database ordering lexicographic and comparisons
/// straightforward. Callers that need local time must convert before storing.
pub(crate) fn is_utc_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20 {
        return false;
    }
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return false;
    }

    let Some(year) = parse_digits(&bytes[0..4]) else {
        return false;
    };
    let Some(month) = parse_digits(&bytes[5..7]) else {
        return false;
    };
    let Some(day) = parse_digits(&bytes[8..10]) else {
        return false;
    };
    let Some(hour) = parse_digits(&bytes[11..13]) else {
        return false;
    };
    let Some(minute) = parse_digits(&bytes[14..16]) else {
        return false;
    };
    let Some(second) = parse_digits(&bytes[17..19]) else {
        return false;
    };

    if !(1..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return false;
    }

    let rest = &bytes[19..];
    match rest {
        [b'Z'] => true,
        [b'.', fraction @ .., b'Z'] => {
            !fraction.is_empty() && fraction.len() <= 9 && fraction.iter().all(u8::is_ascii_digit)
        }
        _ => false,
    }
}

fn parse_digits(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bytes.iter().try_fold(0_u32, |acc, byte| {
        acc.checked_mul(10)?.checked_add(u32::from(byte - b'0'))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

pub(crate) fn ensure_timestamp(field: &'static str, value: &str) -> Result<(), DomainError> {
    if !is_utc_timestamp(value) {
        return Err(DomainError::InvalidTimestamp { field });
    }
    Ok(())
}

pub(crate) fn ensure_metadata(
    field: &'static str,
    metadata: &BTreeMap<String, Value>,
) -> Result<(), DomainError> {
    for key in metadata.keys() {
        if key.trim().is_empty() || key.len() > 100 {
            return Err(DomainError::RuleViolation {
                message: format!("{field} metadata keys must be 1..=100 non-blank characters"),
            });
        }
    }
    ensure_no_secrets(field, metadata)
}

pub(crate) fn ensure_metadata_json(
    field: &'static str,
    metadata: &serde_json::Map<String, Value>,
) -> Result<(), DomainError> {
    for key in metadata.keys() {
        if key.trim().is_empty() || key.len() > 100 {
            return Err(DomainError::RuleViolation {
                message: format!("{field} metadata keys must be 1..=100 non-blank characters"),
            });
        }
    }
    if metadata
        .iter()
        .any(|(key, value)| key_is_sensitive(key) || value_contains_secret(value))
    {
        return Err(DomainError::SecretMaterial { field });
    }
    Ok(())
}

/// Reject common credential shapes in document metadata. Retrieved/source
/// metadata is untrusted and must never become a place to stash API keys.
pub(crate) fn ensure_no_secrets(
    field: &'static str,
    metadata: &BTreeMap<String, Value>,
) -> Result<(), DomainError> {
    if metadata
        .iter()
        .any(|(key, value)| key_is_sensitive(key) || value_contains_secret(value))
    {
        return Err(DomainError::SecretMaterial { field });
    }
    Ok(())
}

fn key_is_sensitive(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', ' '], "_");
    [
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "authorization",
        "password",
        "private_key",
        "client_secret",
        "secret",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn value_contains_secret(value: &Value) -> bool {
    match value {
        Value::String(text) => {
            text.starts_with("Bearer ")
                || text.starts_with("-----BEGIN ")
                || (text.starts_with("sk-") && text.len() > 20)
                || (text.starts_with("AKIA") && text.len() >= 20)
        }
        Value::Array(items) => items.iter().any(value_contains_secret),
        Value::Object(map) => map
            .iter()
            .any(|(key, value)| key_is_sensitive(key) || value_contains_secret(value)),
        _ => false,
    }
}
