//! Parseur et modèles pour les conteneurs d'événements Level-5 IEVR (`ev*.cfg.bin`).
//!
//! Les conteneurs d'événements régissent la mise en scène (cinématiques temps réel, dialogues,
//! caméra, animations, audio, effets spéciaux et embranchements de choix).
//!
//! ## Types de conteneurs d'événements
//!
//! - `data/common/event_cfg/evt/ev*.cfg.bin` : Séquence maître (timeline d'événements, cuts, acteurs, dialogues).
//! - `data/common/event_cfg/snd/ev*_snd.cfg.bin` : Synchronisation sonore (cues audio, bruitages, BGM).
//! - `data/common/event_cfg/eff/ev*_eff.cfg.bin` : Déclencheurs d'effets visuels et particules (`.objbin`).
//! - `data/common/event_cfg/other/*.cfg.bin` : Scripts système, fenêtres de choix (`select_sys_win`), dialogues NPC.
//!
//! ## Format T2B sous-jacent
//!
//! Les fichiers utilisent le format **T2B** (Level-5 Type 2 Binary) :
//! ```text
//! EVENT_COMMAND_NUM_0    — Champ #0 : nombre de commandes déclarées (i32).
//! EVENT_COMMAND_HEADER_i — Champ #0 : frame (i32), Champ #1 : opcode (CRC-32), Champ #2 : catégorie (i32).
//! EVENT_COMMAND_ARGS_i   — Arguments variables de la commande (String, Int, Float).
//! ```
//! Les scripts système (`other/`) utilisent la variante compacte :
//! ```text
//! EVENT_COMMAND_i        — Champ #0 : frame (-1), Champ #1 : opcode, Champ #2+ : arguments.
//! ```

extern crate alloc;
use alloc::{
    borrow::ToOwned,
    string::{String, ToString},
    vec::Vec,
};

use crate::FormatError;
use crate::cfgbin::{CfgEntry, Format, Value, cfgbin_parse};

// ── Opcodes Level-5 CRC-32 connus ──────────────────────────────────────────
//
// Chaque valeur est l'opcode dominant de sa catégorie, mesuré sur les 9 897
// fixtures `data/common/event_cfg/{evt,snd,eff}/*.cfg.bin.json` (~800 000
// commandes). Le nombre d'occurrences accompagne chaque constante ; les
// catégories dont l'opcode dominant est ambigu sont marquées comme telles.

