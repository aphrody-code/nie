//! Mesure la palette de skinning d'un modèle RÉEL : partition de l'unité et influences max.
//!
//! Troisième critère de vérification du module [`nie_formats::pose`], celui qui ne peut pas être
//! fabriqué : les deux premiers (identité, rigidité) tiennent sur des données synthétiques, mais
//! « les poids d'un vrai modèle somment à 1 » ne se vérifie que sur un vrai modèle.
//!
//! ```sh
//! cargo run -p nie-formats --release --example skin_palette_census -- \
//!     var/tmp/godknows/ev60_00340.g4pkm var/tmp/godknows/ev60_00340.g4mg
//! ```
use nie_formats::assemble::{GenericModelInput, MeshComponent, assemble_generic_model};
use nie_formats::pose;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(a), Some(b)) = (args.next(), args.next()) else {
        eprintln!("usage : skin_palette_census <fichier.g4pkm|.g4md> <fichier.g4mg>");
        std::process::exit(2);
    };
    let brut = std::fs::read(&a).expect("lire le descripteur");
    // Un `.g4pkm` EMBARQUE son G4MD : c'est le cas de la famille `_waza`, qui n'a aucun `.g4md`
    // autonome. On accepte les deux formes pour que l'outil serve aux deux familles.
    let g4md = nie_formats::g4pkm::extract_g4md(&brut).map_or_else(|| brut.clone(), <[u8]>::to_vec);
    let g4mg = std::fs::read(&b).expect("lire la géométrie");

    let modele = assemble_generic_model(GenericModelInput {
        code: "census".into(),
        g4md,
        g4mg,
        component: MeshComponent::Body,
    })
    .expect("assembler");

    let (mut sommets, mut avec_skin, mut unite, mut hors_unite) = (0u64, 0u64, 0u64, 0u64);
    let mut influences = 0usize;
    let mut pire = (1.0f32, 1.0f32);
    let mut triangles = 0u64;

    for prim in &modele.primitives {
        triangles += (prim.indices.len() / 3) as u64;
        sommets += prim.positions.len() as u64;
        let Some(skin) = &prim.skin else { continue };
        influences = influences.max(pose::influences_max(skin));
        for v in 0..prim.positions.len() {
            avec_skin += 1;
            let s = pose::somme_des_poids(skin, v);
            if (0.999..=1.001).contains(&s) {
                unite += 1;
            } else {
                hors_unite += 1;
                if s < pire.0 {
                    pire.0 = s;
                }
                if s > pire.1 {
                    pire.1 = s;
                }
            }
        }
    }

    let pct = |a: u64, b: u64| if b == 0 { 0.0 } else { a as f64 * 100.0 / b as f64 };
    println!("primitives        {}", modele.primitives.len());
    println!("sommets           {sommets}");
    println!("triangles         {triangles}");
    println!("sommets skinnés   {avec_skin}");
    println!(
        "PARTITION DE L'UNITÉ  {unite}/{avec_skin} ({:.2} %), {hors_unite} hors [0,999 ; 1,001]",
        pct(unite, avec_skin)
    );
    if hors_unite > 0 {
        println!("  pire somme observée : min={} max={}", pire.0, pire.1);
    }
    println!("INFLUENCES MAX        {influences} (la palette en porte 8)");
}
