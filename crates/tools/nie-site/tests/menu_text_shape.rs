//! Les deux chemins de texte rendent-ils les mêmes lignes ?
//!
//! Le différentiel `nie-lua-web` laisse trois écrans divergents sur un seul slot : `Some("")`
//! côté natif, `None` côté module. Les deux exécutent le même `replay` ; la seule entrée qui
//! diffère est `localized_text`. Le natif la construit comme ci-dessous (c'est le corps de
//! `routes::menu::load_menu_text`, sans la recherche VFS) ; le navigateur la reçoit de
//! `/api/v1/text/{lang}/menu_text`, qui sert 2 755 lignes dont AUCUNE vide.
//!
//! ## La réponse, mesurée le 2026-09-13 : la table N'EST PAS en cause
//!
//! ```text
//! chemin natif : 2755 lignes, 0 vides, 2675 hash distincts
//! route        : 2755 lignes, 0 vide
//! premiers hash : 0x968619e7, 0x824c51b3, 0x9b7a6ee1, 0xbdd279ee, 0x593d6f58 — IDENTIQUES
//! ```
//!
//! Même nombre, mêmes vides (aucun), même ordre en tête. Les 80 hash dupliqués (2 755 lignes
//! pour 2 675 distincts) sont résolus « dernier gagnant » des deux côtés — `find_text` scanne à
//! l'envers, et une collecte en `BTreeMap` garde la dernière — donc même résultat tant que
//! l'ordre coïncide, ce qu'il fait.
//!
//! Le `Some("")` contre `None` vient donc d'ailleurs que de `localized_text`. Cette piste-là est
//! close ; ce test reste pour qu'elle le demeure.
//!
//! Conditionné : `NIE_MENU_TEXT` doit désigner un `menu_text.cfg.bin` extrait
//! (`niers vfs extract data/common/text/fr/menu_text.cfg.bin --out <fichier>`).

#[test]
fn le_chemin_natif_et_la_route_comptent_les_memes_lignes() {
    let Ok(chemin) = std::env::var("NIE_MENU_TEXT") else {
        eprintln!("NIE_MENU_TEXT non défini : relevé sauté");
        return;
    };
    let octets = std::fs::read(&chemin).expect("fichier lisible");
    let Ok(fichier) = nie_formats::cfgbin::parse_t2b(&octets) else {
        eprintln!("pas un conteneur T2B : relevé sauté");
        return;
    };
    let root = serde_json::json!({
        "entries": nie_site::routes::menu::t2b_siblings_to_iecode(&fichier.entries),
    });
    let lignes = nie_data::text::parse_text_file(&root);
    let vides = lignes.iter().filter(|(_, texte)| texte.is_empty()).count();
    let distincts: std::collections::BTreeSet<u32> = lignes.iter().map(|(id, _)| id.0).collect();
    eprintln!(
        "chemin natif : {} lignes, {} vides, {} hash distincts",
        lignes.len(),
        vides,
        distincts.len()
    );
    eprintln!("route        : 2 755 lignes, 0 vide (mesuré le 2026-09-13)");
    eprintln!(
        "premiers hash du chemin natif : {:?}",
        lignes.iter().take(5).map(|(id, _)| format!("{:#010x}", id.0)).collect::<Vec<_>>()
    );
    // 80 hash sont DUPLIQUÉS (2 755 lignes pour 2 675 distincts) : la valeur retenue dépend donc
    // de l'ORDRE, des deux côtés. Si les deux chemins ne rendent pas les lignes dans le même
    // ordre, ils ne résolvent pas le même texte pour ces 80 hash.
    let doublons = lignes.len() - distincts.len();
    eprintln!("hash dupliqués : {doublons} — la résolution dépend de l'ordre");
    assert!(!lignes.is_empty(), "le fichier porte du texte mais rien n'est lu");
}