/// Définition de cut / scène (`FD044302`, catégorie 1, 8 546 occurrences).
pub const OPCODE_CUT: u32 = 0xFD04_4302;
/// Spawn et enregistrement d'acteur / personnage (`35746E60`, catégorie 100, 7 246 occurrences).
pub const OPCODE_ACTOR: u32 = 0x3574_6E60;
/// Configuration de l'éclairage de scène (`A8C45AA2`, catégorie 100, 2 085 occurrences).
pub const OPCODE_LIGHT: u32 = 0xA8C4_5AA2;
/// Chargement d'un pack de motions `.g4pk` (`D552FA5D`, catégorie 102, 61 390 occurrences).
pub const OPCODE_MOTION_PKG: u32 = 0xD552_FA5D;
/// Reset d'état de scène (`DDC9D278`, catégorie 105, 7 825 occurrences).
pub const OPCODE_SCENE_RESET: u32 = 0xDDC9_D278;
/// Reset de cut (`682C8656`, catégorie 106, 8 546 occurrences).
pub const OPCODE_CUT_RESET: u32 = 0x682C_8656;
/// Enregistrement d'un jeu de motions (`DDEC5B3D`, catégorie 108, 23 222 occurrences).
pub const OPCODE_MOTION_SET: u32 = 0xDDEC_5B3D;
/// Lecture d'animation squelettique (`678F7CE6`, catégorie 109, 24 652 occurrences).
pub const OPCODE_ANIM_PLAY: u32 = 0x678F_7CE6;
/// Animation faciale / expression (`BFA5C387`, catégorie 109, 10 605 occurrences).
pub const OPCODE_FACIAL: u32 = 0xBFA5_C387;
/// Déplacement dans l'espace avec animation de marche/course (`82297276`, catégorie 109, 1 234 occurrences).
pub const OPCODE_CHARA_MOVE: u32 = 0x8229_7276;
/// Position de caméra (`6C976996`, catégorie 110 — args `x, y, z, …`).
pub const OPCODE_CAMERA_POS: u32 = 0x6C97_6996;
/// Cible / LookAt de caméra (`F821B199`, catégorie 110 — args `x, y, z, …`).
pub const OPCODE_CAMERA_TARGET: u32 = 0xF821_B199;
/// Champ de vision (FOV) de caméra (`045642DB`, catégorie 110 — premier arg en degrés).
pub const OPCODE_CAMERA_FOV: u32 = 0x0456_42DB;
/// Déclencheur de dialogue et réplique (`A4C7132D`, catégorie 150, 5 322 occurrences).
pub const OPCODE_DIALOGUE: u32 = 0xA4C7_132D;
/// Configuration d'effet de dialogue / lip-sync (`7BA7DD95`, catégorie 155, 5 322 occurrences).
pub const OPCODE_DIALOGUE_UI: u32 = 0x7BA7_DD95;
/// Enregistrement de ressource sonore (`BA67E844`, catégorie 140, 6 626 occurrences).
pub const OPCODE_AUDIO_REG: u32 = 0xBA67_E844;
/// Déclenchement / lecture de son ou voix (`3946657C`, catégorie 145, 9 774 occurrences).
pub const OPCODE_AUDIO_PLAY: u32 = 0x3946_657C;
/// Chargement d'un asset de scène référencé par chemin, `.g4sk` compris
/// (`799A1EBA`, catégorie 100, 11 409 occurrences).
pub const OPCODE_EFFECT_LOAD: u32 = 0x799A_1EBA;
/// Nettoyage / libération d'acteurs ou d'effets (`7EE3A490`, catégorie 900, 60 282 occurrences).
pub const OPCODE_CLEANUP: u32 = 0x7EE3_A490;
/// Fin de séquence d'événement (`B4CD69F7`, catégorie 1000, 2 088 occurrences).
pub const OPCODE_END: u32 = 0xB4CD_69F7;
/// Attente d'entrée utilisateur / confirmation de dialogue (`FF354267`, catégorie 1009, 5 154 occurrences).
pub const OPCODE_WAIT_INPUT: u32 = 0xFF35_4267;

// ── Types sémantiques ─────────────────────────────────────────────────────────

/// Catégorie de commande de l'ordonnanceur d'événements Level-5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum EventCategory {
    /// Catégorie 1 : Découpage en cuts.
    Cut,
    /// Catégorie 100 : Chargement d'assets (acteurs, lumière, effets).
    AssetLoad,
    /// Catégorie 102 : Chargement de packages d'animations.
    MotionLoad,
    /// Catégorie 105 : Reset global de scène.
    SceneReset,
    /// Catégorie 106 : Reset spécifique au cut.
    CutReset,
    /// Catégorie 108 : Enregistrement de motion set.
    MotionSet,
    /// Catégorie 109 : Exécution d'animation ou déplacement.
    Animation,
    /// Catégorie 110 : Caméra, cadrage et repères spatiaux.
    Camera,
    /// Catégorie 140 : Déclaration de ressource audio.
    AudioRegister,
    /// Catégorie 145 : Lecture audio synchronisée.
    AudioPlay,
    /// Catégorie 150 : Déclenchement de dialogue.
    Dialogue,
    /// Catégorie 155 : Propriétés de réplique et émotions.
    DialogueProperties,
    /// Catégorie 900 : Libération d'assets.
    Cleanup,
    /// Catégorie 1000 : Fin de la cinématique.
    SequenceEnd,
    /// Catégorie 1009 : Attente d'entrée utilisateur.
    WaitInput,
    /// Autre catégorie non répertoriée.
    Other(i32),
}

impl EventCategory {
    /// Code numérique brut Level-5 correspondant à la catégorie.
    #[must_use]
    pub const fn raw_code(&self) -> i32 {
        match self {
            Self::Cut => 1,
            Self::AssetLoad => 100,
            Self::MotionLoad => 102,
            Self::SceneReset => 105,
            Self::CutReset => 106,
            Self::MotionSet => 108,
            Self::Animation => 109,
            Self::Camera => 110,
            Self::AudioRegister => 140,
            Self::AudioPlay => 145,
            Self::Dialogue => 150,
            Self::DialogueProperties => 155,
            Self::Cleanup => 900,
            Self::SequenceEnd => 1000,
            Self::WaitInput => 1009,
            Self::Other(c) => *c,
        }
    }
}

