use std::time::{Duration, Instant};

use tokio::sync::RwLock;

struct CacheEntry<T> {
    key: String,
    data: T,
    created_at: Instant,
}

pub struct Cache<T> {
    inner: RwLock<Option<CacheEntry<T>>>,
    ttl: Duration,
}

impl<T: Clone> Cache<T> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            inner: RwLock::new(None),
            ttl,
        }
    }

    pub async fn get(&self, key: &str) -> Option<T> {
        let guard = self.inner.read().await;
        guard.as_ref().and_then(|entry| {
            if entry.key == key && entry.created_at.elapsed() < self.ttl {
                Some(entry.data.clone())
            } else {
                None
            }
        })
    }

    /// Cached data past its TTL, for use as a fallback when the upstream fails.
    /// Matches on key like [`Cache::get`], but `max_age` bounds how stale is
    /// still useful: without it a dead upstream pins the last good response
    /// forever, and the caller has no way to tell it apart from a fresh one.
    pub async fn get_stale(&self, key: &str, max_age: Duration) -> Option<T> {
        let guard = self.inner.read().await;
        guard
            .as_ref()
            .filter(|entry| entry.key == key && entry.created_at.elapsed() < max_age)
            .map(|entry| entry.data.clone())
    }

    pub async fn set(&self, key: String, data: T) {
        let mut guard = self.inner.write().await;
        *guard = Some(CacheEntry {
            key,
            data,
            created_at: Instant::now(),
        });
    }

    pub async fn invalidate(&self, key: &str) {
        let mut guard = self.inner.write().await;
        if guard.as_ref().is_some_and(|entry| entry.key == key) {
            *guard = None;
        }
    }

    pub async fn has_data(&self) -> bool {
        self.inner.read().await.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: Duration = Duration::from_secs(3600);

    #[tokio::test]
    async fn get_stale_serves_a_recent_entry_past_its_ttl() {
        let cache = Cache::new(Duration::ZERO); // already expired for `get`
        cache.set("k".into(), 42).await;
        assert_eq!(cache.get("k").await, None);
        assert_eq!(cache.get_stale("k", HOUR).await, Some(42));
    }

    /// The bound is the point of the parameter: an upstream that has been down
    /// long enough must stop resurrecting its last good response.
    #[tokio::test]
    async fn get_stale_refuses_an_entry_older_than_max_age() {
        let cache = Cache::new(HOUR);
        cache.set("k".into(), 42).await;
        assert_eq!(cache.get_stale("k", Duration::ZERO).await, None);
    }

    #[tokio::test]
    async fn get_stale_still_matches_on_key() {
        let cache = Cache::new(HOUR);
        cache.set("k".into(), 42).await;
        assert_eq!(cache.get_stale("other", HOUR).await, None);
    }
}
