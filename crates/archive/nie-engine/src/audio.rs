//! Sous-systèmes audio de `nie.exe` — CRI Atom Ex + CRI Mana (Sofdec2).
//!
//! Porte les deux fonctions d'initialisation/création audio identifiées par
//! Ghidra dans le binaire `nie.exe` :
//!
//! - [`criatom_init`] — `FUN_1405b94a0` : initialisation complète du pipeline
//!   CRI Atom Ex (voix, bus, catégories, séquenceur, 3D, server thread…).
//! - [`mana_player_create`] — `FUN_140683a20` : création d'un lecteur
//!   `CriManaSoundEx` pour les cinématiques Sofdec2/USM.
//!
//! # Sources RE
//!
//! - `audio_criatom_init.c` — `FUN_1405b94a0` (adresse 0x1405b94a0)
//! - `audio_mana_player_create.c` — `FUN_140683a20` (adresse 0x140683a20)
//!
//! # Fidélité
//!
//! - Flux de contrôle (validations, branches d'erreur, séquence init) : FIABLE
//! - Noms des sous-systèmes internes (voix, bus, catégories, etc.) : FIABLE
//!   (reconstruits depuis les tailles de blocs et les commentaires Ghidra)
//! - Offsets de structure (`CriManaSoundEx` 0xE0 bytes) : FIABLE
//! - Implémentation interne des sous-systèmes appelés : NON PORTÉE
//!   (représentée par des fonctions EXTERN documentées)
//! - Précision des tailles mémoire calculées dynamiquement : INCERTAINE
//!   (les formules `local_dc * 0x108 + 8` etc. sont portées fidèlement)

// ============================================================================
// EXTERN : fonctions/globals du binaire nie.exe NON portées dans ce fichier.
// Chaque entrée EXTERN correspond à un symbole Ghidra dont la logique interne
// reste à reverser. Elles sont remplacées par des traits/callbacks ou des
// paramètres injectés dans la version Rust.
// ============================================================================
//
// EXTERN: FUN_1405b8d00        — calcul taille workspace CriAtomEx total
// EXTERN: FUN_1405d2dec        — allocateur interne (malloc-like workspace)
// EXTERN: FUN_1405d1f28        — libération workspace interne
// EXTERN: FUN_1405dc080        — init device audio
// EXTERN: FUN_1405b9ae0        — init config de base AtomEx
// EXTERN: FUN_1405ded80        — init système de voix (voice pool)
// EXTERN: FUN_1405deeac        — placement voix dans workspace
// EXTERN: FUN_1405e6e40        — init bus/mixer (local_dc * 0x108 + 8 bytes)
// EXTERN: FUN_1405e98dc        — init playback manager
// EXTERN: FUN_1405ea33c        — placement playback manager dans workspace
// EXTERN: FUN_1405eaba0        — init séquenceur (max_sequences=0x40 fixé)
// EXTERN: FUN_1405ead0c        — placement séquenceur dans workspace
// EXTERN: FUN_1405ee99c        — init tracks (local_158 * 0x150 + 8 bytes)
// EXTERN: FUN_1405e8f58        — init catégories
// EXTERN: FUN_1405e8ff4        — placement catégories dans workspace
// EXTERN: FUN_1405e5900        — init players (local_108 * 0x138 + 0x18 bytes)
// EXTERN: FUN_1405c2984        — calcul taille voice limiter
// EXTERN: FUN_1405c2a8c        — init voice limiter
// EXTERN: FUN_1405bb294        — init faders
// EXTERN: FUN_1405bfab0        — init 3D positioning
// EXTERN: FUN_1405f5ff8        — init beat sync
// EXTERN: FUN_1405f5be4        — init tweens
// EXTERN: FUN_1405d55ec        — init server thread
// EXTERN: FUN_1405d0538        — log erreur (format printf, niveau error)
// EXTERN: FUN_1405d051c        — log erreur (format string simple)
// EXTERN: FUN_1405d0550        — log avertissement (format printf)
// EXTERN: FUN_1405d0564        — log erreur avec code
// EXTERN: FUN_1405d0854        — memset/zero_init d'une struct
// EXTERN: FUN_1405d9554        — calcul offset device audio
// EXTERN: FUN_1405d356c        — init paramètre global (local_c8)
// EXTERN: FUN_1405d0a44        — allocation handle RNG (0x48 bytes)
// EXTERN: FUN_1405d34b0        — calcul taille handle RNG
// EXTERN: FUN_1405d34e4        — création handle CriAtomExRngHn
// EXTERN: FUN_1405decc0        — configure période server thread (microsecondes)
// EXTERN: FUN_1405dec5c        — lit flag debug/profiling courant
// EXTERN: FUN_1405d4ad8        — configure mode output (0=défaut, 1=exclusif)
// EXTERN: FUN_1405c2c14        — configure voice limiter (param uStack_d4)
// EXTERN: FUN_1405eabfc        — configure séquenceur (param local_d0)
// EXTERN: FUN_1405ea9a0        — active le server thread
// EXTERN: FUN_1405d12ec        — configure RNG (struct local_res8)
// EXTERN: FUN_1405d164c        — vérifie si le thread courant est le server thread
// EXTERN: FUN_1405d1660        — yield server thread
// EXTERN: FUN_1405d15cc        — enregistre callback server thread (LAB_1405b919c, prio 3)
// EXTERN: FUN_1405c8448        — init sous-système inconnu (spatial/3D?)
// EXTERN: FUN_1405c8c00        — init sous-système inconnu (suite spatial?)
// EXTERN: FUN_1405b9228        — shutdown/rollback de l'init AtomEx (chemin d'échec)
// EXTERN: FUN_1405b99e8        — vérifie si CriAtomEx est déjà initialisé
// EXTERN: DAT_141c735ac        — flag global "CriAtomEx initialisé" (i32)
// EXTERN: DAT_141c73620        — pointeur workspace alloué internement (pour free)
// EXTERN: DAT_141c73630        — handle CriAtomExRngHn[0]
// EXTERN: DAT_141c73638        — handle CriAtomExRngHn[1]
// EXTERN: DAT_141c73648        — flag debug/profiling courant
// EXTERN: DAT_141c73650        — flag mode output exclusif
// EXTERN: DAT_141c73658        — struct config output exclusif
// EXTERN: DAT_141c735c8        — handle allocateur RNG (0 si pas de RNG)
// EXTERN: DAT_141c735d0        — buffer RNG (0x48 bytes)
// EXTERN: DAT_141c735b0        — pointeur vers la version string AtomEx
// EXTERN: DAT_141a3d1c4        — frequence serveur (server_frequency, float)
// EXTERN: DAT_141a3d1c8        — fréquence effective (>=1.0)
// EXTERN: DAT_141a3d1cc        — flag init complète
// EXTERN: DAT_141a3d1d0        — nb threads (>=1, ou local_110 si >1)
// EXTERN: DAT_141a3d1d4        — max_aisacs (byte, <=0x37)
// EXTERN: DAT_141a3d1d5        — max_bus_sends (byte, 1..0x20)
// EXTERN: DAT_141a3d1d8        — categories_per_playback (<=0x10)
//
// EXTERN: FUN_1409e6db4        — allocateur mémoire CriMana (taille, ctx, tag, align)
// EXTERN: FUN_140683230        — constructeur CriManaSoundEx
// EXTERN: FUN_140683870        — récupère config player AtomEx depuis contexte Mana
// EXTERN: FUN_1405ba48c        — calcule taille workspace AtomExPlayer
// EXTERN: FUN_1409e4ea0        — allocateur workspace AtomExPlayer (ctx, taille, tag, align)
// EXTERN: thunk_FUN_1405ba5ec  — criAtomExPlayer_Create (crée le player)
// EXTERN: thunk_FUN_1405bbea8  — criAtomExPlayer_SetMaxChannels (nb canaux sortie)
// EXTERN: thunk_FUN_1405bbd7c  — criAtomExPlayer_SetEventCallback (callback + userdata)
// EXTERN: FUN_140683530        — callback événements playback CriMana
// EXTERN: FUN_1409e51c8        — libération workspace AtomExPlayer