impl From<i32> for EventCategory {
    fn from(val: i32) -> Self {
        match val {
            1 => Self::Cut,
            100 => Self::AssetLoad,
            102 => Self::MotionLoad,
            105 => Self::SceneReset,
            106 => Self::CutReset,
            108 => Self::MotionSet,
            109 => Self::Animation,
            110 => Self::Camera,
            140 => Self::AudioRegister,
            145 => Self::AudioPlay,
            150 => Self::Dialogue,
            155 => Self::DialogueProperties,
            900 => Self::Cleanup,
            1000 => Self::SequenceEnd,
            1009 => Self::WaitInput,
            other => Self::Other(other),
        }
    }
}

/// Description d'un cut au sein d'une séquence.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CutInfo {
    /// Identifiant du cut (ex. `"c0010"`, `"c0020"`).
    pub cut_id: String,
    /// Frame de début.
    pub start_frame: i32,
    /// Frame de fin.
    pub end_frame: i32,
    /// Type de transition (ex. `"NONE"`, `"CROSS_FADE"`).
    pub transition: String,
}

/// Déclaration d'un acteur apparaissant dans la séquence.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ActorSpawnInfo {
    /// Identifiant d'instance locale (ex. `"c11010011"`).
    pub instance_id: String,
    /// Identifiant de modèle de base (ex. `"c11010010"`).
    pub base_model_id: String,
}

/// Déclenchement d'une ligne de dialogue dans la séquence.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DialogueCue {
    /// Frame de déclenchement.
    pub frame: i32,
    /// Label canonique de la réplique (ex. `"ev01_00300_010_010"`).
    pub line_label: String,
    /// Acteur prononçant la réplique (ex. `"c11010011"`).
    pub speaker_actor: String,
}

/// Cue audio synchronisé (musique, bruitage ou voix).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AudioCue {
    /// Frame de déclenchement.
    pub frame: i32,
    /// Nom du cue audio (ex. `"ev01_00300_005_imaginary_ball"`).
    pub cue_name: String,
    /// Identifiant sonore ou piste (ex. `"Sound_138"`).
    pub sound_id: String,
    /// Volume relatif (1.0 = nominal).
    pub volume: f32,
    /// `true` s'il s'agit d'une commande de lecture.
    pub is_play: bool,
}

/// Commande individuelle au sein du flux d'événement.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct EventCommand {
    /// Index séquentiel de la commande (0 à N-1).
    pub index: usize,
    /// Frame temporelle de déclenchement (-1 si statique/système).
    pub frame: i32,
    /// Opcode (CRC-32 Level-5).
    pub opcode: u32,
    /// Catégorie de commande.
    pub category: EventCategory,
    /// Arguments bruts de la commande.
    pub args: Vec<Value>,
}

impl EventCommand {
    /// Interprète la commande comme une déclaration de Cut si applicable.
    #[must_use]
    pub fn as_cut(&self) -> Option<CutInfo> {
        if self.opcode == OPCODE_CUT || self.category == EventCategory::Cut {
            let cut_id = self.args.first().and_then(val_as_str)?;
            let start = self.args.get(1).map_or(0, val_as_int);
            let end = self.args.get(2).map_or(0, val_as_int);
            let transition = self
                .args
                .get(3)
                .and_then(val_as_str)
                .unwrap_or("NONE")
                .to_owned();
            return Some(CutInfo {
                cut_id: cut_id.to_owned(),
                start_frame: start,
                end_frame: end,
                transition,
            });
        }
        None
    }

    /// Interprète la commande comme un spawn d'acteur.
    #[must_use]
    pub fn as_actor(&self) -> Option<ActorSpawnInfo> {
        if self.opcode == OPCODE_ACTOR
            && self.category == EventCategory::AssetLoad
            && self.args.len() >= 2
        {
            let inst = self.args.first().and_then(val_as_str)?;
            let base = self.args.get(1).and_then(val_as_str)?;
            return Some(ActorSpawnInfo {
                instance_id: inst.to_owned(),
                base_model_id: base.to_owned(),
            });
        }
        None
    }

