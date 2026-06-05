//! Portage du scanner CPK et du chargeur de liste CPK de `nie.exe`.
//!
//! # Sources décompilées (Ghidra, pseudo-C)
//!
//! | Fonction C              | Adresse       | Description                                          |
//! |-------------------------|---------------|------------------------------------------------------|
//! | `FUN_14157c660`         | `0x14157c660` | Scanner `data/packs/*.cpk` — [`cpk_scanner`]         |
//! | `FUN_14157cf50`         | `0x14157cf50` | Chargeur `cpk_list.cfg.bin` — [`CpkListLoader`]      |
//! | `FUN_14066371c`         | `0x14066371c` | Vérification magic CRILAYLA — [`is_crilayla`]        |
//!
//! ## Logique portée
//!
//! ### `cpk_scanner` (FUN_14157c660)
//!
//! Le moteur formate le glob `data/packs/*.cpk` (via `sprintf`/`FindFirstFileA`), ouvre
//! le premier fichier trouvé en lecture binaire (`fopen_s`), lit 4 octets (magic), puis
//! ferme le handle. Retourne 0 si aucun fichier ou si l'ouverture échoue, sinon les 4
//! octets lus (= le magic du premier CPK, potentiellement chiffré).
//!
//! Port Rust : parcours du répertoire `data/packs/` (ou le chemin fourni), ouvre le
//! premier `.cpk` lexicographiquement, lit ses 4 premiers octets.
//!
//! ### `CpkListLoader` (FUN_14157cf50)
//!
//! 1. Ouvre `cpk_list.cfg.bin` via `FUN_1404863d0` (le FileHandle du moteur CRI Fs).
//! 2. Si `DAT_141f9805a != 0` (flag debug), déchiffre avec la clé fixe Viola
//!    `0x1717E18E` via `FUN_14048e560`.
//! 3. Parse la table UTF embarquée (offset `0x500` dans la structure interne, stride 6).
//! 4. Alloue un tableau de `CpkListEntry` (via `FUN_14005ae00` catégorie 6) et le peuple
//!    via `FUN_141670310` (copie de données).
//! 5. Publie les pointeurs globaux `DAT_141c001e0` (base tableau), `DAT_141c001e8`
//!    (table UTF), `DAT_141c001f0` (count).
//!
//! Port Rust : `CpkListLoader::load(data: &[u8], decrypt: bool)` — reçoit le contenu brut
//! de `cpk_list.cfg.bin`, déchiffre optionnellement, parse l'UTF, extrait les entrées.
//! Exposé via [`CpkListState`] (équivalent des globaux `DAT_141c001e0/e8/f0`).
//!
//! ### `is_crilayla` (FUN_14066371c)
//!
//! Wrapper minimal : `param_2 > 7 && memcmp(param_1, "CRILAYLA", 8) == 0`.
//! Port direct avec slice Rust.
//!
//! ## Stubs / Externes non portés
//!
//! Les fonctions suivantes du moteur sont référencées mais non portées dans ce crate
//! (elles appartiennent à d'autres sous-systèmes) :
//!
//! ```text
//! // EXTERN: FUN_1400960f0   sprintf_s (CRT, formatage chemin glob)
//! // EXTERN: FUN_14099ce48   fclose (CRT, fermeture fichier)
//! // EXTERN: FUN_1416709b0   memset (CRT, zeroing)
//! // EXTERN: FUN_1404863d0   CriFs_OpenFile (VFS CRI, ouvre un fichier par nom interne)
//! // EXTERN: FUN_14048e560   CriViolaDecrypt (déchiffrement Viola, clé 0x1717E18E)
//! // EXTERN: FUN_14047a9c0   CriUtf_GetTableInfo (info table UTF — stride, count, offset)
//! // EXTERN: FUN_14047ab40   CriUtf_ParseRows (parcours des lignes UTF)
//! // EXTERN: FUN_14047ad20   CriUtf_Finalize (finalisation table UTF)
//! // EXTERN: FUN_14005ae00   CriHeap_Alloc (allocateur CRI catégorie 6, taille 0x10)
//! // EXTERN: FUN_141670310   memcpy (CRT, copie données)
//! // EXTERN: FUN_140051c90   CriTask_CreateLocal (création tâche locale)
//! // EXTERN: DAT_141f9805a   g_CpkDebugDecrypt (bool — déchiffrement debug activé)
//! // EXTERN: DAT_141c001e0   g_CpkListBase (pointeur base tableau CPK)
//! // EXTERN: DAT_141c001e8   g_CpkListUtfTable (pointeur table UTF)
//! // EXTERN: DAT_141c001f0   g_CpkListCount (u64 — nombre d'entrées)
//! // EXTERN: DAT_142034f10   g_CpkListWorkspace (pointeur workspace interne)
//! // EXTERN: DAT_142034f18   g_CpkListAllocPtr (pointeur allocation heap CRI)
//! // EXTERN: DAT_142034f24   g_CpkListEntryCount (u32 — count après parse)
//! // EXTERN: DAT_142034f28   g_CpkLoaderState (u32 = 6 pendant le chargement)
//! // EXTERN: DAT_142043520   g_CpkBinderTable (table vtable binders)
//! // EXTERN: DAT_141a415c0   __security_cookie (canary stack Windows)
//! ```
//!
//! ## Chiffrement CPK IEVR
//!
//! La clé `0x1717E18E` (constante `VIOLA_KEY`) est la clé **fixe Viola** des `cfg.bin`
//! (pas des `.cpk` de `data/packs/` — ceux-ci utilisent une clé dérivée du nom de
//! fichier). Voir `nie-formats::cpk::VIOLA_FIXED_KEY` pour le détail complet.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Constantes portées de FUN_14157cf50 / nie-index
// ---------------------------------------------------------------------------

/// Répertoire des packs CPK dans l'arborescence du jeu.
///
/// Porté du format `FUN_1400960f0(local_118, "%s/*.cpk", "data/packs")` dans le scanner.
pub const CPK_PACKS_DIR: &str = "data/packs";

/// Nom du fichier manifeste CPK.
///
/// Porté de la chaîne `"cpk_list.cfg.bin"` dans `FUN_14157cf50`.
pub const CPK_LIST_FILENAME: &str = "cpk_list.cfg.bin";

/// Magic `CPK ` en octets little-endian (tel que lu par le scanner).
///
/// Le scanner lit 4 octets bruts — sur les CPK chiffrés IEVR, ces octets sont
/// chiffrés, pas `CPK `. La valeur `0x204B5043` est le magic clair.
pub const CPK_MAGIC_LE: u32 = 0x204B_5043;

/// Clé fixe Viola (`0x1717E18E`) utilisée par `FUN_14048e560` pour déchiffrer
/// `cpk_list.cfg.bin`.
///
/// Portée de `FUN_14157cf50` : `FUN_14048e560(&local_150, 0, 0x1717e18e)`.
/// Identique à `nie_formats::cpk::VIOLA_FIXED_KEY`.
pub const VIOLA_KEY: u32 = 0x1717_E18E;

