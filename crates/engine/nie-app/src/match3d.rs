//! Rendu **3D** d'un match : le terrain en perspective, et les vingt-deux joueurs représentés par
//! un vrai modèle du jeu plutôt que par des disques.
//!
//! Le rastériseur top-down de `nie_runtime::render` reste la vue de référence — déterministe,
//! sans assets, c'est lui que testent les goldens. Celle-ci lui ajoute ce qu'il ne peut pas
//! donner : la profondeur et les vrais maillages, chargés du VFS.
//!
//! **Un seul modèle est téléversé**, instancié vingt-deux fois. Charger un maillage par joueur
//! coûterait vingt-deux décodages BC7 et autant de mégaoctets, pour des personnages que la caméra
//! voit de loin.

use anyhow::{Context, Result};
use nie_formats::vfs::Vfs;
use nie_render3d::glb::Model;
use nie_render3d::scene::{self, Camera, Instance, Tri};
use nie_runtime::{HALF_LEN, HALF_WID, Role, World};

use crate::render::{H, W};

/// Assets d'un personnage tel que le VFS les range : quatre fichiers de même radical.
fn lire_personnage(vfs: &Vfs, dossier: &str, code: &str) -> Result<Model> {
    let md = vfs
        .read(&format!("{dossier}/{code}.g4md"))
        .map_err(|e| anyhow::anyhow!("{code}.g4md : {e:?}"))?;
    let mg = vfs
        .read(&format!("{dossier}/{code}.g4mg"))
        .map_err(|e| anyhow::anyhow!("{code}.g4mg : {e:?}"))?;
    let sk = vfs
        .read(&format!("{dossier}/{code}.g4sk"))
        .map_err(|e| anyhow::anyhow!("{code}.g4sk : {e:?}"))?;
    // La texture vit sous la racine de plateforme, pas sous `common/`.
    let tex_path = dossier.replacen("data/common/", "data/dx11/", 1);
    let tex = vfs
        .read(&format!("{tex_path}/{code}.g4tx"))
        .map_err(|e| anyhow::anyhow!("{code}.g4tx : {e:?}"))?;
    crate::character::build_skinned_model(&md, &mg, &sk, &tex)
}

/// Charge un modèle utilisable pour représenter un joueur.
///
/// **Ce n'est pas un joueur entier, et c'est une limite du dépôt, pas un choix.** Les seuls
/// modèles du VFS qui portent les quatre fichiers nécessaires (`g4md` + `g4mg` + `g4sk` + `g4tx`)
/// sont sous `chr/_face/` : ce sont des TÊTES. Un personnage complet s'assemble à partir de sa
/// tête et de son uniforme, ce que fait `nie-model-serve` — mais seulement avec le manifeste
/// `var/uniform-model-map.ndjson`, que `niers uniform-map` doit générer et qui est absent ici.
/// Tant qu'il manque, le match affiche des têtes, et il vaut mieux le dire que le laisser
/// découvrir à l'écran.
///
/// Cherche donc le premier modèle qui passe de bout en bout, plutôt qu'un code en dur qu'une
/// mise à jour du jeu pourrait retirer.
///
/// # Errors
///
/// Rend une erreur si aucun personnage complet n'est trouvé dans les `essais` premiers candidats.
pub fn charger_modele_joueur(vfs: &Vfs, essais: usize) -> Result<Model> {
    // On part des SQUELETTES, pas des maillages : le jeu compte des milliers de `.g4md` (têtes,
    // armures, uniformes) pour seulement quelques dizaines de `.g4sk`, et sans squelette il n'y a
    // pas de pose à rendre. Chercher dans l'autre sens fait échouer des centaines de candidats
    // avant d'en trouver un bon.
    let mut dossiers: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p)
        .filter(|p| p.starts_with("data/common/chr/") && p.ends_with(".g4sk"))
        .filter_map(|p| p.rsplit_once('/').map(|(d, _)| d.to_string()))
        // Un JOUEUR, pas n'importe quel modèle squeletté : les dossiers `_animal`, `_armd`,
        // `_keshin` en portent aussi, et un tri alphabétique les place avant (« _ » précède
        // « c »). Le premier modèle rendu sur le terrain était un quadrupède.
        .filter(|d| {
            d.rsplit('/')
                .next()
                .is_some_and(|n| n.starts_with('c') && n[1..].chars().all(|c| c.is_ascii_digit()))
        })
        .collect();
    // Ordre stable : le même joueur d'une exécution à l'autre.
    dossiers.sort_unstable();
    dossiers.dedup();

    let mut derniere = None;
    for dossier in dossiers.iter().take(essais) {
        let Some(code) = dossier.rsplit('/').next() else { continue };
        match lire_personnage(vfs, dossier, code) {
            Ok(m) if !m.primitives.is_empty() => return Ok(m),
            Ok(_) => {}
            Err(e) => derniere = Some(e),
        }
    }
    Err(derniere.unwrap_or_else(|| anyhow::anyhow!("aucun personnage complet dans le VFS")))
        .context("chargement d'un modèle de joueur")
}

