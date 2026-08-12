//! `niers` — pilote la boucle RE autonome (seed → propagate → coverage) et la frontière redis.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

mod decode_cmd;
mod delegate;
mod lua_cmd;
mod menu_predecode;

use std::io::Write;
use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use sha2::{Digest, Sha256};

/// Image base de nie.exe (PE32+ Level-5).
const NIE_IMAGE_BASE: i64 = 0x1_4000_0000;

/// Parse une adresse décimale ou hexadécimale (`0x...`).
fn parse_addr(s: &str) -> Result<i64, String> {
    match s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        Some(hex) => u64::from_str_radix(hex, 16).map(|v| v as i64).map_err(|e| e.to_string()),
        None => s.parse::<i64>().map_err(|e| e.to_string()),
    }
}

#[derive(Parser)]
#[command(name = "niers", about = "Boucle RE + réimplémentation Rust d'Inazuma Eleven: Victory Road")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Délègue au toolkit C++ `iecode` (~40 commandes non encore portées).
    ///
    /// `niers` est la seule CLI utilisateur (cf. docs/ARCHITECTURE.md) : les
    /// commandes du C++ passent par ici tant qu'elles ne sont pas portées en Rust.
    ///
    /// `disable_help_flag` : `--help`/`-h` doivent atteindre le délégué, pas être avalés par
    /// clap — sinon `niers cpp --help` n'affiche jamais l'aide des 40 commandes déléguées.
    #[command(name = "cpp", disable_help_flag = true)]
    Cpp {
        /// Arguments transmis tels quels à `iecode`.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Délègue à l'outillage .NET `IECODE.CLI` (~37 commandes : dump, pack, cdn, pipeline…).
    #[command(name = "cs", disable_help_flag = true)]
    Cs {
        /// Arguments transmis tels quels à `iecode.dll`.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Dit quels back-ends de la CLI unique sont construits, et où.
    Backends,
    /// Opérations de modding LEVEL-5 — le périmètre de l'outil Viola, en Rust natif.
    ///
    /// Reprend ce que `niers cs dump` / `niers cpp pack` déléguaient : chaque sous-commande ici
    /// retire une délégation, et l'écart avec les toolkits externes se mesure.
    Viola {
        #[command(subcommand)]
        op: ViolaOp,
    },
    /// Dit le format d'un fichier ou d'une arborescence, sans rien écrire.
    Format {
        /// Fichier ou répertoire à inspecter.
        src: PathBuf,
    },
    /// Décode un fichier ou une arborescence vers JSON (données) / PNG (textures).
    ///
    /// Même table de dispatch que la FFI (`nie_formats::decode`) : ce que le décodage sait
    /// faire ici, `packages/nie` et l'explorateur le savent aussi.
    Decode {
        /// Fichier ou répertoire source.
        src: PathBuf,
        /// Sortie : fichier, ou répertoire si `src` en est un (défaut : à côté de la source).
        #[arg(short, long)]
        out: Option<PathBuf>,
        /// N'affiche rien en cas de succès.
        #[arg(short, long)]
        quiet: bool,
    },
    /// Convertit un asset du jeu vers un format d'échange.
    ///
    /// `decode` rend la représentation canonique d'un fichier (JSON, ou PNG pour une texture) ;
    /// `convert` choisit le format de sortie. La source peut être un fichier du disque **ou** un
    /// chemin VFS — le VFS est interrogé quand le chemin n'existe pas sur le disque.
    Convert {
        /// Fichier du disque, ou chemin VFS (`data/dx11/.../x.g4tx`).
        src: String,
        /// Format de sortie : png, webp, gif, jpg, bmp, tga, tiff, qoi — ou, pour un atlas
        /// d'icônes, css (feuille + image), svg (autonome) ou json (manifeste des régions).
        #[arg(long, default_value = "png")]
        to: String,
        /// Fichier de sortie (défaut : la source avec l'extension du format).
        #[arg(short, long)]
        out: Option<PathBuf>,
        /// Racine du jeu (défaut : résolution automatique).
        #[arg(long)]
        game_dir: Option<PathBuf>,
        /// Compare l'octet produit à une référence (fichier local ou URL `https://`).
        #[arg(long)]
        reference: Option<String>,
        /// Pour `--to css` : pose l'atlas en masque teinté par `currentColor`, au lieu d'une
        /// image de fond. Les icônes suivent alors la couleur du thème.
        #[arg(long)]
        masque: bool,
    },
    /// Analyse statique d'une source Lua (fichier ou arborescence), sans l'exécuter.
    ///
    /// Cible les scripts décompilés (`data/lua_scripts/decompiled/`) : fonctions déclarées,
    /// appels, chaînes, et erreurs de syntaxe laissées par le décompilateur. Le bytecode
    /// `.lua.bin` ne se traite pas ici — il s'exécute (`nie_lua`), il ne se lit pas.
    Lua {
        /// Fichier `.lua` ou répertoire à parcourir récursivement.
        src: PathBuf,
        /// Détaille les fonctions déclarées.
        #[arg(long)]
        functions: bool,
        /// Détaille les cibles d'appel, agrégées par fréquence décroissante.
        #[arg(long)]
        calls: bool,
        /// Détaille les chaînes littérales retenues.
        #[arg(long)]
        strings: bool,
        /// Détaille les chaînes passées à `CRC32`, avec leur hash.
        #[arg(long)]
        crc32: bool,
        /// Lignes de détail maximales par rubrique et par fichier (0 = illimité).
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Importe le savoir fusionné (index Ghidra nie-index.json) dans la base de connaissance.
    Seed {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Fichier research/nie-index.json.
        #[arg(long)]
        json: PathBuf,
        /// Binaire nie.exe (pour calculer sha256/taille). Optionnel.
        #[arg(long)]
        exe: Option<PathBuf>,
    },
    /// Affiche la couverture (fonctions classifiées) du binaire indexé.
    Coverage {
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
    },
    /// Opérations sur la frontière BFS redis.
    Queue {
        #[command(subcommand)]
        op: QueueOp,
        #[arg(long, env = "NIERS_REDIS", default_value = "redis://127.0.0.1/")]
        redis: String,
        #[arg(long, default_value = "nie")]
        tag: String,
    },
    /// Propage les labels sur le call-graph (auto-ML, ancrage strings + label-spreading).
    Propagate {
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        #[arg(long, default_value_t = 16)]
        rounds: usize,
    },
    /// Extrait les classes RTTI MSVC depuis nie_eacpatched.exe et les ingère dans la base.
    Rtti {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Chemin vers nie_eacpatched.exe (ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Triage PE/ELF via aphrody-re : sections + imports/exports ingérés dans la base.
    Index {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire à indexer.
        #[arg(long)]
        exe: PathBuf,
    },
    /// Récupère les arêtes d'appel manquantes par désassemblage iced-x86 de `.text`.
    Disasm {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire à désassembler (nie_eacpatched.exe ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Découvre les fonctions AUTORITAIRES via `.pdata` et mesure le désalignement Ghidra.
    Pdata {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire PE x64 (nie_eacpatched.exe ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Refonde la carte sur `.pdata` (vrais débuts), ré-ancre Ghidra, disasm + propage. Couverture HONNÊTE.
    Rebuild {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire PE x64.
        #[arg(long)]
        exe: PathBuf,
        #[arg(long, default_value_t = 16)]
        rounds: usize,
    },
    /// Opérations sur les saves IEVR (Lives format) : decrypt/read/edit.
    Save {
        #[command(subcommand)]
        op: SaveOp,
    },
    /// Exploration game-data depuis le miroir SQLite (personnages, skills, items, équipes).
    Wiki {
        #[command(subcommand)]
        op: WikiOp,
    },
    /// Construit le manifeste CRC32->chemin pour tous les fichiers .g4md/.g4mg des CPK.
    /// Utilisé pour résoudre les ModelIdCrc des inagle_uniforms vers les chemins réels.
    UniformMap {
        /// Répertoire racine du jeu (contenant `data/cpk_list.cfg.bin`). Résolu
        /// automatiquement s'il est absent (cf. `NIE_GAME_DIR`).
        #[arg(long)]
        game_dir: Option<PathBuf>,
        /// Chemin du manifeste NDJSON de sortie (crc32->path).
        #[arg(long, default_value = "var/model-crc-manifest.ndjson")]
        out: PathBuf,
    },
    /// Scanne les fichiers .g4tx dans les CPK du jeu et produit un manifeste NDJSON d'en-têtes.
    Textures {
        /// Répertoire racine du jeu (contenant `data/cpk_list.cfg.bin`). Résolu
        /// automatiquement s'il est absent (cf. `NIE_GAME_DIR`).
        #[arg(long)]
        game_dir: Option<PathBuf>,
        /// Borne dure : nombre maximum de .g4tx à traiter (défaut 500).
        #[arg(long, default_value_t = 500)]
        limit: usize,
        /// Chemin du manifeste NDJSON de sortie.
        #[arg(long, default_value = "var/g4tx-manifest.ndjson")]
        manifest: PathBuf,
        /// Pousse aussi dans Redis db3 (iev:tex:*).
        #[arg(long)]
        redis: bool,
        /// URL Redis (db3).
        #[arg(long, default_value = "redis://127.0.0.1/3")]
        redis_url: String,
    },
    /// Pré-décode les sprites menu IEVR (g4tx→DDS→RGBA→PNG) dans le dump disque.
    ///
    /// Lit l'index Redis db3 (iev:file:index) pour localiser les g4tx dans les CPK,
    /// décode chacun via nie-formats + image_dds (BC1/BC3/BC7), et écrit le PNG
    /// à <game_dir>/data/dx11/menu/.../<nom>.png (idempotent : skip si non-vide).
    ///
    /// Priorité : sprites des 32 layouts azalee (<layouts_dir>/*.json) ; le reste si --all.
    MenuPredecode {
        /// Répertoire racine du jeu (contenant `data/packs/`). Résolu automatiquement s'il
        /// est absent (cf. `NIE_GAME_DIR`).
        #[arg(long)]
        game_dir: Option<PathBuf>,
        /// Répertoire des layouts azalee (`*.json`) — vit dans le dépôt azalee, pas ici :
        /// aucun défaut ne peut être juste, le chemin est donc demandé.
        #[arg(long)]
        layouts_dir: PathBuf,
        /// URL Redis db3 (iev:file:index).
        #[arg(long, default_value = "redis://127.0.0.1/3")]
        redis_url: String,
        /// Traite aussi TOUS les g4tx menu fr+en+base (pas seulement les sprites des layouts).
        #[arg(long)]
        all: bool,
    },
    /// RE en direct : lit/scanne/dumpe la mémoire live d'un nie.exe sous Wine (process_vm_readv).
    ///
    /// Le jeu doit tourner (cf. crates/forge/nie-trace/scripts/boot-nie-direct.sh) ; s'attache à un
    /// process existant, ne le lance jamais, ne le stoppe pas. Linux-only.
    Mem {
        #[command(subcommand)]
        op: MemOp,
    },
    /// Explorateur du VFS (CPK) : liste/cherche/prévisualise/extrait les ~254 800 fichiers du
    /// jeu, avec décodage structuré par format (G4MT/G4SK/G4MD/G4TX/…) et recherche de
    /// personnage/technique par nom, ID ou code interne via le miroir wiki.
    Vfs {
        #[command(subcommand)]
        op: VfsOp,
    },
}

/// Sous-commandes de `niers mem` (RE runtime via nie-trace).
#[derive(Subcommand)]
enum MemOp {
    /// Liste les plages mémoire (filtrées par --module sauf --all).
    Maps {
        #[arg(long, short = 'p', default_value_t = 0)]
        pid: i32,
        #[arg(long, short = 'm', default_value = "nie.exe")]
        module: String,
        #[arg(long)]
        all: bool,
    },
    /// Affiche l'adresse de chargement (base) d'un module.
    Base {
        #[arg(long, short = 'p', default_value_t = 0)]
        pid: i32,
        #[arg(long, short = 'm', default_value = "nie.exe")]
        module: String,
    },
    /// Lit des octets à une adresse (hex dump, ou -o fichier brut).
    Read {
        /// Adresse `0x…` ou module-relative `nie.exe+0xF600CA`.
        addr: String,
        #[arg(long, short = 'n', default_value_t = 256)]
        len: usize,
        #[arg(long, short = 'p', default_value_t = 0)]
        pid: i32,
        /// Écrit les octets bruts ici (sinon hex dump stdout).
        #[arg(long, short = 'o')]
        output: Option<PathBuf>,
    },
    /// Dumpe les plages lisibles (module ou --all) vers un dossier.
    Dump {
        #[arg(long, short = 'p', default_value_t = 0)]
        pid: i32,
        #[arg(long, short = 'm', default_value = "nie.exe")]
        module: String,
        #[arg(long)]
        all: bool,
        #[arg(long, short = 'o', default_value = "./memdump")]
        output: PathBuf,
    },
    /// Cherche un motif : hex `48 8B 0D`, texte `str:Closing`, ou UTF-16LE `wstr:Title`.
    Scan {
        /// Motif hex (`DE AD BE EF`), `str:…` (UTF-8) ou `wstr:…` (UTF-16LE, chaînes Windows).
        pattern: String,
        #[arg(long, short = 'p', default_value_t = 0)]
        pid: i32,
        #[arg(long, short = 'm', default_value = "nie.exe")]
        module: String,
        #[arg(long)]
        all: bool,
        #[arg(long, short = 'l', default_value_t = 20)]
        limit: usize,
    },
    /// Patche EAC : crée une copie `--dst` de `--src` avec le call de modale fatale NOPé.
    PatchEac {
        /// nie.exe d'origine (jamais modifié).
        #[arg(long)]
        src: PathBuf,
        /// Sortie patchée (ex. nie_eacpatched.exe).
        #[arg(long)]
        dst: PathBuf,
    },
}

/// Sous-commandes de `niers vfs` (explorateur CPK / VFS).
///
/// `--game-dir` est optionnel partout : par défaut, résolu via
/// [`nie_formats::vfs::resolve_game_dir`] (`NIE_GAME_DIR`, sinon le répertoire courant s'il
/// contient déjà `data/cpk_list.cfg.bin` — cas du dépôt fusionné avec l'install du jeu).
#[derive(Subcommand)]
enum VfsOp {
    /// Vue « dossier » : sous-dossiers et fichiers directement sous `prefix` (racine si omis).
    Ls {
        prefix: Option<String>,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Cherche par sous-chaîne dans les chemins internes (remplace l'exemple `vfs_grep`).
    Find {
        /// Sous-chaîne cherchée (insensible à la casse).
        query: String,
        /// Filtre par extension (ex. `g4tx`, sans le point).
        #[arg(long)]
        ext: Option<String>,
        #[arg(long, short = 'n', default_value_t = 100)]
        limit: usize,
        /// Sortie JSON (tableau compact sur une ligne) — pour consommation programmatique
        /// (ex. `niers_bridge.py` de l'addon Blender `plugins/niers-blender`, recherche de fichiers sans
        /// dépendre du miroir wiki contrairement à `chara`/`waza`).
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Infos sur une entrée précise : taille, CPK conteneur, format détecté (magic).
    Stat {
        path: String,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Aperçu du contenu : décodage structuré selon le format détecté (fallback hexdump).
    Cat {
        path: String,
        /// Force le hexdump même si un décodeur structuré reconnaît le format.
        #[arg(long)]
        hex: bool,
        /// Nombre d'octets affichés en hexdump (défaut 256).
        #[arg(long, default_value_t = 256)]
        len: usize,
        /// Décode la meilleure texture du fichier (.g4tx) et écrit un PNG ici.
        #[arg(long)]
        png_out: Option<PathBuf>,
        /// Décode l'audio brut (ADX) et écrit un WAV ici.
        #[arg(long)]
        wav_out: Option<PathBuf>,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Extrait un fichier — ou tous les fichiers sous un préfixe — vers le disque.
    Extract {
        /// Chemin exact, ou préfixe de dossier VFS.
        path: String,
        #[arg(long, short = 'o')]
        out: PathBuf,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Histogramme des extensions du VFS complet (remplace l'exemple `vfs_hist`).
    Stats {
        #[arg(long, default_value_t = 50)]
        top: usize,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Cherche un personnage par nom (FR/EN/JA), ID ou code interne (miroir wiki `nie-wiki`),
    /// puis liste ses fichiers dans le VFS (modèles, textures, animations…).
    Chara {
        /// Nom/ID/code interne — laisser vide avec `--element`/`--position` pour lister la
        /// catégorie entière (substitué en `""`, qui matche `LIKE '%%'` côté SQL).
        #[arg(default_value = "")]
        query: String,
        /// N'affiche que les résultats wiki, sans lister les fichiers VFS associés.
        #[arg(long)]
        no_paths: bool,
        /// Filtre par élément (ex. `Feu`, `Vent`, `Forêt`, `Montagne`, `Néant`), insensible à la casse.
        #[arg(long)]
        element: Option<String>,
        /// Filtre par poste (ex. `GK`, `DF`, `MF`, `FW`), insensible à la casse.
        #[arg(long)]
        position: Option<String>,
        /// Sortie JSON (tableau compact sur une ligne) — pour consommation programmatique
        /// (ex. `niers_bridge.py` de l'addon Blender `plugins/niers-blender`).
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, short = 'n', default_value_t = 50)]
        limit: usize,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<PathBuf>,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Cherche une technique/waza par nom (FR/EN/JA), ID ou code interne (miroir wiki
    /// `nie-wiki`), puis liste ses fichiers dans le VFS (cut-ins, sons, vidéos…).
    Waza {
        /// Nom/ID/code interne — laisser vide avec `--category`/`--element` pour lister la
        /// catégorie entière.
        #[arg(default_value = "")]
        query: String,
        #[arg(long)]
        no_paths: bool,
        /// Filtre par catégorie, sous-chaîne insensible à la casse (ex. `Tir` matche `Tir/Shoot`,
        /// libellés réels bilingues : `Dribble`, `Défense/Block`, `Arrêt/Keep`).
        #[arg(long)]
        category: Option<String>,
        /// Filtre par élément, insensible à la casse.
        #[arg(long)]
        element: Option<String>,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, short = 'n', default_value_t = 50)]
        limit: usize,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<PathBuf>,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
}

/// Les quatre opérations de modding LEVEL-5, servies par `nie_viola` **en process**.
///
/// Chaque sous-commande ici retire une délégation à `niers cs` / `niers cpp` : c'est la mesure
/// de l'absorption (cf. `docs/ABSORPTION-IECODE.md`).
#[derive(Subcommand)]
enum ViolaOp {
    /// Extrait le VFS complet vers un dossier — packs ordonnés par volume, mappés en mémoire,
    /// reprise d'un dump interrompu.
    Dump {
        /// Dossier de sortie.
        #[arg(long, short = 'o')]
        out: PathBuf,
        /// Filtre glob sur le chemin VFS (`*.g4tx`, `data/chr/*`). Seul `*` est reconnu.
        #[arg(long)]
        filtre: Option<String>,
        /// Repart de zéro au lieu de reprendre le manifeste laissé par un dump précédent.
        #[arg(long)]
        sans_reprise: bool,
        /// Réécrit les fichiers même quand la taille de destination coïncide déjà.
        #[arg(long)]
        tout_reecrire: bool,
        /// Nombre de threads rayon (défaut : autant que de cœurs).
        #[arg(long)]
        threads: Option<usize>,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Bascule les fichiers d'un mod hors des paquets : le jeu les charge alors depuis le disque.
    Pack {
        /// Dossier du mod (arborescence relative au VFS).
        #[arg(long)]
        mod_dir: PathBuf,
        /// Dossier de sortie — reçoit les fichiers et le `cpk_list.cfg.bin` réécrit.
        #[arg(long, short = 'o')]
        out: PathBuf,
        /// `cpk_list.cfg.bin` **vanilla**. Défaut : celui du jeu résolu.
        #[arg(long)]
        cpk_list: Option<PathBuf>,
        /// Cible Switch (`romfs/data/…`) au lieu de PC (`data/…`).
        #[arg(long)]
        switch: bool,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// Fusionne plusieurs mods, en **priorité décroissante** — le premier dossier l'emporte.
    ///
    /// Par défaut la fusion est **au champ** sur les `.cfg.bin` : deux mods qui éditent des
    /// champs différents d'un même fichier survivent tous les deux. C'est ce que les toolkits
    /// amont ne savent pas faire, faute de comprendre les formats.
    Merge {
        /// Dossiers de mods, du plus prioritaire au moins prioritaire.
        #[arg(required = true, num_args = 1..)]
        sources: Vec<PathBuf>,
        /// Dossier de sortie.
        #[arg(long, short = 'o')]
        out: PathBuf,
        /// Fusion au fichier (comportement amont) : plus de fusion au champ.
        #[arg(long)]
        fichier: bool,
        #[arg(long)]
        game_dir: Option<PathBuf>,
    },
    /// (Dé)chiffre un fichier Criware. L'opération est **involutive** : un seul sens suffit.
    Crypto {
        /// Fichier source.
        src: PathBuf,
        /// Fichier destination.
        #[arg(long, short = 'o')]
        out: PathBuf,
        /// Clé en hexadécimal (`1717E18E`). Défaut : la clé fixe Viola.
        #[arg(long, conflicts_with = "du_nom")]
        cle: Option<String>,
        /// Dérive la clé du nom de fichier (CRC32), comme pour les paquets CPK.
        #[arg(long)]
        du_nom: bool,
    },
}

#[derive(Subcommand)]
enum SaveOp {
    /// Déchiffre et affiche un résumé terse d'un fichier de sauvegarde Lives.
    Read {
        /// Chemin vers le fichier de sauvegarde (ex. `002AB8F4-SYSTEMLIVE`).
        #[arg(long)]
        file: std::path::PathBuf,
        /// Affiche aussi les N premiers octets du corps de chaque blob.
        #[arg(long, default_value_t = 0)]
        hexdump: usize,
    },
    /// Déchiffre un fichier de sauvegarde et écrit le plaintext.
    Decrypt {
        /// Chemin vers le fichier de sauvegarde chiffré.
        #[arg(long)]
        file: std::path::PathBuf,
        /// Chemin de sortie pour le plaintext.
        #[arg(long)]
        out: std::path::PathBuf,
    },
    /// Chiffre un fichier plaintext (issu de `decrypt`) et produit le fichier sauvegarde.
    Encrypt {
        /// Chemin vers le plaintext.
        #[arg(long)]
        file: std::path::PathBuf,
        /// Nom de slot (ex. `002AB8F4-SYSTEMLIVE`) pour dériver la clé.
        #[arg(long)]
        slot: String,
        /// Chemin de sortie pour le fichier chiffré.
        #[arg(long)]
        out: std::path::PathBuf,
    },
    /// Édite un byte dans le corps d'un blob et rechiffre.
    Edit {
        /// Chemin vers le fichier de sauvegarde.
        #[arg(long)]
        file: std::path::PathBuf,
        /// Nom interne du blob (ex. `SYSTEM_data.bin`).
        #[arg(long)]
        blob: String,
        /// Offset dans le corps du blob (décimal ou `0x…`).
        #[arg(long, value_parser = parse_addr)]
        offset: i64,
        /// Nouvelle valeur du byte (décimal ou `0x…`).
        #[arg(long, value_parser = parse_addr)]
        value: i64,
        /// Fichier de sortie (défaut : écrase l'entrée).
        #[arg(long)]
        out: Option<std::path::PathBuf>,
    },
}

#[derive(Subcommand)]
enum QueueOp {
    /// Empile une adresse (décimale ou hex `0x...`).
    Push {
        #[arg(value_parser = parse_addr)]
        addr: i64,
    },
    /// Dépile la prochaine adresse.
    Pop,
    /// Taille de la frontière.
    Len,
    /// Vide la frontière.
    Reset,
}

#[derive(Subcommand)]
enum WikiOp {
    /// Profil complet d'un personnage (stats, techniques, auras).
    Chara {
        /// Nom, ID ou code interne du personnage (ex: "Mark", "0x99A1C150", "c01000010").
        query: String,
        /// Sortie JSON machine.
        #[arg(long, short = 'j')]
        json: bool,
        /// Chemin vers le miroir SQLite (override NIE_WIKI_DB / SQLITE_DB_PATH).
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Profil d'une technique / skill.
    Skill {
        /// Nom, ID ou code interne de la technique (ex: "Tempête du désert", "whd00580").
        query: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Profil d'un item / objet.
    Item {
        /// Nom, ID ou code interne de l'objet.
        query: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Profil d'une équipe.
    Team {
        /// Nom, ID ou code interne de l'équipe (ex: "Raimon", "0xF01BB293").
        query: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Compare deux personnages côte à côte (stats interpolées, moveset, diff).
    Compare {
        /// Premier personnage (nom / ID / code interne).
        chara1: String,
        /// Deuxième personnage.
        chara2: String,
        /// Niveau pour l'interpolation de stats (1–99).
        #[arg(long, short = 'l', default_value = "99")]
        level: u8,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Recherche multi-tables (characters / skills / items / teams / auras / keshins / souls).
    Search {
        /// Terme de recherche.
        query: String,
        /// Nombre maximum de résultats (défaut 20).
        #[arg(long, short = 'n', default_value = "20")]
        limit: usize,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Exécute une requête SQL read-only sur le miroir et affiche le résultat.
    ///
    /// Seuls SELECT, PRAGMA, EXPLAIN et WITH … SELECT sont autorisés.
    Db {
        /// Requête SQL (ex: "SELECT COUNT(*) FROM inagle_characters").
        sql: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Génère une équipe aléatoire depuis le miroir.
    ///
    /// Requiert un seed explicite — le RNG non seédé est interdit dans niers.
    RandomTeam {
        /// Seed entier pour le PRNG (déterministe).
        #[arg(long, short = 's')]
        seed: u64,
        /// Formation (ex: 4-4-2, 4-3-3, 3-5-2). Défaut: 4-4-2.
        #[arg(long, short = 'f', default_value = "4-4-2")]
        formation: String,
        /// Filtre élément (Feu/Vent/Forêt/Montagne/Néant). Optionnel.
        #[arg(long, short = 'e')]
        element: Option<String>,
        /// Filtre style de jeu. Optionnel.
        #[arg(long, short = 'p')]
        playstyle: Option<String>,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Gère les compositions d'équipes depuis le miroir (actions: list / show / calc).
    ///
    /// Note : list/add/delete dans PostgreSQL (user_teams) nécessitent DATABASE_URL.
    /// La partie miroir SQLite (inagle_team_build) est accessible sans réseau.
    TeamBuilder {
        /// Action : list | show <id> | calc <id>.
        action: String,
        /// Arguments de l'action (ex: ID pour show/calc).
        #[arg(trailing_var_arg = true)]
        args: Vec<String>,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Diagnostic du miroir SQLite + ping Redis db0/db3.
    Status {
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Commande Redis simple (get / set / del) sur db0 par défaut.
    Redis {
        /// Commande : get | set | del.
        cmd: String,
        /// Clé Redis.
        key: String,
        /// Valeur (requis pour set).
        val: Option<String>,
        /// URL Redis complète (ex: redis://127.0.0.1/3 pour db3).
        #[arg(long, default_value = "redis://127.0.0.1/0")]
        redis_url: String,
        #[arg(long, short = 'j')]
        json: bool,
    },
    /// Audite la cohérence du miroir (counts, nulls sur tables clés).
    Audit {
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Recherche dans les sous-titres / dialogues de `inagle_event_subtitles`.
    Dialogue {
        /// Texte à rechercher (FR / EN / JA).
        query: String,
        /// Nombre de résultats max (défaut 10).
        #[arg(long, short = 'n', default_value = "10")]
        limit: usize,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
}

fn wiki_cmd(op: WikiOp) -> anyhow::Result<()> {
    use nie_wiki::{mirror, query, render};

    match op {
        // ─── Commandes existantes ────────────────────────────────────────────
        WikiOp::Chara { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let matches = query::search_characters(&conn, &q)?;

            if matches.is_empty() {
                if json {
                    println!("[]");
                } else {
                    println!("Aucun personnage trouve pour : \"{}\"", q);
                }
                return Ok(());
            }

            if matches.len() > 1 && !json {
                // Vérifier si c'est une correspondance exacte sur un seul personnage logique
                let first_chara_id = &matches[0].chara_id;
                let all_same = matches.iter().all(|m| &m.chara_id == first_chara_id);
                if !all_same {
                    println!("Plusieurs personnages correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {} | Code: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                            m.internal_code.as_deref().unwrap_or("N/A"),
                        );
                    }
                    return Ok(());
                }
            }

            // Charger le profil complet du premier match
            let target_id = &matches[0].id;
            let profile = query::get_character(&conn, target_id)?
                .ok_or_else(|| anyhow::anyhow!("profil introuvable pour {}", target_id))?;

            if json {
                println!("{}", serde_json::to_string_pretty(&profile)?);
            } else {
                println!("{}", render::render_chara_profile(&profile, &conn));
            }
        }

        WikiOp::Skill { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;

            // Essai par ID exact d'abord
            let mut skill = query::get_skill(&conn, &q)?;

            if skill.is_none() {
                let matches = query::search_skills(&conn, &q)?;
                if matches.is_empty() {
                    if json {
                        println!("[]");
                    } else {
                        println!("Aucune technique trouvee pour : \"{}\"", q);
                    }
                    return Ok(());
                }
                if matches.len() > 1 && !json {
                    println!("Plusieurs techniques correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                        );
                    }
                    return Ok(());
                }
                skill = matches.into_iter().next();
            }

            let sk = skill.ok_or_else(|| anyhow::anyhow!("skill introuvable"))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&sk)?);
            } else {
                println!("{}", render::render_skill_profile(&sk));
            }
        }

        WikiOp::Item { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;

            let mut item = query::get_item(&conn, &q)?;

            if item.is_none() {
                let matches = query::search_items(&conn, &q)?;
                if matches.is_empty() {
                    if json {
                        println!("[]");
                    } else {
                        println!("Aucun item trouve pour : \"{}\"", q);
                    }
                    return Ok(());
                }
                if matches.len() > 1 && !json {
                    println!("Plusieurs items correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                        );
                    }
                    return Ok(());
                }
                item = matches.into_iter().next();
            }

            let it = item.ok_or_else(|| anyhow::anyhow!("item introuvable"))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&it)?);
            } else {
                println!("{}", render::render_item_profile(&it));
            }
        }

        WikiOp::Team { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;

            let mut team = query::get_team(&conn, &q)?;

            if team.is_none() {
                let matches = query::search_teams(&conn, &q)?;
                if matches.is_empty() {
                    if json {
                        println!("[]");
                    } else {
                        println!("Aucune equipe trouvee pour : \"{}\"", q);
                    }
                    return Ok(());
                }
                if matches.len() > 1 && !json {
                    println!("Plusieurs equipes correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                        );
                    }
                    return Ok(());
                }
                team = matches.into_iter().next();
            }

            let t = team.ok_or_else(|| anyhow::anyhow!("equipe introuvable"))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&t)?);
            } else {
                println!("{}", render::render_team_profile(&t));
            }
        }

        // ─── Nouvelles commandes ─────────────────────────────────────────────

        WikiOp::Compare { chara1, chara2, level, json, db } => {
            anyhow::ensure!(
                (1..=99).contains(&level),
                "le niveau doit être compris entre 1 et 99 (reçu: {})",
                level
            );
            let conn = mirror::open(db.as_deref())?;
            let result = query::compare_characters(&conn, &chara1, &chara2, level)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("{}", render::render_compare(&result));
            }
        }

        WikiOp::Search { query: q, limit, json, db } => {
            if q.trim().is_empty() {
                anyhow::bail!("terme de recherche vide");
            }
            let conn = mirror::open(db.as_deref())?;
            let results = query::search_all(&conn, &q, limit)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&results)?);
            } else {
                println!("{}", render::render_search_results(&results));
            }
        }

        WikiOp::Db { sql, json, db } => {
            if sql.trim().is_empty() {
                anyhow::bail!("requête SQL vide");
            }
            let conn = mirror::open(db.as_deref())?;
            let rows = query::exec_readonly_sql(&conn, &sql)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else {
                println!("Resultats ({} lignes) :", rows.len());
                println!("{}", render::render_ascii_table(&rows));
            }
        }

        WikiOp::RandomTeam { seed, formation, element, playstyle, json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let team = query::random_team(
                &conn,
                &formation,
                element.as_deref(),
                playstyle.as_deref(),
                seed,
            )?;
            if json {
                println!("{}", serde_json::to_string_pretty(&team)?);
            } else {
                println!("{}", render::render_random_team(&team));
            }
        }

        WikiOp::TeamBuilder { action, args, json, db } => {
            let conn = mirror::open(db.as_deref())?;
            match action.as_str() {
                "list" => {
                    let entries = query::team_build_list(&conn)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&entries)?);
                    } else {
                        println!("{}", render::render_team_build_list(&entries));
                    }
                }
                "show" | "calc" => {
                    let id = args.first().ok_or_else(|| {
                        anyhow::anyhow!("Usage: niers wiki team-builder {} <id>", action)
                    })?;
                    let entry = query::team_build_calc(&conn, id)?;
                    match entry {
                        None => {
                            if json {
                                println!("null");
                            } else {
                                println!("Aucune entree trouvee pour : \"{}\"", id);
                            }
                        }
                        Some(e) => {
                            if json {
                                println!("{}", serde_json::to_string_pretty(&e)?);
                            } else {
                                println!("{}", render::render_team_build_entry(&e));
                            }
                        }
                    }
                }
                other => {
                    anyhow::bail!(
                        "action inconnue : '{}'. Actions supportées depuis le miroir : list / show <id> / calc <id>.\n\
                         Note : add/delete/save opèrent sur PostgreSQL (user_teams) et ne sont pas portés ici.",
                        other
                    );
                }
            }
        }

        WikiOp::Status { json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let report = query::status_report(&conn)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!("{}", render::render_status(&report));
            }
        }

        WikiOp::Redis { cmd, key, val, redis_url, json } => {
            let result = query::redis_cmd(&redis_url, &cmd, &key, val.as_deref())?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "cmd": cmd,
                        "key": key,
                        "value": result,
                    }))?
                );
            } else {
                match &result {
                    None => println!("(nil)"),
                    Some(v) => println!("{}", v),
                }
            }
        }

        WikiOp::Audit { json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let report = query::audit_mirror(&conn)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!("{}", render::render_audit(&report));
            }
        }

        WikiOp::Dialogue { query: q, limit, json, db } => {
            if q.trim().is_empty() {
                anyhow::bail!("terme de recherche vide");
            }
            let conn = mirror::open(db.as_deref())?;
            let matches = query::search_dialogues(&conn, &q, limit)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&matches)?);
            } else {
                println!("{}", render::render_dialogues(&matches, &q));
            }
        }
    }

    Ok(())
}

/// Racine du jeu : celle passée en argument, sinon celle que le contexte désigne.
///
/// Aucun chemin de poste n'est codé en dur — `resolve_game_dir` regarde `NIE_GAME_DIR`, puis le
/// répertoire courant et ses ancêtres portant `data/cpk_list.cfg.bin`, puis le répertoire de
/// l'exécutable. Sur une installation Steam, la racine du jeu est le répertoire courant.
fn racine_jeu(arg: Option<PathBuf>) -> PathBuf {
    arg.unwrap_or_else(nie_formats::vfs::resolve_game_dir)
}

fn main() -> anyhow::Result<()> {
    // CLI interne (consommé par l'agent) : sortie minimale. `RUST_LOG=info` réactive les traces.
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive(tracing::Level::WARN.into()))
        .init();
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Cpp { args } => delegate::cpp(&args),
        Cmd::Cs { args } => delegate::cs(&args),
        Cmd::Viola { op } => viola_cmd(op),
        Cmd::Backends => {
            // Le nombre de commandes vient de clap : il suit le binaire, pas une note qui derive.
            let n = <Cli as clap::CommandFactory>::command().get_subcommands().count();
            delegate::status(n);
            Ok(())
        }
        Cmd::Format { src } => decode_cmd::format(&src),
        Cmd::Decode { src, out, quiet } => {
            if src.is_dir() {
                let out = out.unwrap_or_else(|| src.join("_decoded"));
                decode_cmd::dir(&src, &out, quiet)
            } else {
                decode_cmd::file(&src, out.as_deref(), quiet)
            }
        }
        Cmd::Convert { src, to, out, game_dir, reference, masque } => {
            convert_cmd(&src, &to, out.as_deref(), game_dir, reference.as_deref(), masque)
        }
        Cmd::Lua { src, functions, calls, strings, crc32, limit } => {
            lua_cmd::run(&src, lua_cmd::Detail { functions, calls, strings, crc32, limit })
        }
        Cmd::Seed { db, json, exe } => seed(&db, &json, exe.as_deref()),
        Cmd::Coverage { db } => coverage(&db),
        Cmd::Queue { op, redis, tag } => queue(op, &redis, &tag),
        Cmd::Propagate { db, rounds } => propagate(&db, rounds),
        Cmd::Rtti { db, exe } => rtti(&db, &exe),
        Cmd::Index { db, exe } => index(&db, &exe),
        Cmd::Disasm { db, exe } => disasm(&db, &exe),
        Cmd::Pdata { db, exe } => pdata(&db, &exe),
        Cmd::Rebuild { db, exe, rounds } => rebuild(&db, &exe, rounds),
        Cmd::Save { op } => save_cmd(op),
        Cmd::Wiki { op } => wiki_cmd(op),
        Cmd::UniformMap { game_dir, out } => uniform_map(&racine_jeu(game_dir), &out),
        Cmd::Textures { game_dir, limit, manifest, redis: use_redis, redis_url } => {
            textures(&racine_jeu(game_dir), limit, &manifest, use_redis, &redis_url)
        }
        Cmd::Mem { op } => mem_cmd(op),
        Cmd::MenuPredecode { game_dir, layouts_dir, redis_url, all } => {
            menu_predecode_cmd(&racine_jeu(game_dir), &layouts_dir, &redis_url, all)
        }
        Cmd::Vfs { op } => vfs_cmd(op),
    }
}

