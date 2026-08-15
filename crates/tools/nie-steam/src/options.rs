//! Options de téléchargement Steam.
//!
//! Port de `IECODE.Core/Steam/Content/SteamDownloadOptions.cs` (C#).
//! Couvre l'ensemble des paramètres de `SteamDownloadOptions` + les types
//! auxiliaires (`SteamGuardKind`, `SteamDownloadPhase`, `SteamDownloadProgress`,
//! `SteamDepotInfo`, `SteamDownloadResult`).
//!
//! Défauts IEVR : app 2799860, branche `"public"`, OS `"windows"`, langue `"english"`.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use crate::IEVR_STEAM_APP_ID;

// ─── Steam Guard ──────────────────────────────────────────────────────────────

/// Type de second facteur Steam Guard demandé pendant l'authentification.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SteamGuardKind {
    /// Code à 5 caractères de l'application mobile Steam (authenticator).
    Device,
    /// Code envoyé par e-mail.
    Email,
}

/// Future boxée retournée par [`SteamGuardProvider::get_code`].
/// Permet la dyn-compatibilité du trait.
pub type GuardCodeFuture = Pin<Box<dyn Future<Output = anyhow::Result<String>> + Send>>;

/// Trait à implémenter côté appelant pour fournir un code 2FA Steam Guard.
///
/// En CLI : lit depuis `stdin` ou la variable d'environnement `STEAM_GUARD_CODE`.
/// En mode automatisé : renvoie le code depuis la configuration.
///
/// Utilise un return type `Pin<Box<dyn Future>>` pour être dyn-compatible et
/// stocker dans `Arc<dyn SteamGuardProvider>`.
pub trait SteamGuardProvider: Send + Sync {
    /// Fournit le code Steam Guard.
    ///
    /// # Paramètres
    /// - `kind` : `Device` (app mobile) ou `Email`
    /// - `email` : adresse masquée (si `kind == Email`)
    /// - `previous_incorrect` : `true` si le code précédent a été rejeté
    fn get_code(
        &self,
        kind: SteamGuardKind,
        email: Option<&str>,
        previous_incorrect: bool,
    ) -> GuardCodeFuture;
}

/// Implémentation `SteamGuardProvider` depuis la variable d'environnement
/// `STEAM_GUARD_CODE`. Pratique pour les runs CI non-interactifs.
#[derive(Clone, Debug, Default)]
pub struct EnvGuardProvider;

impl SteamGuardProvider for EnvGuardProvider {
    fn get_code(
        &self,
        _kind: SteamGuardKind,
        _email: Option<&str>,
        _previous_incorrect: bool,
    ) -> GuardCodeFuture {
        Box::pin(async {
            std::env::var("STEAM_GUARD_CODE").map_err(|_| {
                anyhow::anyhow!(
                    "Steam Guard (2FA) requis. Définissez STEAM_GUARD_CODE=<code> \
                     dans l'environnement."
                )
            })
        })
    }
}

// ─── Options de download ──────────────────────────────────────────────────────

/// Options complètes du téléchargement natif d'une app Steam.
///
/// Préférer [`SteamDownloadOptions::ievr()`] pour l'app IEVR (app 2799860).
pub struct SteamDownloadOptions {
    /// App ID Steam (ex. [`IEVR_STEAM_APP_ID`] = 2799860).
    pub app_id: u32,

    /// Répertoire d'installation cible (sera créé si absent).
    pub install_dir: PathBuf,

    /// Compte Steam possédant l'app. `None` → login anonyme (jeux gratuits seulement).
    pub username: Option<String>,

    /// Mot de passe. Ignoré si un refresh token est en cache pour ce compte.
    pub password: Option<String>,

    /// Branche (défaut `"public"`).
    pub branch: String,

    /// Mot de passe de branche bêta (optionnel).
    pub beta_password: Option<String>,

    /// OS ciblé pour le filtrage des depots (`"windows"` / `"macos"` / `"linux"`).
    /// Défaut : `"windows"` (IEVR est une app Windows).
    pub os: String,

    /// Architecture ciblée (`"64"` / `"32"`). `None` → pas de filtre arch.
    pub arch: Option<String>,

