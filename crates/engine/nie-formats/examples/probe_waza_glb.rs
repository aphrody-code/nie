//! Sonde : assembler un modèle `chr/_waza/` en GLB, G4MD pris DANS son `.g4pkm`.
use nie_formats::assemble::{GenericModelInput, MeshComponent, assemble_generic_model};
use nie_formats::g4pkm;

fn main() {
    let mut argv = std::env::args().skip(1);
    let base = argv
        .next()
        .expect("usage: probe_waza_glb <prefixe-sans-extension>");
    let code = std::path::Path::new(&base)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("modele")
        .to_string();
    let g4mg = std::fs::read(format!("{base}.g4mg")).expect("lecture g4mg");
    // Précédence mesurée (et déjà appliquée par nie-model-serve) : le G4MD EMBARQUÉ dans le
    // .g4pkm est canonique quand il existe — un G4MD libre voisin peut décrire un autre LOD, dont
    // les offsets sortent du G4MG compagnon. Le fichier libre n'est le repli que sans paquet.
    let pkm = std::fs::read(format!("{base}.g4pkm")).ok();
    let g4md = match pkm.as_deref().and_then(g4pkm::extract_g4md) {
        Some(md) => {
            println!("g4md      {} octets (embarqué dans le g4pkm)", md.len());
            md.to_vec()
        }
        None => {
            let md = std::fs::read(format!("{base}.g4md")).expect("ni g4md embarqué ni libre");
            println!("g4md      {} octets (fichier libre)", md.len());
            md
        }
    };
    println!("g4mg      {} octets", g4mg.len());

    let model = assemble_generic_model(GenericModelInput {
        code: code.clone(),
        g4md,
        g4mg,
        component: MeshComponent::Generic,
    })
    .expect("assemblage");

    let mut sommets = 0usize;
    let mut triangles = 0usize;
    for p in &model.primitives {
        sommets += p.positions.len();
        triangles += p.indices.len() / 3;
        println!(
            "primitive « {} » : {} sommets, {} triangles",
            p.material_name,
            p.positions.len(),
            p.indices.len() / 3
        );
    }
    // Boîte englobante : c'est elle qui dira si le modèle est à l'échelle du personnage.
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for p in &model.primitives {
        for v in &p.positions {
            for (i, c) in [v.x, v.y, v.z].into_iter().enumerate() {
                lo[i] = lo[i].min(c);
                hi[i] = hi[i].max(c);
            }
        }
    }
    println!("total     {sommets} sommets, {triangles} triangles");
    println!("bbox      min {lo:?}\n          max {hi:?}");
    println!(
        "étendue   {:?}",
        [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
    );

    let glb = model.to_glb();
    let out = format!("{base}.glb");
    std::fs::write(&out, &glb).expect("écriture glb");
    println!("glb       {out} ({} octets)", glb.len());
}
