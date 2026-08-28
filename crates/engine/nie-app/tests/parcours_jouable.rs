//! Le parcours qu'une joueuse fait réellement : écran-titre → menu → adversaires → match, et
//! retour. C'est la définition opérationnelle de « le jeu est jouable ».
//!
//! La FSM ([`nie_app::flow::Screen`]) est partagée par le front web (`nie-wasm`) et le front natif
//! (`nie-game --play`) : ce qui casse ici casse les deux. Elle n'avait aucun test — un parcours
//! interrompu au troisième écran ne se serait vu qu'à la main, front par front.
//!
//! Les commandes sont celles du jeu (`MENU_CMD_INFO` / `input_ctrl`), pas des touches : le mapping
//! clavier vit dans chaque front, la navigation vit ici.

use nie_app::flow::Screen;
use nie_app::{MENU, MODES};

/// Nom court de l'écran courant, pour des échecs lisibles.
fn ou(e: &Screen) -> String {
    match e {
        Screen::Title => "titre".into(),
        Screen::Menu { sel } => format!("menu[{sel}]"),
        Screen::ModeSelect { sel } => format!("mode[{sel}]"),
        Screen::Match { .. } => "match".into(),
        Screen::Story { idx } => format!("histoire[{idx}]"),
        Screen::Info { title } => format!("info({title})"),
    }
}

/// Titre → menu → « Adversaires » → un mode → **match en cours**.
///
/// C'est le chemin le plus court vers du jeu réel, et le seul qui traverse toute la FSM.
#[test]
fn du_titre_au_match_en_cours() {
    let mut e = Screen::new();
    assert!(matches!(e, Screen::Title), "on démarre sur le titre, pas {}", ou(&e));

    e.input("CMD_ENTER");
    assert!(matches!(e, Screen::Menu { sel: 0 }), "titre + Entrée → menu, pas {}", ou(&e));

    // « Adversaires » est le 6ᵉ onglet (index 5) : le seul qui mène à du jeu.
    let cible = MENU.iter().position(|m| *m == "Adversaires").expect("onglet Adversaires");
    for _ in 0..cible {
        e.input("CMD_FCS_MTX_DOWN");
    }
    assert!(
        matches!(e, Screen::Menu { sel } if sel == cible),
        "navigation jusqu'à Adversaires, pas {}",
        ou(&e),
    );

    e.input("CMD_ENTER");
    assert!(matches!(e, Screen::ModeSelect { sel: 0 }), "→ sélection de mode, pas {}", ou(&e));

    // Le mode 0 est l'histoire (dialogues) ; les suivants lancent un vrai match.
    e.input("CMD_FCS_MTX_DOWN");
    e.input("CMD_ENTER");
    assert!(matches!(e, Screen::Match { .. }), "→ match, pas {}", ou(&e));
    assert!(e.in_match(), "in_match() doit suivre l'écran");
    assert_eq!(e.score(), vec![0, 0], "un match commence à 0-0");
}

/// Le match AVANCE : la physique tourne, elle n'est pas figée sur l'écran d'entrée.
///
/// Sans cette vérification, un `update` qui ne ferait rien laisserait un « match » parfaitement
/// immobile — et tous les tests de navigation passeraient quand même.
#[test]
fn le_match_avance_dans_le_temps() {
    let mut e = Screen::new();
    e.input("CMD_ENTER");
    for _ in 0..5 {
        e.input("CMD_FCS_MTX_DOWN");
    }
    e.input("CMD_ENTER");
    e.input("CMD_FCS_MTX_DOWN");
    e.input("CMD_ENTER");
    assert!(e.in_match(), "le parcours doit aboutir à un match, pas {}", ou(&e));

    let Screen::Match { world } = &e else { unreachable!() };
    let depart = world.ball.pos;

    // Une minute de jeu à 60 Hz : assez pour que le ballon bouge, sans dépendre d'un but.
    for _ in 0..3_600 {
        e.update(1.0 / 60.0);
    }

    let Screen::Match { world } = &e else {
        panic!("le match ne doit pas se terminer tout seul : {}", ou(&e))
    };
    let arrivee = world.ball.pos;
    let bouge = (arrivee.x - depart.x).abs() > 0.01
        || (arrivee.y - depart.y).abs() > 0.01
        || (arrivee.z - depart.z).abs() > 0.01;
    assert!(bouge, "le ballon n'a pas bougé en 60 s simulées : {depart:?} → {arrivee:?}");
}