// ─── niers mem — RE en direct via nie-trace (process_vm_readv) ─────────────────────

fn mem_cmd(op: MemOp) -> anyhow::Result<()> {
    match op {
        MemOp::Maps { pid, module, all } => mem_maps(pid, &module, all),
        MemOp::Base { pid, module } => mem_base(pid, &module),
        MemOp::Read { addr, len, pid, output } => mem_read(&addr, len, pid, output.as_deref()),
        MemOp::Dump { pid, module, all, output } => mem_dump(pid, &module, all, &output),
        MemOp::Scan { pattern, pid, module, all, limit } => {
            mem_scan(&pattern, pid, &module, all, limit)
        }
        MemOp::PatchEac { src, dst } => mem_patch_eac(&src, &dst),
    }
}

/// Résout/valide le pid (auto-détecte nie.exe si 0) + avertit sur ptrace_scope. Linux-only.
fn mem_preflight(pid: i32) -> anyhow::Result<i32> {
    if !cfg!(target_os = "linux") {
        anyhow::bail!("`niers mem` est Linux-only (process_vm_readv).");
    }
    let pid = if pid <= 0 {
        let p = nie_trace::find_pid_by_name("nie.exe")
            .context("nie.exe introuvable — lance le jeu, ou précise --pid")?;
        eprintln!("# nie.exe → pid {p}");
        p
    } else {
        pid
    };
    // Vérification d'existence du process : `/proc/<pid>` n'existe que sous Linux. Ailleurs, on
    // laisse `nie-trace` trancher — son backend Windows (`OpenProcess`/`VirtualQueryEx`) rend une
    // erreur parlante si le pid est mort ou inaccessible.
    #[cfg(target_os = "linux")]
    if !std::path::Path::new(&format!("/proc/{pid}")).exists() {
        anyhow::bail!("pid {pid} inexistant.");
    }
    #[cfg(windows)]
    if nie_trace::enumerate_regions(pid).is_empty() {
        anyhow::bail!(
            "pid {pid} inaccessible : process inexistant, ou droits insuffisants \
             (lancer le terminal en administrateur pour lire un jeu élevé)."
        );
    }
    #[cfg(target_os = "linux")]
    if !nie_trace::likely_permitted(pid) {
        let scope = nie_trace::read_ptrace_scope();
        eprintln!(
            "# Attention: ptrace_scope={scope} et le lecteur n'est pas ancêtre de {pid}. \
             Lecture probablement refusée (EPERM). Remède: \
             `echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope`."
        );
    }
    Ok(pid)
}