/// Offset interne dans la structure CRI Fs où la taille stride UTF est stockée.
///
/// Porté de `local_154 = 0x500` dans `FUN_14157cf50`. Indique que la structure
/// interne du loader commence avec un `u16` à `+0x00` = `0x0500` (stride 5, version 0,
/// ou stride 0x05 / version 0x00 selon nibbles BE). Documenté pour fidélité RE.
pub const CPK_LIST_UTF_INIT_WORD: u16 = 0x0500;

/// Taille en octets d'une entrée `CpkListEntry` allouée par `FUN_14005ae00`.
///
/// Porté de `local_148 = 0x10` dans la branche d'allocation de `FUN_14157cf50` :
/// `FUN_14005ae00(6, &local_150)` où `local_150 = { size=0x10, count=uVar11 }`.
pub const CPK_LIST_ENTRY_ALLOC_SIZE: usize = 0x10;

/// Catégorie d'allocation CRI heap utilisée pour le tableau CPK.
///
/// Porté de `FUN_14005ae00(6, ...)` — premier argument = catégorie 6.
pub const CRI_HEAP_CATEGORY_CPK: u32 = 6;

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------

/// Erreurs du module CPK.
#[derive(Debug, Error)]
pub enum CpkError {
    /// E/S système (lecture de fichier, listage de répertoire).
    #[error("erreur I/O: {0}")]
    Io(#[from] std::io::Error),

    /// Le répertoire `data/packs/` ne contient aucun fichier `.cpk`.
    ///
    /// Porté du cas `hFindFile == INVALID_HANDLE_VALUE` dans `FUN_14157c660`.
    #[error("aucun fichier CPK trouve dans: {dir}")]
    NoCpkFound {
        /// Répertoire scanné.
        dir: PathBuf,
    },

    /// Tampon trop court pour contenir le header CPK (minimum 4 octets).
    #[error("fichier CPK trop court: {path}")]
    TooShort {
        /// Chemin du fichier tronqué.
        path: PathBuf,
    },

    /// `cpk_list.cfg.bin` introuvable ou illisible.
    #[error("cpk_list.cfg.bin introuvable: {path}")]
    CpkListNotFound {
        /// Chemin attendu.
        path: PathBuf,
    },

    /// Données du `cpk_list.cfg.bin` corrompues ou non conformes.
    #[error("cpk_list.cfg.bin corrompu: {reason}")]
    CpkListCorrupt {
        /// Description de la corruption.
        reason: &'static str,
    },
}

// ---------------------------------------------------------------------------
// `cpk_scanner` — port de FUN_14157c660 (0x14157c660)
// ---------------------------------------------------------------------------

/// Résultat du scan CPK.
///
/// Port Rust du type de retour `undefined4` de `FUN_14157c660`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CpkScanResult {
    /// Les 4 premiers octets lus dans le premier `.cpk` trouvé (bruts, potentiellement chiffrés).
    ///
    /// Correspond à `local_268[0]` dans `FUN_14157c660`. Si `0x204B5043` : magic clair `CPK `.
    /// Si autre valeur : CPK chiffré (normal pour les packs IEVR).
    pub magic_bytes: u32,

    /// Chemin complet du premier fichier `.cpk` trouvé.
    ///
    /// Dans le C original : `local_98` = `sprintf("%s/%s", "data/packs", cFileName)`.
    pub first_cpk_path: PathBuf,

    /// Nombre total de fichiers `.cpk` trouvés dans le répertoire.
    ///
    /// Le moteur C ne comptait que le premier (via `FindFirstFileA` sans `FindNextFileA`),
    /// mais le port Rust recense l'ensemble pour plus d'utilité.
    pub total_cpk_count: usize,
}

