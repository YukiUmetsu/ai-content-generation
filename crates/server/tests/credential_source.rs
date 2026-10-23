use std::sync::{Arc, Mutex};

use contentgen_server::credentials::{
    ConnectionSource, CredentialError, CredentialStore, ProviderCredentials, ProviderId,
};

#[derive(Default)]
struct FakeStore {
    key: Mutex<Option<String>>,
    fail_read: Mutex<Option<CredentialError>>,
    fail_write: Mutex<bool>,
}

impl CredentialStore for FakeStore {
    fn read(&self, _: ProviderId) -> Result<Option<String>, CredentialError> {
        if let Some(error) = *self.fail_read.lock().unwrap() {
            return Err(error);
        }
        Ok(self.key.lock().unwrap().clone())
    }

    fn put(&self, _: ProviderId, key: &str) -> Result<(), CredentialError> {
        if *self.fail_write.lock().unwrap() {
            return Err(CredentialError::Denied);
        }
        *self.key.lock().unwrap() = Some(key.to_owned());
        Ok(())
    }

    fn delete(&self, _: ProviderId) -> Result<(), CredentialError> {
        *self.key.lock().unwrap() = None;
        Ok(())
    }
}

#[test]
fn keychain_takes_precedence_and_replacement_is_live() {
    let store = Arc::new(FakeStore::default());
    let credentials = ProviderCredentials::new(store, Some("env-fallback".into()));
    assert_eq!(credentials.youtube_key().unwrap(), "env-fallback");
    assert_eq!(
        credentials.youtube_status().source,
        ConnectionSource::Environment
    );
    credentials.put_youtube_key("mac-key-one").unwrap();
    assert_eq!(credentials.youtube_key().unwrap(), "mac-key-one");
    assert_eq!(
        credentials.youtube_status().source,
        ConnectionSource::Keychain
    );
    credentials.put_youtube_key("mac-key-two").unwrap();
    assert_eq!(credentials.youtube_key().unwrap(), "mac-key-two");
    credentials.delete_youtube_key().unwrap();
    assert_eq!(credentials.youtube_key().unwrap(), "env-fallback");
}

#[test]
fn access_denial_is_distinct_from_missing_and_does_not_use_env_fallback() {
    let store = Arc::new(FakeStore::default());
    *store.fail_read.lock().unwrap() = Some(CredentialError::Denied);
    let credentials = ProviderCredentials::new(store, Some("env-fallback".into()));
    assert_eq!(credentials.youtube_key(), Err(CredentialError::Denied));
    assert_eq!(credentials.youtube_status().source, ConnectionSource::Error);
    assert!(!credentials.youtube_status().configured);
}

#[test]
fn unavailable_storage_does_not_persist_or_claim_that_it_did() {
    let store = Arc::new(FakeStore::default());
    *store.fail_read.lock().unwrap() = Some(CredentialError::Unavailable);
    let credentials = ProviderCredentials::new(store, None);
    assert_eq!(
        credentials.youtube_status().source,
        ConnectionSource::Unavailable
    );
    assert!(!credentials.youtube_status().configured);
}

#[test]
fn failed_replace_keeps_the_previous_key() {
    let store = Arc::new(FakeStore::default());
    let credentials = ProviderCredentials::new(store.clone(), None);
    credentials.put_youtube_key("original-key").unwrap();
    *store.fail_write.lock().unwrap() = true;
    assert_eq!(
        credentials.put_youtube_key("replacement-key"),
        Err(CredentialError::Denied)
    );
    assert_eq!(credentials.youtube_key().unwrap(), "original-key");
}
