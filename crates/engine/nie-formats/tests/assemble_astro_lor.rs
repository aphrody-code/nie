//! Intégration et validation de l'assemblage 3D GLB pour Astro Lor (c99019010 & c99019020).
//!
//! Assemble les primitives de la tête d'Astro Lor (issues des descripteurs G4MD et maillages G4MG
//! calqués sur Byron Love c01001900) avec le corps avatar `u000105` (stature tall / normal) et le
//! squelette d'édition, puis exporte le modèle complet en binaire glTF (GLB 2.0).

use std::path::{Path, PathBuf};
use nie_formats::assemble::{
    assemble_avatar_model, bone_rest_world, AvatarPiece, MeshComponent,
};
use nie_formats::vfs::Vfs;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}


fn game_data_dir() -> PathBuf {
    nie_formats::vfs::resolve_game_dir().join("data")
}

#[test]
fn assemble_et_export_glb_astro_lor() {
    let data_dir = game_data_dir();
    let mut vfs = Vfs::new();
    if vfs.init(&data_dir).is_err() {
        eprintln!("SKIP : VFS non disponible sur cette machine");
        return;
    }

    let root = repo_root();
    let ocgen_dir = root.join("var").join("ocgen");
    if ocgen_dir.is_dir() {
        let n_mounted = vfs.mount_ocgen_artifacts(&ocgen_dir);
        eprintln!("VFS : {n_mounted} artefacts ocgen montés avec succès");
    }


    // Squelette avatar tall/normal (c000301_edit.g4sk)
    let skel_candidates = [
        "data/common/chr/_face/20_EDIT/_bodySK/c000301_edit/c000301_edit.g4sk",
        "data/common/chr/_face/20_EDIT/_bodySK/c000101_edit/c000101_edit.g4sk",
        "data/common/chr/_face/20_EDIT/_bodySK/c000201_edit/c000201_edit.g4sk",
        "data/common/chr/_face/20_EDIT/_bodySK/c000401_edit/c000401_edit.g4sk",
    ];
    let mut skel_bytes = None;
    for skel_path in skel_candidates {
        if let Ok(b) = vfs.read(skel_path) {
            eprintln!("Squelette trouvé : {skel_path} ({} octets)", b.len());
            skel_bytes = Some(b);
            break;
        }
    }

    let attach_matrix = skel_bytes.as_ref().and_then(|bytes| {
        bone_rest_world(bytes, "c_head_1_0")
    });

    if attach_matrix.is_some() {
        eprintln!("Matrice d'attache 'c_head_1_0' résolue avec succès");
    } else {
        eprintln!("Avertissement : matrice d'attache 'c_head_1_0' non résolue, repli vers identité");
    }

    // Corps avatar tall / normal (u000105) sous u000101
    let body_candidates = [
        "data/common/chr/_uniform/u000101/u000105",
        "data/common/chr/_uniform/u000101/u000101",
    ];
    let mut body_parts = None;
    for body_base in body_candidates {
        let md_path = format!("{body_base}.g4md");
        let mg_path = format!("{body_base}.g4mg");
        if let (Ok(md), Ok(mg)) = (vfs.read(&md_path), vfs.read(&mg_path)) {
            eprintln!("Corps avatar trouvé : {body_base} (md={}, mg={})", md.len(), mg.len());
            body_parts = Some((md, mg));
            break;
        }
    }

    // Chaussures avatar (s000201)
    let shoes_base = "data/common/chr/_uniform/s000201/s000201";
    let shoes_parts = match (vfs.read(&format!("{shoes_base}.g4md")), vfs.read(&format!("{shoes_base}.g4mg"))) {
        (Ok(md), Ok(mg)) => {
            eprintln!("Chaussures avatar trouvées : {shoes_base} (md={}, mg={})", md.len(), mg.len());
            Some((md, mg))
        }
        _ => None,
    };


    // Paires de test : (code, group, vfs_md, vfs_mg)
    let variants = [
        (
            "c99019010",
            "01_IE1",
            "data/common/chr/_face/01_IE1/c99019010/c99019010.g4md",
            "data/common/chr/_face/01_IE1/c99019010/c99019010.g4mg",
        ),
        (
            "c99019020",
            "11_VICTORY",
            "data/common/chr/_face/11_VICTORY/c99019020/c99019020.g4md",
            "data/common/chr/_face/11_VICTORY/c99019020/c99019020.g4mg",
        ),
    ];

    for (code, group, md_vfs_path, mg_vfs_path) in variants {
        let (head_md, head_mg) = match (vfs.read(md_vfs_path), vfs.read(mg_vfs_path)) {
            (Ok(md), Ok(mg)) => (md, mg),
            _ => {
                // Repli direct sur disque si non présent dans le VFS loose
                let disk_md = root.join("var").join("ocgen").join("chr").join(group).join(code).join(format!("{code}.g4md"));
                let disk_mg = root.join("var").join("ocgen").join("chr").join(group).join(code).join(format!("{code}.g4mg"));
                let Ok(md) = std::fs::read(&disk_md) else {
                    eprintln!("SKIP : Fichier introuvable {}", disk_md.display());
                    continue;
                };
                let Ok(mg) = std::fs::read(&disk_mg) else {
                    eprintln!("SKIP : Fichier introuvable {}", disk_mg.display());
                    continue;
                };
                (md, mg)
            }
        };

        let mut pieces = Vec::new();

        // 1. Tête avec transformation d'attache au squelette
        pieces.push(AvatarPiece {
            component: MeshComponent::Face,
            g4md: head_md,
            g4mg: head_mg,
            attach: attach_matrix,
        });

        // 2. Corps (si disponible)
        if let Some((body_md, body_mg)) = &body_parts {
            pieces.push(AvatarPiece {
                component: MeshComponent::Uniform,
                g4md: body_md.clone(),
                g4mg: body_mg.clone(),
                attach: None,
            });
        }

        // 3. Chaussures (si disponibles)
        if let Some((shoes_md, shoes_mg)) = &shoes_parts {
            pieces.push(AvatarPiece {
                component: MeshComponent::Uniform,
                g4md: shoes_md.clone(),
                g4mg: shoes_mg.clone(),
                attach: None,
            });
        }

        let model = assemble_avatar_model(code, &pieces)
            .unwrap_or_else(|e| panic!("Échec de l'assemblage avatar pour {code} : {e:?}"));

        let total_verts = model.total_vertex_count();
        let total_tris = model.total_triangle_count();
        assert!(total_verts > 0, "Le modèle assemblé {code} doit contenir des sommets");
        assert!(total_tris > 0, "Le modèle assemblé {code} doit contenir des triangles");

        let glb = model.to_glb();
        assert!(glb.len() > 12, "Le GLB généré pour {code} ne doit pas être vide");

        // Validation du magic glTF (0x46546C67 = "glTF" en little-endian)
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67, "En-tête GLB invalide pour {code}");

        // Sauvegarde des GLB
        // 1. data/oc/astro-lor/<code_internal>.glb
        let oc_target_dir = root.join("data").join("oc").join("astro-lor");
        let oc_glb_path = oc_target_dir.join(format!("{code}.glb"));
        std::fs::write(&oc_glb_path, &glb)
            .unwrap_or_else(|e| panic!("Impossible d'écrire {}: {e}", oc_glb_path.display()));

        // 2. var/ocgen/chr/<group>/<code_internal>/<code_internal>.glb
        let var_target_dir = root.join("var").join("ocgen").join("chr").join(group).join(code);
        let var_glb_path = var_target_dir.join(format!("{code}.glb"));
        std::fs::write(&var_glb_path, &glb)
            .unwrap_or_else(|e| panic!("Impossible d'écrire {}: {e}", var_glb_path.display()));


        eprintln!(
            "SUCCÈS : Modèle 3D GLB assemblé pour {code} ({group}) -> {} sommets, {} triangles, {} octets écris dans {} et {}",
            total_verts,
            total_tris,
            glb.len(),
            oc_glb_path.display(),
            var_glb_path.display()
        );
    }
}