/// Scanne le répertoire `data/packs/` à la recherche de fichiers `.cpk`.
///
/// Port de `FUN_14157c660` (`0x14157c660`, subsystem `vfs`).
///
/// ## Logique C originale
///
/// ```c
/// // FUN_14157c660 — scanner CPK, adresse 0x14157c660
/// sprintf(local_118, "%s/*.cpk", "data/packs");
/// hFindFile = FindFirstFileA(local_118, &local_258);
/// if (hFindFile == INVALID_HANDLE_VALUE) {
///     return 0;  // aucun fichier
/// }
/// sprintf(local_98, "%s/%s", "data/packs", local_258.cFileName);
/// fopen_s(&local_260, local_98, "rb");
/// if (local_260 != NULL) {
///     fread(local_268, 1, 4, local_260);  // lit 4 octets (magic)
///     fclose(local_260);
/// }
/// FindClose(hFindFile);
/// return local_268[0];  // magic bytes (potentiellement chiffré)
/// ```
///
/// ## Différences de portage
///
/// - Utilise `std::fs::read_dir` au lieu de `FindFirstFileA`/`FindClose` (Win32).
/// - Trie les fichiers lexicographiquement (FindFirstFileA retourne l'ordre FS).
/// - Recense tous les `.cpk`, pas seulement le premier.
///
/// # Arguments
///
/// * `packs_dir` — chemin du répertoire `data/packs/` (équivalent du `"data/packs"` hardcodé).
///
/// # Erreurs
///
/// - [`CpkError::Io`] si le répertoire ne peut pas être lu.
/// - [`CpkError::NoCpkFound`] si aucun `.cpk` n'est présent.
/// - [`CpkError::TooShort`] si le premier `.cpk` fait moins de 4 octets.
///
/// # Exemples
///
/// ```rust,no_run
/// use nie_engine::cpk::cpk_scanner;
/// let result = cpk_scanner("game/data/packs").unwrap();
/// println!("premier CPK: {}", result.first_cpk_path.display());
/// println!("magic brut: 0x{:08X}", result.magic_bytes);
/// ```
pub fn cpk_scanner<P: AsRef<Path>>(packs_dir: P) -> Result<CpkScanResult, CpkError> {
    let packs_dir = packs_dir.as_ref();

    // FUN_1400960f0(local_118, "%s/*.cpk", "data/packs")
    // → enumération de tous les .cpk dans le répertoire.
    let mut cpk_paths: Vec<PathBuf> = std::fs::read_dir(packs_dir)?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_ascii_lowercase() == "cpk" {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    // Le moteur utilise FindFirstFileA qui suit l'ordre du système de fichiers.
    // On trie lexicographiquement pour un comportement déterministe.
    cpk_paths.sort();

    let total_cpk_count = cpk_paths.len();

    // hFindFile == INVALID_HANDLE_VALUE → return 0
    if cpk_paths.is_empty() {
        return Err(CpkError::NoCpkFound { dir: packs_dir.to_path_buf() });
    }

    // Premier fichier trouvé = local_258.cFileName → sprintf(local_98, "%s/%s", ...)
    let first_cpk_path = cpk_paths.into_iter().next().unwrap();

    // fopen_s(&local_260, local_98, "rb")
    // fread(local_268, 1, 4, local_260)
    let magic_bytes = {
        use std::io::Read as _;
        let mut f = std::fs::File::open(&first_cpk_path)
            .map_err(|_| CpkError::TooShort { path: first_cpk_path.clone() })?;
        let mut buf = [0u8; 4];
        let n = f.read(&mut buf)?;
        if n < 4 {
            return Err(CpkError::TooShort { path: first_cpk_path });
        }
        // FUN_14099ce48(local_260) → fclose — fermé automatiquement par le Drop de File.
        u32::from_le_bytes(buf)
    };

    Ok(CpkScanResult {
        magic_bytes,
        first_cpk_path,
        total_cpk_count,
    })
}

/// Vrai si le magic brut lu par le scanner correspond à un CPK non-chiffré.
///
/// Dans le jeu, les CPK de `data/packs/` sont chiffrés — cette valeur sera donc
/// typiquement `false` sur les dumps IEVR normaux.
#[must_use]
#[inline]
pub fn is_cpk_clear(magic_bytes: u32) -> bool {
    magic_bytes == CPK_MAGIC_LE
}

// ---------------------------------------------------------------------------
// `is_crilayla` — port de FUN_14066371c (0x14066371c)
// ---------------------------------------------------------------------------

/// Vérifie si un tampon commence par le magic CRILAYLA.
///
/// Port de `FUN_14066371c` (`0x14066371c`, subsystem `sound`).
///
/// ## Logique C originale
///
/// ```c
/// // FUN_14066371c — adresse 0x14066371c
/// undefined8 FUN_14066371c(void *param_1, int param_2) {
///     int iVar1;
///     if ((7 < param_2) && (iVar1 = memcmp(param_1, "CRILAYLA", 8), iVar1 == 0)) {
///         return 1;
///     }
///     return 0;
/// }
/// ```
///
/// Le moteur l'appelle avant de déclencher le décompresseur CRILAYLA (CRI Middleware
/// lossless compression). `param_2` est la taille du buffer : le check `7 < param_2`
/// garantit qu'il y a au moins 8 octets pour le memcmp.
///
/// # Arguments
///
/// * `buf` — tampon à vérifier.
///
/// # Exemples
///
/// ```rust
/// use nie_engine::cpk::is_crilayla;
/// assert!(is_crilayla(b"CRILAYLA\x00\x01\x02\x03"));
/// assert!(!is_crilayla(b"CRILAYL")); // trop court
/// assert!(!is_crilayla(b"CPK ...."));
/// ```
#[must_use]
pub fn is_crilayla(buf: &[u8]) -> bool {
    // if ((7 < param_2) && memcmp(param_1, "CRILAYLA", 8) == 0)
    buf.len() > 7 && buf.starts_with(b"CRILAYLA")
}

// ---------------------------------------------------------------------------
// `CpkListLoader` — port de FUN_14157cf50 (0x14157cf50)
// ---------------------------------------------------------------------------

/// Entrée CPK extraite de `cpk_list.cfg.bin`.
///
/// Représente une ligne de la table UTF interne. La structure originale est allouée
/// en blocs de `0x10` octets (`CPK_LIST_ENTRY_ALLOC_SIZE`) par `FUN_14005ae00`.
///
/// Les champs sont reconstruits depuis la table UTF embarquée dans le `cfg.bin` déchiffré.
/// Le moteur accède à ces données via les globaux `DAT_141c001e0/e8/f0`.
///
/// ## Champs connus
///
/// D'après l'analyse de `FUN_14157cf50` et des strings référencées par le VFS :
/// - `FileName` : nom de fichier interne dans le CPK (ex. `"chara/x001.g4tx"`)
/// - `DirName`  : répertoire interne (ex. `"chara/"`)
/// - `FileSize` : taille décompressée
/// - `CpkHash`  : hash/nom du CPK (ex. `"1d08dda99e8549431c6c7b459ed8deab.cpk"`)
///
/// Ces noms exacts dépendent de la table UTF du fichier réel. Le portage est
/// structurellement fidèle ; les noms de colonnes sont des approximations RE.
// Porté de FUN_14157cf50 — allocation entry: FUN_14005ae00(6, &{size=0x10, count=uVar11})
#[derive(Debug, Clone)]
pub struct CpkListEntry {
    /// Nom de fichier interne.
    ///
    /// Porté du champ UTF `"FileName"` dans la table `cpk_list.cfg.bin`.
    pub filename: String,

    /// Répertoire interne.
    ///
    /// Porté du champ UTF `"DirName"`.
    pub directory: String,

    /// Hash/nom du fichier CPK contenant ce fichier.
    ///
    /// Porté du champ `cpk_hash` (correspondance via VFS init dans `vfs_crifs_init.c`).
    pub cpk_hash: String,

    /// Taille du fichier (compressé ou non).
    ///
    /// Porté du champ `"FileSize"` / `uVar11 = *(uint*)(local_f8 + 8)`.
    pub file_size: u32,
}

/// État global publié par le chargeur CPK.
///
/// Équivalent Rust des globaux `DAT_141c001e0` (base tableau), `DAT_141c001e8`
/// (table UTF) et `DAT_141c001f0` (count) publiés à la fin de `FUN_14157cf50` :
///
/// ```c
/// _DAT_141c001e0 = DAT_142034f18;   // g_CpkListBase
/// _DAT_141c001e8 = DAT_142034f10;   // g_CpkListUtfTable
/// _DAT_141c001f0 = (ulonglong)DAT_142034f24; // g_CpkListCount
/// ```
#[derive(Debug, Clone)]
pub struct CpkListState {
    /// Tableau des entrées CPK parsées (= `g_CpkListBase`).
    pub entries: Vec<CpkListEntry>,

    /// Nombre d'entrées (= `g_CpkListCount`, `DAT_141c001f0`).
    ///
    /// Toujours `entries.len()`, conservé pour la fidélité sémantique.
    pub count: u64,
}

/// Chargeur de la liste CPK (`cpk_list.cfg.bin`).
///
/// Port de `FUN_14157cf50` (`0x14157cf50`, subsystem `gds`, tag `complex`).
///
/// ## Logique C originale (résumé)
///
/// ```c
/// // FUN_14157cf50 — cpk_list.cfg.bin loader, adresse 0x14157cf50
///
/// // 1. Init interne
/// local_168 = 0; uStack_160 = 0; local_154 = 0x0500;
///
/// // 2. Ouverture du fichier via CRI Fs (FUN_1404863d0)
/// cVar7 = FUN_1404863d0(&local_168, "cpk_list.cfg.bin");
/// if (cVar7 == '\0') { return 0; }  // échec ouverture
///
/// // 3. Déchiffrement optionnel (si DAT_141f9805a != 0)
/// if (DAT_141f9805a != '\0') {
///     local_150 = uStack_160;
///     local_148 = (ulonglong)local_158;
///     FUN_14048e560(&local_150, 0, 0x1717e18e);  // déchiffrement Viola
/// }
///
/// // 4. Parse UTF si taille et offset valides
/// if ((uVar3 != 0) && (uVar4 != 0)) {
///     DAT_142034f28 = 6;         // état = 6 (chargement actif)
///     FUN_140051c90(local_138);  // créer tâche locale
///     FUN_14047ab40(local_138, uVar3, uVar4);  // parse rows UTF
///     if (local_97 != '\0') {
///         // allocation heap CRI catégorie 6, taille 0x10 par entrée
///         uVar11 = *(uint*)(local_f8 + 8);  // count d'entrées
///         DAT_142034f18 = FUN_14005ae00(6, &local_150);
///         // copie données
///         FUN_141670310(DAT_142034f18, uVar8, uVar9);
///         // finalisation
///         cVar7 = FUN_14047ad20(local_138);
///         if (cVar7 != '\0') {
///             _DAT_141c001e0 = DAT_142034f18;  // publie base tableau
///             _DAT_141c001e8 = DAT_142034f10;  // publie table UTF
///             _DAT_141c001f0 = DAT_142034f24;  // publie count
///         }
///     }
/// }
/// ```
///
/// ## Différences de portage
///
/// - La gestion CRI Fs (handle fichier + VTable `DAT_142043520`) est remplacée par un
///   slice d'octets bruts (le code appelant lit et passe le contenu).
/// - La décision de déchiffrement est explicite (`decrypt: bool`) plutôt que conditionnée
///   sur `DAT_141f9805a`.
/// - Les globaux `DAT_*` sont représentés par le struct `CpkListState`.
/// - Le parsing UTF interne (via `CriUtf_ParseRows`) est délégué à notre propre implem
///   du format UTF défini dans ce module.
pub struct CpkListLoader;

impl CpkListLoader {
    /// Charge et parse `cpk_list.cfg.bin` depuis ses octets bruts.
    ///
    /// # Arguments
    ///
    /// * `data` — contenu brut de `cpk_list.cfg.bin` (éventuellement chiffré).
    /// * `decrypt` — si `true`, déchiffre avec la clé Viola `0x1717E18E`
    ///   (= `DAT_141f9805a != 0` dans le moteur C).
    ///
    /// # Retourne
    ///
    /// `Ok(CpkListState)` avec les entrées parsées et publiées (équivalent des
    /// globaux `DAT_141c001e0/e8/f0`).
    ///
    /// # Erreurs
    ///
    /// - [`CpkError::CpkListCorrupt`] si le contenu ne peut pas être parsé comme table UTF.
    ///
    /// # Exemples
    ///
    /// ```rust,no_run
    /// use nie_engine::cpk::CpkListLoader;
    /// let data = std::fs::read("data/cpk_list.cfg.bin").unwrap();
    /// let state = CpkListLoader::load(&data, true).unwrap();
    /// println!("{} entrées CPK chargées", state.count);
    /// ```
    pub fn load(data: &[u8], decrypt: bool) -> Result<CpkListState, CpkError> {
        // Copie locale pour déchiffrement optionnel.
        // (Reproduit le comportement : le moteur modifie le buffer en place via FUN_14048e560.)
        let mut buf = data.to_vec();

        // 3. Déchiffrement optionnel Viola (FUN_14048e560, clé 0x1717e18e)
        if decrypt {
            // FUN_14048e560(&local_150, 0, 0x1717e18e)
            // Port de l'algorithme XOR progressif identique à celui du CPK :
            // chaque octet est XORé avec un état dérivé de la clé Viola.
            viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        }

        // 4. Parse de la structure interne du cfg.bin.
        // Le moteur utilise FUN_14047a9c0/ab40/ad20 (CriUtf) ; on parse directement.
        let state = parse_cpk_list_buf(&buf)?;

        Ok(state)
    }

    /// Charge `cpk_list.cfg.bin` depuis le disque.
    ///
    /// Raccourci qui lit le fichier puis appelle [`Self::load`].
    ///
    /// # Arguments
    ///
    /// * `path` — chemin vers `cpk_list.cfg.bin`.
    /// * `decrypt` — si `true`, applique le déchiffrement Viola.
    ///
    /// # Erreurs
    ///
    /// - [`CpkError::CpkListNotFound`] si le fichier n'est pas lisible.
    /// - [`CpkError::CpkListCorrupt`] si le contenu est invalide.
    pub fn load_file<P: AsRef<Path>>(path: P, decrypt: bool) -> Result<CpkListState, CpkError> {
        let path = path.as_ref();
        let data = std::fs::read(path).map_err(|_| CpkError::CpkListNotFound {
            path: path.to_path_buf(),
        })?;
        Self::load(&data, decrypt)
    }
}

// ---------------------------------------------------------------------------
// Algorithme de déchiffrement Viola (XOR progressif)
// ---------------------------------------------------------------------------

/// Déchiffre en place un buffer avec la clé Viola `key` (algorithme XOR progressif).
///
/// Port de `FUN_14048e560` (`CriViolaDecrypt`) tel que référencé dans `FUN_14157cf50`.
/// Le même algorithme XOR positionnel est utilisé pour le déchiffrement des `cfg.bin`
/// Viola. La sémantique est identique à `decrypt_block` de `nie-formats::cpk` avec la
/// clé fixe passée explicitement.
///
/// ## Algorithme (porté de CriwareCrypt.cs / NativeCrypto.cs)
///
/// La table CRC32 (poly `0xEDB88320`) est utilisée pour dériver des octets XOR à partir
/// de l'offset absolu et de la clé. Chaque position `i` dans le buffer est XORée par
/// `compute_xor_byte(update_crc_state(base_offset as u32, key_bytes), pos_in_word)`.
///
/// Identique à `nie_formats::cpk::decrypt_block(buf, 0, VIOLA_KEY)`.
fn viola_decrypt_inplace(buf: &mut [u8], key: u32) {
    // Port fidèle de CriwareCrypt.DecryptBlock (file_offset=0, clé=VIOLA_KEY).
    if buf.is_empty() {
        return;
    }

    let k = [
        key as u8,
        (key >> 8) as u8,
        (key >> 16) as u8,
        (key >> 24) as u8,
    ];

    let mut i = 0usize;
    let length = buf.len();

    // Boucle principale : mots de 4 octets.
    let mut base_offset = 0u32;
    while i + 4 <= length {
        let crc = update_crc_state(base_offset, k);
        buf[i]     ^= compute_xor_byte(crc, 0);
        buf[i + 1] ^= compute_xor_byte(crc, 1);
        buf[i + 2] ^= compute_xor_byte(crc, 2);
        buf[i + 3] ^= compute_xor_byte(crc, 3);
        i += 4;
        base_offset += 4;
    }

    // Octets restants (< 4).
    if i < length {
        let crc = update_crc_state(base_offset, k);
        let mut pos = 0u32;
        while i < length {
            buf[i] ^= compute_xor_byte(crc, pos);
            i += 1;
            pos += 1;
        }
    }
}

/// Polynôme CRC32 réfléchi standard.
const CRC32_POLY: u32 = 0xEDB8_8320;

/// Construit la table CRC32 au build.
const fn crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0u32;
    while i < 256 {
        let mut crc = i;
        let mut j = 0;
        while j < 8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ CRC32_POLY } else { crc >> 1 };
            j += 1;
        }
        table[i as usize] = crc;
        i += 1;
    }
    table
}

