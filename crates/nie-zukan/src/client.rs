//! Client HTTP poli pour le Zukan Inagle.
//!
//! Caractéristiques :
//! - Concurrence limitée à 4-6 requêtes parallèles
//! - Rate-limit : 300 ms entre requêtes (politesse Level-5)
//! - Retry avec backoff exponentiel (3 tentatives max)
//! - Cache disque sous `var/zukan/<lang>/<route>/<key>.html`
//! - Ne re-fetche pas les fichiers existants (reprise)

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tracing::{debug, warn};

/// Base URL du Zukan.
pub const BASE_URL: &str = "https://zukan.inazuma.jp";

/// User-Agent poli identifiant notre outil.
pub const USER_AGENT: &str =
    "Mozilla/5.0 (niers-zukan-ingestor/0.1; +https://rosegriffon.fr; respectful-scraper)";

/// Délai minimum entre deux requêtes (politesse serveur Level-5).
pub const RATE_LIMIT_MS: u64 = 350;

/// Nombre de tentatives max en cas d'erreur HTTP transitoire.
pub const MAX_RETRIES: u32 = 3;

/// Client HTTP avec cache disque.
pub struct ZukanClient {
    inner: reqwest::blocking::Client,
    cache_root: PathBuf,
}

impl ZukanClient {
    /// Crée un nouveau client. `cache_root` est le répertoire racine du cache
    /// (ex. `/home/ubuntu/niers/var/zukan`).
    pub fn new(cache_root: PathBuf) -> Result<Self> {
        let inner = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .context("construction du client HTTP")?;
        Ok(Self { inner, cache_root })
    }

    /// Retourne le chemin de cache pour une URL donnée.
    ///
    /// `cache_key` est un identifiant opaque (ex. `page_1`, `c01000010`).
    #[must_use]
    pub fn cache_path(&self, lang: &str, route: &str, cache_key: &str) -> PathBuf {
        self.cache_root
            .join(lang)
            .join(route)
            .join(format!("{cache_key}.html"))
    }

    /// Récupère une URL avec cache disque.
    ///
    /// Si le fichier cache existe, le contenu est retourné sans requête HTTP.
    /// Sinon la requête est effectuée avec retry + backoff, et le résultat est
    /// sauvegardé sur disque.
    pub fn get_cached(&self, url: &str, cache_path: &Path) -> Result<String> {
        // Vérifier le cache d'abord
        if cache_path.exists() {
            debug!(path = %cache_path.display(), "cache hit");
            return std::fs::read_to_string(cache_path).context("lecture cache");
        }

        // Requête HTTP avec retry
        let content = self.fetch_with_retry(url)?;

        // Sauvegarder dans le cache
        if let Some(parent) = cache_path.parent() {
            std::fs::create_dir_all(parent).context("création répertoire cache")?;
        }
        std::fs::write(cache_path, &content).context("écriture cache")?;
        debug!(path = %cache_path.display(), "cache miss → sauvegardé");

        Ok(content)
    }

    /// Effectue une requête HTTP avec retry et backoff exponentiel.
    fn fetch_with_retry(&self, url: &str) -> Result<String> {
        let mut last_err: anyhow::Error = anyhow::anyhow!("aucune tentative");
        for attempt in 0..MAX_RETRIES {
            if attempt > 0 {
                let delay_ms = 500u64 * 2u64.pow(attempt - 1);
                warn!(url, attempt, delay_ms, "retry après erreur");
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
            match self.inner.get(url).send() {
                Ok(resp) if resp.status().is_success() => {
                    let text = resp.text().context("lecture corps HTTP")?;
                    // Rate-limiting poli
                    std::thread::sleep(Duration::from_millis(RATE_LIMIT_MS));
                    return Ok(text);
                }
                Ok(resp) => {
                    last_err = anyhow::anyhow!("HTTP {}: {}", resp.status(), url);
                    warn!(status = %resp.status(), url, "réponse non-2xx");
                }
                Err(e) => {
                    last_err = anyhow::anyhow!("erreur réseau: {e} — URL: {url}");
                    warn!(error = %e, url, "erreur réseau");
                }
            }
        }
        Err(last_err.context(format!("échec après {MAX_RETRIES} tentatives: {url}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_path_structure() {
        let client = ZukanClient::new(PathBuf::from("/tmp/test-cache")).unwrap();
        let p = client.cache_path("ja", "chara_list", "page_1");
        assert_eq!(
            p,
            PathBuf::from("/tmp/test-cache/ja/chara_list/page_1.html")
        );
    }

    #[test]
    fn cache_path_fr() {
        let client = ZukanClient::new(PathBuf::from("/tmp/test-cache")).unwrap();
        let p = client.cache_path("fr", "chara_param", "c01000010");
        assert_eq!(
            p,
            PathBuf::from("/tmp/test-cache/fr/chara_param/c01000010.html")
        );
    }
}