// ============================================================================
// Version string CRI Atom Ex
// ============================================================================

/// Version string embarquée de CRI Atom Ex, extraite depuis `nie.exe`.
///
/// Source: `audio_criatom_init.c` — `_DAT_141c735b0 =
/// "\nCRI AtomEx/PCx64 Ver.2.29.4 Build:Jul  9 2025 22:00:44\n"`
pub const CRIATOM_VERSION: &str = "\nCRI AtomEx/PCx64 Ver.2.29.4 Build:Jul  9 2025 22:00:44\n";

// ============================================================================
// Constantes de validation AtomEx
// ============================================================================

/// Nombre maximal d'AISACs autorisé par la configuration.
///
/// Source: `audio_criatom_init.c` — `if (0x37 < bVar1) { return 0; }`
pub const CRIATOM_MAX_AISACS: u8 = 0x37;

/// Nombre maximal de bus sends autorisé.
///
/// Source: `audio_criatom_init.c` — `if (0x20 < bVar2) { return 0; }`
pub const CRIATOM_MAX_BUS_SENDS: u8 = 0x20;

/// Nombre minimal de bus sends (doit être >= 1).
///
/// Source: `audio_criatom_init.c` — `if (bVar2 == 0) { return 0; }`
pub const CRIATOM_MIN_BUS_SENDS: u8 = 1;

/// Nombre maximal de catégories par playback.
///
/// Source: `audio_criatom_init.c` — message d'erreur
/// `categories_per_playback (%d) is greater than its maximum value` avec borne 0x10.
pub const CRIATOM_MAX_CATEGORIES_PER_PLAYBACK: u32 = 0x10;

/// Nombre maximal de séquences (valeur fixée dans local_140=0x40 avant appel séquenceur).
///
/// Source: `audio_criatom_init.c` — `local_140 = 0x40`
pub const CRIATOM_MAX_SEQUENCES: u32 = 0x40;

/// Canal surround 5.1 pour le player CriMana.
///
/// Source: `audio_mana_player_create.c` — `thunk_FUN_1405bbea8(..., 6)`
/// (6 = 5.1 surround, utilisé pour les cinématiques USM/Sofdec2).
pub const CRIMANA_OUTPUT_CHANNELS_SURROUND_51: u32 = 6;

/// Taille de la structure `CriManaSoundEx` en bytes.
///
/// Source: `audio_mana_player_create.c` — `FUN_1409e6db4(0xe0, param_1, ...)`
pub const CRIMANA_SOUND_EX_SIZE: usize = 0xE0;

// ============================================================================
// Erreurs
// ============================================================================

/// Erreurs du sous-système audio portées depuis les messages d'erreur CRI.
///
/// Les codes `E20XXXXXXXX` sont les codes d'erreur internes CRI Middleware
/// tels qu'ils apparaissent dans le binaire et les logs runtime.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AudioError {
    /// Nombre d'AISACs trop élevé (dépasse [`CRIATOM_MAX_AISACS`]).
    ///
    /// Source: `audio_criatom_init.c` —
    /// `"E2018061401:The maximum number of AISACs which you specified is too large."`
    #[error(
        "E2018061401: nombre max d'AISACs trop grand ({got}), maximum = {max}",
        got = got,
        max = max
    )]
    TooManyAisacs {
        /// Valeur fournie par la configuration.
        got: u8,
        /// Borne maximale autorisée.
        max: u8,
    },

    /// Nombre de bus sends nul (doit être >= 1).
    ///
    /// Source: `audio_criatom_init.c` —
    /// `"E2022052400:The maximum number of bus sends must be at least 1."`
    #[error("E2022052400: le nombre de bus sends doit être >= 1")]
    ZeroBusSends,

    /// Nombre de bus sends trop élevé (dépasse [`CRIATOM_MAX_BUS_SENDS`]).
    ///
    /// Source: `audio_criatom_init.c` —
    /// `"E2021121500:The maximum number of bus sends which you specified is too large."`
    #[error(
        "E2021121500: nombre max de bus sends trop grand ({got}), maximum = {max}",
        got = got,
        max = max
    )]
    TooManyBusSends {
        /// Valeur fournie.
        got: u8,
        /// Borne maximale autorisée.
        max: u8,
    },

    /// Workspace fourni insuffisant (ou allocation interne échouée).
    ///
    /// Source: `audio_criatom_init.c` — `FUN_1405d0564(0, "E2010021570", 0xfffffffd)`
    #[error("E2010021570: workspace insuffisant ou allocation interne échouée (requis={required}, fourni={provided})")]
    WorkspaceInsufficient {
        /// Taille nécessaire calculée.
        required: usize,
        /// Taille fournie (0 si allocation interne échouée).
        provided: usize,
    },

    /// Échec de création du premier handle RNG CriAtomEx.
    ///
    /// Source: `audio_criatom_init.c` —
    /// `"E2011021000:Failed to create CriAtomExRngHn"`
    #[error("E2011021000: échec de création du handle RNG primaire")]
    RngHandlePrimaryFailed,

    /// Échec de création du second handle RNG CriAtomEx.
    ///
    /// Source: `audio_criatom_init.c` —
    /// `"E2011051606:Failed to create CriAtomExRngHn"`
    #[error("E2011051606: échec de création du handle RNG secondaire")]
    RngHandleSecondaryFailed,

    /// Mode output invalide (différent de 0 ou 1).
    ///
    /// Source: `audio_criatom_init.c` — `FUN_1405d0564(0, "E2010111200", 0xfffffffe)`
    #[error("E2010111200: mode output audio invalide ({mode}), valeurs acceptées: 0 (défaut) ou 1 (exclusif)")]
    InvalidOutputMode {
        /// Valeur du mode output fourni.
        mode: u32,
    },

    /// Échec d'allocation du workspace pour le player AtomEx (CriMana).
    ///
    /// Source: `audio_mana_player_create.c` —
    /// `"E2019101601:Failed to allocate criAtomExPlayer work."`
    #[error("E2019101601: échec d'allocation du workspace AtomExPlayer pour CriMana")]
    ManaPlayerWorkspaceAllocFailed,

    /// Échec de création du player AtomEx (CriMana).
    ///
    /// Source: `audio_mana_player_create.c` —
    /// `"E2019101602:Failed to Create criAtomExPlayer."`
    #[error("E2019101602: échec de création du criAtomExPlayer pour CriMana")]
    ManaPlayerCreateFailed,

    /// Échec d'allocation de la structure CriManaSoundEx (0xE0 bytes).
    ///
    /// Source: `audio_mana_player_create.c` — `if (local_88 == 0)` après
    /// `FUN_1409e6db4(0xe0, ...)`.
    #[error("échec d'allocation de CriManaSoundEx ({CRIMANA_SOUND_EX_SIZE} bytes)")]
    ManaSoundExAllocFailed,
}

// ============================================================================
// Configuration CriAtomEx
// ============================================================================