const CRC32_TABLE: [u32; 256] = crc32_table();

/// Port de `UpdateCrcStateFast` (CriwareCrypt.cs).
fn update_crc_state(seed: u32, k: [u8; 4]) -> u32 {
    let mut crc = !seed;
    let mut i = 0;
    while i < 4 {
        let idx = ((crc & 0xFF) as u8 ^ k[i]) as usize;
        crc = (crc >> 8) ^ CRC32_TABLE[idx];
        i += 1;
    }
    !crc
}

/// Port de `ComputeXorByte` (CriwareCrypt.cs).
fn compute_xor_byte(crc: u32, position: u32) -> u8 {
    let base_shift = position * 2;
    let mut r8 = (crc >> (base_shift + 8)) & 3;
    r8 |= ((crc >> base_shift) & 0xFF) << 2 & 0xFF;
    r8 = ((r8 << 2) & 0xFF) | ((crc >> (base_shift + 16)) & 3);
    r8 = ((r8 << 2) & 0xFF) | ((crc >> (base_shift + 24)) & 3);
    r8 as u8
}

// ---------------------------------------------------------------------------
// Parser interne du cfg.bin CPK list
// ---------------------------------------------------------------------------

/// Parse le contenu brut (déchiffré) de `cpk_list.cfg.bin` et extrait les entrées.
///
/// Le fichier `cpk_list.cfg.bin` est un fichier RDBN (cfg.bin Level-5) ou une table
/// UTF CRI embarquée. Le moteur le traite via `CriUtf_ParseRows` (`FUN_14047ab40`).
///
/// Ce parser tente d'abord l'interprétation UTF Criware, puis l'interprétation RDBN.
/// Les deux formats sont reconnus par leur magic respectif.
///
/// ## Format reconnu
///
/// - `@UTF` (big-endian, magic `0x40555446`) : table CRI Middleware UTF.
/// - `RDBN` (little-endian, magic `0x4E424452`) : cfg.bin Level-5.
///
/// ## Port
///
/// Correspondance avec les étapes de `FUN_14157cf50` :
/// - Parse table → `FUN_14047a9c0` (info) + `FUN_14047ab40` (rows)
/// - `local_f8 + 8` → `uVar11` = count d'entrées UTF
/// - `DAT_142034f28 = 6` → état interne = 6 (chargement)
/// - Tableau résultat → `DAT_141c001e0` / `DAT_141c001f0`
fn parse_cpk_list_buf(buf: &[u8]) -> Result<CpkListState, CpkError> {
    if buf.len() < 4 {
        return Err(CpkError::CpkListCorrupt { reason: "buffer trop court (< 4 octets)" });
    }

    // Détection du format par magic.
    let magic = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);

    match magic {
        // 0x40555446 = "@UTF" big-endian
        0x4055_5446 => parse_utf_cpk_list(buf),
        // 0x4E424452 = "RDBN" little-endian
        0x4E42_4452 => parse_rdbn_cpk_list(buf),
        // Essai UTF avec offset (le cfg.bin peut avoir un header RDBN avant l'UTF)
        _ => {
            // Recherche du magic @UTF dans les 256 premiers octets.
            // (FUN_14047a9c0 reçoit l'offset depuis le début du buffer.)
            let utf_offset = buf[..buf.len().min(256)]
                .windows(4)
                .position(|w| w == b"@UTF");
            if let Some(off) = utf_offset {
                parse_utf_cpk_list(&buf[off..])
            } else {
                // Recherche RDBN
                let rdbn_offset = buf[..buf.len().min(256)]
                    .windows(4)
                    .position(|w| w == b"RDBN");
                if let Some(off) = rdbn_offset {
                    parse_rdbn_cpk_list(&buf[off..])
                } else {
                    Err(CpkError::CpkListCorrupt {
                        reason: "format non reconnu (ni @UTF ni RDBN)",
                    })
                }
            }
        }
    }
}