    /// Interprète la commande comme un déclencheur de réplique/dialogue.
    #[must_use]
    pub fn as_dialogue(&self) -> Option<DialogueCue> {
        if self.opcode == OPCODE_DIALOGUE || self.category == EventCategory::Dialogue {
            let mut label = None;
            let mut actor = None;
            for arg in &self.args {
                if let Some(s) = val_as_str(arg) {
                    if is_line_label(s) {
                        label = Some(s.to_owned());
                    } else if s.starts_with('c') && s.len() >= 5 {
                        actor = Some(s.to_owned());
                    }
                }
            }
            if let Some(lbl) = label {
                return Some(DialogueCue {
                    frame: self.frame,
                    line_label: lbl,
                    speaker_actor: actor.unwrap_or_default(),
                });
            }
        }
        None
    }

    /// Interprète la commande comme un cue audio.
    #[must_use]
    pub fn as_audio(&self) -> Option<AudioCue> {
        if self.opcode == OPCODE_AUDIO_PLAY || self.category == EventCategory::AudioPlay {
            let sound_id = self
                .args
                .first()
                .and_then(val_as_str)
                .unwrap_or("")
                .to_owned();
            let cue_name = self
                .args
                .get(2)
                .and_then(val_as_str)
                .unwrap_or("")
                .to_owned();
            let volume = self.args.get(3).map_or(1.0f32, val_as_float);
            return Some(AudioCue {
                frame: self.frame,
                cue_name,
                sound_id,
                volume,
                is_play: true,
            });
        }
        if self.opcode == OPCODE_AUDIO_REG || self.category == EventCategory::AudioRegister {
            let sound_id = self
                .args
                .first()
                .and_then(val_as_str)
                .unwrap_or("")
                .to_owned();
            let cue_name = self
                .args
                .get(2)
                .and_then(val_as_str)
                .unwrap_or("")
                .to_owned();
            return Some(AudioCue {
                frame: self.frame,
                cue_name,
                sound_id,
                volume: 1.0,
                is_play: false,
            });
        }
        None
    }

    /// Indique si la commande est une attente d'entrée utilisateur.
    #[must_use]
    pub fn is_wait_input(&self) -> bool {
        self.opcode == OPCODE_WAIT_INPUT || self.category == EventCategory::WaitInput
    }

    /// Indique si la commande marque la fin de la cinématique.
    #[must_use]
    pub fn is_end(&self) -> bool {
        self.opcode == OPCODE_END || self.category == EventCategory::SequenceEnd
    }
}

/// Document complet représentant un conteneur d'événement (`ev*.cfg.bin`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct EventScriptDocument {
    /// Nombre de commandes déclaré par l'en-tête (`EVENT_COMMAND_NUM_0`).
    pub header_command_count: usize,
    /// Liste ordonnée de toutes les commandes extraites.
    pub commands: Vec<EventCommand>,
}

impl EventScriptDocument {
    /// Nombre total de commandes parsées.
    #[must_use]
    pub fn len(&self) -> usize {
        self.commands.len()
    }

    /// `true` si le document ne contient aucune commande.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.commands.is_empty()
    }

    /// Durée totale de l'événement en frames (déterminée par la frame maximale).
    #[must_use]
    pub fn duration_frames(&self) -> i32 {
        self.commands.iter().map(|c| c.frame).max().unwrap_or(0)
    }

    /// Liste de tous les cuts définis dans l'événement.
    #[must_use]
    pub fn cuts(&self) -> Vec<CutInfo> {
        self.commands.iter().filter_map(EventCommand::as_cut).collect()
    }

    /// Liste de tous les acteurs spawnés dans l'événement.
    #[must_use]
    pub fn actors(&self) -> Vec<ActorSpawnInfo> {
        self.commands
            .iter()
            .filter_map(EventCommand::as_actor)
            .collect()
    }

    /// Liste de toutes les répliques de dialogue déclenchées.
    #[must_use]
    pub fn dialogues(&self) -> Vec<DialogueCue> {
        self.commands
            .iter()
            .filter_map(EventCommand::as_dialogue)
            .collect()
    }

    /// Liste de tous les événements sonores de la séquence.
    #[must_use]
    pub fn audio_cues(&self) -> Vec<AudioCue> {
        self.commands
            .iter()
            .filter_map(EventCommand::as_audio)
            .collect()
    }
}

// ── Points d'entrée de parsing ────────────────────────────────────────────────