/// Pelouse : un quad vert aux dimensions réelles du terrain, plus ses bandes de tonte.
fn pelouse() -> Vec<Tri> {
    let mut t = Vec::new();
    const BANDES: i32 = 12;
    for i in 0..BANDES {
        let x0 = -HALF_LEN + 2.0 * HALF_LEN * (i as f32 / BANDES as f32);
        let x1 = -HALF_LEN + 2.0 * HALF_LEN * ((i + 1) as f32 / BANDES as f32);
        let c = if i % 2 == 0 { [34, 139, 53] } else { [40, 150, 58] };
        let (y0, y1) = (-HALF_WID, HALF_WID);
        t.push(Tri { p: [[x0, 0.0, y0], [x1, 0.0, y0], [x1, 0.0, y1]], color: c });
        t.push(Tri { p: [[x0, 0.0, y0], [x1, 0.0, y1], [x0, 0.0, y1]], color: c });
    }
    // Ligne médiane et lignes de but, posées juste au-dessus du sol pour ne pas z-fighter.
    let blanc = [235, 240, 235];
    let mut bande = |x: f32, demi: f32| {
        t.push(Tri {
            p: [[x - demi, 0.02, -HALF_WID], [x + demi, 0.02, -HALF_WID], [x + demi, 0.02, HALF_WID]],
            color: blanc,
        });
        t.push(Tri {
            p: [[x - demi, 0.02, -HALF_WID], [x + demi, 0.02, HALF_WID], [x - demi, 0.02, HALF_WID]],
            color: blanc,
        });
    };
    bande(0.0, 0.15);
    bande(-HALF_LEN, 0.15);
    bande(HALF_LEN, 0.15);
    t
}

/// Le ballon, en cube (le moteur n'a pas de sphère et il est vu de loin).
fn ballon(p: [f32; 3], r: f32) -> Vec<Tri> {
    let c = [250, 250, 250];
    let (x, y, z) = (p[0], p[1].max(r), p[2]);
    // Deux quads croisés : lisible sous tous les angles pour un coût dérisoire.
    vec![
        Tri { p: [[x - r, y - r, z], [x + r, y - r, z], [x + r, y + r, z]], color: c },
        Tri { p: [[x - r, y - r, z], [x + r, y + r, z], [x - r, y + r, z]], color: c },
        Tri { p: [[x, y - r, z - r], [x, y - r, z + r], [x, y + r, z + r]], color: c },
        Tri { p: [[x, y - r, z - r], [x, y + r, z + r], [x, y + r, z - r]], color: c },
    ]
}

/// Caméra de match : vue de télévision, sur le côté du terrain, suivant le ballon.
///
/// **En dehors** de la surface de jeu, et haute. Placée au milieu du terrain près du ballon —
/// ce que j'avais fait d'abord — elle a des joueurs qui lui passent devant l'objectif : ils
/// remplissent alors l'écran, et on ne voit plus le jeu. Une caméra de retransmission se tient
/// à l'écart pour cette raison exacte.
fn camera(world: &World) -> Camera {
    let b = world.ball.pos;
    // Le suivi est amorti sur la longueur du terrain : la caméra accompagne le jeu sans le
    // devancer, et ne sort jamais des limites.
    let cx = b.x.clamp(-HALF_LEN * 0.6, HALF_LEN * 0.6);
    Camera {
        eye: [cx, 26.0, -(HALF_WID + 26.0)],
        target: [cx, 0.0, 0.0],
        up: [0.0, 1.0, 0.0],
        fov_y: 0.9,
    }
}

/// Rend le match en 3D : pelouse, ballon, et un modèle par joueur.
///
/// `modele` est le maillage partagé par les vingt-deux instances (cf. [`charger_modele_joueur`]).
#[must_use]
pub fn rendre(world: &World, modele: &Model) -> Vec<u8> {
    let mut plats = pelouse();
    plats.extend(ballon([world.ball.pos.x, world.ball.pos.z, world.ball.pos.y], 0.35));

    // Le modèle est à l'échelle du jeu, pas à celle du terrain : on le ramène à ~1,7 m.
    let hauteur = hauteur_modele(modele).max(1e-3);
    let echelle = 1.7 / hauteur;

    let instances: Vec<Instance> = world
        .players
        .iter()
        .map(|p| {
            // Le joueur regarde le but qu'il attaque ; le gardien, le terrain.
            let angle = if p.role == Role::Goalkeeper {
                if p.team == 0 { 0.0 } else { core::f32::consts::PI }
            } else if p.team == 0 {
                0.0
            } else {
                core::f32::consts::PI
            };
            let t = scene::mat_mul(
                &scene::mat_translate([p.pos.x, 0.0, p.pos.y]),
                &scene::mat_mul(&scene::mat_rot_y(angle), &scene::mat_scale(echelle)),
            );
            Instance { model: modele, transform: t, two_sided: false }
        })
        .collect();

    scene::render_scene(
        &plats,
        &instances,
        &camera(world),
        W as u32,
        H as u32,
        [120, 150, 210],
        [58, 86, 140],
    )
}

/// Hauteur (axe Y) de la boîte englobante du modèle.
fn hauteur_modele(m: &Model) -> f32 {
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for p in &m.primitives {
        for v in &p.positions {
            lo = lo.min(v[1]);
            hi = hi.max(v[1]);
        }
    }
    if lo > hi { 0.0 } else { hi - lo }
}