/// Chaque écran sait revenir en arrière — un jeu où l'on entre sans pouvoir sortir n'est pas
/// jouable, c'est une impasse.
#[test]
fn on_peut_toujours_revenir_en_arriere() {
    let mut e = Screen::new();
    e.input("CMD_ENTER"); // titre → menu
    e.input("CMD_BACK");
    assert!(matches!(e, Screen::Title), "menu + retour → titre, pas {}", ou(&e));

    // Un onglet non encore jouable affiche un écran d'information, dont on doit ressortir.
    e.input("CMD_ENTER");
    e.input("CMD_ENTER"); // onglet 0 → Info
    assert!(matches!(e, Screen::Info { .. }), "onglet 0 → info, pas {}", ou(&e));
    e.input("CMD_BACK");
    assert!(matches!(e, Screen::Menu { .. }), "info + retour → menu, pas {}", ou(&e));

    // Depuis un match, le retour ramène à la sélection de mode.
    for _ in 0..5 {
        e.input("CMD_FCS_MTX_DOWN");
    }
    e.input("CMD_ENTER");
    e.input("CMD_FCS_MTX_DOWN");
    e.input("CMD_ENTER");
    assert!(e.in_match(), "match attendu, pas {}", ou(&e));
    e.input("CMD_BACK");
    assert!(matches!(e, Screen::ModeSelect { .. }), "match + retour → modes, pas {}", ou(&e));
}

/// La navigation **boucle** dans les deux sens sur toute la liste, sans jamais sortir des bornes.
///
/// Un `sel` qui déborde indexerait hors de [`MENU`]/[`MODES`] au rendu — panique, donc jeu fermé.
#[test]
fn la_navigation_boucle_sans_deborder() {
    let mut e = Screen::new();
    e.input("CMD_ENTER");

    // Un tour complet vers le bas revient au point de départ.
    for _ in 0..MENU.len() {
        e.input("CMD_FCS_MTX_DOWN");
    }
    assert!(matches!(e, Screen::Menu { sel: 0 }), "tour complet → retour à 0, pas {}", ou(&e));

    // Vers le haut depuis 0 : dernier élément, pas un débordement.
    e.input("CMD_FCS_MTX_UP");
    assert!(
        matches!(e, Screen::Menu { sel } if sel == MENU.len() - 1),
        "haut depuis 0 → dernier onglet, pas {}",
        ou(&e),
    );

    // Même règle sur la liste des modes, qui n'a pas la même longueur.
    e.input("CMD_FCS_MTX_DOWN"); // retour à 0
    for _ in 0..5 {
        e.input("CMD_FCS_MTX_DOWN");
    }
    e.input("CMD_ENTER");
    for _ in 0..MODES.len() {
        e.input("CMD_FCS_MTX_DOWN");
    }
    assert!(matches!(e, Screen::ModeSelect { sel: 0 }), "tour des modes, pas {}", ou(&e));
}

/// Le mode Histoire enchaîne ses répliques puis rend la main.
#[test]
fn le_mode_histoire_se_deroule_puis_revient() {
    let mut e = Screen::new();
    e.input("CMD_ENTER");
    for _ in 0..5 {
        e.input("CMD_FCS_MTX_DOWN");
    }
    e.input("CMD_ENTER"); // → modes, index 0 = Mode Histoire
    e.input("CMD_ENTER");
    assert!(matches!(e, Screen::Story { idx: 0 }), "→ histoire, pas {}", ou(&e));

    // Valider assez de fois pour dépasser la dernière réplique, quelle que soit sa longueur.
    for _ in 0..32 {
        if !matches!(e, Screen::Story { .. }) {
            break;
        }
        e.input("CMD_ENTER");
    }
    assert!(
        matches!(e, Screen::ModeSelect { .. }),
        "la scène doit rendre la main à la sélection de mode, pas {}",
        ou(&e),
    );
}
