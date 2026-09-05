//! `pixel` — mesurer une image, comparer deux images, vectoriser, rastériser un SVG.
//!
//! L'outil de la skill `pixel-perfect` : il produit les chiffres sans lesquels une reproduction
//! n'est qu'une ressemblance affirmée. Volontairement sans `clap` — la crate n'en dépend pas et
//! six sous-commandes ne le justifient pas.

use nie_aphrody::pixel::{
    Boite, Comparaison, Image, Masque, Mesure, Reglages, ReglagesVecteur, comparer, mesurer,
    rasteriser_svg, vectoriser,
};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const AIDE: &str = "\
pixel — mesure et reproduction au pixel près

  pixel mesurer <IMG> [--boite X0 Y0 X1 Y1] [--k N] [--alpha S|--sombre S|--teinte MIN MAX SAT]
        [--json]
  pixel comparer <A> <B> [--tolerance N] [--json]
  pixel vectoriser <IMG> [--k N] [--tolerance PX] [--aire-min N] [--alpha S|--sombre S] [-o SVG]
  pixel rasteriser <SVG> --largeur N -o <PNG>

Sans --json, la sortie est un résumé lisible. Les codes de retour : 0 succès, 1 échec.
Une mesure qui contredit l'ordre de grandeur connu accuse la mesure, jamais le sujet.
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match executer(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("pixel: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Lit une option `--nom` suivie de `n` valeurs, et la retire de la liste.
fn option(args: &mut Vec<String>, nom: &str, n: usize) -> Result<Option<Vec<String>>, String> {
    let Some(i) = args.iter().position(|a| a == nom) else { return Ok(None) };
    if args.len() < i + 1 + n {
        return Err(format!("{nom} attend {n} valeur(s)"));
    }
    let vals: Vec<String> = args.drain(i..=i + n).skip(1).collect();
    Ok(Some(vals))
}

fn drapeau(args: &mut Vec<String>, nom: &str) -> bool {
    args.iter().position(|a| a == nom).is_some_and(|i| {
        args.remove(i);
        true
    })
}

fn nombre<T: std::str::FromStr>(s: &str, quoi: &str) -> Result<T, String> {
    s.parse().map_err(|_| format!("{quoi} : « {s} » n'est pas un nombre"))
}

fn lire_masque(args: &mut Vec<String>) -> Result<Option<Masque>, String> {
    if let Some(v) = option(args, "--alpha", 1)? {
        return Ok(Some(Masque::Alpha(nombre(&v[0], "--alpha")?)));
    }
    if let Some(v) = option(args, "--sombre", 1)? {
        return Ok(Some(Masque::Sombre(nombre(&v[0], "--sombre")?)));
    }
    if let Some(v) = option(args, "--teinte", 3)? {
        return Ok(Some(Masque::Teinte {
            min: nombre(&v[0], "--teinte min")?,
            max: nombre(&v[1], "--teinte max")?,
            sat: nombre(&v[2], "--teinte sat")?,
        }));
    }
    Ok(None)
}

fn executer(args: &[String]) -> Result<(), String> {
    let Some(commande) = args.first() else {
        print!("{AIDE}");
        return Ok(());
    };
    let mut reste: Vec<String> = args[1..].to_vec();
    match commande.as_str() {
        "mesurer" => cmd_mesurer(&mut reste),
        "comparer" => cmd_comparer(&mut reste),
        "vectoriser" => cmd_vectoriser(&mut reste),
        "rasteriser" => cmd_rasteriser(&mut reste),
        "-h" | "--help" | "aide" => {
            print!("{AIDE}");
            Ok(())
        }
        autre => Err(format!("commande inconnue « {autre} »\n\n{AIDE}")),
    }
}

fn positionnel(args: &mut Vec<String>, quoi: &str) -> Result<PathBuf, String> {
    let i = args
        .iter()
        .position(|a| !a.starts_with("--"))
        .ok_or_else(|| format!("{quoi} manquant\n\n{AIDE}"))?;
    Ok(PathBuf::from(args.remove(i)))
}

fn charger(chemin: &Path) -> Result<Image, String> {
    Image::charger(chemin).map_err(|e| e.to_string())
}

fn cmd_mesurer(args: &mut Vec<String>) -> Result<(), String> {
    let json = drapeau(args, "--json");
    let masque = lire_masque(args)?;
    let k = option(args, "--k", 1)?.map(|v| nombre::<usize>(&v[0], "--k")).transpose()?;
    let boite = option(args, "--boite", 4)?
        .map(|v| -> Result<Boite, String> {
            Ok(Boite {
                x0: nombre(&v[0], "--boite x0")?,
                y0: nombre(&v[1], "--boite y0")?,
                x1: nombre(&v[2], "--boite x1")?,
                y1: nombre(&v[3], "--boite y1")?,
            })
        })
        .transpose()?;
    let chemin = positionnel(args, "<IMG>")?;

    let mut reglages = Reglages { boite, ..Reglages::default() };
    if let Some(m) = masque {
        reglages.masque = m;
    }
    if let Some(k) = k {
        reglages.k = k;
    }

    let m = mesurer(&charger(&chemin)?, reglages).map_err(|e| e.to_string())?;
    if json {
        println!("{}", serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?);
    } else {
        imprimer_mesure(&m);
    }
    Ok(())
}

fn imprimer_mesure(m: &Mesure) {
    println!("source           {}x{}", m.source[0], m.source[1]);
    println!(
        "boite            {} {} → {} {}  ({}x{})",
        m.boite.x0,
        m.boite.y0,
        m.boite.x1,
        m.boite.y1,
        m.boite.largeur(),
        m.boite.hauteur()
    );
    println!("ratio            {:.3}", m.ratio);
    println!("remplissage      {:.2} %   (disque plein = 78,54 %)", m.remplissage_pct);
    println!("part de l'image  {:.2} %", m.part_image_pct);
    println!(
        "trait            {:.2} %  de la largeur{}",
        m.trait_pct,
        if m.trait_pct > 2.0 {
            "   ← INVRAISEMBLABLE pour un contour : le masque a attrapé un aplat"
        } else {
            ""
        }
    );
    println!(
        "bords            gauche {:+.4} dx/dy ({:+.2}°)   droit {:+.4} dx/dy ({:+.2}°)",
        m.pente_gauche, m.angle_gauche_deg, m.pente_droite, m.angle_droit_deg
    );
    println!(
        "  droiture R²    gauche {:.4}  droit {:.4}{}",
        m.droiture_gauche,
        m.droiture_droite,
        if m.bord_droiture < 0.95 {
            "   ← un bord n'est PAS droit (souvent : la boîte le COUPE) — l'angle ne veut rien dire"
        } else {
            "   → l'angle se traduit tel quel en skewX(-angle)"
        }
    );
    println!("palette");
    for c in &m.palette {
        println!(
            "  {:>6.2} %  {}  hsl({:.1}° {:.1} % {:.1} %)  oklch({:.3} {:.3} {:.1}°)",
            c.part_pct,
            c.hex,
            c.hsl[0],
            c.hsl[1] * 100.0,
            c.hsl[2] * 100.0,
            c.oklch[0],
            c.oklch[1],
            c.oklch[2]
        );
    }
    println!(
        "\nContrôle de vraisemblance à faire soi-même : une palette contient toujours des\ncouleurs qui n'appartiennent pas au sujet (fond happé par le masque, élément voisin).\nCelles qui ont servi doivent être citées dans le tableau « décision → mesure »."
    );
}

fn cmd_comparer(args: &mut Vec<String>) -> Result<(), String> {
    let json = drapeau(args, "--json");
    let tol = option(args, "--tolerance", 1)?
        .map(|v| nombre::<u8>(&v[0], "--tolerance"))
        .transpose()?
        .unwrap_or(0);
    let a = positionnel(args, "<A>")?;
    let b = positionnel(args, "<B>")?;
    let c = comparer(&charger(&a)?, &charger(&b)?, tol).map_err(|e| e.to_string())?;
    if json {
        println!("{}", serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?);
    } else {
        imprimer_comparaison(&c);
    }
    Ok(())
}

fn imprimer_comparaison(c: &Comparaison) {
    println!("ssim                     {:.4}", c.ssim);
    println!(
        "pixels dans ±{:<3}          {:.3} %",
        c.tolerance, c.pixels_dans_tolerance_pct
    );
    println!("identique au bit près    {}", if c.identique { "oui" } else { "non" });
    println!(
        "\nLe SSIM juge une reproduction d'interface ; la part dans la tolérance juge un rendu\nqui doit être identique (le gate du dépôt échoue sous 99 %). Ce ne sont pas le même\ncritère : dire lequel a servi."
    );
}

fn cmd_vectoriser(args: &mut Vec<String>) -> Result<(), String> {
    let masque = lire_masque(args)?;
    let k = option(args, "--k", 1)?.map(|v| nombre::<usize>(&v[0], "--k")).transpose()?;
    let tol =
        option(args, "--tolerance", 1)?.map(|v| nombre::<f64>(&v[0], "--tolerance")).transpose()?;
    let aire =
        option(args, "--aire-min", 1)?.map(|v| nombre::<usize>(&v[0], "--aire-min")).transpose()?;
    let sortie = option(args, "-o", 1)?.map(|v| PathBuf::from(&v[0]));
    let chemin = positionnel(args, "<IMG>")?;

    let mut reglages = ReglagesVecteur::default();
    if let Some(m) = masque {
        reglages.masque = m;
    }
    if let Some(k) = k {
        reglages.k = k;
    }
    if let Some(t) = tol {
        reglages.tolerance = t;
    }
    if let Some(a) = aire {
        reglages.aire_min = a;
    }

    let img = charger(&chemin)?;
    let svg = vectoriser(&img, reglages).map_err(|e| e.to_string())?;
    match sortie {
        Some(p) => {
            std::fs::write(&p, &svg).map_err(|e| format!("{} : {e}", p.display()))?;
            let noeuds = svg.matches("<path").count();
            let sommets = svg.matches('L').count() + svg.matches('M').count();
            eprintln!(
                "{} écrit — {noeuds} chemin(s), {sommets} sommet(s), {} octets.\nRelire le résultat : un tracé automatique est un DÉCALQUE. Au-delà de quelques\ncentaines de sommets pour une icône, la redessiner à la main donne mieux.",
                p.display(),
                svg.len()
            );
        }
        None => print!("{svg}"),
    }
    Ok(())
}

fn cmd_rasteriser(args: &mut Vec<String>) -> Result<(), String> {
    let largeur = option(args, "--largeur", 1)?
        .map(|v| nombre::<u32>(&v[0], "--largeur"))
        .transpose()?
        .unwrap_or(512);
    let sortie = option(args, "-o", 1)?
        .map(|v| PathBuf::from(&v[0]))
        .ok_or_else(|| "rasteriser exige -o <PNG>".to_string())?;
    let chemin = positionnel(args, "<SVG>")?;
    let svg = std::fs::read_to_string(&chemin).map_err(|e| format!("{} : {e}", chemin.display()))?;
    let img = rasteriser_svg(&svg, largeur).map_err(|e| e.to_string())?;
    let png = nie_aphrody::assets::encoder_png(&img.rgba, img.largeur, img.hauteur)
        .map_err(|e| e.to_string())?;
    std::fs::write(&sortie, png).map_err(|e| format!("{} : {e}", sortie.display()))?;
    eprintln!("{} écrit — {}x{}", sortie.display(), img.largeur, img.hauteur);
    Ok(())
}
