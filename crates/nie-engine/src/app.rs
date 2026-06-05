//! Point d'entrée et initialisation de la configuration applicative de `nie.exe`.
//!
//! Porte deux fonctions Ghidra extraites du binaire `nie.exe` (Level-5 Lives,
//! Inazuma Eleven: Victory Road) :
//!
//! | Fonction C          | Adresse         | Symbole Rust              |
//! |---------------------|-----------------|---------------------------|
//! | `entry`             | `0x140985524`   | [`entry`]                 |
//! | `FUN_140ae76b0`     | `0x140ae76b0`   | [`app_config_init`]       |
//!
//! ## Sources
//!
//! - `ghidra-export/decompiled/entry_point.c`
//! - `ghidra-export/decompiled/app_config_init.c`
//!
//! ## Observations RE
//!
//! ### `entry` (`0x140985524`)
//!
//! Le vrai point d'entrée PE de `nie.exe`. Sa structure est typique du CRT MSVC
//! (Visual C++ « security cookie » + SEH wrapper) :
//!
//! ```text
//! void entry(void) {
//!     FUN_140985c68();          // __security_init_cookie (Windows CRT)
//!     __scrt_common_main_seh(); // boucle de message Win32 + main
//! }
//! ```
//!
//! `FUN_140985c68` est `__security_init_cookie` : initialise le cookie stack-canary
//! du CRT MSVC (lu à `__security_cookie` via `GetCurrentProcessId`,
//! `GetCurrentThreadId`, `GetTickCount`, `QueryPerformanceCounter`, etc.).
//!
//! `__scrt_common_main_seh` est la routine de démarrage MSVC qui configure le SEH,
//! initialise le CRT C++ (constructeurs globaux `__cinit`), puis appelle `WinMain` /
//! `main` et propage le code de retour.
//!
//! En Rust, aucune de ces deux responsabilités n'est portée directement : le runtime
//! Rust gère déjà l'initialisation CRT et le panic-handler. Cette fonction est portée
//! comme point de documentation architecturale + modèle du séquençage bootstrap.
//!
//! ### `app_config_init` (`0x140ae76b0`)
//!
//! Initialise la configuration de l'application en chargeant le fichier de
//! configuration canonique du moteur :
//!
//! ```text
//! common/system/app_config_5.00.24.00.cfg.bin
//! ```
//!
//! La version `5.00.24.00` est encodée en dur dans le binaire et correspond à la
//! version de build du jeu (Inazuma Eleven: Victory Road, Steam App ID 2799860).
//!
//! La seconde opération est un `strlen` + write-NUL manuel sur `param_2` :
//!
//! ```c
//! lVar1 = -1;
//! do {
//!     lVar1 = lVar1 + 1;
//! } while (*(char *)(param_2 + lVar1) != '\0');
//! *(undefined1 *)((int)lVar1 + param_2) = 0;
//! ```
//!
//! Ce pattern Ghidra est un `strlen` sur un buffer C suivi d'un redoublement du
//! NUL terminal. Il s'agit probablement d'une normalisation post-chargement :
//! garantir qu'un buffer de chemin ou de config est correctement terminé après
//! une copie par `memcpy` sans NUL final.
//!
//! En Rust, ce comportement est encapsulé dans [`truncate_to_first_nul`], qui
//! reproduit la logique byte-par-byte du C et retourne la longueur calculée.
//!
//! `param_1` (`undefined8`) est le handle ou contexte du sous-système de fichiers
//! (non utilisé directement dans la logique visible — il est passé opaque à
//! `FUN_140468ee0`, le chargeur de fichier VFS interne).

// ---------------------------------------------------------------------------
// Constantes extraites fidèlement du code C décompilé
// ---------------------------------------------------------------------------

/// Chemin du fichier de configuration applicative principal.
///
/// Valeur littérale hardcodée dans `FUN_140ae76b0` :
/// ```c
/// FUN_140468ee0("common/system/app_config_5.00.24.00.cfg.bin");
/// ```
///
/// La version `5.00.24.00` est la version de build du moteur Level-5 Lives
/// (Inazuma Eleven: Victory Road, Steam App ID 2799860).
pub const APP_CONFIG_PATH: &str = "common/system/app_config_5.00.24.00.cfg.bin";