fn mem_maps(pid: i32, module: &str, all: bool) -> anyhow::Result<()> {
    let pid = mem_preflight(pid)?;
    let maps = nie_trace::module_regions(pid, module, all);
    let mut total: u64 = 0;
    for m in &maps {
        total += m.size();
        println!("  0x{:012x}-0x{:012x}  {}  {:>12}  {}", m.start, m.end, m.perms, m.size(), m.path);
    }
    let suffix = if all { String::new() } else { format!(" (module « {module} »)") };
    println!("\n  {} plage(s), {total} octets{suffix}", maps.len());
    Ok(())
}

fn mem_base(pid: i32, module: &str) -> anyhow::Result<()> {
    let pid = mem_preflight(pid)?;
    match nie_trace::find_module_base(pid, module) {
        Some(base) => println!("  {module} @ 0x{base:x} (pid {pid})"),
        None => anyhow::bail!("Module « {module} » introuvable dans les plages du pid {pid}"),
    }
    Ok(())
}

fn mem_read(addr: &str, len: usize, pid: i32, output: Option<&std::path::Path>) -> anyhow::Result<()> {
    let pid = mem_preflight(pid)?;
    let address = mem_resolve_addr(addr, pid)?;
    let mut buf = vec![0u8; len];
    let got = nie_trace::read(pid, address, &mut buf).context("process_vm_readv")?;
    if got == 0 {
        anyhow::bail!("0 octet lu (plage non mappée ?)");
    }
    match output {
        Some(p) => {
            std::fs::write(p, &buf[..got])?;
            println!("  {got} octets @ 0x{address:x} → {}", p.display());
        }
        None => mem_hexdump(&buf[..got], address),
    }
    Ok(())
}