/// Configuration complète de CriAtomEx, portée depuis `CriAtomExConfig`.
///
/// Correspond au bloc pointé par `param_1` dans `FUN_1405b94a0`. Quand
/// `param_1 == NULL`, le moteur applique les valeurs par défaut (champs
/// marqués `Default`).
///
/// Source: `audio_criatom_init.c` — lecture des champs à `param_1 + 0x20`
/// (max_aisacs), `param_1 + 0x21` (max_bus_sends), et divers offsets
/// reconstruits depuis `local_*` variables Ghidra.
///
/// # Invariants vérifiés par [`criatom_init`]
///
/// - `max_aisacs <= 0x37` (sinon `E2018061401`)
/// - `max_bus_sends >= 1` (sinon `E2022052400`)
/// - `max_bus_sends <= 0x20` (sinon `E2021121500`)
/// - `categories_per_playback <= 0x10` (sinon warn + troncature à 0x10)
#[derive(Debug, Clone, PartialEq)]
pub struct CriAtomExConfig {
    /// Nombre maximal d'AISACs par cue (offset +0x20 dans le C).
    ///
    /// Contrainte: `<= CRIATOM_MAX_AISACS` (0x37).
    /// Valeur binaire par défaut observée : 8.
    ///
    /// Source: `audio_criatom_init.c` —
    /// `bVar1 = *(byte *)(param_1 + 0x20)` ; `DAT_141a3d1d4 = bVar1`.
    pub max_aisacs: u8,

    /// Nombre maximal de bus sends (offset +0x21 dans le C).
    ///
    /// Contrainte: `>= 1` et `<= CRIATOM_MAX_BUS_SENDS` (0x20).
    /// Valeur binaire par défaut observée : 8.
    ///
    /// Source: `audio_criatom_init.c` —
    /// `bVar2 = *(byte *)(param_1 + 0x21)` ; `DAT_141a3d1d5 = bVar2`.
    pub max_bus_sends: u8,

    /// Nombre maximal de players AtomEx simultanés.
    ///
    /// Influence la taille du bloc players :
    /// `local_108 * 0x138 + 0x18` bytes.
    ///
    /// Source: `audio_criatom_init.c` — `local_108` utilisé dans
    /// `FUN_1405e5900(local_108, lVar10, iVar3)`.
    /// RE incertain: offset exact dans `CriAtomExConfig`.
    pub max_players: u32,

    /// Nombre maximal de voix simultanées.
    ///
    /// Influence la taille du voice pool via `FUN_1405ded80`.
    ///
    /// Source: `audio_criatom_init.c` — `local_108` partagé avec max_players
    /// dans certains calculs.
    /// RE incertain: distinction exacte players vs voix dans le C décompilé.
    pub max_voices: u32,

    /// Nombre maximal de bus audio (mixer).
    ///
    /// Taille du bloc bus : `local_dc * 0x108 + 8` bytes.
    ///
    /// Source: `audio_criatom_init.c` —
    /// `iVar3 = local_dc * 0x108 + 8` ; `FUN_1405e6e40(local_dc, ...)`.
    pub max_buses: u32,

    /// Nombre maximal de tracks (séquences audio).
    ///
    /// Taille du bloc tracks : `local_158 * 0x150 + 8` bytes.
    ///
    /// Source: `audio_criatom_init.c` —
    /// `iVar3 = local_158 * 0x150 + 8` ; `FUN_1405ee99c(local_158, ...)`.
    pub max_tracks: u32,

    /// Catégories par playback (offset dans CriAtomExConfig).
    ///
    /// Tronqué à [`CRIATOM_MAX_CATEGORIES_PER_PLAYBACK`] (0x10) si dépassé.
    ///
    /// Source: `audio_criatom_init.c` — `local_f4` / `DAT_141a3d1d8`.
    pub categories_per_playback: u32,

    /// Fréquence du server thread en Hz.
    ///
    /// Utilisée pour calculer la période en microsecondes :
    /// `period_us = (num_threads * 1e6) / server_frequency`.
    ///
    /// Source: `audio_criatom_init.c` — `local_114` (float) ;
    /// forcée à `>= 1.0` avant stockage dans `DAT_141a3d1c8`.
    pub server_frequency: f32,

    /// Nombre de threads du server audio.
    ///
    /// Si `> 1`, stocké dans `DAT_141a3d1d0` ; sinon `DAT_141a3d1d0 = 1`.
    ///
    /// Source: `audio_criatom_init.c` — `local_110` / `DAT_141a3d1d0`.
    pub num_threads: u32,

    /// Mode de threading RNG.
    ///
    /// `0` = défaut (pas de RNG), `1` = RNG activé, `2` = RNG alternatif.
    /// Encode `local_118` qui conditionne la construction de `local_res8`
    /// (struct passée à `FUN_1405d12ec`).
    ///
    /// Source: `audio_criatom_init.c` — `local_118` ; branch `if (local_118 == 0)`
    /// / `if ((local_118 == 1) || (local_118 == 2))` / `if (local_118 == 3)`.
    pub rng_mode: u32,

    /// Mode output (0 = défaut shared, 1 = exclusif).
    ///
    /// Source: `audio_criatom_init.c` — `local_d8` ;
    /// `if (local_d8 == 1) { puVar6 = 0x1; }` sinon erreur `E2010111200`.
    pub output_mode: u32,
}

impl Default for CriAtomExConfig {
    /// Valeurs par défaut observées quand `param_1 == NULL` dans `FUN_1405b94a0`.
    ///
    /// Source: `audio_criatom_init.c` —
    /// `if (param_1 == 0) { DAT_141a3d1d4 = 8; bVar2 = 8; }`
    fn default() -> Self {
        Self {
            max_aisacs: 8,
            max_bus_sends: 8,
            // RE incertain: les valeurs par défaut de ces champs ne sont pas
            // directement lisibles dans le décompilé (variables locales non
            // initialisées explicitement quand param_1 == NULL).
            max_players: 32,
            max_voices: 32,
            max_buses: 8,
            max_tracks: 32,
            categories_per_playback: 4,
            server_frequency: 60.0,
            num_threads: 1,
            rng_mode: 0,
            output_mode: 0,
        }
    }
}

// ============================================================================
// Résultat d'initialisation RNG
// ============================================================================

/// Encode la struct `local_res8` construite dans `FUN_1405b94a0` avant
/// d'être passée à `FUN_1405d12ec` (configurateur de RNG).
///
/// La valeur est un discriminant sur `rng_mode` :
///
/// | `rng_mode` | octet bas `local_res8[0..4]` | octet haut (partie 1) |
/// |------------|------------------------------|-----------------------|
/// | 0          | 0                            | 1                     |
/// | 1 ou 2     | 2                            | 1                     |
/// | 3          | (indéfini → retour 0)        | (pas de call)         |
/// | 4          | 0                            | 1                     |
/// | autre      | 2                            | 1                     |
///
/// Source: `audio_criatom_init.c` — construction de `local_res8` via
/// `CONCAT44(1, (undefined4)local_res8)` à `LAB_1405b97f7`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RngConfig {
    /// Partie basse de `local_res8` (4 octets).
    pub low: u32,
    /// Partie haute de `local_res8` — toujours 1 sauf `rng_mode == 3`.
    pub high: u32,
}

impl RngConfig {
    /// Construit la configuration RNG depuis le mode demandé.
    ///
    /// Porte fidèlement les branches `LAB_1405b97db` / `LAB_1405b97f0` /
    /// `LAB_1405b97f7`.
    ///
    /// Source: `audio_criatom_init.c` — bloc conditionnel lignes 214-231.
    #[must_use]
    pub fn from_mode(rng_mode: u32) -> Option<Self> {
        // rng_mode == 3 → local_res8 = 0 → FUN_1405d12ec non appelé → retour 0 (échec)
        // RE incertain : est-ce vraiment un "échec" ou juste un mode "pas de RNG" ?
        // Dans le C, rng_mode==3 mène directement à LAB_1405b9918 (shutdown).
        match rng_mode {
            3 => None,
            // LAB_1405b97f0 : local_res8[0..4] = 0, puis CONCAT44(1, 0)
            0 | 4 => Some(Self { low: 0, high: 1 }),
            // LAB_1405b97db : local_res8[0..4] = 2, puis CONCAT44(1, 2) — couvre 1, 2 et tout autre.
            _ => Some(Self { low: 2, high: 1 }),
        }
    }
}