/// Numéro de version du moteur encodé dans le chemin de configuration.
///
/// Format : `<major>.<minor>.<patch>.<build>`.
/// Extrait de `app_config_5.00.24.00.cfg.bin` — cf. [`APP_CONFIG_PATH`].
pub const ENGINE_VERSION: &str = "5.00.24.00";

// ---------------------------------------------------------------------------
// EXTERN stubs documentés
// ---------------------------------------------------------------------------

// EXTERN: FUN_140985c68 — __security_init_cookie (CRT MSVC Windows).
//   Initialise le cookie de protection stack-canary via entropy système
//   (GetCurrentProcessId, GetCurrentThreadId, GetTickCount,
//   QueryPerformanceCounter, RtlGenRandom).
//   Adresse: 0x140985c68.
//   Signature C : void FUN_140985c68(void).

// EXTERN: __scrt_common_main_seh — boucle de démarrage CRT MSVC.
//   Configure le SEH, exécute les constructeurs globaux C++ (__cinit),
//   appelle WinMain/main, propage le code de retour.
//   Adresse: symbole importé MSVC (pas résolu Ghidra).
//   Signature C : void __scrt_common_main_seh(void).

// EXTERN: FUN_140468ee0 — chargeur VFS interne (cfg.bin loader).
//   Charge un fichier depuis le virtual filesystem du moteur Level-5.
//   Signature : fn(path: *const char) -> undefined8 (handle ou 0 si erreur).
//   Adresse: 0x140468ee0.
//   Utilisé : FUN_140ae76b0 L11 — `FUN_140468ee0("common/system/app_config_5.00.24.00.cfg.bin")`.

// ---------------------------------------------------------------------------
// Types locaux
// ---------------------------------------------------------------------------

/// Résultat d'initialisation de la configuration applicative.
///
/// Porte sémantique du retour implicite `void` de `FUN_140ae76b0`.
/// En Rust, on enrichit avec un état observable pour les tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppConfigResult {
    /// Chargement déclenché avec succès, longueur NUL calculée.
    ///
    /// `nul_offset` reproduit la valeur de `lVar1` à la fin de la boucle
    /// `do { lVar1++ } while (*(char*)(param_2+lVar1) != '\0')`.
    Ok {
        /// Indice du NUL terminal calculé par la boucle `strlen` du C.
        ///
        /// Correspond à `lVar1` après la boucle (= longueur de la chaîne).
        nul_offset: usize,
    },
    /// `param_2` est vide (longueur zéro) — NUL déjà en position 0.
    ///
    /// La boucle C s'arrête immédiatement ; `lVar1 = 0`.
    EmptyBuffer,
}

// ---------------------------------------------------------------------------
// entry — `entry` @ 0x140985524 (entry_point.c)
// ---------------------------------------------------------------------------

/// Point d'entrée PE de `nie.exe`.
///
/// Porte de : `entry` (`entry_point.c`, adresse `0x140985524`).
///
/// ## Logique C reproduite
///
/// ```c
/// void entry(void) {
///     FUN_140985c68();          // EXTERN: __security_init_cookie
///     __scrt_common_main_seh(); // EXTERN: boucle démarrage CRT MSVC
/// }
/// ```
///
/// ## Séquençage bootstrap (RE documenté)
///
/// 1. **Cookie de sécurité** (`FUN_140985c68`) — initialise `__security_cookie`
///    avec de l'entropy système. Empêche les attaques stack-smashing détectables
///    par le CRT MSVC.
/// 2. **Boucle de démarrage CRT** (`__scrt_common_main_seh`) — configure le SEH,
///    appelle les constructeurs globaux C++, puis `WinMain` ou `main`.
///
/// ## Portage Rust
///
/// En Rust le runtime initialise lui-même ses invariants ; les deux EXTERN
/// sont des responsabilités du système hôte, pas du code moteur. Cette fonction
/// est portée comme point de documentation architecturale uniquement.
///
/// Les deux étapes sont modélisées par le type [`BootstrapStep`] retourné
/// pour permettre aux tests de valider le séquençage.
///
/// # Exemples
///
/// ```rust
/// use nie_engine::app::{entry, BootstrapStep};
///
/// let steps = entry();
/// assert_eq!(steps[0], BootstrapStep::SecurityCookieInit);
/// assert_eq!(steps[1], BootstrapStep::CrtMainSeh);
/// ```
#[must_use]
pub fn entry() -> [BootstrapStep; 2] {
    // C: FUN_140985c68(); — EXTERN: __security_init_cookie
    // C: __scrt_common_main_seh(); — EXTERN: CRT startup
    [BootstrapStep::SecurityCookieInit, BootstrapStep::CrtMainSeh]
}