    /// Langue ciblée pour les depots localisés. Défaut `"english"`.
    pub language: String,

    /// Ne pas filtrer par OS/arch/langue : télécharge tous les depots.
    pub all_platforms: bool,

    /// Restreint à ces depot IDs (vide → tous les depots éligibles de l'app).
    pub depot_ids: Vec<u32>,

    /// Nombre de chunks téléchargés en parallèle. Défaut : 16.
    pub max_downloads: usize,

    /// Vérifie chaque fichier existant (taille + SHA) contre le manifest et
    /// **saute** ceux déjà à jour, au lieu de tout retélécharger.
    ///
    /// Essentiel pour une MAJ *en place* d'une install existante : sans lui,
    /// steamroom réécrit l'intégralité du depot (aucun skip, aucun delta en
    /// mode atomique). Défaut : `true`.
    pub verify: bool,

    /// Chemin du fichier JSON de cache des jetons (refresh token + guard data) par compte.
    ///
    /// `None` → pas de persistance (2FA redemandé à chaque run).
    /// Défaut : [`crate::token_store::default_path()`].
    pub token_store_path: Option<PathBuf>,

    /// Fournisseur de codes Steam Guard (2FA). `None` → utilise [`EnvGuardProvider`].
    pub guard_provider: Option<std::sync::Arc<dyn SteamGuardProvider>>,

    /// Délai sans le moindre événement de progression au-delà duquel le
    /// téléchargement est déclaré bloqué et interrompu. `None` → pas de garde.
    ///
    /// Sans cette garde, un depot peut s'arrêter **définitivement** sans rien
    /// signaler : si tous les serveurs CDN passent en cooldown, chaque tâche de
    /// chunk part en `sleep`, le process tombe à zéro CPU et zéro socket, et
    /// plus rien ne le réveille. Observé le 2026-08-15 (figé à 00:21:22, encore
    /// vivant et inerte des heures après).
    ///
    /// Le seuil doit dépasser le temps de vérification du **plus gros fichier**
    /// du depot : la passe `verify` lit et hache chaque fichier existant sans
    /// émettre d'événement entre-temps (4,26 Gio sur IEVR ≈ 90 s). Défaut : 300 s.
    pub stall_timeout: Option<Duration>,
}

impl SteamDownloadOptions {
    /// Options préréglées pour l'app IEVR (app 2799860, branche `public`, OS windows).
    ///
    /// Champ `install_dir` à renseigner.
    ///
    /// ```
    /// use nie_steam::options::SteamDownloadOptions;
    /// use std::path::PathBuf;
    ///
    /// let opts = SteamDownloadOptions::ievr(PathBuf::from("/tmp/ievr"));
    /// assert_eq!(opts.app_id, 2799860);
    /// assert_eq!(opts.branch, "public");
    /// assert_eq!(opts.os, "windows");
    /// ```
    pub fn ievr(install_dir: PathBuf) -> Self {
        Self {
            app_id: IEVR_STEAM_APP_ID,
            install_dir,
            username: None,
            password: None,
            branch: "public".to_owned(),
            beta_password: None,
            os: "windows".to_owned(),
            arch: None,
            language: "english".to_owned(),
            all_platforms: false,
            depot_ids: vec![],
            max_downloads: 16,
            verify: true,
            token_store_path: Some(crate::token_store::default_path()),
            guard_provider: None,
            stall_timeout: Some(Duration::from_secs(300)),
        }
    }
}

impl Default for SteamDownloadOptions {
    fn default() -> Self {
        Self::ievr(PathBuf::from("."))
    }
}

// ─── Types de progression ─────────────────────────────────────────────────────

/// Phase courante du téléchargement.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SteamDownloadPhase {
    Connecting,
    LoggingIn,
    FetchingAppInfo,
    FetchingManifests,
    Downloading,
    Completed,
    Error,
}