// ============================================================================
// Workspace mémoire
// ============================================================================

/// Représentation d'un workspace mémoire alloué pour CriAtomEx.
///
/// Dans `FUN_1405b94a0`, le workspace est soit fourni explicitement
/// (`param_2`/`param_3`), soit alloué en interne via `FUN_1405d2dec`.
///
/// En Rust, on modélise ça par une `Vec<u8>` (ownership clair, drop = free).
///
/// Source: `audio_criatom_init.c` — `param_2`/`param_3` + `DAT_141c73620`.
#[derive(Debug)]
pub struct AudioWorkspace {
    /// Données brutes du workspace.
    buf: Vec<u8>,
    /// `true` si alloué en interne (doit être libéré par nous).
    ///
    /// Source: `audio_criatom_init.c` — `DAT_141c73620` stocke le pointeur
    /// si alloué en interne ; reste 0 si fourni par l'appelant.
    owned: bool,
}

impl AudioWorkspace {
    /// Alloue un workspace interne de taille `size` bytes.
    ///
    /// Correspond à `FUN_1405d2dec(iVar3)` dans `FUN_1405b94a0`.
    #[must_use]
    pub fn allocate(size: usize) -> Self {
        Self {
            buf: vec![0u8; size],
            owned: true,
        }
    }

    /// Enveloppe un workspace fourni par l'appelant (pas de libération auto).
    ///
    /// Correspond au cas `param_2 != 0 && param_3 != 0` dans `FUN_1405b94a0`.
    #[must_use]
    pub fn from_external(buf: Vec<u8>) -> Self {
        Self { buf, owned: false }
    }

    /// Taille du workspace en bytes.
    #[must_use]
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    /// Renvoie `true` si le workspace est vide.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// Accès en lecture au buffer brut.
    #[must_use]
    pub fn as_slice(&self) -> &[u8] {
        &self.buf
    }

    /// Accès en écriture au buffer brut.
    #[must_use]
    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.buf
    }

    /// Indique si ce workspace est alloué en interne (owned).
    #[must_use]
    pub fn is_owned(&self) -> bool {
        self.owned
    }
}

// ============================================================================
// Sous-systèmes initialisés
// ============================================================================

/// Énumération des sous-systèmes initialisés par [`criatom_init`], dans
/// l'ordre exact observé dans `FUN_1405b94a0`.
///
/// Source: `audio_criatom_init.c` — séquence des appels FUN_ lignes 151-208.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CriAtomSubsystem {
    /// Device audio physique.
    /// Source: `FUN_1405dc080`
    AudioDevice,
    /// Configuration de base AtomEx.
    /// Source: `FUN_1405b9ae0`
    BaseConfig,
    /// Pool de voix.
    /// Source: `FUN_1405ded80` + `FUN_1405deeac`
    VoicePool,
    /// Bus/mixer.
    /// Source: `FUN_1405e6e40` (taille = `max_buses * 0x108 + 8`)
    BusMixer,
    /// Gestionnaire de playback.
    /// Source: `FUN_1405e98dc` + `FUN_1405ea33c`
    PlaybackManager,
    /// Séquenceur (max_sequences = 0x40 fixé).
    /// Source: `FUN_1405eaba0` + `FUN_1405ead0c`
    Sequencer,
    /// Tracks (taille = `max_tracks * 0x150 + 8`).
    /// Source: `FUN_1405ee99c`
    Tracks,
    /// Catégories audio.
    /// Source: `FUN_1405e8f58` + `FUN_1405e8ff4`
    Categories,
    /// Players AtomEx (taille = `max_players * 0x138 + 0x18`).
    /// Source: `FUN_1405e5900`
    Players,
    /// Voice limiter.
    /// Source: `FUN_1405c2984` + `FUN_1405c2a8c`
    VoiceLimiter,
    /// Faders.
    /// Source: `FUN_1405bb294`
    Faders,
    /// Positionnement 3D.
    /// Source: `FUN_1405bfab0`
    Positioning3D,
    /// Synchronisation beat.
    /// Source: `FUN_1405f5ff8`
    BeatSync,
    /// Tweens (interpolations).
    /// Source: `FUN_1405f5be4`
    Tweens,
    /// Thread serveur audio.
    /// Source: `FUN_1405d55ec`
    ServerThread,
}

/// État d'une session CriAtomEx initialisée.
///
/// Retourné par [`criatom_init`] en cas de succès. Encapsule la configuration
/// validée et le workspace utilisé.
///
/// Source: `audio_criatom_init.c` — `DAT_141c735ac = 1` (flag init complète,
/// dernier write avant `return 1`).
#[derive(Debug)]
pub struct CriAtomExSession {
    /// Configuration validée et normalisée.
    pub config: CriAtomExConfig,
    /// Workspace mémoire utilisé par la session.
    pub workspace: AudioWorkspace,
    /// Version string du runtime CRI Atom Ex.
    ///
    /// Source: `audio_criatom_init.c` — `_DAT_141c735b0 = "CRI AtomEx/PCx64 Ver.2.29.4 ..."`
    pub version: &'static str,
    /// Période effective du server thread en microsecondes.
    ///
    /// Calculée depuis : `period_us = (num_threads * 1_000_000.0) / server_frequency`.
    /// La double addition `local_114 = local_114 + local_114` dans le C correspond
    /// à un doublement intentionnel (buffer double-buffering du server thread).
    ///
    /// Source: `audio_criatom_init.c` — lignes 239-245.
    pub server_period_us: i64,
    /// Sous-systèmes initialisés dans l'ordre.
    pub subsystems: Vec<CriAtomSubsystem>,
    /// Configuration RNG effective (None si `rng_mode == 3`).
    pub rng_config: Option<RngConfig>,
}

// ============================================================================
// Calcul des tailles workspace
// ============================================================================

/// Calcule les tailles de blocs des sous-systèmes AtomEx.
///
/// Porte les formules de taille extraites de `FUN_1405b94a0` :
///
/// - Bus mixer : `max_buses * 0x108 + 8`
/// - Tracks : `max_tracks * 0x150 + 8`
/// - Players : `max_players * 0x138 + 0x18`
///
/// Ces tailles correspondent aux blocs placés séquentiellement dans le
/// workspace via les fonctions `FUN_1405eXXXX`.
///
/// Source: `audio_criatom_init.c` — lignes 157-199.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubsystemSizes {
    /// Taille du bloc bus/mixer en bytes.
    pub bus_mixer: usize,
    /// Taille du bloc tracks en bytes.
    pub tracks: usize,
    /// Taille du bloc players en bytes.
    pub players: usize,
}

impl SubsystemSizes {
    /// Calcule les tailles à partir de la configuration.
    ///
    /// Source: `audio_criatom_init.c` — formules directement portées.
    #[must_use]
    pub fn compute(config: &CriAtomExConfig) -> Self {
        Self {
            // local_dc * 0x108 + 8
            bus_mixer: config.max_buses as usize * 0x108 + 8,
            // local_158 * 0x150 + 8
            tracks: config.max_tracks as usize * 0x150 + 8,
            // local_108 * 0x138 + 0x18
            players: config.max_players as usize * 0x138 + 0x18,
        }
    }

    /// Taille totale estimée (somme des 3 blocs connus).
    ///
    /// Note: d'autres blocs (voix, catégories, playback manager, séquenceur,
    /// voice limiter, 2x handles RNG) s'y ajoutent mais leurs tailles dépendent
    /// de fonctions EXTERN non portées.
    #[must_use]
    pub fn known_total(&self) -> usize {
        self.bus_mixer + self.tracks + self.players
    }
}