/// Étape du séquençage bootstrap de `nie.exe`.
///
/// Modélise les deux appels de `entry()` pour permettre la validation RE
/// du séquençage sans dépendance sur les fonctions EXTERN Windows.
///
/// Porte de : `entry_point.c` — séquence `FUN_140985c68` → `__scrt_common_main_seh`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BootstrapStep {
    /// `FUN_140985c68` — initialisation du cookie de sécurité stack-canary MSVC.
    ///
    /// Correspond à `__security_init_cookie` dans le runtime MSVC.
    /// Doit être la **première** opération du processus.
    SecurityCookieInit,

    /// `__scrt_common_main_seh` — boucle de démarrage SEH + CRT + WinMain.
    ///
    /// Exécutée **après** l'initialisation du cookie. Appelle les constructeurs
    /// globaux C++ (`__cinit`) et entre dans la boucle de message Win32.
    CrtMainSeh,
}

// ---------------------------------------------------------------------------
// app_config_init — FUN_140ae76b0 @ 0x140ae76b0 (app_config_init.c)
// ---------------------------------------------------------------------------

/// Initialise la configuration applicative du moteur Level-5 Lives.
///
/// Porte de : `FUN_140ae76b0` (`app_config_init.c`, adresse `0x140ae76b0`).
///
/// ## Logique C reproduite
///
/// ```c
/// void FUN_140ae76b0(undefined8 param_1, longlong param_2) {
///     // 1. Charge le fichier de config principal (EXTERN VFS)
///     FUN_140468ee0("common/system/app_config_5.00.24.00.cfg.bin");
///
///     // 2. strlen manuel + redoublement NUL terminal sur param_2
///     longlong lVar1 = -1;
///     do {
///         lVar1 = lVar1 + 1;
///     } while (*(char *)(param_2 + lVar1) != '\0');
///     *(undefined1 *)((int)lVar1 + param_2) = 0;
/// }
/// ```
///
/// ## Étape 1 — chargement VFS (`FUN_140468ee0`)
///
/// Charge `common/system/app_config_5.00.24.00.cfg.bin` via le VFS interne
/// du moteur (EXTERN non portée). La version `5.00.24.00` est hardcodée.
///
/// ## Étape 2 — normalisation NUL (`strlen` + write)
///
/// La boucle est un `strlen` classique initialisé à `-1` (pattern MSVC/Ghidra
/// fréquent pour éviter une variable temporaire) suivi d'une écriture du NUL
/// terminal à la position calculée. Cela garantit que le buffer `param_2` est
/// proprement terminé même après une copie sans NUL.
///
/// En Rust, `param_2` est représenté par une slice mutable `buf`. La fonction
/// [`truncate_to_first_nul`] encapsule la logique de la boucle.
///
/// ## Paramètres Rust
///
/// - `buf` : slice mutable représentant `param_2` (buffer de chaîne C).
///   La fonction cherche le premier octet NUL et redouble l'écriture à cet indice.
///
/// `param_1` (`undefined8`, handle VFS) est opaque à la logique visible —
/// il est passé directement à `FUN_140468ee0` (EXTERN) et non utilisé autrement.
///
/// ## Retour
///
/// [`AppConfigResult::Ok`] avec l'indice du NUL calculé, ou
/// [`AppConfigResult::EmptyBuffer`] si `buf` est vide.
///
/// # Exemples
///
/// ```rust
/// use nie_engine::app::{app_config_init, AppConfigResult};
///
/// // Buffer contenant "hello\0..." — la boucle trouve le NUL à l'index 5.
/// let mut buf = b"hello\0world".to_vec();
/// let result = app_config_init(&mut buf);
/// assert_eq!(result, AppConfigResult::Ok { nul_offset: 5 });
/// // Le NUL est bien en position 5 (redoublement confirmé).
/// assert_eq!(buf[5], 0);
///
/// // Buffer vide → EmptyBuffer (lVar1 reste 0 sans itération).
/// let mut empty: Vec<u8> = vec![];
/// assert_eq!(app_config_init(&mut empty), AppConfigResult::EmptyBuffer);
/// ```
pub fn app_config_init(buf: &mut [u8]) -> AppConfigResult {
    // C: FUN_140468ee0("common/system/app_config_5.00.24.00.cfg.bin");
    // EXTERN: FUN_140468ee0 — chargeur VFS (non portable sans runtime moteur)
    // Le chargement du fichier est documenté via APP_CONFIG_PATH.

    // C:
    //   longlong lVar1 = -1;
    //   do {
    //       lVar1 = lVar1 + 1;
    //   } while (*(char *)(param_2 + lVar1) != '\0');
    //   *(undefined1 *)((int)lVar1 + param_2) = 0;
    //
    // Reproduit fidèlement : initialisation à -1 simulée en commençant à 0
    // avec do-while (le C incrémente avant le test en pratique).
    let nul_offset = truncate_to_first_nul(buf);

    match nul_offset {
        Some(idx) => {
            // C: *(undefined1 *)((int)lVar1 + param_2) = 0;
            // Le NUL est déjà présent ; on le réécrit fidèlement (redoublement).
            buf[idx] = 0;
            AppConfigResult::Ok { nul_offset: idx }
        }
        None => AppConfigResult::EmptyBuffer,
    }
}