/// Décode un conteneur d'événement binaire `.cfg.bin` (T2B).
///
/// # Erreurs
///
/// Retourne [`FormatError`] si les octets sont invalides ou ne correspondent pas à T2B.
pub fn parse(data: &[u8]) -> Result<EventScriptDocument, FormatError> {
    let file = cfgbin_parse(data)?;
    if file.format != Format::T2b {
        return Err(FormatError::Corrupt("event_script : format attendu T2B"));
    }
    parse_entries(&file.entries)
}

/// Construit un [`EventScriptDocument`] à partir d'une liste de [`CfgEntry`].
///
/// Gère la forme double (`EVENT_COMMAND_HEADER_i` + `EVENT_COMMAND_ARGS_i`) ainsi
/// que la forme compacte (`EVENT_COMMAND_i`).
///
/// # Erreurs
///
/// Retourne [`FormatError::Corrupt`] si la structure est anormale.
pub fn parse_entries(entries: &[CfgEntry]) -> Result<EventScriptDocument, FormatError> {
    let mut header_command_count = 0usize;
    let mut commands = Vec::new();

    let mut pending_headers: alloc::collections::BTreeMap<usize, (i32, u32, i32)> =
        alloc::collections::BTreeMap::new();
    let mut pending_args: alloc::collections::BTreeMap<usize, Vec<Value>> =
        alloc::collections::BTreeMap::new();

    for entry in entries {
        let name = entry.name.as_str();

        if name.starts_with("EVENT_COMMAND_NUM") {
            if let Some(v) = entry.variables.first() {
                header_command_count = val_as_int(v).max(0) as usize;
            }
        } else if let Some(idx) = name
            .strip_prefix("EVENT_COMMAND_HEADER_")
            .and_then(|s| s.parse::<usize>().ok())
        {
            let frame = entry.variables.first().map_or(-1, val_as_int);
            let opcode = entry.variables.get(1).map_or(0u32, val_as_uint);
            let cat = entry.variables.get(2).map_or(0, val_as_int);
            pending_headers.insert(idx, (frame, opcode, cat));
        } else if let Some(idx) = name
            .strip_prefix("EVENT_COMMAND_ARGS_")
            .and_then(|s| s.parse::<usize>().ok())
        {
            pending_args.insert(idx, entry.variables.clone());
        } else if let Some(idx) = name
            .strip_prefix("EVENT_COMMAND_")
            .and_then(|s| s.parse::<usize>().ok())
        {
            let frame = entry.variables.first().map_or(-1, val_as_int);
            let opcode = entry.variables.get(1).map_or(0u32, val_as_uint);
            let args = if entry.variables.len() > 2 {
                entry.variables[2..].to_vec()
            } else {
                Vec::new()
            };
            commands.push(EventCommand {
                index: idx,
                frame,
                opcode,
                category: EventCategory::from(0),
                args,
            });
        }
    }

    if !pending_headers.is_empty() {
        for (idx, (frame, opcode, cat)) in pending_headers {
            let args = pending_args.remove(&idx).unwrap_or_default();
            commands.push(EventCommand {
                index: idx,
                frame,
                opcode,
                category: EventCategory::from(cat),
                args,
            });
        }
    }

    commands.sort_by_key(|c| c.index);

    if header_command_count == 0 {
        header_command_count = commands.len();
    }

    Ok(EventScriptDocument {
        header_command_count,
        commands,
    })
}

/// Décode un conteneur d'événement sérialisé au format JSON (`.cfg.bin.json`).
///
/// # Erreurs
///
/// Retourne [`FormatError::Corrupt`] si le format JSON ne décrit pas des entrées CfgBin.
pub fn parse_json(json: &serde_json::Value) -> Result<EventScriptDocument, FormatError> {
    let entries = json_to_cfg_entries(json)?;
    parse_entries(&entries)
}

// ── Helpers internes ──────────────────────────────────────────────────────────

fn val_as_int(v: &Value) -> i32 {
    match v {
        Value::Int(i) => *i,
        Value::Float(f) => *f as i32,
        Value::String(_) => 0,
    }
}

fn val_as_uint(v: &Value) -> u32 {
    match v {
        Value::Int(i) => *i as u32,
        Value::Float(f) => f.to_bits(),
        Value::String(_) => 0u32,
    }
}

fn val_as_float(v: &Value) -> f32 {
    match v {
        Value::Float(f) => *f,
        Value::Int(i) => f32::from_bits(*i as u32),
        Value::String(_) => 0.0,
    }
}