// ============================================================================
// Initialisation CriAtomEx — FUN_1405b94a0
// ============================================================================

/// Initialise le pipeline audio CRI Atom Ex.
///
/// Porte `FUN_1405b94a0` (adresse 0x1405b94a0) depuis
/// `audio_criatom_init.c`.
///
/// # Comportement
///
/// 1. Valide la configuration (AISACs, bus sends, catégories).
/// 2. Calcule les tailles de sous-systèmes.
/// 3. Alloue le workspace (interne si `workspace` est `None`).
/// 4. Initialise les sous-systèmes dans l'ordre du binaire.
/// 5. Configure le RNG (2 handles).
/// 6. Configure le server thread.
///
/// # Paramètres
///
/// - `config` — configuration CriAtomEx. `None` correspond à `param_1 == NULL`
///   dans le C (valeurs par défaut appliquées).
/// - `workspace` — workspace mémoire pré-alloué. `None` déclenche une
///   allocation interne (équivalent `param_2 == 0 && param_3 == 0`).
///
/// # Erreurs
///
/// Retourne [`AudioError`] si la validation échoue ou si l'allocation est
/// impossible. Correspond au `return 0` du C (échec).
///
/// # Exemple
///
/// ```rust
/// use nie_engine::audio::{CriAtomExConfig, criatom_init};
///
/// let config = CriAtomExConfig::default();
/// let session = criatom_init(Some(config), None).expect("init audio");
/// assert_eq!(session.version, nie_engine::audio::CRIATOM_VERSION);
/// ```
///
/// Source: `audio_criatom_init.c` — `FUN_1405b94a0`.
pub fn criatom_init(
    config: Option<CriAtomExConfig>,
    workspace: Option<AudioWorkspace>,
) -> Result<CriAtomExSession, AudioError> {
    // ── Étape 1 : résolution de la configuration ──────────────────────────
    // Source: `audio_criatom_init.c` — `if (param_1 == 0) { DAT_141a3d1d4 = 8; bVar2 = 8; }`
    let mut cfg = config.unwrap_or_default();

    // ── Étape 2 : validation AISACs ──────────────────────────────────────
    // Source: `if (0x37 < bVar1) { FUN_1405d0538(0, "E2018061401:..."); return 0; }`
    if cfg.max_aisacs > CRIATOM_MAX_AISACS {
        return Err(AudioError::TooManyAisacs {
            got: cfg.max_aisacs,
            max: CRIATOM_MAX_AISACS,
        });
    }

    // ── Étape 3 : validation bus sends ───────────────────────────────────
    // Source: `if (bVar2 == 0) { FUN_1405d051c(0, "E2022052400:..."); return 0; }`
    if cfg.max_bus_sends == 0 {
        return Err(AudioError::ZeroBusSends);
    }
    // Source: `if (0x20 < bVar2) { pcVar7 = "E2021121500:..."; goto LAB_1405b94f2; }`
    if cfg.max_bus_sends > CRIATOM_MAX_BUS_SENDS {
        return Err(AudioError::TooManyBusSends {
            got: cfg.max_bus_sends,
            max: CRIATOM_MAX_BUS_SENDS,
        });
    }

    // ── Étape 4 : validation/troncature catégories par playback ──────────
    // Source: `if (0x10 < local_f4) { FUN_1405d0550(0, "E2015051801:..."); iVar3 = 0x10; }`
    // Note : c'est un avertissement + troncature, pas une erreur bloquante.
    if cfg.categories_per_playback > CRIATOM_MAX_CATEGORIES_PER_PLAYBACK {
        cfg.categories_per_playback = CRIATOM_MAX_CATEGORIES_PER_PLAYBACK;
    }

    // ── Étape 5 : validation mode output ─────────────────────────────────
    // Source: `if (local_d8 != 0) { if (local_d8 == 1) { puVar6 = 0x1; } else { FUN_1405d0564(0,"E2010111200",...); } }`
    if cfg.output_mode > 1 {
        return Err(AudioError::InvalidOutputMode { mode: cfg.output_mode });
    }

    // ── Étape 6 : calcul des tailles de sous-systèmes ────────────────────
    // Source: `iVar3 = local_dc * 0x108 + 8` etc. + appels FUN_1405b8d00.
    let sizes = SubsystemSizes::compute(&cfg);
    // Taille minimale requise = somme des blocs connus
    // RE incertain: FUN_1405b8d00 additionne d'autres blocs (voix, catégories…)
    // On utilise `known_total()` comme borne inférieure conservative.
    let required = sizes.known_total();

    // ── Étape 7 : résolution/validation du workspace ──────────────────────
    // Source: `if ((param_2 == 0) && (param_3 == 0)) { param_2 = FUN_1405d2dec(iVar3); ... }`
    let ws = match workspace {
        Some(w) => {
            // Workspace fourni : vérifier la taille
            // Source: `if ((param_2 == 0) || (param_3 < iVar3)) { ... return 0; }`
            if w.len() < required {
                return Err(AudioError::WorkspaceInsufficient {
                    required,
                    provided: w.len(),
                });
            }
            w
        }
        None => {
            // Allocation interne
            // Source: `param_2 = FUN_1405d2dec(iVar3); DAT_141c73620 = param_2;`
            AudioWorkspace::allocate(required)
        }
    };

    // ── Étape 8 : normalisation fréquence serveur ─────────────────────────
    // Source: `DAT_141a3d1c8 = local_114; if (local_114 <= 1.0) { DAT_141a3d1c8 = 1.0; }`
    if cfg.server_frequency <= 1.0 {
        cfg.server_frequency = 1.0;
    }

    // ── Étape 9 : calcul période server thread ────────────────────────────
    // Source: `local_114 = ((float)local_110 * 1e+06) / local_114;`
    //          `local_114 = local_114 + local_114;`  ← doublement intentionnel
    // La saturation IEEE 754 vers i64::MIN est portée via `saturating_cast`.
    let period_raw = (cfg.num_threads as f64 * 1_000_000.0) / cfg.server_frequency as f64;
    let period_doubled = period_raw + period_raw; // doublement comme dans le C
    // Saturation vers i64 (le C fait une conversion float→int64 avec overflow UB
    // qui produit i64::MIN pour les valeurs >= 9.223372e18).
    // Source: `if (9.223372e+18 <= local_114) { lVar5 = -0x8000000000000000; }`
    let server_period_us = if period_doubled >= 9.223_372e18_f64 {
        i64::MIN
    } else {
        period_doubled as i64
    };

    // ── Étape 10 : configuration RNG ─────────────────────────────────────
    // Source: `FUN_1405d12ec(&local_res8)` — rng_mode==3 → shutdown (retour 0)
    let rng_config = match RngConfig::from_mode(cfg.rng_mode) {
        Some(rc) => Some(rc),
        None => {
            // rng_mode == 3 → le C fait goto LAB_1405b9918 (shutdown) → return 0
            // On considère ça comme une erreur de configuration invalide.
            // RE incertain: peut-être que mode 3 = "pas de RNG" sans erreur ?
            return Err(AudioError::InvalidOutputMode { mode: cfg.rng_mode });
        }
    };

    // ── Étape 11 : ordre d'initialisation des sous-systèmes ──────────────
    // Source: `audio_criatom_init.c` — séquence FUN_ lignes 151-208.
    // Les appels réels sont EXTERN (non portés ici). On trace l'ordre.
    let subsystems = vec![
        CriAtomSubsystem::AudioDevice,       // FUN_1405dc080
        CriAtomSubsystem::BaseConfig,        // FUN_1405b9ae0
        CriAtomSubsystem::VoicePool,         // FUN_1405ded80 + FUN_1405deeac
        CriAtomSubsystem::BusMixer,          // FUN_1405e6e40
        CriAtomSubsystem::PlaybackManager,   // FUN_1405e98dc + FUN_1405ea33c
        CriAtomSubsystem::Sequencer,         // FUN_1405eaba0 + FUN_1405ead0c
        CriAtomSubsystem::Tracks,            // FUN_1405ee99c
        CriAtomSubsystem::Categories,        // FUN_1405e8f58 + FUN_1405e8ff4
        CriAtomSubsystem::Players,           // FUN_1405e5900
        CriAtomSubsystem::VoiceLimiter,      // FUN_1405c2984 + FUN_1405c2a8c
        CriAtomSubsystem::Faders,            // FUN_1405bb294
        CriAtomSubsystem::Positioning3D,     // FUN_1405bfab0
        CriAtomSubsystem::BeatSync,          // FUN_1405f5ff8
        CriAtomSubsystem::Tweens,            // FUN_1405f5be4
        CriAtomSubsystem::ServerThread,      // FUN_1405d55ec
    ];

    // ── Résultat ──────────────────────────────────────────────────────────
    // Source: `DAT_141c735ac = 1; return 1;`
    Ok(CriAtomExSession {
        config: cfg,
        workspace: ws,
        version: CRIATOM_VERSION,
        server_period_us,
        subsystems,
        rng_config,
    })
}