// ---------------------------------------------------------------------------
// truncate_to_first_nul — boucle strlen du C (helper interne)
// ---------------------------------------------------------------------------

/// Reproduit la boucle `strlen` manuel de `FUN_140ae76b0`.
///
/// Porte de : boucle `do { lVar1++ } while (*(char*)(param_2+lVar1) != '\0')`
/// dans `app_config_init.c`.
///
/// Cherche le premier octet `0x00` dans `buf` et retourne son indice.
/// Retourne `None` si `buf` est vide (la boucle C serait UB sur un buffer vide).
///
/// ## Comportement C fidèle
///
/// La boucle C initialise `lVar1 = -1` puis incrémente avant le test, donc :
/// - Si `param_2[0] == '\0'` → `lVar1 = 0` après la première itération.
/// - Si `param_2[0..n-1]` sont non-NUL et `param_2[n] == '\0'` → `lVar1 = n`.
///
/// # Exemples
///
/// ```rust
/// use nie_engine::app::truncate_to_first_nul;
///
/// assert_eq!(truncate_to_first_nul(b"abc\0xyz"), Some(3));
/// assert_eq!(truncate_to_first_nul(b"\0abc"),   Some(0));
/// assert_eq!(truncate_to_first_nul(b""),         None);
/// // Pas de NUL dans le buffer : retourne l'indice hors-borne (len)
/// // RE incertain: le C serait UB ici (overflow lVar1 sans NUL)
/// assert_eq!(truncate_to_first_nul(b"abc"),      Some(3));
/// ```
#[must_use]
pub fn truncate_to_first_nul(buf: &[u8]) -> Option<usize> {
    if buf.is_empty() {
        // C: buffer vide → la boucle do-while serait UB (param_2 = NULL ou len=0).
        // On modélise ce cas comme None pour sécurité Rust.
        return None;
    }

    // C: lVar1 = -1; do { lVar1++; } while (buf[lVar1] != 0);
    // → Équivalent à position(b'\0') si présent, sinon buf.len() (débordement UB en C).
    // RE incertain: si pas de NUL, le C déborde ; on sature à buf.len() en Rust.
    let idx = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    Some(idx)
}

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- entry ---

    #[test]
    fn entry_retourne_deux_etapes() {
        let steps = entry();
        assert_eq!(steps.len(), 2);
    }

    #[test]
    fn entry_premiere_etape_est_security_cookie() {
        // C: FUN_140985c68() appelé EN PREMIER — invariant du CRT MSVC.
        let steps = entry();
        assert_eq!(steps[0], BootstrapStep::SecurityCookieInit);
    }

    #[test]
    fn entry_deuxieme_etape_est_crt_seh() {
        // C: __scrt_common_main_seh() appelé APRES le cookie.
        let steps = entry();
        assert_eq!(steps[1], BootstrapStep::CrtMainSeh);
    }

    #[test]
    fn bootstrap_steps_sont_distincts() {
        assert_ne!(BootstrapStep::SecurityCookieInit, BootstrapStep::CrtMainSeh);
    }

    // --- truncate_to_first_nul ---

    #[test]
    fn strlen_buffer_vide_retourne_none() {
        // C: buffer vide = UB ; Rust retourne None.
        assert_eq!(truncate_to_first_nul(b""), None);
    }

    #[test]
    fn strlen_nul_en_position_zero() {
        // C: lVar1 = 0 après première itération (buf[0] == '\0').
        assert_eq!(truncate_to_first_nul(b"\0abc"), Some(0));
    }

    #[test]
    fn strlen_nul_en_milieu() {
        // C: lVar1 = 3 (buf[3] == '\0').
        assert_eq!(truncate_to_first_nul(b"abc\0xyz"), Some(3));
    }

    #[test]
    fn strlen_nul_a_la_fin() {
        // C: lVar1 = 4 (buf[4] == '\0').
        assert_eq!(truncate_to_first_nul(b"abcd\0"), Some(4));
    }

    #[test]
    fn strlen_sans_nul_retourne_len() {
        // RE incertain: en C ce serait UB (overflow) ; on sature à len.
        assert_eq!(truncate_to_first_nul(b"abc"), Some(3));
    }

    #[test]
    fn strlen_buffer_un_octet_nul() {
        assert_eq!(truncate_to_first_nul(b"\0"), Some(0));
    }

    #[test]
    fn strlen_buffer_un_octet_non_nul() {
        // RE incertain: UB en C → Some(1) (= len) en Rust.
        assert_eq!(truncate_to_first_nul(b"x"), Some(1));
    }

    // --- app_config_init ---

    #[test]
    fn app_config_init_buffer_vide_retourne_empty_buffer() {
        let mut buf: Vec<u8> = vec![];
        assert_eq!(app_config_init(&mut buf), AppConfigResult::EmptyBuffer);
    }

    #[test]
    fn app_config_init_retourne_nul_offset() {
        // "hello\0world" → lVar1 = 5
        let mut buf = b"hello\0world".to_vec();
        let result = app_config_init(&mut buf);
        assert_eq!(result, AppConfigResult::Ok { nul_offset: 5 });
    }

    #[test]
    fn app_config_init_reecrit_nul_a_la_position_calculee() {
        // C: *(undefined1 *)((int)lVar1 + param_2) = 0; — redoublement du NUL.
        let mut buf = b"cfg\0data".to_vec();
        app_config_init(&mut buf);
        // Position 3 doit être 0 (confirmé après appel).
        assert_eq!(buf[3], 0);
    }

    #[test]
    fn app_config_init_nul_en_position_zero() {
        // C: lVar1 = 0 → buf[0] reste 0.
        let mut buf = b"\0rest".to_vec();
        let result = app_config_init(&mut buf);
        assert_eq!(result, AppConfigResult::Ok { nul_offset: 0 });
        assert_eq!(buf[0], 0);
    }

    #[test]
    fn app_config_init_nul_a_la_fin() {
        let mut buf = b"end\0".to_vec();
        let result = app_config_init(&mut buf);
        assert_eq!(result, AppConfigResult::Ok { nul_offset: 3 });
    }

    #[test]
    fn app_config_path_est_exact() {
        // Valeur hardcodée dans entry_point.c L11.
        assert_eq!(APP_CONFIG_PATH, "common/system/app_config_5.00.24.00.cfg.bin");
    }

    #[test]
    fn engine_version_est_extraite_du_path() {
        // La version est le segment entre "app_config_" et ".cfg.bin".
        assert!(APP_CONFIG_PATH.contains(ENGINE_VERSION));
        assert_eq!(ENGINE_VERSION, "5.00.24.00");
    }

    #[test]
    fn app_config_result_ok_champs_coherents() {
        let mut buf = b"abc\0".to_vec();
        if let AppConfigResult::Ok { nul_offset } = app_config_init(&mut buf) {
            assert_eq!(buf[nul_offset], 0);
        } else {
            panic!("attendu Ok");
        }
    }

    #[test]
    fn bootstrap_step_est_copy() {
        // BootstrapStep doit implémenter Copy pour usage sans clone explicite.
        let step = BootstrapStep::SecurityCookieInit;
        let _step2 = step; // move
        let _step3 = step; // copy (si Copy est impl)
    }
}
