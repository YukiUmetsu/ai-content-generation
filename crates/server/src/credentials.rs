//! Provider credentials stay in the operating system's secure store.
//! No readback HTTP endpoint, database column or browser-persistent copy exists.

use std::sync::Arc;

use serde::Serialize;

const YOUTUBE_ENV: &str = "CONTENTGEN_YOUTUBE_API_KEY";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderId {
    Youtube,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CredentialError {
    #[error("Provider credential is not configured")]
    Missing,
    #[error("OS credential access was denied")]
    Denied,
    #[error("OS secure credential storage is unavailable")]
    Unavailable,
    #[error("OS credential operation failed")]
    Other,
}

pub trait CredentialStore: Send + Sync {
    fn read(&self, provider: ProviderId) -> Result<Option<String>, CredentialError>;
    fn put(&self, provider: ProviderId, key: &str) -> Result<(), CredentialError>;
    fn delete(&self, provider: ProviderId) -> Result<(), CredentialError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionSource {
    Keychain,
    Environment,
    Missing,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ConnectionStatus {
    pub id: &'static str,
    pub configured: bool,
    pub source: ConnectionSource,
}

#[derive(Clone)]
pub struct ProviderCredentials {
    store: Arc<dyn CredentialStore>,
    env_key: Option<Arc<str>>,
}

impl std::fmt::Debug for ProviderCredentials {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        fmt.debug_struct("ProviderCredentials")
            .field("store", &"native/injected")
            .field("env_fallback_configured", &self.env_key.is_some())
            .finish()
    }
}

impl ProviderCredentials {
    pub fn system() -> Self {
        Self::new(
            Arc::new(SystemCredentialStore),
            std::env::var(YOUTUBE_ENV).ok(),
        )
    }

    pub fn new(store: Arc<dyn CredentialStore>, env_key: Option<String>) -> Self {
        Self {
            store,
            env_key: env_key
                .filter(|value| !value.trim().is_empty())
                .map(Arc::from),
        }
    }

    pub fn youtube_key(&self) -> Result<String, CredentialError> {
        match self.store.read(ProviderId::Youtube) {
            Ok(Some(key)) if !key.trim().is_empty() => Ok(key),
            Ok(Some(_)) => Err(CredentialError::Other),
            Ok(None) | Err(CredentialError::Unavailable) => self
                .env_key
                .as_ref()
                .map(|key| key.to_string())
                .ok_or(CredentialError::Missing),
            Err(error) => Err(error),
        }
    }

    pub fn youtube_status(&self) -> ConnectionStatus {
        let source = match self.store.read(ProviderId::Youtube) {
            Ok(Some(key)) if !key.trim().is_empty() => ConnectionSource::Keychain,
            Ok(Some(_)) => ConnectionSource::Error,
            Ok(None) => {
                if self.env_key.is_some() {
                    ConnectionSource::Environment
                } else {
                    ConnectionSource::Missing
                }
            }
            Err(CredentialError::Unavailable) => {
                if self.env_key.is_some() {
                    ConnectionSource::Environment
                } else {
                    ConnectionSource::Unavailable
                }
            }
            Err(_) => ConnectionSource::Error,
        };
        ConnectionStatus {
            id: "youtube",
            configured: matches!(
                source,
                ConnectionSource::Keychain | ConnectionSource::Environment
            ),
            source,
        }
    }

    pub fn put_youtube_key(&self, key: &str) -> Result<(), CredentialError> {
        self.store.put(ProviderId::Youtube, key)
    }

    pub fn delete_youtube_key(&self) -> Result<(), CredentialError> {
        self.store.delete(ProviderId::Youtube)
    }
}

struct SystemCredentialStore;

#[cfg(target_os = "macos")]
mod native {
    use super::{CredentialError, ProviderId};
    use security_framework::passwords;

    const SERVICE: &str = "com.contentgen.local.credentials";
    fn account(provider: ProviderId) -> &'static str {
        match provider {
            ProviderId::Youtube => "youtube-data-api-v3",
        }
    }

    fn classify(code: i32) -> CredentialError {
        match code {
            -25293 | -25308 | -25291 => CredentialError::Denied,
            _ => CredentialError::Other,
        }
    }

    pub fn read(provider: ProviderId) -> Result<Option<String>, CredentialError> {
        match passwords::get_generic_password(SERVICE, account(provider)) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| CredentialError::Other),
            Err(error) if error.code() == -25300 => Ok(None),
            Err(error) => Err(classify(error.code())),
        }
    }

    pub fn put(provider: ProviderId, key: &str) -> Result<(), CredentialError> {
        passwords::set_generic_password(SERVICE, account(provider), key.as_bytes())
            .map_err(|error| classify(error.code()))
    }

    pub fn delete(provider: ProviderId) -> Result<(), CredentialError> {
        match passwords::delete_generic_password(SERVICE, account(provider)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(error) => Err(classify(error.code())),
        }
    }
}

impl CredentialStore for SystemCredentialStore {
    fn read(&self, provider: ProviderId) -> Result<Option<String>, CredentialError> {
        #[cfg(target_os = "macos")]
        {
            native::read(provider)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = provider;
            Err(CredentialError::Unavailable)
        }
    }

    fn put(&self, provider: ProviderId, key: &str) -> Result<(), CredentialError> {
        #[cfg(target_os = "macos")]
        {
            native::put(provider, key)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (provider, key);
            Err(CredentialError::Unavailable)
        }
    }

    fn delete(&self, provider: ProviderId) -> Result<(), CredentialError> {
        #[cfg(target_os = "macos")]
        {
            native::delete(provider)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = provider;
            Err(CredentialError::Unavailable)
        }
    }
}