/// Parse une table `@UTF` de `cpk_list.cfg.bin` pour en extraire les entrées CPK.
///
/// Reproduit la logique de `FUN_14047ab40` (CriUtf_ParseRows) et
/// `FUN_141670310` (copie vers le tableau d'entrées `DAT_142034f18`).
///
/// ## Layout UTF attendu
///
/// La table UTF suit le format standard CRI (voir `nie-formats::cpk::parse_utf`).
/// Chaque ligne représente un fichier avec les colonnes suivantes (noms approximatifs RE) :
///
/// | Colonne      | Type   | Description                              |
/// |-------------|--------|------------------------------------------|
/// | `FileName`  | String | Nom de fichier interne                   |
/// | `DirName`   | String | Répertoire interne                       |
/// | `CpkHash`   | String | Nom/hash du CPK hôte                     |
/// | `FileSize`  | U32    | Taille du fichier                        |
///
/// Ces colonnes sont celles documentées dans le VFS (`vfs.rs`) qui lit le même fichier.
fn parse_utf_cpk_list(utf_data: &[u8]) -> Result<CpkListState, CpkError> {
    // Vérification du magic @UTF.
    if utf_data.len() < 8 || &utf_data[..4] != b"@UTF" {
        return Err(CpkError::CpkListCorrupt { reason: "@UTF : magic manquant" });
    }

    // Lecture du header UTF (big-endian, base = offset 8).
    // Layout (relatif à l'offset 8 = UTF_BASE) :
    //   +0x00 u32  rows_offset   (relatif à UTF_BASE)
    //   +0x04 u32  string_offset (relatif à UTF_BASE)
    //   +0x08 u32  data_offset   (relatif à UTF_BASE)
    //   +0x0C u32  table_name_off
    //   +0x10 u16  column_count
    //   +0x12 u16  row_stride
    //   +0x14 u32  row_count
    const UTF_BASE: usize = 8;

    if utf_data.len() < UTF_BASE + 0x18 {
        return Err(CpkError::CpkListCorrupt { reason: "@UTF : header tronqué" });
    }

    let read_u32_be = |off: usize| -> Option<u32> {
        utf_data.get(off..off + 4)?.try_into().ok().map(u32::from_be_bytes)
    };
    let read_u16_be = |off: usize| -> Option<u16> {
        utf_data.get(off..off + 2)?.try_into().ok().map(u16::from_be_bytes)
    };

    let rows_off_rel  = read_u32_be(UTF_BASE)      .ok_or(CpkError::CpkListCorrupt { reason: "@UTF : rows_offset" })? as usize;
    let str_off_rel   = read_u32_be(UTF_BASE + 4)  .ok_or(CpkError::CpkListCorrupt { reason: "@UTF : string_offset" })? as usize;
    let data_off_rel  = read_u32_be(UTF_BASE + 8)  .ok_or(CpkError::CpkListCorrupt { reason: "@UTF : data_offset" })? as usize;
    let tname_off     = read_u32_be(UTF_BASE + 12) .ok_or(CpkError::CpkListCorrupt { reason: "@UTF : table_name_off" })? as usize;
    let col_count     = read_u16_be(UTF_BASE + 16) .ok_or(CpkError::CpkListCorrupt { reason: "@UTF : column_count" })? as usize;
    let row_stride    = read_u16_be(UTF_BASE + 18) .ok_or(CpkError::CpkListCorrupt { reason: "@UTF : row_stride" })? as usize;
    let row_count     = read_u32_be(UTF_BASE + 20) .ok_or(CpkError::CpkListCorrupt { reason: "@UTF : row_count" })? as usize;

    let _ = (data_off_rel, tname_off); // utilisés implicitement ci-dessous

    let rows_base   = UTF_BASE + rows_off_rel;
    let string_base = UTF_BASE + str_off_rel;

    // Lecture d'une chaîne null-terminée depuis le string pool.
    let read_cstr = |pool_off: usize| -> String {
        let start = string_base.saturating_add(pool_off);
        if start >= utf_data.len() {
            return String::new();
        }
        let slice = &utf_data[start..];
        let nul = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
        String::from_utf8_lossy(&slice[..nul]).into_owned()
    };

    // --- Parsing du schéma des colonnes (offset 0x20) ---
    // Descripteur = 1 octet flags + [4 octets name_off si HAS_NAME] + [wire_size si HAS_DEFAULT]
    const FLAG_HAS_NAME: u8    = 0x10;
    const FLAG_HAS_DEFAULT: u8 = 0x20;
    const FLAG_ROW_STORAGE: u8 = 0x40;

    #[derive(Clone)]
    struct ColDef {
        name: String,
        col_type: u8,   // nibble bas des flags
        flags: u8,
        default_str_off: Option<u32>,  // si HAS_DEFAULT + type String
        default_u32: Option<u32>,      // si HAS_DEFAULT + type U32
    }

    let mut col_defs: Vec<ColDef> = Vec::with_capacity(col_count);
    let mut schema_off = 0x20usize; // les descripteurs commencent à 0x20

    for _ in 0..col_count {
        if schema_off >= utf_data.len() {
            break;
        }
        let flags = utf_data[schema_off];
        schema_off += 1;
        let col_type = flags & 0x0F;

        let name = if flags & FLAG_HAS_NAME != 0 {
            let name_off = read_u32_be(schema_off).unwrap_or(0) as usize;
            schema_off += 4;
            read_cstr(name_off)
        } else {
            String::new()
        };

        let (default_str_off, default_u32) = if flags & FLAG_HAS_DEFAULT != 0 {
            match col_type {
                4 => { // U32
                    let v = read_u32_be(schema_off).unwrap_or(0);
                    schema_off += 4;
                    (None, Some(v))
                }
                10 => { // String
                    let off = read_u32_be(schema_off).unwrap_or(0);
                    schema_off += 4;
                    (Some(off), None)
                }
                _ => {
                    // Autres types : sauter wire_size (approximatif)
                    let wire_size = utf_col_wire_size(col_type);
                    schema_off += wire_size;
                    (None, None)
                }
            }
        } else {
            (None, None)
        };

        col_defs.push(ColDef { name, col_type, flags, default_str_off, default_u32 });
    }

    // --- Parsing des lignes ---
    // uVar11 = *(uint*)(local_f8 + 8) = row_count dans FUN_14157cf50.
    // DAT_142034f28 = 6 = état loader actif.
    let mut entries: Vec<CpkListEntry> = Vec::with_capacity(row_count);

    for r in 0..row_count {
        let row_base = rows_base + r * row_stride;
        let mut row_cursor = row_base;

        let mut filename = String::new();
        let mut directory = String::new();
        let mut cpk_hash = String::new();
        let mut file_size = 0u32;

        for def in &col_defs {
            if def.flags & FLAG_HAS_DEFAULT != 0 {
                // Valeur constante (schéma, n'avance pas row_cursor).
                match def.name.as_str() {
                    "FileName" => {
                        if let Some(off) = def.default_str_off { filename = read_cstr(off as usize); }
                    }
                    "DirName" => {
                        if let Some(off) = def.default_str_off { directory = read_cstr(off as usize); }
                    }
                    "CpkHash" | "CpkName" | "PackName" => {
                        if let Some(off) = def.default_str_off { cpk_hash = read_cstr(off as usize); }
                    }
                    "FileSize" => {
                        if let Some(v) = def.default_u32 { file_size = v; }
                    }
                    _ => {}
                }
            } else if def.flags & FLAG_ROW_STORAGE != 0 {
                // Valeur inline dans la section rows.
                let val_str;
                let val_u32;
                match def.col_type {
                    10 => { // String
                        let off = read_u32_be(row_cursor).unwrap_or(0) as usize;
                        val_str = Some(read_cstr(off));
                        val_u32 = None;
                        row_cursor += 4;
                    }
                    4 => { // U32
                        val_u32 = Some(read_u32_be(row_cursor).unwrap_or(0));
                        val_str = None;
                        row_cursor += 4;
                    }
                    _ => {
                        let ws = utf_col_wire_size(def.col_type);
                        val_str = None;
                        val_u32 = None;
                        row_cursor += ws;
                    }
                }
                match def.name.as_str() {
                    "FileName" => {
                        if let Some(s) = val_str { filename = s; }
                    }
                    "DirName" => {
                        if let Some(s) = val_str { directory = s; }
                    }
                    "CpkHash" | "CpkName" | "PackName" => {
                        if let Some(s) = val_str { cpk_hash = s; }
                    }
                    "FileSize" => {
                        if let Some(v) = val_u32 { file_size = v; }
                    }
                    _ => {
                        // Colonnes non nommées : on tente de les mapper par position.
                        // D'après le VFS : cols[0]=Dir, cols[1]=File, cols[3]=CpkHash, cols[4]=Size
                        let col_idx = col_defs.iter().position(|c| std::ptr::eq(c, def));
                        if let Some(idx) = col_idx {
                            match idx {
                                0 => { if let Some(s) = val_str { directory = s; } }
                                1 => { if let Some(s) = val_str { filename = s; } }
                                3 => { if let Some(s) = val_str { cpk_hash = s; } }
                                4 => { if let Some(v) = val_u32 { file_size = v; } }
                                _ => {}
                            }
                        }
                    }
                }
            }
            // ni HAS_DEFAULT ni ROW_STORAGE → valeur zéro implicite, pas d'avance row_cursor.
        }

        entries.push(CpkListEntry { filename, directory, cpk_hash, file_size });
    }

    let count = entries.len() as u64;

    // Publication des globaux (DAT_141c001e0/e8/f0).
    // DAT_142034f28 = 6 → état loader (non observable côté Rust, logiqué documenté).
    // cVar7 = FUN_14047ad20(local_138) → finalisation UTF (on considère toujours ok ici).
    Ok(CpkListState { entries, count })
}

