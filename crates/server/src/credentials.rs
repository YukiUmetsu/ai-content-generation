//! Provider credentials stay in the operating system's secure store.
//! No readback HTTP endpoint, database column or browser-persistent copy exists.

use std::sync::Arc;

use serde::Serialize;

const YOUTUBE_ENV: &str = "CONTENTGEN_YOUTUBE_API_KEY";
const FISH_ENV: &str = "FISH_AUDIO_API_KEY";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderId {
    Youtube,
    Fish,
}

impl ProviderId {
    pub fn from_slug(value: &str) -> Option<Self> {
        match value {
            "youtube" => Some(Self::Youtube),
            "fish" => Some(Self::Fish),
            _ => None,
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Self::Youtube => "youtube",
            Self::Fish => "fish",
        }
    }
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
    fish_env: Option<Arc<str>>,
}

impl std::fmt::Debug for ProviderCredentials {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        fmt.debug_struct("ProviderCredentials")
            .field("store", &"native/injected")
            .field("env_fallback_configured", &self.env_key.is_some())
            .field("fish_env_configured", &self.fish_env.is_some())
            .finish()
    }
}

impl ProviderCredentials {
    pub fn system() -> Self {
        let mut credentials = Self::new(
            Arc::new(SystemCredentialStore),
            std::env::var(YOUTUBE_ENV).ok(),
        );
        credentials.fish_env = Self::clean_env(std::env::var(FISH_ENV).ok());
        credentials
    }

    fn clean_env(value: Option<String>) -> Option<Arc<str>> {
        value.filter(|key| !key.trim().is_empty()).map(Arc::from)
    }

    pub fn new(store: Arc<dyn CredentialStore>, env_key: Option<String>) -> Self {
        Self {
            store,
            env_key: env_key
                .filter(|value| !value.trim().is_empty())
                .map(Arc::from),
            fish_env: None,
        }
    }

    fn environment(&self, provider: ProviderId) -> Option<&Arc<str>> {
        match provider {
            ProviderId::Youtube => self.env_key.as_ref(),
            ProviderId::Fish => self.fish_env.as_ref(),
        }
    }

    pub fn key(&self, provider: ProviderId) -> Result<String, CredentialError> {
        match self.store.read(provider) {
            Ok(Some(key)) if !key.trim().is_empty() => Ok(key),
            Ok(Some(_)) => Err(CredentialError::Other),
            Ok(None) | Err(CredentialError::Unavailable) => self
                .environment(provider)
                .map(|key| key.to_string())
                .ok_or(CredentialError::Missing),
            Err(error) => Err(error),
        }
    }

    pub fn youtube_key(&self) -> Result<String, CredentialError> {
        self.key(ProviderId::Youtube)
    }

    pub fn status(&self, provider: ProviderId) -> ConnectionStatus {
        let source = match self.store.read(provider) {
            Ok(Some(key)) if !key.trim().is_empty() => ConnectionSource::Keychain,
            Ok(Some(_)) => ConnectionSource::Error,
            Ok(None) => {
                if self.environment(provider).is_some() {
                    ConnectionSource::Environment
                } else {
                    ConnectionSource::Missing
                }
            }
            Err(CredentialError::Unavailable) => {
                if self.environment(provider).is_some() {
                    ConnectionSource::Environment
                } else {
                    ConnectionSource::Unavailable
                }
            }
            Err(_) => ConnectionSource::Error,
        };
        ConnectionStatus {
            id: provider.slug(),
            configured: matches!(
                source,
                ConnectionSource::Keychain | ConnectionSource::Environment
            ),
            source,
        }
    }

    pub fn youtube_status(&self) -> ConnectionStatus {
        self.status(ProviderId::Youtube)
    }

    pub fn put_key(&self, provider: ProviderId, key: &str) -> Result<(), CredentialError> {
        self.store.put(provider, key)
    }

    pub fn delete_key(&self, provider: ProviderId) -> Result<(), CredentialError> {
        self.store.delete(provider)
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
            ProviderId::Fish => "fish-audio-api",
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
