//! L'effectif réel du jeu, chargé depuis le VFS pour l'écran « Composition d'équipe ».
//!
//! Jusqu'ici cet onglet affichait « Mode en cours d'intégration » alors que les données étaient
//! là et déjà parsées par `nie-data` : personnages (`chara_base`), leurs paramètres de match
//! (`chara_param`) et leurs noms localisés (`chara_text`). Ce module fait la jointure et rend une
//! liste affichable — c'est le premier onglet du menu principal à montrer du vrai contenu.
//!
//! Tout part du VFS, pas de fichiers pré-générés : les `cfg.bin` sont décodés en mémoire
//! (`cfgbin::to_iecode_json`), donc l'écran fonctionne sur une installation comme sur un dump.

use anyhow::{Context, Result};
use nie_data::chara_base::{self, CharaBase};
use nie_data::chara_param::{self, CharaParam};
use nie_data::chara_text;
use nie_formats::vfs::Vfs;

/// Un joueur tel que l'écran d'effectif l'affiche.
#[derive(Debug, Clone)]
pub struct Joueur {
    /// Nom affichable — « Prénom Nom » quand les deux sont résolus, sinon le code interne.
    pub nom: String,
    /// Code interne (`c01000010`), qui reste la seule identité stable.
    pub code: String,
    /// Poste principal, en toutes lettres.
    pub poste: &'static str,
    /// Élément, en toutes lettres.
    pub element: &'static str,
}

impl Joueur {
    /// Ligne d'affichage : `Nom — Poste · Élément`.
    #[must_use]
    pub fn ligne(&self) -> String {
        format!("{} — {} · {}", self.nom, self.poste, self.element)
    }
}

/// Poste principal en clair. Valeurs relevées dans `chara_param` (`mainPosition`).
fn poste(v: i64) -> &'static str {
    match v {
        1 => "Gardien",
        2 => "Attaquant",
        3 => "Milieu",
        4 => "Défenseur",
        _ => "Poste inconnu",
    }
}

/// Élément en clair. Valeurs relevées dans `chara_param` (`element`).
fn element(v: i64) -> &'static str {
    match v {
        1 => "Vent",
        2 => "Forêt",
        3 => "Feu",
        4 => "Montagne",
        _ => "Sans élément",
    }
}

/// Lit un `cfg.bin` du VFS et le rend sous la forme JSON qu'attend `nie-data`.
fn charger_json(vfs: &Vfs, chemin: &str) -> Result<serde_json::Value> {
    let octets = vfs.read(chemin).map_err(|e| anyhow::anyhow!("{chemin} : {e:?}"))?;
    nie_formats::cfgbin::to_iecode_json(&octets)
        .with_context(|| format!("décodage de {chemin}"))
}

/// Trouve le premier fichier du VFS sous `prefixe` dont le nom commence par `radical`.
///
/// Les tables du jeu portent leur version dans leur nom (`chara_param_1.03.66.00.cfg.bin`) :
/// la coder en dur rendrait l'écran vide à la première mise à jour du jeu.
fn resoudre(vfs: &Vfs, prefixe: &str, radical: &str) -> Option<String> {
    let mut candidats: Vec<&str> = vfs
        .iter()
        .map(|(p, _)| p)
        .filter(|p| {
            p.starts_with(prefixe)
                && p.ends_with(".cfg.bin")
                && p.rsplit('/').next().is_some_and(|n| n.starts_with(radical))
        })
        .collect();
    // Ordre stable : deux exécutions doivent choisir le même fichier.
    candidats.sort_unstable();
    candidats.first().map(|s| (*s).to_string())
}

/// Charge les `max` premiers personnages jouables, noms résolus.
///
/// # Errors
///
/// Rend une erreur si les tables sont absentes du VFS ou illisibles. L'appelant décide quoi
/// afficher : un écran d'effectif vide vaut mieux qu'un plantage, mais il doit dire pourquoi.
pub fn charger(vfs: &Vfs, max: usize, langue: &str) -> Result<Vec<Joueur>> {
    const DOSSIER: &str = "data/common/gamedata/character/";
    let p_param = resoudre(vfs, DOSSIER, "chara_param")
        .context("aucun chara_param dans le VFS")?;
    let p_base = resoudre(vfs, DOSSIER, "chara_base")
        .context("aucun chara_base dans le VFS")?;
    let p_text = format!("data/common/text/{langue}/chara_text.cfg.bin");

    let params: Vec<CharaParam> = chara_param::parse_all_chara_params(&charger_json(vfs, &p_param)?);
    let bases: Vec<CharaBase> = chara_base::parse_all_chara_base(&charger_json(vfs, &p_base)?);
    // Les noms sont facultatifs : sans eux on affiche les codes internes plutôt que rien.
    let noms = charger_json(vfs, &p_text)
        .map(|v| chara_text::parse_all_nouns(&v))
        .unwrap_or_default();

    let mut out = Vec::with_capacity(max);
    for p in &params {
        let Some(base) = chara_base::find_by_chara_id(&bases, p.chara_base_id) else {
            continue; // paramètre orphelin : rien à nommer, on l'écarte plutôt que d'inventer.
        };
        let prenom = chara_base::resolve_first_name(base, &noms);
        let nom_famille = chara_base::resolve_last_name(base, &noms);
        let nom = match (prenom, nom_famille) {
            // Certains personnages n'ont pas de nom de famille : le champ répète alors le prénom,
            // et une concaténation naïve affiche « Destin Destin » ou « Raika Raika ». Constaté
            // sur six des vingt premiers personnages du jeu.
            (Some(p), Some(n)) if p.eq_ignore_ascii_case(n) => p.to_string(),
            (Some(p), Some(n)) => format!("{p} {n}"),
            (Some(p), None) => p.to_string(),
            (None, Some(n)) => n.to_string(),
            (None, None) => base.internal_code.clone(),
        };
        out.push(Joueur {
            nom,
            code: base.internal_code.clone(),
            poste: poste(p.main_position),
            element: element(p.element),
        });
        if out.len() >= max {
            break;
        }
    }
    anyhow::ensure!(!out.is_empty(), "aucun personnage jointable entre chara_param et chara_base");
    Ok(out)
}