/// Taille wire d'un type de colonne UTF (en octets).
fn utf_col_wire_size(col_type: u8) -> usize {
    match col_type {
        0 | 1 => 1,          // U8, I8
        2 | 3 => 2,          // U16, I16
        4 | 5 | 8 => 4,      // U32, I32, F32
        6 | 7 | 9 | 11 => 8, // U64, I64, F64, Bytes (offset+len)
        10 => 4,             // String (offset pool)
        12 => 16,            // Guid
        _ => 4,              // inconnu : skip 4 (heuristique)
    }
}

/// Parse un fichier RDBN (cfg.bin Level-5) de `cpk_list.cfg.bin`.
///
/// Porté du chemin alternatif dans `FUN_14157cf50` : si le magic n'est pas `@UTF`,
/// le loader tente l'interprétation RDBN. Le format RDBN est documenté dans
/// `cfgbin_loader.c` / `cfgbin_parser.c` (autres fichiers décompilés).
///
/// ## Format RDBN minimal
///
/// ```text
/// Offset  Taille  Champ
///  0x00     4     Magic "RDBN"
///  0x04     4     version (LE)
///  0x08     4     entry_count (LE)
///  0x0C     4     data_offset (LE)
///  0x10     …     entrées (variable selon version)
/// ```
///
/// Chaque entrée contient des champs null-terminés pour filename, directory et cpk_hash.
///
/// # RE incertain
///
/// La structure exacte des entrées RDBN dans `cpk_list.cfg.bin` est inconnue sans
/// binaire réel. Ce parser implémente une heuristique de lecture séquentielle de
/// chaînes null-terminées + u32 pour la taille.
fn parse_rdbn_cpk_list(buf: &[u8]) -> Result<CpkListState, CpkError> {
    if buf.len() < 0x10 || &buf[..4] != b"RDBN" {
        return Err(CpkError::CpkListCorrupt { reason: "RDBN : magic manquant" });
    }

    // RE incertain: structure du header RDBN spécifique au cpk_list.cfg.bin.
    // On extrait entry_count depuis l'offset 0x08 (LE u32, heuristique).
    let entry_count = u32::from_le_bytes(
        buf.get(8..12)
            .and_then(|s| s.try_into().ok())
            .ok_or(CpkError::CpkListCorrupt { reason: "RDBN : entry_count hors limites" })?
    ) as usize;

    let data_offset = u32::from_le_bytes(
        buf.get(12..16)
            .and_then(|s| s.try_into().ok())
            .ok_or(CpkError::CpkListCorrupt { reason: "RDBN : data_offset hors limites" })?
    ) as usize;

    if data_offset > buf.len() {
        return Err(CpkError::CpkListCorrupt { reason: "RDBN : data_offset hors limites" });
    }

    // Lecture heuristique des entrées : chaque entrée = séquence de chaînes null-terminées
    // + u32 pour la taille. Structure : [dir\0][file\0][?\0][cpk_hash\0][file_size u32 LE]
    let data = &buf[data_offset..];
    let mut cursor = 0usize;
    let mut entries = Vec::with_capacity(entry_count.min(4096));

    let read_cstr_cursor = |data: &[u8], cursor: &mut usize| -> String {
        let start = *cursor;
        if start >= data.len() {
            return String::new();
        }
        let nul = data[start..].iter().position(|&b| b == 0).unwrap_or(data.len() - start);
        let s = String::from_utf8_lossy(&data[start..start + nul]).into_owned();
        *cursor = start + nul + 1;
        s
    };

    for _ in 0..entry_count {
        if cursor >= data.len() {
            break;
        }
        // RE incertain: ordre des champs dans les entrées RDBN cpk_list.
        // Heuristique basée sur le mapping documenté dans vfs.rs : [dir, file, ?, cpk_hash, size].
        let directory = read_cstr_cursor(data, &mut cursor);
        let filename  = read_cstr_cursor(data, &mut cursor);
        let _unknown  = read_cstr_cursor(data, &mut cursor);
        let cpk_hash  = read_cstr_cursor(data, &mut cursor);
        let file_size = if cursor + 4 <= data.len() {
            let v = u32::from_le_bytes(data[cursor..cursor + 4].try_into().unwrap());
            cursor += 4;
            v
        } else {
            0
        };

        entries.push(CpkListEntry { filename, directory, cpk_hash, file_size });
    }

    let count = entries.len() as u64;
    Ok(CpkListState { entries, count })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- is_crilayla ---

    #[test]
    fn is_crilayla_detection_magic_exact() {
        // FUN_14066371c : 7 < param_2 && memcmp(param_1, "CRILAYLA", 8) == 0
        assert!(is_crilayla(b"CRILAYLA\x00\x00\x00\x00"));
        assert!(is_crilayla(b"CRILAYLA")); // exactement 8 octets
    }

    #[test]
    fn is_crilayla_trop_court() {
        // 7 < param_2 → false si len <= 7
        assert!(!is_crilayla(b"CRILAYL")); // 7 octets → pas > 7
        assert!(!is_crilayla(b"CRILAYA"));
        assert!(!is_crilayla(b""));
    }

    #[test]
    fn is_crilayla_mauvais_magic() {
        assert!(!is_crilayla(b"crilayla\x00\x00")); // casse incorrecte
        assert!(!is_crilayla(b"CPK \x00\x00\x00\x00\x00"));
        assert!(!is_crilayla(b"@UTF\x00\x00\x00\x00\x00"));
    }

    // --- is_cpk_clear ---

    #[test]
    fn is_cpk_clear_magic_clair() {
        // "CPK " = 0x43 0x50 0x4B 0x20 → u32 LE = 0x204B5043
        assert!(is_cpk_clear(CPK_MAGIC_LE));
        assert!(is_cpk_clear(0x204B_5043));
    }

    #[test]
    fn is_cpk_clear_chiffre_est_false() {
        // Les CPK IEVR réels retournent une valeur différente (chiffrés).
        assert!(!is_cpk_clear(0x0000_0000));
        assert!(!is_cpk_clear(0x1234_5678));
        assert!(!is_cpk_clear(0xFFFF_FFFF));
    }

    // --- viola_decrypt_inplace ---

    #[test]
    fn viola_decrypt_est_involutif() {
        // L'XOR est involutif : déchiffrer deux fois = identité.
        let original = b"Hello, CPK list!".to_vec();
        let mut buf = original.clone();
        viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        assert_eq!(buf, original, "double déchiffrement doit restituer l'original");
    }

    #[test]
    fn viola_decrypt_vide_ne_panique_pas() {
        // Aucun accès hors bornes sur buffer vide.
        let mut buf: Vec<u8> = Vec::new();
        viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        assert!(buf.is_empty());
    }

    #[test]
    fn viola_decrypt_un_octet() {
        // Vérification sur 1 octet (chemin octets restants < 4).
        let mut buf = vec![0u8];
        let original = buf.clone();
        viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        assert_eq!(buf, original);
    }

    #[test]
    fn viola_decrypt_quatre_octets_alignes() {
        // Vérification sur 4 octets (boucle principale exacte).
        let mut buf = vec![0u8, 1, 2, 3];
        let original = buf.clone();
        viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        // L'XOR change les valeurs.
        assert_ne!(buf, original);
        // Re-chiffrer redonne l'original.
        viola_decrypt_inplace(&mut buf, VIOLA_KEY);
        assert_eq!(buf, original);
    }

    // --- crc32_table ---

    #[test]
    fn crc32_table_valeurs_canoniques() {
        // Poly 0xEDB88320 : valeurs connues.
        assert_eq!(CRC32_TABLE[0], 0x0000_0000);
        assert_eq!(CRC32_TABLE[1], 0x7707_3096);
        assert_eq!(CRC32_TABLE[255], 0x2D02_EF8D);
    }

    // --- CpkListLoader avec données synthétiques ---

    /// Construit une table @UTF minimale simulant `cpk_list.cfg.bin`.
    ///
    /// Structure : 2 colonnes (FileName String, FileSize U32) × 2 lignes.
    /// (Test structurel du parser UTF embarqué du loader.)
    fn build_utf_cpk_list() -> Vec<u8> {
        // String pool :
        //  off 0  : "cpk_list\0"  (9)
        //  off 9  : "FileName\0"  (9)
        //  off 18 : "FileSize\0"  (9)
        //  off 27 : "chara.g4tx\0" (11)
        //  off 38 : "field.g4tx\0" (11)
        let string_pool: &[u8] =
            b"cpk_list\0FileName\0FileSize\0chara.g4tx\0field.g4tx\0";
        // Longueurs : 9+9+9+11+11 = 49 octets.

        // Schema : 2 colonnes
        // Col0 : flags=0x5A (HAS_NAME|ROW_STORAGE|String=10), name_off=9
        // Col1 : flags=0x54 (HAS_NAME|ROW_STORAGE|U32=4), name_off=18
        let schema: &[u8] = &[
            0x5A, 0x00, 0x00, 0x00, 0x09, // Col0 FileName String
            0x54, 0x00, 0x00, 0x00, 0x12, // Col1 FileSize U32 (0x12 = 18)
        ];

        // Rows : 2 lignes × 8 octets (4 + 4)
        let row_data: &[u8] = &[
            // Ligne 0 : FileName=off27 "chara.g4tx", FileSize=1000
            0x00, 0x00, 0x00, 27,
            0x00, 0x00, 0x03, 0xE8,
            // Ligne 1 : FileName=off38 "field.g4tx", FileSize=2000
            0x00, 0x00, 0x00, 38,
            0x00, 0x00, 0x07, 0xD0,
        ];

        // Calcul offsets (relatifs à UTF_BASE=8) :
        // header body = 0x18, schema = 10, rows à 0x22 (rel), string_pool à 0x22+16=0x32 (rel)
        let rows_off_rel: u32 = 0x22;
        let str_off_rel: u32  = rows_off_rel + 16; // 2 lignes × 8 octets
        let data_off_rel: u32 = str_off_rel + string_pool.len() as u32;

        let mut body: Vec<u8> = Vec::new();
        body.extend_from_slice(&rows_off_rel.to_be_bytes());
        body.extend_from_slice(&str_off_rel.to_be_bytes());
        body.extend_from_slice(&data_off_rel.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes()); // table_name_off=0
        body.extend_from_slice(&2u16.to_be_bytes()); // col_count=2
        body.extend_from_slice(&8u16.to_be_bytes()); // row_stride=8
        body.extend_from_slice(&2u32.to_be_bytes()); // row_count=2
        body.extend_from_slice(schema);
        body.extend_from_slice(row_data);
        body.extend_from_slice(string_pool);

        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(b"@UTF");
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn loader_parse_utf_synthetique() {
        let data = build_utf_cpk_list();
        let state = CpkListLoader::load(&data, false)
            .expect("le cpk_list UTF synthétique doit parser");

        // Correspondance avec les globaux DAT_141c001e0/f0 :
        // count = 2, entries[0].filename = "chara.g4tx", entries[1].file_size = 2000.
        assert_eq!(state.count, 2, "g_CpkListCount doit être 2");
        assert_eq!(state.entries.len(), 2);
        assert_eq!(state.entries[0].filename, "chara.g4tx",
            "entries[0] = chara.g4tx (col FileName)");
        assert_eq!(state.entries[0].file_size, 1000,
            "entries[0].file_size = 1000");
        assert_eq!(state.entries[1].filename, "field.g4tx");
        assert_eq!(state.entries[1].file_size, 2000);
    }

    #[test]
    fn loader_decrypt_involutif() {
        // Déchiffrer deux fois (encrypt=decrypt en XOR) doit redonner le même état.
        let data = build_utf_cpk_list();

        // Chiffrer une fois manuellement.
        let mut encrypted = data.clone();
        viola_decrypt_inplace(&mut encrypted, VIOLA_KEY);

        // CpkListLoader::load avec decrypt=true doit déchiffrer et parser correctement.
        let state = CpkListLoader::load(&encrypted, true)
            .expect("load avec decrypt doit réussir");
        assert_eq!(state.count, 2);
        assert_eq!(state.entries[0].filename, "chara.g4tx");
    }

    #[test]
    fn loader_format_inconnu_echoue() {
        let bad = b"\x00\x00\x00\x00XXXXXXXXXXXXXXXXXXXXXXXX";
        let res = CpkListLoader::load(bad, false);
        assert!(res.is_err(), "format inconnu doit échouer");
    }

    // --- Constantes portées ---

    #[test]
    fn constantes_correctes() {
        // CPK_PACKS_DIR correspond au format string de FUN_14157c660.
        assert_eq!(CPK_PACKS_DIR, "data/packs");
        // CPK_LIST_FILENAME correspond à la string de FUN_14157cf50.
        assert_eq!(CPK_LIST_FILENAME, "cpk_list.cfg.bin");
        // VIOLA_KEY = 0x1717E18E (hex_constants de FUN_14157cf50).
        assert_eq!(VIOLA_KEY, 0x1717_E18E);
        // CPK_MAGIC_LE = "CPK " en little-endian.
        assert_eq!(CPK_MAGIC_LE, 0x204B_5043);
        // CPK_LIST_UTF_INIT_WORD = local_154 init dans FUN_14157cf50.
        assert_eq!(CPK_LIST_UTF_INIT_WORD, 0x0500);
        // Taille d'entrée allouée = 0x10 (FUN_14005ae00 catégorie 6).
        assert_eq!(CPK_LIST_ENTRY_ALLOC_SIZE, 0x10);
        // Catégorie heap CRI.
        assert_eq!(CRI_HEAP_CATEGORY_CPK, 6);
    }
}