fn mem_dump(pid: i32, module: &str, all: bool, output: &std::path::Path) -> anyhow::Result<()> {
    let pid = mem_preflight(pid)?;
    let maps = nie_trace::module_regions(pid, module, all);
    let stats = nie_trace::dump_regions(pid, &maps, output)?;
    println!(
        "  {} plage(s) dumpée(s), {} octets → {}",
        stats.regions,
        stats.bytes,
        output.canonicalize().unwrap_or_else(|_| output.to_path_buf()).display()
    );
    Ok(())
}

fn mem_scan(pattern: &str, pid: i32, module: &str, all: bool, limit: usize) -> anyhow::Result<()> {
    let pid = mem_preflight(pid)?;
    let (needle, label) = mem_parse_pattern(pattern)?;
    let maps = nie_trace::module_regions(pid, module, all);
    let base = nie_trace::find_module_base(pid, module);
    let hits = nie_trace::scan_regions(pid, &maps, base, &needle, limit);
    for h in &hits {
        let rva = match h.rva {
            Some(r) => format!(" ({module}+0x{r:x})"),
            None => String::new(),
        };
        println!("  0x{:012x}{rva}  [{}]", h.addr, h.perms);
    }
    let capped = if hits.len() >= limit { format!(" (limité à {limit})") } else { String::new() };
    println!("\n  {} hit(s) pour {label}{capped}", hits.len());
    Ok(())
}

fn mem_patch_eac(src: &std::path::Path, dst: &std::path::Path) -> anyhow::Result<()> {
    let report = nie_trace::patch_eac(src, dst).context("patch EAC")?;
    println!(
        "  OK  offset 0x{:X}: {} -> {}  ({} octets)  {}",
        report.offset,
        report.original.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        report.patched.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        report.dst_len,
        dst.display()
    );
    Ok(())
}

/// Parse `0x…` (absolu) ou `module+0xRVA` (résolu via la base du module).
fn mem_resolve_addr(addr: &str, pid: i32) -> anyhow::Result<u64> {
    let s = addr.trim();
    if let Some(plus) = s.find('+') {
        let module = &s[..plus];
        let rva = parse_u64_hex(&s[plus + 1..]).with_context(|| format!("RVA invalide: {}", &s[plus + 1..]))?;
        let base = nie_trace::find_module_base(pid, module)
            .with_context(|| format!("Module « {module} » introuvable"))?;
        return Ok(base + rva);
    }
    parse_u64_hex(s).with_context(|| format!("Adresse invalide: {s}"))
}

fn parse_u64_hex(s: &str) -> anyhow::Result<u64> {
    let s = s.trim();
    let s = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s);
    Ok(u64::from_str_radix(s, 16)?)
}

/// Parse un motif : `wstr:texte` (UTF-16LE), `str:texte` (UTF-8), ou octets hex `48 8B 0D`.
fn mem_parse_pattern(pattern: &str) -> anyhow::Result<(Vec<u8>, String)> {
    if let Some(text) = pattern.strip_prefix("wstr:") {
        let needle: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        anyhow::ensure!(!needle.is_empty(), "Motif wstr: vide");
        return Ok((needle, format!("wstr \"{text}\"")));
    }
    if let Some(text) = pattern.strip_prefix("str:") {
        anyhow::ensure!(!text.is_empty(), "Motif str: vide");
        return Ok((text.as_bytes().to_vec(), format!("\"{text}\"")));
    }
    let hex: String = pattern.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    anyhow::ensure!(!hex.is_empty() && hex.len().is_multiple_of(2), "Motif hex de longueur impaire/vide");
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for i in (0..hex.len()).step_by(2) {
        bytes.push(u8::from_str_radix(&hex[i..i + 2], 16).with_context(|| format!("Octet hex invalide à {i}"))?);
    }
    let label = format!("hex {}", bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join("-"));
    Ok((bytes, label))
}

fn mem_hexdump(data: &[u8], base: u64) {
    for (i, line) in data.chunks(16).enumerate() {
        let off = base + (i * 16) as u64;
        let mut hex = String::new();
        for j in 0..16 {
            if j < line.len() {
                hex.push_str(&format!("{:02x} ", line[j]));
            } else {
                hex.push_str("   ");
            }
        }
        let ascii: String = line.iter().map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' }).collect();
        println!("  0x{off:012x}  {hex} {ascii}");
    }
}

fn seed(db_path: &std::path::Path, json: &std::path::Path, exe: Option<&std::path::Path>) -> anyhow::Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;

    let (sha, size, path_str) = match exe {
        Some(p) => {
            let bytes = std::fs::read(p).with_context(|| format!("lecture {}", p.display()))?;
            let mut h = Sha256::new();
            h.update(&bytes);
            (hex::encode(h.finalize()), bytes.len() as i64, p.display().to_string())
        }
        None => ("unknown-nie-index".to_string(), 0, "nie.exe".to_string()),
    };
    let bin = db.upsert_binary(&path_str, &sha, "x86_64", 64, NIE_IMAGE_BASE, size, None, None)?;

    let stats = nie_seed::nie_index_json::ingest_file(&mut db, bin, json)?;
    let cov = db.snapshot_coverage(bin)?;
    println!(
        "seed fn={} call={} str={} const={} glob={} anchor={} cov={}/{} ({:.2}%)",
        stats.functions, stats.xrefs, stats.str_refs, stats.consts, stats.globals, stats.anchors,
        cov.classified, cov.total, cov.pct
    );
    Ok(())
}

fn coverage(db_path: &std::path::Path) -> anyhow::Result<()> {
    let db = nie_index::Db::open(db_path)?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;
    let cov = nie_index::query::coverage(db.conn(), bin)?;
    let by_sub = nie_index::query::by_subsystem(db.conn(), bin)?;
    let subs = by_sub.iter().map(|(ns, n)| format!("{ns}={n}")).collect::<Vec<_>>().join(" ");
    println!("cov {}/{} ({:.2}%) named={} | {}", cov.classified, cov.total, cov.pct, cov.named, subs);
    Ok(())
}

fn queue(op: QueueOp, redis: &str, tag: &str) -> anyhow::Result<()> {
    let mut f = nie_queue::Frontier::connect(redis, tag)?;
    match op {
        QueueOp::Push { addr } => {
            let added = f.push(addr)?;
            println!("{}", if added { "ajoutée" } else { "déjà vue" });
        }
        QueueOp::Pop => match f.pop()? {
            Some(a) => println!("0x{a:x}"),
            None => println!("(frontière vide)"),
        },
        QueueOp::Len => println!("frontière: {} | vues: {}", f.len()?, f.seen_count()?),
        QueueOp::Reset => {
            f.reset()?;
            println!("frontière réinitialisée");
        }
    }
    Ok(())
}

fn propagate(db_path: &std::path::Path, rounds: usize) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::loop_db::propagate_db(&mut db, bin, rounds)
        .context("propagation")?;

    println!(
        "propagate rounds={} anchors(str/rtti/const)={}/{}/{} cov {:.2}%->{:.2}% (+{} fn)",
        stats.rounds, stats.anchored_str, stats.anchored_rtti, stats.anchored_const,
        stats.coverage_before, stats.coverage_after, stats.classified_after - stats.classified_before
    );
    Ok(())
}