/// Progression du téléchargement.
#[derive(Clone, Debug)]
pub struct SteamDownloadProgress {
    pub phase: SteamDownloadPhase,
    pub message: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

impl SteamDownloadProgress {
    /// Pourcentage d'avancement (0.0–100.0). `0.0` si `total_bytes == 0`.
    pub fn percent_complete(&self) -> f64 {
        if self.total_bytes > 0 {
            self.downloaded_bytes as f64 * 100.0 / self.total_bytes as f64
        } else {
            0.0
        }
    }
}

// ─── Résultats ────────────────────────────────────────────────────────────────

/// Résumé d'un depot inspecté en mode `list` (sans téléchargement).
#[derive(Clone, Debug)]
pub struct DepotInfo {
    pub depot_id: u32,
    pub manifest_id: u64,
    pub name: Option<String>,
    pub file_count: u32,
    pub total_bytes: u64,
}

/// Cause d'une collision entre une entrée de manifest et l'état du disque.
///
/// Chacune fait échouer le depot ENTIER sur `Is a directory (os error 21)`,
/// sans nommer le coupable : le downloader écrit (ou renomme depuis le
/// staging) sur un chemin qui n'a pas la nature attendue.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CollisionReason {
    /// Chemin vide : `install_dir.join("")` désigne le répertoire d'install
    /// lui-même. Une entrée taille 0 sans chunk y déclenche `fs::write` sur
    /// un répertoire.
    EmptyPath,
    /// Fichier pour le manifest, répertoire sur le disque.
    DirectoryOnDisk,
    /// Répertoire pour le manifest, fichier sur le disque.
    FileOnDisk,
}

impl CollisionReason {
    /// Libellé court en français, pour l'affichage CLI.
    pub fn label(self) -> &'static str {
        match self {
            Self::EmptyPath => "chemin vide (= le répertoire d'install)",
            Self::DirectoryOnDisk => "répertoire sur le disque, fichier au manifest",
            Self::FileOnDisk => "fichier sur le disque, répertoire au manifest",
        }
    }
}

/// Entrée de manifest dont l'application au disque échouerait.
#[derive(Clone, Debug)]
pub struct ManifestCollision {
    /// Depot d'où provient l'entrée.
    pub depot_id: u32,
    /// Chemin déclaré par le manifest, séparateurs normalisés.
    pub path: String,
    /// Flags Steam bruts (`DepotFileFlags` : 1 exécutable, 2 répertoire, …).
    pub flags: u32,
    /// Taille déclarée par le manifest.
    pub size: u64,
    /// Nombre de chunks de l'entrée.
    pub chunk_count: usize,
    /// Nature du conflit.
    pub reason: CollisionReason,
}

/// Résultat agrégé d'un téléchargement d'app.
#[derive(Clone, Debug)]
pub struct DownloadResult {
    pub success: bool,
    pub error: Option<String>,
    pub app_id: u32,
    pub install_dir: PathBuf,
    pub depots: Vec<u32>,
    pub downloaded_bytes: u64,
    pub file_count: u64,
    pub duration: Duration,
}

impl DownloadResult {
    /// Résultat d'erreur condensé.
    pub(crate) fn err(app_id: u32, install_dir: PathBuf, msg: &str, duration: Duration) -> Self {
        Self {
            success: false,
            error: Some(msg.to_owned()),
            app_id,
            install_dir,
            depots: vec![],
            downloaded_bytes: 0,
            file_count: 0,
            duration,
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ievr_defaults() {
        let opts = SteamDownloadOptions::ievr(PathBuf::from("/tmp/test"));
        assert_eq!(opts.app_id, 2799860);
        assert_eq!(opts.branch, "public");
        assert_eq!(opts.os, "windows");
        assert_eq!(opts.language, "english");
        assert_eq!(opts.arch, None);
        assert!(!opts.all_platforms);
        assert!(opts.depot_ids.is_empty());
        assert_eq!(opts.max_downloads, 16);
        assert_eq!(opts.install_dir, PathBuf::from("/tmp/test"));
    }

    #[test]
    fn progress_percent_complete() {
        let p = SteamDownloadProgress {
            phase: SteamDownloadPhase::Downloading,
            message: String::new(),
            downloaded_bytes: 50,
            total_bytes: 200,
        };
        assert!((p.percent_complete() - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn progress_percent_zero_when_total_zero() {
        let p = SteamDownloadProgress {
            phase: SteamDownloadPhase::Connecting,
            message: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
        };
        assert_eq!(p.percent_complete(), 0.0);
    }
}