// ============================================================================
// CriManaSoundEx — structure du lecteur Mana
// ============================================================================

/// Lecteur audio CRI Mana pour les cinématiques Sofdec2/USM.
///
/// Porte la structure `CriManaSoundEx` (0xE0 bytes) identifiée dans
/// `FUN_140683a20` (adresse 0x140683a20).
///
/// # Offsets vérifiés
///
/// | Offset | Champ                   | Source C                                  |
/// |--------|-------------------------|-------------------------------------------|
/// | +0x18  | `player_handle`         | `*(undefined8 *)(local_98 + 0x18) = uVar2` |
/// | +0x20  | `player_workspace`      | `*(undefined8 *)(local_98 + 0x20) = uVar2` |
/// | +0xC8  | `mem_ctx`               | `*(undefined8 *)(local_80 + 200) = param_1` |
///
/// La taille totale est de 0xE0 (224) bytes comme passé à `FUN_1409e6db4`.
///
/// Source: `audio_mana_player_create.c` — `FUN_140683a20`.
#[derive(Debug)]
pub struct CriManaSoundEx {
    /// Identifiant/index du player AtomEx créé (offset +0x18).
    ///
    /// Correspond au handle opaque retourné par `thunk_FUN_1405ba5ec`
    /// (criAtomExPlayer_Create). En Rust, on l'encode comme un `u64`
    /// (remplace le pointeur C `undefined8`).
    ///
    /// Source: `audio_mana_player_create.c` — `*(undefined8 *)(local_98 + 0x18) = uVar2`
    pub player_handle: u64,

    /// Taille du workspace alloué pour le player AtomEx.
    ///
    /// Calculée par `FUN_1405ba48c` (EXTERN) ; workspace alloué via
    /// `FUN_1409e4ea0`. Ici on stocke la taille plutôt qu'un pointeur brut.
    ///
    /// Source: `audio_mana_player_create.c` — `local_90 = FUN_1405ba48c(local_58)`
    pub player_workspace_size: u32,

    /// Buffer workspace du player AtomEx (offset +0x20 dans la struct).
    ///
    /// Source: `audio_mana_player_create.c` — `*(undefined8 *)(local_98 + 0x20) = uVar2`
    pub player_workspace: Vec<u8>,

    /// Contexte mémoire parent (offset +0xC8 = 200 decimal).
    ///
    /// Dans le binaire c'est un pointeur `undefined8` passé en `param_1`
    /// et stocké à l'offset 200 (0xC8). En Rust, on le modélise comme un
    /// identifiant opaque u64 (l'appelant fournit l'ID de son contexte).
    ///
    /// Source: `audio_mana_player_create.c` — `*(undefined8 *)(local_80 + 200) = param_1`
    pub mem_ctx_id: u64,

    /// Nombre de canaux de sortie configurés.
    ///
    /// Toujours 6 (5.1 surround) pour les cinématiques IEVR.
    ///
    /// Source: `audio_mana_player_create.c` — `thunk_FUN_1405bbea8(..., 6)`
    pub output_channels: u32,
}

impl CriManaSoundEx {
    /// Taille en bytes de la structure en mémoire dans `nie.exe`.
    ///
    /// Source: `audio_mana_player_create.c` — `FUN_1409e6db4(0xe0, ...)`
    pub const STRUCT_SIZE: usize = CRIMANA_SOUND_EX_SIZE;

    /// Offset du champ `player_handle` dans la struct native.
    ///
    /// Source: `audio_mana_player_create.c` — `*(undefined8 *)(local_98 + 0x18)`
    pub const OFFSET_PLAYER_HANDLE: usize = 0x18;

    /// Offset du champ `player_workspace` dans la struct native.
    ///
    /// Source: `audio_mana_player_create.c` — `*(undefined8 *)(local_98 + 0x20)`
    pub const OFFSET_PLAYER_WORKSPACE: usize = 0x20;

    /// Offset du champ `mem_ctx` dans la struct native (200 = 0xC8).
    ///
    /// Source: `audio_mana_player_create.c` — `*(undefined8 *)(local_80 + 200)`
    pub const OFFSET_MEM_CTX: usize = 0xC8;
}

// ============================================================================
// Config player AtomEx pour CriMana
// ============================================================================

/// Configuration du player AtomEx utilisée par CriMana.
///
/// Porte le bloc de 0x18 bytes copié deux fois dans `FUN_140683a20` :
///
/// ```text
/// // Copie 1 : local_40 ← résultat de FUN_140683870(local_70)
/// for (lVar3 = 0x18; ...) { *puVar4 = *puVar1; ... }
/// // Copie 2 : local_58 ← local_40
/// for (lVar3 = 0x18; ...) { *puVar4 = *puVar1; ... }
/// ```
///
/// Le format exact du bloc de 0x18 bytes est INCERTAIN — il correspond
/// à la sortie de `FUN_140683870` (EXTERN, config player).
///
/// Source: `audio_mana_player_create.c` — lignes 63-76.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[derive(Default)]
pub struct ManaAtomPlayerConfig {
    /// Données brutes de configuration (0x18 = 24 bytes).
    ///
    /// RE incertain: structure interne du bloc non décodée.
    pub raw: [u8; 0x18],
}


// ============================================================================
// Création player CriMana — FUN_140683a20
// ============================================================================