fn rtti(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let bytes = std::fs::read(exe_path)
        .with_context(|| format!("lecture {}", exe_path.display()))?;

    let stats = nie_re::rtti::parse_and_ingest(&mut db, bin, &bytes)
        .context("parsing RTTI")?;

    println!(
        "rtti col={} td={} classes={} bases={}",
        stats.candidates, stats.valid_type_descs, stats.classes_ingested, stats.bases_ingested
    );
    Ok(())
}

fn index(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::indexer::triage_into(&mut db, bin, exe_path)
        .context("indexation PE")?;

    println!(
        "index fmt={} sections={} imports={} exports={}",
        stats.format, stats.sections, stats.imports, stats.exports
    );
    Ok(())
}

fn disasm(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    // A/B : NIE_NO_INDIRECT=1 détecte les LEA (stats) mais ne les insère pas.
    let skip_lea = std::env::var("NIE_NO_INDIRECT").is_ok();
    let stats = nie_re::disasm::recover_call_edges(&mut db, bin, exe_path, skip_lea)
        .context("désassemblage des arêtes d'appel")?;

    println!(
        "disasm insn={} call={} jmp={} thunk={} miss={} cand={} new={} | lea_insn={} lea_cand={} lea_new={}",
        stats.instructions_decoded, stats.call_near, stats.jmp_near, stats.thunk_resolved,
        stats.near_target_miss, stats.edges_candidates, stats.edges_new,
        stats.lea_insns, stats.lea_candidates, stats.lea_edges_new
    );
    Ok(())
}

fn pdata(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::pdata::discover_into(&mut db, bin, exe_path)
        .context("découverte .pdata")?;

    let pct_aligned = if stats.ghidra_total > 0 {
        100.0 * stats.overlap_ghidra as f64 / stats.ghidra_total as f64
    } else {
        0.0
    };
    println!(
        "pdata entries={} chained={} roots={} inserted={} | ghidra {}/{} aligned ({:.1}%) inside_body={}",
        stats.entries, stats.chained_fragments, stats.roots, stats.inserted,
        stats.overlap_ghidra, stats.ghidra_total, pct_aligned, stats.ghidra_inside_body
    );
    Ok(())
}

fn rebuild(db_path: &std::path::Path, exe_path: &std::path::Path, rounds: usize) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let src_bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    // Binaire cible distinct (vérité .pdata) : sha dérivé pour ne pas écraser la source.
    let (path_str, src_sha): (String, String) = db.conn().query_row(
        "SELECT path, sha256 FROM binary WHERE id=?1",
        [src_bin],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let dst_bin = db.upsert_binary(
        &format!("{path_str}#pdata"),
        &format!("{src_sha}-pdata"),
        "x86_64",
        64,
        NIE_IMAGE_BASE,
        0,
        None,
        None,
    )?;

    // A/B leviers indirects : NIE_NO_INDIRECT=1 saute l'ancrage de classe (vtable)
    // ET l'insertion des arêtes LEA → mesure du delta de couverture réel.
    let skip_indirect = std::env::var("NIE_NO_INDIRECT").is_ok();

    let rb = nie_re::pdata::rebuild_from_pdata(&mut db, src_bin, dst_bin, exe_path)?;
    let vt = nie_re::vtable::vtable_edges_into(&mut db, src_bin, dst_bin, exe_path, skip_indirect)?;
    let dis = nie_re::disasm::recover_call_edges(&mut db, dst_bin, exe_path, skip_indirect)?;
    let prop = nie_re::loop_db::propagate_db(&mut db, dst_bin, rounds)?;

    // Couverture HONNÊTE à deux seuils : classé brut (≥1 voisin labellisé, même
    // confiance quasi-nulle) ET confiance ≥ 0.3 (label sémantiquement utile).
    let classified_conf: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM function WHERE binary_id=?1 AND subsystem!='standalone' AND confidence>=0.3",
        [dst_bin],
        |r| r.get(0),
    )?;
    let pct_conf = if prop.total > 0 {
        100.0 * classified_conf as f64 / prop.total as f64
    } else {
        0.0
    };

    // Noms réels écrits : fonctions ayant un `name` non nul dans dst_bin.
    // Inclut les noms 'vtable-struct' générés à cette exécution ainsi que
    // tout nom antérieur (name_source != NULL).  N'exclut pas de préfixe
    // car les noms structurels ne commencent pas par 'FUN_'.
    let named_total: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM function WHERE binary_id=?1 AND name IS NOT NULL",
        [dst_bin],
        |r| r.get(0),
    )?;
    let pct_named = if prop.total > 0 {
        100.0 * named_total as f64 / prop.total as f64
    } else {
        0.0
    };

    println!(
        "rebuild roots={} str={} ce={} rtti={} | vtable methods={} leaf+={} cohesion={} anchored={} named_struct={} | disasm new={} lea_new={} | named={}/{} ({:.2}%) | cov_brut={}/{} ({:.2}%) cov_conf>=0.3={}/{} ({:.2}%)",
        rb.roots, rb.str_refs_moved, rb.ce_edges_mapped, rb.rtti_copied,
        vt.methods, vt.new_leaf_funcs, vt.cohesion_edges, vt.class_anchored, vt.named_struct,
        dis.edges_new, dis.lea_edges_new,
        named_total, prop.total, pct_named,
        prop.classified_after, prop.total, prop.coverage_after,
        classified_conf, prop.total, pct_conf
    );
    Ok(())
}

/// Entrée du manifeste NDJSON pour une texture G4TX.
#[derive(serde::Serialize)]
struct TexEntry<'a> {
    path: &'a str,
    cpk: &'a str,
    width: i32,
    height: i32,
    format: &'static str,
    mips: u8,
}

fn textures(
    game_dir: &std::path::Path,
    limit: usize,
    manifest_path: &std::path::Path,
    use_redis: bool,
    redis_url: &str,
) -> anyhow::Result<()> {
    use nie_formats::vfs::Vfs;
    use nie_formats::g4tx;

    let data_dir = game_dir.join("data");

    // Initialiser le VFS depuis cpk_list.cfg.bin
    let mut vfs = Vfs::new();
    vfs.init(&data_dir).context("init VFS depuis cpk_list.cfg.bin")?;

    // Collecter tous les chemins .g4tx indexés
    let all_g4tx: Vec<(String, String)> = {
        // Accès à l'index interne via itération : on utilise find() sur les clés connues,
        // mais l'API publique n'expose pas d'itérateur. On reconstruit la liste via
        // la méthode asset_count() pour vérifier, puis on scanne via une méthode d'itération
        // publique si disponible.
        // Comme l'API Vfs n'expose pas d'itérateur direct, on charge le cfg.bin nous-mêmes
        // pour collecter les chemins .g4tx.
        collect_g4tx_paths(&data_dir)?
    };

    let total_found = all_g4tx.len();
    let to_process = all_g4tx.len().min(limit);
    let dropped = total_found.saturating_sub(limit);

    tracing::info!(total_found, to_process, dropped, "fichiers .g4tx découverts");

    // Préparer le fichier manifeste
    if let Some(parent) = manifest_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut manifest_file = std::fs::File::create(manifest_path)
        .with_context(|| format!("création manifeste {}", manifest_path.display()))?;

    // Connexion Redis optionnelle
    let mut redis_conn: Option<redis::Connection> = if use_redis {
        match redis::Client::open(redis_url).and_then(|c| c.get_connection()) {
            Ok(conn) => {
                tracing::info!("Redis connecté : {redis_url}");
                Some(conn)
            }
            Err(e) => {
                tracing::warn!("Redis indisponible ({e}) — poursuite sans Redis");
                None
            }
        }
    } else {
        None
    };

    let mut parsed = 0usize;
    let mut failed = 0usize;

    for (internal_path, cpk_name) in all_g4tx.iter().take(limit) {
        let raw = match vfs.read(internal_path) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("échec extraction {internal_path}: {e}");
                failed += 1;
                continue;
            }
        };

        let g = match g4tx::parse(&raw) {
            Ok(g) => g,
            Err(e) => {
                tracing::warn!("échec parse g4tx {internal_path}: {e}");
                failed += 1;
                continue;
            }
        };

        // Pour chaque texture dans le conteneur g4tx
        for tex in &g.textures {
            // Format : on déduit depuis is_dds ; mips : approximation depuis les dimensions
            // (le champ mips n'est pas dans le header G4TX public — on expose 0 comme sentinelle)
            let format_str: &'static str = if tex.is_dds { "DDS" } else { "NXTCH" };
            let mips: u8 = 0; // G4txHeader n'expose pas de champ mips explicite

            let entry = TexEntry {
                path: internal_path.as_str(),
                cpk: cpk_name.as_str(),
                width: tex.width,
                height: tex.height,
                format: format_str,
                mips,
            };

            let line = serde_json::to_string(&entry).context("sérialisation JSON")?;
            writeln!(manifest_file, "{line}").context("écriture manifeste")?;

            // Pousser dans Redis si activé
            if let Some(ref mut conn) = redis_conn {
                use redis::Commands;
                let redis_path_key = format!("iev:tex:{internal_path}");
                if let Err(e) = conn.sadd::<_, _, i64>("iev:tex:index", internal_path.as_str()) {
                    tracing::warn!("redis SADD échec: {e}");
                }
                if let Err(e) = conn.hset_multiple::<_, _, _, ()>(&redis_path_key, &[
                    ("width", tex.width.to_string()),
                    ("height", tex.height.to_string()),
                    ("format", format_str.to_string()),
                    ("mips", mips.to_string()),
                    ("cpk", cpk_name.clone()),
                ]) {
                    tracing::warn!("redis HSET échec: {e}");
                }
            }
        }

        parsed += 1;
    }

    // Écrire meta Redis
    if let Some(ref mut conn) = redis_conn {
        use redis::Commands;
        if let Err(e) = conn.hset_multiple::<_, _, _, ()>("iev:tex:meta", &[
            ("parsed", parsed.to_string()),
            ("failed", failed.to_string()),
            ("total_found", total_found.to_string()),
            ("limit", limit.to_string()),
            ("dropped", dropped.to_string()),
        ]) {
            tracing::warn!("redis meta HSET échec: {e}");
        }
    }

    // Comptage Redis pour sortie terse
    let redis_count: usize = if let Some(ref mut conn) = redis_conn {
        use redis::Commands;
        conn.scard::<_, usize>("iev:tex:index").unwrap_or(0)
    } else {
        0
    };

    // Sortie terse (convention niers : 1 ligne clé=val)
    if dropped > 0 {
        println!(
            "tex.parsed={parsed} tex.failed={failed} tex.total={total_found} tex.dropped={dropped} manifest={} redis_index={}",
            manifest_path.display(),
            redis_count
        );
    } else {
        println!(
            "tex.parsed={parsed} tex.failed={failed} tex.total={total_found} manifest={} redis_index={}",
            manifest_path.display(),
            redis_count
        );
    }

    Ok(())
}

fn save_cmd(op: SaveOp) -> anyhow::Result<()> {
    use nie_save::io::{edit_blob_byte, hexdump_blob_body, print_summary, read_save, write_save};

    match op {
        SaveOp::Read { file, hexdump } => {
            let container = read_save(&file)
                .map_err(|e| anyhow::anyhow!("lecture save : {e}"))?;
            print_summary(&container);
            if hexdump > 0 {
                for (i, blob) in container.blobs.iter().enumerate() {
                    println!("  hexdump blob[{i}]:");
                    hexdump_blob_body(blob, hexdump);
                }
            }
        }
        SaveOp::Decrypt { file, out } => {
            // XOR direct sur le fichier brut : le keystream est involutif, donc
            // decrypt = encrypt = XOR(données, keystream).
            // On n'utilise PAS serialize_plaintext() pour rester byte-identique à l'original.
            let raw = std::fs::read(&file)
                .with_context(|| format!("lecture {}", file.display()))?;
            let filename = file
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| anyhow::anyhow!("nom de fichier invalide : {}", file.display()))?;
            let key = nie_save::key_from_filename(filename);
            let mut plain = raw;
            nie_save::decrypt_block(&mut plain, 0, key);
            std::fs::write(&out, &plain)
                .with_context(|| format!("écriture plaintext {}", out.display()))?;
            println!("decrypt ok={} bytes={}", out.display(), plain.len());
        }
        SaveOp::Encrypt { file, slot, out } => {
            let plain = std::fs::read(&file)
                .with_context(|| format!("lecture {}", file.display()))?;
            // Chiffrer le plaintext avec la clé dérivée du nom de slot
            let key = nie_save::key_from_filename(&slot);
            let mut enc = plain;
            nie_save::decrypt_block(&mut enc, 0, key);
            std::fs::write(&out, &enc)
                .with_context(|| format!("écriture {}", out.display()))?;
            println!("encrypt slot={slot} key=0x{key:08X} out={} bytes={}", out.display(), enc.len());
        }
        SaveOp::Edit { file, blob: blob_name, offset, value, out } => {
            if !(0..=255).contains(&value) {
                anyhow::bail!("valeur {value} hors plage [0, 255]");
            }
            if offset < 0 {
                anyhow::bail!("offset {offset} négatif");
            }
            let mut container = read_save(&file)
                .map_err(|e| anyhow::anyhow!("lecture save : {e}"))?;
            let ok = edit_blob_byte(&mut container, &blob_name, offset as usize, value as u8);
            if !ok {
                anyhow::bail!("blob '{}' introuvable ou offset {} hors limites", blob_name, offset);
            }
            let out_path = out.as_deref().unwrap_or(&file);
            write_save(&container, out_path)
                .map_err(|e| anyhow::anyhow!("écriture save : {e}"))?;
            println!(
                "edit blob={blob_name} offset=0x{offset:X} value=0x{value:02X} out={}",
                out_path.display()
            );
        }
    }
    Ok(())
}