fn val_as_str(v: &Value) -> Option<&str> {
    match v {
        Value::String(s) => Some(s.as_str()),
        Value::Int(_) | Value::Float(_) => None,
    }
}

fn is_line_label(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() < 8 {
        return false;
    }
    let suffix = &bytes[bytes.len() - 8..];
    suffix[0] == b'_'
        && suffix[4] == b'_'
        && suffix[1..4].iter().all(u8::is_ascii_digit)
        && suffix[5..8].iter().all(u8::is_ascii_digit)
}

fn json_to_cfg_entries(val: &serde_json::Value) -> Result<Vec<CfgEntry>, FormatError> {
    let arr = if let Some(entries) = val.get("entries").and_then(|e| e.as_array()) {
        entries
    } else if let Some(root_arr) = val.as_array() {
        root_arr
    } else {
        return Err(FormatError::Corrupt(
            "json_to_cfg_entries : champ 'entries' absent ou non-tableau",
        ));
    };

    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let name = item
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string();
        let mut variables = Vec::new();
        if let Some(vars) = item.get("variables").and_then(|v| v.as_array()) {
            for v in vars {
                let vtype = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let vval = v.get("value");
                match vtype {
                    "String" => {
                        let s = vval.and_then(|x| x.as_str()).unwrap_or("").to_string();
                        variables.push(Value::String(s));
                    }
                    "Int" => {
                        let n = vval
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse::<i32>().ok())
                            .or_else(|| vval.and_then(|x| x.as_i64()).map(|n| n as i32))
                            .unwrap_or(0);
                        variables.push(Value::Int(n));
                    }
                    "Float" => {
                        let f = vval
                            .and_then(|x| x.as_str())
                            .and_then(|s| s.parse::<f32>().ok())
                            .or_else(|| vval.and_then(|x| x.as_f64()).map(|f| f as f32))
                            .unwrap_or(0.0);
                        variables.push(Value::Float(f));
                    }
                    _ => {
                        if let Some(s) = vval.and_then(|x| x.as_str()) {
                            if let Ok(i) = s.parse::<i32>() {
                                variables.push(Value::Int(i));
                            } else if let Ok(f) = s.parse::<f32>() {
                                variables.push(Value::Float(f));
                            } else {
                                variables.push(Value::String(s.to_string()));
                            }
                        }
                    }
                }
            }
        }
        let children = if let Some(child_val) = item.get("children") {
            json_to_cfg_entries(child_val).unwrap_or_default()
        } else {
            Vec::new()
        };
        out.push(CfgEntry {
            name,
            variables,
            children,
        });
    }

    Ok(out)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Résout un chemin relatif depuis la racine du workspace.
    ///
    /// Les tests s'exécutent avec le dossier du crate comme répertoire courant,
    /// si bien qu'un chemin relatif nu comme `data/common/...` ne résolvait
    /// jamais : les tests concernés sautaient et rapportaient `ok` à vide.
    fn workspace_path(relative: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join(relative)
    }

    #[test]
    fn test_parse_real_event_json() {
        let path = workspace_path("data/common/event_cfg/evt/ev01_00300.cfg.bin.json");
        if !path.exists() {
            eprintln!("skip test_parse_real_event_json : fichier {} absent", path.display());
            return;
        }
        let content = std::fs::read_to_string(path).expect("lecture ev01_00300.cfg.bin.json");
        let json: serde_json::Value = serde_json::from_str(&content).expect("JSON valide");
        let doc = parse_json(&json).expect("parse_json réussi");

        assert_eq!(doc.header_command_count, 100);
        assert_eq!(doc.len(), 100);
        assert_eq!(doc.duration_frames(), 505);

        // Cuts
        let cuts = doc.cuts();
        assert_eq!(cuts.len(), 2);
        assert_eq!(cuts[0].cut_id, "c0010");
        assert_eq!(cuts[0].start_frame, 0);
        assert_eq!(cuts[0].end_frame, 222);
        assert_eq!(cuts[1].cut_id, "c0020");
        assert_eq!(cuts[1].start_frame, 222);
        assert_eq!(cuts[1].end_frame, 505);

        // Acteurs
        let actors = doc.actors();
        assert!(!actors.is_empty());
        assert_eq!(actors[0].instance_id, "c11010011");
        assert_eq!(actors[0].base_model_id, "c11010010");

        // Dialogues
        let dialogues = doc.dialogues();
        assert_eq!(dialogues.len(), 2);
        assert_eq!(dialogues[0].line_label, "ev01_00300_010_010");
        assert_eq!(dialogues[0].frame, 283);
        assert_eq!(dialogues[0].speaker_actor, "c11010011");
        assert_eq!(dialogues[1].line_label, "ev01_00300_010_020");
        assert_eq!(dialogues[1].frame, 440);
        assert_eq!(dialogues[1].speaker_actor, "c11010011");

        // End et wait input
        assert!(doc.commands.iter().any(|c| c.is_wait_input()));
        assert!(doc.commands.iter().any(|c| c.is_end()));
    }

    #[test]
    fn test_parse_real_sound_event_json() {
        let path = workspace_path("data/common/event_cfg/snd/ev01_00300_snd.cfg.bin.json");
        if !path.exists() {
            eprintln!("skip test_parse_real_sound_event_json : fichier absent");
            return;
        }
        let content = std::fs::read_to_string(path).expect("lecture snd");
        let json: serde_json::Value = serde_json::from_str(&content).expect("JSON valide");
        let doc = parse_json(&json).expect("parse_json");

        assert_eq!(doc.len(), 4);
        let audios = doc.audio_cues();
        assert_eq!(audios.len(), 4);
        assert_eq!(audios[0].sound_id, "Sound_138");
        assert!(!audios[0].is_play);
        assert_eq!(audios[1].sound_id, "Sound_138");
        assert_eq!(audios[1].frame, 5);
        assert!(audios[1].is_play);
    }

    #[test]
    fn test_parse_compact_command_json() {
        let path = workspace_path("data/common/event_cfg/other/select_sys_win.cfg.bin.json");
        if !path.exists() {
            eprintln!("skip test_parse_compact_command_json : fichier absent");
            return;
        }
        let content = std::fs::read_to_string(path).expect("lecture other");
        let json: serde_json::Value = serde_json::from_str(&content).expect("JSON");
        let doc = parse_json(&json).expect("parse_json");

        assert_eq!(doc.len(), 1);
        assert_eq!(doc.commands[0].frame, -1);
        assert_eq!(
            val_as_str(&doc.commands[0].args[0]),
            Some("RunSystemMessageSelectEvent")
        );
    }

    #[test]
    fn test_oc_event_washa_map_json() {
        // fixture suivie par git : son absence est une régression, pas un saut.
        let path = workspace_path("data/oc/astro-lor/game/text/event/ev98_99010_map.cfg.bin.json");
        assert!(path.exists(), "fixture suivie absente : {}", path.display());
        let content = std::fs::read_to_string(path).expect("lecture ev98_99010_map.cfg.bin.json");
        let json: serde_json::Value = serde_json::from_str(&content).expect("JSON valide");
        let entries = json_to_cfg_entries(&json).expect("entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "TEXT_WASHA_MAP_BEGIN_0");
        assert_eq!(entries[0].children.len(), 15);
        assert_eq!(
            val_as_str(&entries[0].children[0].variables[15]),
            Some("ev98_99010_010_010")
        );
        assert_eq!(
            val_as_str(&entries[0].children[14].variables[15]),
            Some("ev98_99010_030_060")
        );
    }

    #[test]
    fn test_oc_event_washa_map_binary() {
        let path = workspace_path("var/ocgen/text/event/ev98_99010_map.cfg.bin");
        if !path.exists() {
            eprintln!("skip test_oc_event_washa_map_binary : fichier binaire absent");
            return;
        }
        let bytes = std::fs::read(path).expect("lecture binaire ev98_99010_map.cfg.bin");
        let cfg = cfgbin_parse(&bytes).expect("cfgbin_parse réussi sur binaire OC");
        assert_eq!(cfg.format, Format::T2b);
        assert_eq!(cfg.entries.len(), 1);
        // Le suffixe d'index `_<i>` est ajouté par la sérialisation iecode/JSON
        // (`t2b_siblings_to_iecode_json`) ; le binaire porte le nom nu.
        assert_eq!(cfg.entries[0].name, "TEXT_WASHA_MAP_BEGIN");
        assert_eq!(cfg.entries[0].children.len(), 15);
        assert_eq!(
            val_as_str(&cfg.entries[0].children[0].variables[15]),
            Some("ev98_99010_010_010")
        );
    }
}