/// Crée un lecteur audio CriMana pour les cinématiques Sofdec2/USM.
///
/// Porte `FUN_140683a20` (adresse 0x140683a20) depuis
/// `audio_mana_player_create.c`.
///
/// # Comportement
///
/// 1. Alloue 0xE0 bytes pour `CriManaSoundEx` (tag: `"CriManaSoundEx"`).
/// 2. Appelle le constructeur interne.
/// 3. Récupère la config player AtomEx (0x18 bytes, copiée 2x).
/// 4. Calcule la taille workspace player.
/// 5. Alloue le workspace (tag: `"CriManaSoundAtomEx_AtomExPlaeyer"` — typo originale).
/// 6. Crée le player AtomEx (`criAtomExPlayer_Create`).
/// 7. Configure : 6 canaux sortie (5.1), callback playback.
///
/// # Paramètres
///
/// - `mem_ctx_id` — identifiant du contexte mémoire parent (`param_1` dans le C).
/// - `player_config` — configuration du player AtomEx (0x18 bytes).
///   `None` utilise la config par défaut (zéros).
/// - `player_workspace_size` — taille du workspace à allouer pour le player.
///   Dans le binaire, cette valeur est calculée par `FUN_1405ba48c` (EXTERN) ;
///   ici l'appelant la fournit directement.
///
/// # Erreurs
///
/// - [`AudioError::ManaSoundExAllocFailed`] si l'allocation de 0xE0 bytes échoue
///   (simulé si `mem_ctx_id == 0` dans cette implémentation Rust).
/// - [`AudioError::ManaPlayerWorkspaceAllocFailed`] si l'allocation du workspace
///   player échoue.
/// - [`AudioError::ManaPlayerCreateFailed`] si la création du player AtomEx échoue.
///
/// # Typo originale Level-5
///
/// Le tag d'allocation `"CriManaSoundAtomEx_AtomExPlaeyer"` contient une faute
/// de frappe ("Plaeyer" au lieu de "Player") présente dans le binaire original.
///
/// Source: `audio_mana_player_create.c` — commentaire ligne 14 + code ligne 78.
///
/// # Exemple
///
/// ```rust
/// use nie_engine::audio::mana_player_create;
///
/// // ctx_id=1 simule un contexte mémoire valide
/// let player = mana_player_create(1, None, 4096)
///     .expect("création player CriMana");
/// assert_eq!(player.output_channels, 6); // 5.1 surround
/// assert_eq!(player.mem_ctx_id, 1);
/// assert_eq!(player.player_workspace.len(), 4096);
/// ```
///
/// Source: `audio_mana_player_create.c` — `FUN_140683a20`.
pub fn mana_player_create(
    mem_ctx_id: u64,
    player_config: Option<ManaAtomPlayerConfig>,
    player_workspace_size: u32,
) -> Result<CriManaSoundEx, AudioError> {
    // ── Étape 1 : vérification allocation CriManaSoundEx ─────────────────
    // Source: `local_88 = FUN_1409e6db4(0xe0, param_1, "CriManaSoundEx", 8);`
    //         `if (local_88 == 0) { local_80 = 0; }`
    // En Rust : on simule l'échec si mem_ctx_id == 0 (contexte invalide).
    if mem_ctx_id == 0 {
        return Err(AudioError::ManaSoundExAllocFailed);
    }

    // ── Étape 2 : résolution config player ───────────────────────────────
    // Source: `puVar1 = (undefined1 *)FUN_140683870(local_70);`
    //         double memcpy de 0x18 bytes (local_40 ← src, local_58 ← local_40)
    let _player_cfg = player_config.unwrap_or_default();
    // RE incertain: FUN_140683870 lit la config depuis le contexte Mana ;
    // ici on accepte la config fournie par l'appelant directement.

    // ── Étape 3 : allocation workspace player AtomEx ──────────────────────
    // Source: `uVar2 = FUN_1409e4ea0(param_1, local_90, "CriManaSoundAtomEx_AtomExPlaeyer", 8);`
    //         `if (*(longlong *)(local_98 + 0x20) == 0) { log("E2019101601:..."); local_98 = 0; }`
    // Note: typo "Plaeyer" fidèlement portée (tag de debug, non fonctionnel en Rust).
    let _alloc_tag = "CriManaSoundAtomEx_AtomExPlaeyer"; // typo originale Level-5, voir doc
    if player_workspace_size == 0 {
        return Err(AudioError::ManaPlayerWorkspaceAllocFailed);
    }
    let player_workspace = vec![0u8; player_workspace_size as usize];

    // ── Étape 4 : création player AtomEx ─────────────────────────────────
    // Source: `uVar2 = thunk_FUN_1405ba5ec(local_58, *(undefined8 *)(local_98 + 0x20), local_90);`
    //         `if (*(longlong *)(local_98 + 0x18) == 0) { log("E2019101602:..."); ... }`
    // En Rust : on simule le player_handle comme un ID dérivé du contexte.
    // RE incertain: la vraie valeur retournée par criAtomExPlayer_Create est opaque.
    let player_handle: u64 = mem_ctx_id.wrapping_add(0x18); // stub handle

    // ── Étape 5 : configuration canaux + callback ─────────────────────────
    // Source: `thunk_FUN_1405bbea8(*(undefined8 *)(local_98 + 0x18), 6);`
    //         `thunk_FUN_1405bbd7c(*(undefined8 *)(local_98 + 0x18), FUN_140683530, local_98);`
    // Les appels EXTERN ne sont pas portés ; on trace la valeur du canal.
    let output_channels = CRIMANA_OUTPUT_CHANNELS_SURROUND_51;

    // ── Résultat ──────────────────────────────────────────────────────────
    // Source: `return local_98;`
    Ok(CriManaSoundEx {
        player_handle,
        player_workspace_size,
        player_workspace,
        mem_ctx_id,
        output_channels,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ── criatom_init — chemins valides ────────────────────────────────────

    #[test]
    fn criatom_init_defaults_succes() {
        // param_1 == NULL → valeurs par défaut
        let session = criatom_init(None, None).expect("init avec defaults");
        assert_eq!(session.version, CRIATOM_VERSION);
        assert_eq!(session.config.max_aisacs, 8);
        assert_eq!(session.config.max_bus_sends, 8);
        assert!(session.workspace.is_owned());
    }

    #[test]
    fn criatom_init_config_explicite_valide() {
        let cfg = CriAtomExConfig {
            max_aisacs: 0x37,
            max_bus_sends: 0x20,
            max_players: 16,
            max_voices: 16,
            max_buses: 4,
            max_tracks: 8,
            categories_per_playback: 0x10,
            server_frequency: 60.0,
            num_threads: 1,
            rng_mode: 0,
            output_mode: 0,
        };
        let session = criatom_init(Some(cfg), None).expect("config explicite valide");
        assert!(!session.workspace.is_empty());
    }

    #[test]
    fn criatom_init_workspace_externe_suffisant() {
        let cfg = CriAtomExConfig {
            max_buses: 2,
            max_tracks: 4,
            max_players: 4,
            ..Default::default()
        };
        let sizes = SubsystemSizes::compute(&cfg);
        let ws = AudioWorkspace::from_external(vec![0u8; sizes.known_total()]);
        let session = criatom_init(Some(cfg), Some(ws)).expect("workspace externe valide");
        assert!(!session.workspace.is_owned());
    }

    #[test]
    fn criatom_init_categories_tronquees() {
        let cfg = CriAtomExConfig {
            categories_per_playback: 0xFF, // dépasse 0x10
            ..Default::default()
        };
        let session = criatom_init(Some(cfg), None).expect("troncature categories");
        // Doit être tronqué à CRIATOM_MAX_CATEGORIES_PER_PLAYBACK
        assert_eq!(session.config.categories_per_playback, CRIATOM_MAX_CATEGORIES_PER_PLAYBACK);
    }

    #[test]
    fn criatom_init_frequence_normalisee() {
        let cfg = CriAtomExConfig {
            server_frequency: 0.0, // en-dessous de 1.0 → normalisé à 1.0
            ..Default::default()
        };
        let session = criatom_init(Some(cfg), None).expect("fréquence normalisée");
        assert!((session.config.server_frequency - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn criatom_init_periode_server_calcul() {
        // 1 thread, 60 Hz → period_raw = 1e6/60 ≈ 16666.67 µs
        // doublement → ≈ 33333.34 µs → i64 → 33333
        let cfg = CriAtomExConfig {
            num_threads: 1,
            server_frequency: 60.0,
            ..Default::default()
        };
        let session = criatom_init(Some(cfg), None).expect("calcul période");
        let expected = ((1_000_000.0_f64 / 60.0) * 2.0) as i64;
        assert_eq!(session.server_period_us, expected);
    }

    #[test]
    fn criatom_init_subsystems_ordre() {
        let session = criatom_init(None, None).expect("subsystems");
        // AudioDevice doit être le premier sous-système initialisé
        assert_eq!(session.subsystems[0], CriAtomSubsystem::AudioDevice);
        // ServerThread doit être le dernier
        assert_eq!(
            session.subsystems.last().copied(),
            Some(CriAtomSubsystem::ServerThread)
        );
        // 15 sous-systèmes attendus
        assert_eq!(session.subsystems.len(), 15);
    }

    #[test]
    fn criatom_init_rng_config_mode0() {
        let cfg = CriAtomExConfig { rng_mode: 0, ..Default::default() };
        let session = criatom_init(Some(cfg), None).expect("rng mode 0");
        assert_eq!(session.rng_config, Some(RngConfig { low: 0, high: 1 }));
    }

    #[test]
    fn criatom_init_rng_config_mode1() {
        let cfg = CriAtomExConfig { rng_mode: 1, ..Default::default() };
        let session = criatom_init(Some(cfg), None).expect("rng mode 1");
        assert_eq!(session.rng_config, Some(RngConfig { low: 2, high: 1 }));
    }

    #[test]
    fn criatom_init_rng_config_mode4() {
        let cfg = CriAtomExConfig { rng_mode: 4, ..Default::default() };
        let session = criatom_init(Some(cfg), None).expect("rng mode 4");
        assert_eq!(session.rng_config, Some(RngConfig { low: 0, high: 1 }));
    }

    // ── criatom_init — chemins d'erreur ──────────────────────────────────

    #[test]
    fn criatom_init_err_trop_aisacs() {
        let cfg = CriAtomExConfig { max_aisacs: 0x38, ..Default::default() };
        let err = criatom_init(Some(cfg), None).expect_err("trop d'AISACs");
        assert!(matches!(err, AudioError::TooManyAisacs { got: 0x38, max: 0x37 }));
    }

    #[test]
    fn criatom_init_err_zero_bus_sends() {
        let cfg = CriAtomExConfig { max_bus_sends: 0, ..Default::default() };
        let err = criatom_init(Some(cfg), None).expect_err("zero bus sends");
        assert!(matches!(err, AudioError::ZeroBusSends));
    }

    #[test]
    fn criatom_init_err_trop_bus_sends() {
        let cfg = CriAtomExConfig { max_bus_sends: 0x21, ..Default::default() };
        let err = criatom_init(Some(cfg), None).expect_err("trop bus sends");
        assert!(matches!(err, AudioError::TooManyBusSends { got: 0x21, max: 0x20 }));
    }

    #[test]
    fn criatom_init_err_workspace_insuffisant() {
        let ws = AudioWorkspace::from_external(vec![0u8; 1]); // trop petit
        let err = criatom_init(None, Some(ws)).expect_err("workspace trop petit");
        assert!(matches!(err, AudioError::WorkspaceInsufficient { .. }));
    }

    #[test]
    fn criatom_init_err_output_mode_invalide() {
        let cfg = CriAtomExConfig { output_mode: 2, ..Default::default() };
        let err = criatom_init(Some(cfg), None).expect_err("mode output invalide");
        assert!(matches!(err, AudioError::InvalidOutputMode { mode: 2 }));
    }

    // ── SubsystemSizes — formules de taille ───────────────────────────────

    #[test]
    fn subsystem_sizes_formules() {
        // Vérifie les formules portées depuis le C :
        // bus_mixer = max_buses * 0x108 + 8
        // tracks    = max_tracks * 0x150 + 8
        // players   = max_players * 0x138 + 0x18
        let cfg = CriAtomExConfig {
            max_buses: 1,
            max_tracks: 1,
            max_players: 1,
            ..Default::default()
        };
        let s = SubsystemSizes::compute(&cfg);
        assert_eq!(s.bus_mixer, 0x108 + 8);
        assert_eq!(s.tracks, 0x150 + 8);
        assert_eq!(s.players, 0x138 + 0x18);
    }

    #[test]
    fn subsystem_sizes_zero() {
        let cfg = CriAtomExConfig {
            max_buses: 0,
            max_tracks: 0,
            max_players: 0,
            ..Default::default()
        };
        let s = SubsystemSizes::compute(&cfg);
        // Avec 0 éléments les tailles ne sont que les headers
        assert_eq!(s.bus_mixer, 8);
        assert_eq!(s.tracks, 8);
        assert_eq!(s.players, 0x18);
    }

    // ── RngConfig ─────────────────────────────────────────────────────────

    #[test]
    fn rng_config_mode3_retourne_none() {
        assert_eq!(RngConfig::from_mode(3), None);
    }

    #[test]
    fn rng_config_mode2() {
        assert_eq!(RngConfig::from_mode(2), Some(RngConfig { low: 2, high: 1 }));
    }

    // ── mana_player_create — chemin valide ────────────────────────────────

    #[test]
    fn mana_player_create_succes() {
        let player = mana_player_create(42, None, 4096).expect("création player Mana");
        assert_eq!(player.mem_ctx_id, 42);
        assert_eq!(player.output_channels, CRIMANA_OUTPUT_CHANNELS_SURROUND_51);
        assert_eq!(player.player_workspace.len(), 4096);
        assert_eq!(player.player_workspace_size, 4096);
        // Offset player_handle : 42 + 0x18 = 66
        assert_eq!(player.player_handle, 42 + 0x18);
    }

    #[test]
    fn mana_player_create_canaux_surround() {
        // Le canal 6 = 5.1 est fixe pour les cinématiques IEVR
        let player = mana_player_create(1, None, 1024).expect("surround");
        assert_eq!(player.output_channels, 6);
    }

    #[test]
    fn mana_player_create_struct_size_const() {
        assert_eq!(CriManaSoundEx::STRUCT_SIZE, 0xE0);
        assert_eq!(CriManaSoundEx::OFFSET_PLAYER_HANDLE, 0x18);
        assert_eq!(CriManaSoundEx::OFFSET_PLAYER_WORKSPACE, 0x20);
        assert_eq!(CriManaSoundEx::OFFSET_MEM_CTX, 0xC8);
    }

    // ── mana_player_create — chemins d'erreur ─────────────────────────────

    #[test]
    fn mana_player_create_err_ctx_nul() {
        let err = mana_player_create(0, None, 4096).expect_err("ctx nul");
        assert!(matches!(err, AudioError::ManaSoundExAllocFailed));
    }

    #[test]
    fn mana_player_create_err_workspace_nul() {
        let err = mana_player_create(1, None, 0).expect_err("workspace size nul");
        assert!(matches!(err, AudioError::ManaPlayerWorkspaceAllocFailed));
    }

    // ── Constantes IEEE 754 ───────────────────────────────────────────────

    #[test]
    fn constantes_criatom_max_coherents() {
        assert_eq!(CRIATOM_MAX_AISACS, 0x37);
        assert_eq!(CRIATOM_MAX_BUS_SENDS, 0x20);
        assert_eq!(CRIATOM_MAX_CATEGORIES_PER_PLAYBACK, 0x10);
        assert_eq!(CRIATOM_MAX_SEQUENCES, 0x40);
        assert_eq!(CRIMANA_SOUND_EX_SIZE, 0xE0);
        assert_eq!(CRIMANA_OUTPUT_CHANNELS_SURROUND_51, 6);
    }

    #[test]
    fn version_string_criatom() {
        assert!(CRIATOM_VERSION.contains("Ver.2.29.4"));
        assert!(CRIATOM_VERSION.contains("PCx64"));
        assert!(CRIATOM_VERSION.contains("Jul  9 2025"));
    }
}