/// Construit un manifeste NDJSON CRC32->chemin pour tous les fichiers .g4md et .g4mg du VFS.
/// Chaque ligne JSON : `{"crc":3735928559,"path":"chr/c01000010.g4md","cpk":"abc123.cpk"}`
///
/// Le CRC32 est calculé avec l'algorithme du jeu (accumulteur sans inversion finale,
/// sur le nom de fichier complet sans extension, en minuscules, sans chemin).
fn uniform_map(game_dir: &std::path::Path, out: &std::path::Path) -> anyhow::Result<()> {
    use std::io::Write as IoWrite;
    use nie_formats::vfs::Vfs;

    let data_dir = game_dir.join("data");
    let mut vfs = Vfs::new();
    vfs.init(&data_dir).context("init VFS depuis cpk_list.cfg.bin")?;

    tracing::info!(
        asset_count = vfs.asset_count(),
        cpk_count = vfs.cpk_count(),
        "VFS initialisé"
    );

    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut f = std::fs::File::create(out)
        .with_context(|| format!("création manifeste {}", out.display()))?;

    let mut count = 0usize;
    for (path, entry) in vfs.iter() {
        let lower = path.to_lowercase();
        if !lower.ends_with(".g4md") && !lower.ends_with(".g4mg") {
            continue;
        }
        // Nom sans extension pour le CRC (selon l'usage dans g4.rs)
        let stem = path.rsplit('/').next().unwrap_or(path);
        let stem_no_ext = stem.rfind('.').map(|i| &stem[..i]).unwrap_or(stem);
        let crc = nie_formats::cpk::crc32_nie(stem_no_ext.as_bytes());
        let line = serde_json::json!({
            "crc": crc,
            "crc_hex": format!("0x{crc:08X}"),
            "path": path,
            "cpk": entry.cpk_filename,
        });
        writeln!(f, "{line}")?;
        count += 1;
    }

    eprintln!("uniform-map: {count} fichiers .g4md/.g4mg indexés → {}", out.display());
    Ok(())
}

/// Charge le cpk_list.cfg.bin et extrait tous les chemins internes se terminant par `.g4tx`.
/// Retourne (internal_path, cpk_filename).
fn collect_g4tx_paths(data_dir: &std::path::Path) -> anyhow::Result<Vec<(String, String)>> {
    use std::io::Read;

    let cpk_list_path = data_dir.join("cpk_list.cfg.bin");
    let mut file = std::fs::File::open(&cpk_list_path)
        .with_context(|| format!("ouverture {}", cpk_list_path.display()))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).context("lecture cpk_list.cfg.bin")?;

    // Déchiffrer avec la clé fixe Viola
    nie_formats::cpk::decrypt_block(&mut data, 0, nie_formats::cpk::VIOLA_FIXED_KEY);

    let cfg = nie_formats::cfgbin::cfgbin_parse(&data)
        .map_err(|e| anyhow::anyhow!("parse cfg.bin: {e}"))?;

    let mut result = Vec::new();
    for root_entry in &cfg.entries {
        for child in &root_entry.children {
            if child.variables.len() < 5 {
                continue;
            }
            let directory = match &child.variables[0] {
                nie_formats::cfgbin::Value::String(s) => s.as_str(),
                _ => continue,
            };
            let filename = match &child.variables[1] {
                nie_formats::cfgbin::Value::String(s) => s.as_str(),
                _ => continue,
            };
            let cpk_hash = match &child.variables[3] {
                nie_formats::cfgbin::Value::String(s) => s.clone(),
                _ => continue,
            };

            if !filename.ends_with(".g4tx") {
                continue;
            }

            let internal_path = format!("{directory}{filename}");
            result.push((internal_path, cpk_hash));
        }
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// MenuPredecode
// ---------------------------------------------------------------------------

fn menu_predecode_cmd(
    game_dir: &std::path::Path,
    layouts_dir: &std::path::Path,
    redis_url: &str,
    all_menu: bool,
) -> anyhow::Result<()> {
    // dump_root = game_dir/data (les sprite logicalPaths commencent par "dx11/...")
    let dump_root = game_dir.join("data");
    let packs_dir = game_dir.join("data").join("packs");

    // Extraire les sprites des layouts azalee (champ sprite.logicalPath des JSON).
    let priority_paths = extract_layout_sprites(layouts_dir)?;
    eprintln!(
        "predecode layouts={} sprites_uniques={}",
        count_json_files(layouts_dir),
        priority_paths.len()
    );

    let stats = menu_predecode::run(
        &dump_root,
        &packs_dir,
        redis_url,
        &priority_paths,
        all_menu,
    )?;

    println!(
        "decoded={} skipped={} failed={}",
        stats.decoded, stats.skipped, stats.failed
    );
    Ok(())
}

/// Extrait les `sprite.logicalPath` (`.g4tx`) uniques depuis tous les *.json du dossier layouts.
fn extract_layout_sprites(layouts_dir: &std::path::Path) -> anyhow::Result<Vec<String>> {
    use std::collections::HashSet;

    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<String> = Vec::new();

    let entries = std::fs::read_dir(layouts_dir)
        .with_context(|| format!("lecture layouts {}", layouts_dir.display()))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("lecture {}", path.display()))?;
        let json: serde_json::Value = serde_json::from_str(&content)
            .with_context(|| format!("parse JSON {}", path.display()))?;

        if let Some(objects) = json.get("objects").and_then(|v| v.as_array()) {
            for obj in objects {
                if let Some(sprite) = obj.get("sprite")
                    && let Some(logical_path) = sprite.get("logicalPath").and_then(|v| v.as_str())
                    && logical_path.ends_with(".g4tx")
                    && seen.insert(logical_path.to_string())
                {
                    result.push(logical_path.to_string());
                }
            }
        }
    }

    Ok(result)
}

fn count_json_files(layouts_dir: &std::path::Path) -> usize {
    std::fs::read_dir(layouts_dir)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().extension().and_then(|x| x.to_str()) == Some("json")
                })
                .count()
        })
        .unwrap_or(0)
}

// ─── niers vfs — explorateur CPK (VFS) ─────────────────────────────────────────────

// ---------------------------------------------------------------------------
// niers convert — un asset du jeu vers un format d'échange
// ---------------------------------------------------------------------------

/// Lit la source : fichier du disque si présent, sinon entrée du VFS.
fn lire_source(src: &str, game_dir: Option<PathBuf>) -> anyhow::Result<Vec<u8>> {
    let p = std::path::Path::new(src);
    if p.is_file() {
        return std::fs::read(p).with_context(|| format!("lecture « {src} »"));
    }
    let vfs = open_vfs(game_dir)?;
    vfs.read(src)
        .with_context(|| format!("« {src} » introuvable, ni sur le disque ni dans le VFS"))
}

/// Charge une référence de comparaison : chemin local, ou URL `https://` récupérée par `curl`.
///
/// `curl` plutôt qu'un client HTTP en dépendance : la comparaison est un outil de mise au point,
/// pas une fonction du moteur — elle ne justifie pas de faire entrer une pile TLS dans la CLI.
fn lire_reference(reference: &str) -> anyhow::Result<Vec<u8>> {
    if !reference.starts_with("http://") && !reference.starts_with("https://") {
        return std::fs::read(reference)
            .with_context(|| format!("lecture de la référence « {reference} »"));
    }
    let sortie = std::process::Command::new("curl")
        .args(["-sSL", "--fail", "--max-time", "120", reference])
        .output()
        .with_context(|| format!("curl indisponible pour « {reference} »"))?;
    if !sortie.status.success() {
        anyhow::bail!(
            "téléchargement de « {reference} » : {}",
            String::from_utf8_lossy(&sortie.stderr).trim()
        );
    }
    Ok(sortie.stdout)
}

fn convert_cmd(
    src: &str,
    to: &str,
    out: Option<&std::path::Path>,
    game_dir: Option<PathBuf>,
    reference: Option<&str>,
    masque: bool,
) -> anyhow::Result<()> {
    use nie_formats::image_out::ImageOut;

    // Sorties « feuille de sprites » : elles ne rendent pas une image mais la description des
    // régions de l'atlas, sous la forme qu'attend le web.
    if matches!(to, "css" | "svg" | "json") {
        return convert_sprites(src, to, out, game_dir, masque);
    }

    let format = ImageOut::depuis_extension(to).ok_or_else(|| {
        let connus: Vec<&str> = ImageOut::TOUS.iter().map(|f| f.extension()).collect();
        anyhow::anyhow!("format « {to} » inconnu — formats gérés : {}", connus.join(", "))
    })?;

    let data = lire_source(src, game_dir)?;
    let produit = nie_formats::image_out::g4tx_vers(&data, format)
        .map_err(|e| anyhow::anyhow!("conversion de « {src} » en {} : {e}", format.extension()))?;

    let destination = out.map_or_else(
        || {
            let base = src.rsplit('/').next().unwrap_or(src);
            let tronc = base.rsplit_once('.').map_or(base, |(t, _)| t);
            PathBuf::from(format!("{tronc}.{}", format.extension()))
        },
        std::path::Path::to_path_buf,
    );
    std::fs::write(&destination, &produit)
        .with_context(|| format!("écriture « {} »", destination.display()))?;

    println!("source      {src} ({} octets)", data.len());
    println!("format      {}{}", format.extension(), if format.sans_perte() { "" } else { " (avec perte)" });
    println!("sortie      {} ({} octets)", destination.display(), produit.len());

    if let Some(reference) = reference {
        let attendu = lire_reference(reference)?;
        let empreinte = |b: &[u8]| {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(b);
            hex::encode(h.finalize())
        };
        let (a, b) = (empreinte(&produit), empreinte(&attendu));
        println!("reference   {reference} ({} octets)", attendu.len());
        println!("sha256      produit={a}");
        println!("            attendu={b}");
        if a == b {
            println!("verdict     identique a l'octet");
        } else {
            println!("verdict     DIVERGENT");
            anyhow::bail!("la sortie diffère de la référence");
        }
    }
    Ok(())
}

/// Convertit un atlas `.g4tx` en feuille de sprites pour le web (`css`, `svg` ou `json`).
///
/// Le `.g4tx` décrit lui-même ses régions (nom + rectangle) : on les recopie, on ne les devine
/// pas. `css` écrit **deux** fichiers (la feuille et l'atlas en WebP sans perte) ; `svg` et
/// `json` en écrivent un seul, le SVG embarquant l'atlas pour rester autonome.
fn convert_sprites(
    src: &str,
    to: &str,
    out: Option<&std::path::Path>,
    game_dir: Option<PathBuf>,
    masque: bool,
) -> anyhow::Result<()> {
    use nie_formats::image_out::ImageOut;
    use nie_formats::sprite_sheet;

    let data = lire_source(src, game_dir)?;
    let atlas = nie_formats::g4tx::parse(&data)
        .map_err(|e| anyhow::anyhow!("« {src} » n'est pas un G4TX lisible : {e}"))?;
    let feuille = sprite_sheet::depuis_g4tx(&atlas, 0)
        .ok_or_else(|| anyhow::anyhow!("« {src} » ne contient aucune texture"))?;

    let base = src.rsplit('/').next().unwrap_or(src);
    let tronc = base.rsplit_once('.').map_or(base, |(t, _)| t).to_string();
    let destination = out.map_or_else(
        || PathBuf::from(format!("{tronc}.{to}")),
        std::path::Path::to_path_buf,
    );

    println!("source      {src} ({} octets)", data.len());
    println!("atlas       {} — {}×{}", feuille.nom, feuille.largeur, feuille.hauteur);
    println!("regions     {}", feuille.len());
    if feuille.is_empty() {
        println!("note        image simple (aucune région d'atlas déclarée)");
    }

    let contenu = match to {
        "json" => feuille.vers_json(),
        "css" => {
            // L'atlas accompagne la feuille : WebP sans perte, le plus petit des formats exacts.
            let image = nie_formats::image_out::g4tx_vers(&data, ImageOut::Webp)
                .map_err(|e| anyhow::anyhow!("encodage de l'atlas : {e}"))?;
            let image_path = destination.with_extension("webp");
            std::fs::write(&image_path, &image)
                .with_context(|| format!("écriture « {} »", image_path.display()))?;
            let nom_image = image_path
                .file_name()
                .map_or_else(|| tronc.clone() + ".webp", |n| n.to_string_lossy().into_owned());
            println!("atlas       {} ({} octets)", image_path.display(), image.len());
            let mode = if masque {
                sprite_sheet::ModeCss::Masque
            } else {
                sprite_sheet::ModeCss::Image
            };
            feuille.vers_css_mode(&nom_image, mode)
        }
        "svg" => {
            let image = nie_formats::image_out::g4tx_vers(&data, ImageOut::Png)
                .map_err(|e| anyhow::anyhow!("encodage de l'atlas : {e}"))?;
            feuille.vers_svg(&sprite_sheet::data_uri(&image, "image/png"))
        }
        _ => unreachable!("format filtré par l'appelant"),
    };

    std::fs::write(&destination, contenu.as_bytes())
        .with_context(|| format!("écriture « {} »", destination.display()))?;
    println!("sortie      {} ({} octets)", destination.display(), contenu.len());
    Ok(())
}

fn viola_cmd(op: ViolaOp) -> anyhow::Result<()> {
    match op {
        ViolaOp::Dump { out, filtre, sans_reprise, tout_reecrire, threads, game_dir } => {
            let vfs = open_vfs(game_dir)?;
            let options = nie_viola::DumpOptions {
                filtre,
                reprise: !sans_reprise,
                sauter_identiques: !tout_reecrire,
                threads,
            };
            let annuler = std::sync::atomic::AtomicBool::new(false);
            // Le rapport d'avancement n'écrit qu'une ligne réécrite en place : appelé depuis
            // plusieurs threads, il doit rester bon marché.
            let progres = |p: nie_viola::DumpProgress| {
                eprint!("\r  {} / {} fichiers — {:.1} Gio", p.faits, p.total, p.octets as f64 / 1.073_741_824e9);
                let _ = std::io::stderr().flush();
            };
            let r = nie_viola::dump_all(&vfs, &out, &options, &annuler, &progres).map_err(anyhow::Error::msg)?;
            eprintln!();
            println!("extraits  {}", r.extraits);
            println!("sautés    {}", r.sautes);
            println!("échecs    {}", r.echecs);
            println!("octets    {}", r.octets);
            println!("packs repris {}", r.packs_repris);
            if r.annule {
                println!("annulé    oui");
            }
            Ok(())
        }
        ViolaOp::Pack { mod_dir, out, cpk_list, switch, game_dir } => {
            let plateforme = if switch { nie_viola::Platform::Switch } else { nie_viola::Platform::Pc };
            let cpk_list = cpk_list
                .unwrap_or_else(|| racine_jeu(game_dir).join("data").join("cpk_list.cfg.bin"));
            let r = nie_viola::pack_mod(&cpk_list, &mod_dir, &out, plateforme).map_err(anyhow::Error::msg)?;
            println!("mis à jour {}", r.mis_a_jour);
            println!("ajoutés    {}", r.ajoutes);
            println!("copiés     {}", r.copies);
            println!("entrées    {}", r.total);
            println!("enveloppe  {:?}", r.crypto);
            // Un `cpk_list` déjà packé empilerait les entrées d'un mod précédent : le dire.
            if r.loose_avant > 64 {
                eprintln!(
                    "attention : {} entrées étaient déjà hors paquet — ce cpk_list semble déjà packé",
                    r.loose_avant
                );
            }
            Ok(())
        }
        ViolaOp::Merge { sources, out, fichier, game_dir } => {
            // La fusion au champ a besoin du vanilla ; le VFS le fournit sans exiger un dump.
            let vfs = if fichier { None } else { Some(open_vfs(game_dir)?) };
            let rapport = match &vfs {
                None => nie_viola::merge_dirs(&sources, &out, &nie_viola::MergeStrategy::Fichier),
                Some(vfs) => {
                    let resoudre = |rel: &str| vfs.read(rel).ok();
                    nie_viola::merge_dirs(&sources, &out, &nie_viola::MergeStrategy::Semantique(&resoudre))
                }
            }
            .map_err(anyhow::Error::msg)?;
            println!("copiés    {}", rapport.copies);
            println!("fusionnés {}", rapport.fusionnes);
            println!("conflits  {}", rapport.conflits.len());
            for c in &rapport.conflits {
                let repli = c.repli.as_deref().unwrap_or("");
                println!(
                    "  {} — mods {:?}, {} champs fusionnés, {} en désaccord {repli}",
                    c.chemin, c.rangs, c.champs_fusionnes, c.champs_en_desaccord
                );
            }
            Ok(())
        }
        ViolaOp::Crypto { src, out, cle, du_nom } => {
            let cle = match (cle, du_nom) {
                (Some(hex), _) => nie_viola::CriwareKey::depuis_hex(&hex).map_err(anyhow::Error::msg)?,
                (None, true) => nie_viola::CriwareKey::DuNom(
                    src.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                ),
                (None, false) => nie_viola::CriwareKey::Viola,
            };
            let octets = nie_viola::crypt_file(&src, &out, &cle).map_err(anyhow::Error::msg)?;
            println!("clé    {:08X}", cle.valeur());
            println!("octets {octets}");
            Ok(())
        }
    }
}

fn vfs_cmd(op: VfsOp) -> anyhow::Result<()> {
    match op {
        VfsOp::Ls { prefix, game_dir } => vfs_ls(prefix.as_deref().unwrap_or(""), game_dir),
        VfsOp::Stat { path, game_dir } => vfs_stat(&path, game_dir),
        VfsOp::Cat { path, hex, len, png_out, wav_out, game_dir } => {
            vfs_cat(&path, hex, len, png_out.as_deref(), wav_out.as_deref(), game_dir)
        }
        VfsOp::Extract { path, out, game_dir } => vfs_extract(&path, &out, game_dir),
        VfsOp::Stats { top, game_dir } => vfs_stats(top, game_dir),
        VfsOp::Find { query, ext, limit, json, game_dir } => vfs_find(&query, ext.as_deref(), limit, json, game_dir),
        VfsOp::Chara { query, no_paths, element, position, json, limit, db, game_dir } => {
            let opts = SearchOpts { show_paths: !no_paths, json, limit, db: db.as_deref(), game_dir };
            vfs_search_chara(&query, element.as_deref(), position.as_deref(), opts)
        }
        VfsOp::Waza { query, no_paths, category, element, json, limit, db, game_dir } => {
            let opts = SearchOpts { show_paths: !no_paths, json, limit, db: db.as_deref(), game_dir };
            vfs_search_waza(&query, category.as_deref(), element.as_deref(), opts)
        }
    }
}

/// Ouvre le VFS depuis `game_dir` (ou [`nie_formats::vfs::resolve_game_dir`] si absent).
fn open_vfs(game_dir: Option<PathBuf>) -> anyhow::Result<nie_formats::vfs::Vfs> {
    let root = game_dir.unwrap_or_else(nie_formats::vfs::resolve_game_dir);
    let data_dir = root.join("data");
    let mut vfs = nie_formats::vfs::Vfs::new();
    vfs.init(&data_dir).with_context(|| format!("init VFS depuis {}", data_dir.display()))?;
    Ok(vfs)
}

fn vfs_ls(prefix: &str, game_dir: Option<PathBuf>) -> anyhow::Result<()> {
    let vfs = open_vfs(game_dir)?;
    let prefix = prefix.trim_matches('/');

    if let Some(role) = nie_explore::folder_roles::describe_folder(prefix) {
        println!("  rôle : {}", role.role);
        println!("  statut : {}\n", role.status);
    }

    let mut dirs: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut files: Vec<(&str, &nie_formats::vfs::VfsEntry)> = Vec::new();

    for (path, entry) in vfs.iter() {
        let rest = if prefix.is_empty() {
            path
        } else if path == prefix {
            continue;
        } else if let Some(r) = path.strip_prefix(prefix).and_then(|r| r.strip_prefix('/')) {
            r
        } else {
            continue;
        };
        match rest.split_once('/') {
            Some((seg, _)) => {
                dirs.insert(seg.to_string());
            }
            None => files.push((path, entry)),
        }
    }

    for d in &dirs {
        println!("  {d}/");
    }
    files.sort_by_key(|(p, _)| *p);
    for (path, entry) in &files {
        let name = path.rsplit('/').next().unwrap_or(path);
        let cpk = if entry.cpk_filename.is_empty() { "<loose>" } else { entry.cpk_filename.as_str() };
        println!("  {:>10}  {name}  [{cpk}]", entry.file_size);
    }
    println!("\n  {} sous-dossier(s), {} fichier(s)", dirs.len(), files.len());
    Ok(())
}

/// Une entrée de `niers vfs find --json` — même convention compacte-sur-une-ligne que
/// [`SearchJsonEntry`] (`chara`/`waza`), mais SANS dépendance au miroir wiki : `find` marche sur
/// n'importe quelle install du jeu (VFS seul), c'est la recherche « fichiers » générique que
/// `niers_bridge.py` (addon Blender `plugins/niers-blender`) utilise pour son panneau de recherche.
#[derive(serde::Serialize)]
struct FindJsonEntry<'a> {
    path: &'a str,
    size: u32,
    cpk: &'a str,
}

fn vfs_find(query: &str, ext: Option<&str>, limit: usize, json: bool, game_dir: Option<PathBuf>) -> anyhow::Result<()> {
    let vfs = open_vfs(game_dir)?;
    let q = query.to_lowercase();
    let ext_dot = ext.map(|e| format!(".{}", e.trim_start_matches('.').to_lowercase()));

    let mut hits: Vec<(&str, &nie_formats::vfs::VfsEntry)> = vfs
        .iter()
        .filter(|(p, _)| p.to_lowercase().contains(&q))
        .filter(|(p, _)| ext_dot.as_deref().is_none_or(|e| p.to_lowercase().ends_with(e)))
        .collect();
    hits.sort_by_key(|(p, _)| *p);

    let total = hits.len();
    if json {
        let entries: Vec<FindJsonEntry> = hits
            .iter()
            .take(limit)
            .map(|(path, entry)| FindJsonEntry {
                path,
                size: entry.file_size,
                cpk: if entry.cpk_filename.is_empty() { "<loose>" } else { entry.cpk_filename.as_str() },
            })
            .collect();
        println!("{}", serde_json::to_string(&entries)?);
        return Ok(());
    }

    for (path, entry) in hits.iter().take(limit) {
        let cpk = if entry.cpk_filename.is_empty() { "<loose>" } else { entry.cpk_filename.as_str() };
        println!("  {:>10}  {path}  [{cpk}]", entry.file_size);
    }
    let capped = if total > limit { format!(" (limité à {limit})") } else { String::new() };
    println!("\n  {total} résultat(s){capped}");
    Ok(())
}

fn vfs_stat(path: &str, game_dir: Option<PathBuf>) -> anyhow::Result<()> {
    let vfs = open_vfs(game_dir)?;
    let entry = vfs.find(path).ok_or_else(|| anyhow::anyhow!("« {path} » absent du VFS"))?;
    println!("  chemin      {path}");
    println!("  taille      {} octets", entry.file_size);
    println!(
        "  cpk         {}",
        if entry.cpk_filename.is_empty() { "<loose>" } else { &entry.cpk_filename }
    );
    match vfs.read(path) {
        Ok(data) => {
            let label = nie_explore::describe_content(path, &data)
                .and_then(|lines| lines.into_iter().next())
                .unwrap_or_else(|| "format      brut / non reconnu".to_string());
            println!("  {label}");
            println!("  magic       {}", nie_explore::hex_prefix(&data, 16));
        }
        Err(e) => println!("  lecture     ECHEC ({e})"),
    }
    Ok(())
}

fn vfs_cat(
    path: &str,
    hex: bool,
    len: usize,
    png_out: Option<&std::path::Path>,
    wav_out: Option<&std::path::Path>,
    game_dir: Option<PathBuf>,
) -> anyhow::Result<()> {
    /// Chemin du `.awb` de streaming associé à un `.acb` (même dossier, même base).
    fn alloc_awb(base: &str) -> String {
        format!("{base}.awb")
    }

    /// Décode vers WAV **dans un thread à grande pile**.
    ///
    /// `cridecoder` alloue ses tables de synthèse HCA sur la pile : sur le thread principal
    /// Windows (1 Mio en debug) il déborde avant de produire le moindre échantillon. Même
    /// contournement que `apps/nie-explorer/src-tauri`.
    fn decoder_wav(data: Vec<u8>) -> Option<Vec<u8>> {
        std::thread::Builder::new()
            .stack_size(16 * 1024 * 1024)
            .spawn(move || nie_formats::cri_audio::decode_to_wav(&data).ok())
            .ok()?
            .join()
            .ok()?
    }

    let vfs = open_vfs(game_dir)?;
    let data = vfs.read(path).with_context(|| format!("lecture « {path} »"))?;
    println!("  {path}  ({} octets)", data.len());

    if let Some(out) = png_out {
        match nie_formats::g4tx_decode::decode_best_to_png(&data) {
            Some(png) => {
                std::fs::write(out, &png)?;
                println!("  PNG écrit → {}", out.display());
            }
            None => println!("  échec décodage PNG (pas une texture reconnue)"),
        }
    }
    if let Some(out) = wav_out {
        // `decode_to_wav` dispatche par magic : ADX, HCA (clé IEVR), AWB/AFS2, ACB.
        let mut wav = decoder_wav(data.clone());

        // Un `.acb` ne porte souvent que la table de cues : le son vit dans le `.awb` voisin
        // (streaming). C'est le cas de tous les `sound_asset/<lg>/*.acb` du jeu.
        if wav.is_none() && let Some(base) = path.strip_suffix(".acb") {
            let voisin = alloc_awb(base);
            if let Ok(awb) = vfs.read(&voisin) {
                println!("  ACB sans données : reprise sur {voisin} ({} octets)", awb.len());
                wav = decoder_wav(awb);
            }
        }

        match wav {
            Some(w) => {
                std::fs::write(out, &w)?;
                println!("  WAV écrit → {} ({} octets)", out.display(), w.len());
            }
            None => println!("  échec décodage audio (ni ADX, ni HCA, ni AWB/ACB exploitable)"),
        }
    }

    if !hex
        && let Some(lines) = nie_explore::describe_content(path, &data)
    {
        for l in lines {
            println!("  {l}");
        }
        return Ok(());
    }
    let n = data.len().min(len);
    mem_hexdump(&data[..n], 0);
    if data.len() > n {
        println!("  … {} octet(s) de plus (--len pour en voir davantage)", data.len() - n);
    }
    Ok(())
}

fn vfs_extract(path: &str, out: &std::path::Path, game_dir: Option<PathBuf>) -> anyhow::Result<()> {
    let vfs = open_vfs(game_dir)?;

    if vfs.find(path).is_some() {
        let data = vfs.read(path)?;
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(out, &data)?;
        println!("  1 fichier extrait ({} octets) → {}", data.len(), out.display());
        return Ok(());
    }

    // Pas de correspondance exacte : traiter `path` comme un préfixe de dossier.
    let prefix = path.trim_end_matches('/');
    let sub_prefix = format!("{prefix}/");
    let matches: Vec<String> = vfs
        .iter()
        .filter(|(p, _)| *p == prefix || p.starts_with(&sub_prefix))
        .map(|(p, _)| p.to_string())
        .collect();
    anyhow::ensure!(!matches.is_empty(), "« {path} » absent du VFS (ni fichier exact, ni préfixe)");

    let mut ok = 0usize;
    let mut failed = 0usize;
    for p in &matches {
        match vfs.read(p) {
            Ok(data) => {
                let rel = p.strip_prefix(prefix).unwrap_or(p).trim_start_matches('/');
                let dest = out.join(rel);
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                match std::fs::write(&dest, &data) {
                    Ok(()) => ok += 1,
                    Err(_) => failed += 1,
                }
            }
            Err(_) => failed += 1,
        }
    }
    println!("  {ok} fichier(s) extrait(s) sous {} ({failed} échec(s))", out.display());
    Ok(())
}

fn vfs_stats(top: usize, game_dir: Option<PathBuf>) -> anyhow::Result<()> {
    let vfs = open_vfs(game_dir)?;
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (path, _) in vfs.iter() {
        let base = path.rsplit('/').next().unwrap_or(path);
        let ext = base.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_else(|| "<none>".to_string());
        *counts.entry(ext).or_default() += 1;
    }
    let mut v: Vec<_> = counts.into_iter().collect();
    v.sort_by_key(|(_, c)| std::cmp::Reverse(*c));

    println!(
        "  total = {} fichiers, {} CPK, {} entrées extra, {} loose",
        vfs.asset_count(),
        vfs.cpk_count(),
        vfs.extra_count(),
        vfs.loose_count()
    );
    for (ext, c) in v.iter().take(top) {
        println!("  {c:>8}  .{ext}");
    }
    Ok(())
}

/// Vrai si `have` (optionnel) contient `want`, insensible à la casse — `want=None` = pas de
/// filtre. Sous-chaîne plutôt qu'égalité stricte : les catégories réelles du miroir sont
/// bilingues (ex. `"Tir/Shoot"`, `"Défense/Block"`) — `--category Tir` doit matcher.
fn matches_filter(have: Option<&str>, want: Option<&str>) -> bool {
    match want {
        None => true,
        Some(w) => have.is_some_and(|h| h.to_lowercase().contains(&w.to_lowercase())),
    }
}

/// Entrée JSON d'un résultat de recherche chara/waza (`--json`) — consommée par
/// `plugins/niers-blender/niers_bridge.py` (panneau de recherche Blender) ou tout autre script.
#[derive(serde::Serialize)]
struct SearchJsonEntry {
    id: String,
    internal_code: Option<String>,
    name_fr: Option<String>,
    name_en: Option<String>,
    name_ja: Option<String>,
    /// Élément (chara/waza) ou poste (chara uniquement, réutilise ce champ).
    element: Option<String>,
    /// Poste (chara) ou catégorie (waza).
    category_or_position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_hyper: Option<bool>,
    related_paths: Vec<String>,
}

/// Options communes à `vfs_search_chara`/`vfs_search_waza` (regroupées pour l'arité — clippy
/// `too_many_arguments`), indépendantes des filtres de catégorie propres à chaque famille.
struct SearchOpts<'a> {
    show_paths: bool,
    json: bool,
    limit: usize,
    db: Option<&'a std::path::Path>,
    game_dir: Option<PathBuf>,
}

/// Cherche un personnage dans le miroir wiki (nom FR/EN/JA, ID ou code interne), avec filtres
/// optionnels par élément/poste (catégorie), puis liste ses fichiers dans le VFS (le code
/// interne, ex. `c01000100`, apparaît dans les chemins modèle/texture/anim du personnage).
fn vfs_search_chara(query: &str, element: Option<&str>, position: Option<&str>, opts: SearchOpts<'_>) -> anyhow::Result<()> {
    use nie_wiki::{mirror, query as wiki_query};
    let SearchOpts { show_paths, json, limit, db, game_dir } = opts;

    let conn = mirror::open(db)?;
    let mut matches = wiki_query::search_characters(&conn, query)?;
    matches.retain(|m| matches_filter(m.element.as_deref(), element) && matches_filter(m.position.as_deref(), position));

    if matches.is_empty() {
        if json {
            println!("[]");
        } else {
            println!("Aucun personnage trouvé pour « {query} » (miroir wiki, filtres compris).");
        }
        return Ok(());
    }

    let vfs = if show_paths || json { Some(open_vfs(game_dir)?) } else { None };

    if json {
        let entries: Vec<SearchJsonEntry> = matches
            .iter()
            .map(|m| SearchJsonEntry {
                id: m.id.clone(),
                internal_code: m.internal_code.clone(),
                name_fr: m.name_fr.clone(),
                name_en: m.name_en.clone(),
                name_ja: m.name_ja.clone(),
                element: m.element.clone(),
                category_or_position: m.position.clone(),
                is_hyper: None,
                related_paths: match (&vfs, m.internal_code.as_deref()) {
                    (Some(vfs), Some(code)) => vfs.iter().filter(|(p, _)| p.contains(code)).map(|(p, _)| p.to_string()).collect(),
                    _ => Vec::new(),
                },
            })
            .collect();
        println!("{}", serde_json::to_string(&entries)?);
        return Ok(());
    }

    for m in &matches {
        println!(
            "{} / {} (ID {} | code {})",
            m.name_fr.as_deref().unwrap_or("?"),
            m.name_en.as_deref().unwrap_or("?"),
            m.id,
            m.internal_code.as_deref().unwrap_or("?"),
        );
        if let (Some(vfs), Some(code)) = (&vfs, m.internal_code.as_deref()) {
            vfs_print_related(vfs, code, limit);
        }
    }
    Ok(())
}

/// Cherche une technique/waza dans le miroir wiki (nom FR/EN/JA, ID ou code interne), avec
/// filtres optionnels par catégorie/élément, puis liste ses fichiers dans le VFS (le code
/// interne, ex. `whs00010`, apparaît dans les chemins de cut-in/telop/vidéo de la technique).
fn vfs_search_waza(query: &str, category: Option<&str>, element: Option<&str>, opts: SearchOpts<'_>) -> anyhow::Result<()> {
    use nie_wiki::{mirror, query as wiki_query};
    let SearchOpts { show_paths, json, limit, db, game_dir } = opts;

    let conn = mirror::open(db)?;
    let mut matches = wiki_query::search_skills(&conn, query)?;
    matches.retain(|m| matches_filter(m.category.as_deref(), category) && matches_filter(m.element.as_deref(), element));

    if matches.is_empty() {
        if json {
            println!("[]");
        } else {
            println!("Aucune technique trouvée pour « {query} » (miroir wiki, filtres compris).");
        }
        return Ok(());
    }

    let vfs = if show_paths || json { Some(open_vfs(game_dir)?) } else { None };

    if json {
        let entries: Vec<SearchJsonEntry> = matches
            .iter()
            .map(|m| SearchJsonEntry {
                id: m.id.clone(),
                internal_code: m.internal_code.clone(),
                name_fr: m.name_fr.clone(),
                name_en: m.name_en.clone(),
                name_ja: m.name_ja.clone(),
                element: m.element.clone(),
                category_or_position: m.category.clone(),
                is_hyper: Some(m.is_hyper),
                related_paths: match (&vfs, m.internal_code.as_deref()) {
                    (Some(vfs), Some(code)) => vfs.iter().filter(|(p, _)| p.contains(code)).map(|(p, _)| p.to_string()).collect(),
                    _ => Vec::new(),
                },
            })
            .collect();
        println!("{}", serde_json::to_string(&entries)?);
        return Ok(());
    }

    for m in &matches {
        println!(
            "{} / {} (ID {} | code {}){}",
            m.name_fr.as_deref().unwrap_or("?"),
            m.name_en.as_deref().unwrap_or("?"),
            m.id,
            m.internal_code.as_deref().unwrap_or("?"),
            if m.is_hyper { "  [hyper]" } else { "" },
        );
        if let (Some(vfs), Some(code)) = (&vfs, m.internal_code.as_deref()) {
            vfs_print_related(vfs, code, limit);
        }
    }
    Ok(())
}

/// Liste les chemins VFS contenant `needle` (code interne d'un chara/waza), bornés à `limit`.
fn vfs_print_related(vfs: &nie_formats::vfs::Vfs, needle: &str, limit: usize) {
    let mut hits: Vec<&str> = vfs.iter().filter(|(p, _)| p.contains(needle)).map(|(p, _)| p).collect();
    hits.sort_unstable();
    let total = hits.len();
    for p in hits.iter().take(limit) {
        println!("    {p}");
    }
    let capped = if total > limit { format!(" (limité à {limit})") } else { String::new() };
    println!("    → {total} fichier(s) VFS contenant « {needle} »{capped}\n");
}
