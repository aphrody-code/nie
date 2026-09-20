//! Entrées : l'état des touches, et la table unique qui les traduit en commandes de menu.
//!
//! # Pourquoi ce module existe
//!
//! La table « quelle touche fait quoi » était écrite **trois fois**, dans trois langages :
//! `nie-game` (winit), `nie-cli` (jetons de ligne de commande) et `apps/nie-web` (DOM). Elles
//! avaient déjà divergé — mesuré le 2026-09-20 :
//!
//! | Touche | `nie-game` | `bridge.ts` |
//! |---|---|---|
//! | `Tab` → `CMD_FCS_NEXT` | absent | présent |
//! | `i` → `CMD_INFO` | absent | présent |
//! | `NumpadEnter` → `CMD_ENTER` | présent | absent |
//!
//! Deux commandes n'existaient que dans le navigateur, une seulement dans l'hôte natif. Ce n'est
//! pas une hypothèse sur ce qui pourrait arriver : c'est l'état du dépôt. [`BINDINGS`] est
//! désormais la seule table, et elle porte l'**union** des trois.
//!
//! # Ce qui est repris de Bevy, et ce qui ne l'est pas
//!
//! [`ButtonInput`] suit la structure de `bevy_input::ButtonInput` : trois ensembles — enfoncé,
//! vient d'être enfoncé, vient d'être relâché — et un `clear()` par image qui ne vide que les
//! deux derniers. C'est un modèle éprouvé, et sa subtilité utile est qu'un `press()` sur une
//! touche **déjà** enfoncée n'alimente pas `just_pressed` : la répétition clavier du système ne
//! fait donc pas défiler un menu.
//!
//! Le crate `bevy_input` lui-même n'est pas tiré : il dépend de `bevy_ecs`, et le module
//! WebAssembly du jeu tient dans **4,56 Mio sur un budget de 6** (`build-wasm.ts`). Un ECS dans
//! ce budget pour trois ensembles de touches serait payé cher. La structure vaut mieux que la
//! dépendance ici ; c'est un arbitrage mesuré, pas une préférence.

use std::collections::HashSet;
use std::hash::Hash;

/// État des boutons d'un périphérique, sur le modèle de `bevy_input::ButtonInput`.
///
/// Trois ensembles plutôt qu'un : « la touche est enfoncée » et « la touche vient d'être
/// enfoncée » répondent à deux questions différentes. Un joueur de football se dirige par
/// **état** — tant que la touche est tenue, il court — alors qu'un menu réagit à un
/// **événement**. Les deux coexistent sur le même clavier, et c'est exactement ce que
/// `nie-game` gérait à la main avec un seul `HashSet`, donc sans pouvoir répondre à la seconde.
#[derive(Debug, Clone)]
pub struct ButtonInput<T> {
    pressed: HashSet<T>,
    just_pressed: HashSet<T>,
    just_released: HashSet<T>,
}

// `derive(Default)` exigerait `T: Default`, alors que trois ensembles VIDES n'ont besoin de rien
// de tel : la dérivation borne le paramètre même quand le champ ne l'utilise pas. `bevy_input`
// écrit ce `Default` à la main pour la même raison.
impl<T> Default for ButtonInput<T> {
    fn default() -> Self {
        Self {
            pressed: HashSet::new(),
            just_pressed: HashSet::new(),
            just_released: HashSet::new(),
        }
    }
}

impl<T: Copy + Eq + Hash> ButtonInput<T> {
    /// Enregistre un appui.
    ///
    /// Une touche déjà enfoncée n'alimente **pas** `just_pressed` : la répétition automatique du
    /// système d'exploitation ne doit pas se lire comme une suite d'appuis distincts.
    pub fn press(&mut self, input: T) {
        if self.pressed.insert(input) {
            self.just_pressed.insert(input);
        }
    }

    /// Enregistre un relâchement. Relâcher une touche qui ne l'était pas est sans effet.
    pub fn release(&mut self, input: T) {
        if self.pressed.remove(&input) {
            self.just_released.insert(input);
        }
    }

    /// Relâche tout — à appeler quand la fenêtre perd le focus, sans quoi une touche tenue au
    /// moment du changement d'application reste enfoncée pour toujours.
    pub fn release_all(&mut self) {
        for input in self.pressed.drain().collect::<Vec<_>>() {
            self.just_released.insert(input);
        }
    }

    /// La touche est-elle enfoncée ?
    #[must_use]
    pub fn pressed(&self, input: T) -> bool {
        self.pressed.contains(&input)
    }

    /// L'une de ces touches est-elle enfoncée ?
    pub fn any_pressed(&self, inputs: impl IntoIterator<Item = T>) -> bool {
        inputs.into_iter().any(|input| self.pressed(input))
    }

    /// La touche vient-elle d'être enfoncée, sur cette image ?
    #[must_use]
    pub fn just_pressed(&self, input: T) -> bool {
        self.just_pressed.contains(&input)
    }

    /// La touche vient-elle d'être relâchée, sur cette image ?
    #[must_use]
    pub fn just_released(&self, input: T) -> bool {
        self.just_released.contains(&input)
    }

    /// Les touches actuellement enfoncées.
    pub fn get_pressed(&self) -> impl ExactSizeIterator<Item = &T> {
        self.pressed.iter()
    }

    /// Fin d'image : oublie les transitions, garde les touches tenues.
    ///
    /// À appeler **une fois par image**, après que tout le monde a lu les entrées. L'oublier
    /// laisse `just_pressed` vrai indéfiniment, ce qui se lit comme une touche qui se répète
    /// toute seule.
    pub fn clear(&mut self) {
        self.just_pressed.clear();
        self.just_released.clear();
    }

    /// Remet tout à zéro, transitions comprises.
    pub fn reset_all(&mut self) {
        self.pressed.clear();
        self.just_pressed.clear();
        self.just_released.clear();
    }
}

/// Une touche, indépendante de l'hôte.
///
/// Chaque hôte traduit son type natif (`winit::keyboard::KeyCode`, une chaîne DOM, un jeton de
/// ligne de commande) vers ce type ; la table [`BINDINGS`] fait le reste. C'est la couture : le
/// mappage *matériel* appartient à l'hôte, le mappage *sémantique* est commun.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Key {
    /// Flèche haut.
    Up,
    /// Flèche bas.
    Down,
    /// Flèche gauche.
    Left,
    /// Flèche droite.
    Right,
    /// `W` — haut en QWERTY.
    W,
    /// `Z` — haut en AZERTY.
    Z,
    /// `S` — bas.
    S,
    /// `A` — gauche en QWERTY.
    A,
    /// `Q` — gauche en AZERTY.
    Q,
    /// `D` — droite.
    D,
    /// `I` — information.
    I,
    /// Entrée.
    Enter,
    /// Entrée du pavé numérique.
    NumpadEnter,
    /// Barre d'espace.
    Space,
    /// Échap.
    Escape,
    /// Retour arrière.
    Backspace,
    /// Tabulation.
    Tab,
}

impl Key {
    /// Reconnaît une touche depuis son nom, quelle que soit la convention de l'hôte.
    ///
    /// Trois écritures cohabitent dans le dépôt et doivent toutes marcher : les noms DOM
    /// (`ArrowUp`, `" "`), les jetons de ligne de commande (`up`, `enter`, `ok`) et les noms
    /// `winit` (`ArrowUp`, `KeyW`). La comparaison est insensible à la casse.
    ///
    /// Rend `None` pour un nom inconnu — un hôte ne doit pas deviner.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        // L'espace est une touche : le tester avant de rogner, sinon `" "` devient `""`.
        if name == " " || name.eq_ignore_ascii_case("space") {
            return Some(Self::Space);
        }
        let n = name.trim();
        Some(match n.to_ascii_lowercase().as_str() {
            "arrowup" | "up" | "keyup" => Self::Up,
            "arrowdown" | "down" | "keydown" => Self::Down,
            "arrowleft" | "left" | "keyleft" => Self::Left,
            "arrowright" | "right" | "keyright" => Self::Right,
            "w" | "keyw" => Self::W,
            "z" | "keyz" => Self::Z,
            "s" | "keys" => Self::S,
            "a" | "keya" => Self::A,
            "q" | "keyq" => Self::Q,
            "d" | "keyd" => Self::D,
            "i" | "keyi" | "info" => Self::I,
            "enter" | "ok" | "confirm" | "start" => Self::Enter,
            "numpadenter" => Self::NumpadEnter,
            "escape" | "esc" | "back" | "cancel" => Self::Escape,
            "backspace" => Self::Backspace,
            "tab" | "next" => Self::Tab,
            _ => return None,
        })
    }
}

/// La table unique : quelle touche déclenche quelle commande de menu.
///
/// Les commandes sont celles que `flow::Screen::input` consomme, et qui viennent du jeu réel
/// (`MENU_CMD_INFO` / `input_ctrl`). Les flèches **et** ZQSD/WASD naviguent : un clavier AZERTY
/// et un QWERTY doivent marcher sans réglage, ce qui explique que `Z`/`W` et `Q`/`A` soient tous
/// les quatre présents.
pub const BINDINGS: &[(Key, &str)] = &[
    (Key::Up, "CMD_FCS_MTX_UP"),
    (Key::W, "CMD_FCS_MTX_UP"),
    (Key::Z, "CMD_FCS_MTX_UP"),
    (Key::Down, "CMD_FCS_MTX_DOWN"),
    (Key::S, "CMD_FCS_MTX_DOWN"),
    (Key::Left, "CMD_FCS_MTX_LEFT"),
    (Key::A, "CMD_FCS_MTX_LEFT"),
    (Key::Q, "CMD_FCS_MTX_LEFT"),
    (Key::Right, "CMD_FCS_MTX_RIGHT"),
    (Key::D, "CMD_FCS_MTX_RIGHT"),
    (Key::Enter, "CMD_ENTER"),
    (Key::NumpadEnter, "CMD_ENTER"),
    (Key::Space, "CMD_ENTER"),
    (Key::Escape, "CMD_BACK"),
    (Key::Backspace, "CMD_BACK"),
    (Key::Tab, "CMD_FCS_NEXT"),
    (Key::I, "CMD_INFO"),
];

/// La commande d'une touche, ou `None` si elle n'en déclenche aucune.
#[must_use]
pub fn command_for(key: Key) -> Option<&'static str> {
    BINDINGS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, cmd)| *cmd)
}

/// La commande d'un nom de touche, quelle que soit la convention de l'hôte.
///
/// C'est ce qu'appellent le navigateur (noms DOM) et la ligne de commande (jetons) ; l'hôte
/// natif passe par [`command_for`] après avoir traduit son `KeyCode`.
#[must_use]
pub fn command_for_name(name: &str) -> Option<&'static str> {
    Key::parse(name).and_then(command_for)
}

/// Direction de déplacement continue, depuis l'état des touches.
///
/// C'est l'autre moitié des entrées : un menu réagit à des commandes, un joueur se dirige par
/// état. Rend `(dx, dy)` dans `[-1, 1]`, deux touches opposées s'annulant.
#[must_use]
pub fn movement(keys: &ButtonInput<Key>) -> (f32, f32) {
    let axis = |neg: &[Key], pos: &[Key]| -> f32 {
        let n = keys.any_pressed(neg.iter().copied());
        let p = keys.any_pressed(pos.iter().copied());
        f32::from(i8::from(p) - i8::from(n))
    };
    (
        axis(&[Key::Left, Key::A, Key::Q], &[Key::Right, Key::D]),
        axis(&[Key::Down, Key::S], &[Key::Up, Key::W, Key::Z]),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une touche déjà enfoncée ne réalimente pas `just_pressed`.
    ///
    /// C'est la subtilité qui vaut d'emprunter ce modèle : la répétition automatique du système
    /// enverrait sinon une rafale d'appuis, et un menu défilerait tout seul.
    #[test]
    fn la_repetition_ne_produit_pas_un_second_appui() {
        let mut k = ButtonInput::default();
        k.press(Key::Up);
        assert!(k.just_pressed(Key::Up) && k.pressed(Key::Up));
        k.press(Key::Up); // répétition du système
        assert!(k.just_pressed(Key::Up), "toujours vrai sur la MÊME image");
        k.clear();
        k.press(Key::Up); // encore la répétition, image suivante
        assert!(
            !k.just_pressed(Key::Up),
            "une touche tenue ne se réappuie pas"
        );
        assert!(k.pressed(Key::Up), "elle reste tenue");
    }

    /// `clear` oublie les transitions et garde les touches tenues.
    #[test]
    fn clear_oublie_les_transitions_et_garde_les_appuis() {
        let mut k = ButtonInput::default();
        k.press(Key::Left);
        k.release(Key::Left);
        assert!(k.just_released(Key::Left));
        k.clear();
        assert!(!k.just_pressed(Key::Left) && !k.just_released(Key::Left));

        k.press(Key::Right);
        k.clear();
        assert!(k.pressed(Key::Right), "une touche tenue survit au clear");
    }

    /// Perdre le focus relâche tout — sinon une touche tenue reste enfoncée pour toujours.
    #[test]
    fn release_all_relache_tout_et_le_signale() {
        let mut k = ButtonInput::default();
        k.press(Key::W);
        k.press(Key::D);
        k.clear();
        k.release_all();
        assert_eq!(k.get_pressed().len(), 0);
        assert!(k.just_released(Key::W) && k.just_released(Key::D));
    }

    /// Les trois conventions de nommage donnent la MÊME commande.
    ///
    /// C'est la propriété qui supprime la triplication : le navigateur envoie `ArrowUp`, la
    /// ligne de commande `up`, `winit` `KeyW` — une seule table répond.
    #[test]
    fn les_trois_conventions_dhotes_donnent_la_meme_commande() {
        for (dom, cli, winit_like) in [
            ("ArrowUp", "up", "KeyUp"),
            ("ArrowLeft", "left", "KeyLeft"),
            ("Enter", "ok", "Enter"),
            ("Escape", "back", "Esc"),
        ] {
            let a = command_for_name(dom);
            assert!(a.is_some(), "{dom} doit être reconnu");
            assert_eq!(a, command_for_name(cli), "{dom} vs {cli}");
            assert_eq!(a, command_for_name(winit_like), "{dom} vs {winit_like}");
        }
    }

    /// L'espace est une touche, et il ne doit pas être rogné en chaîne vide.
    #[test]
    fn lespace_est_une_touche() {
        assert_eq!(Key::parse(" "), Some(Key::Space));
        assert_eq!(command_for_name(" "), Some("CMD_ENTER"));
        assert_eq!(Key::parse(""), None, "une chaîne vide n'est pas une touche");
    }

    /// La table porte l'UNION des trois anciennes : les commandes que seul le web avait, et
    /// celle que seul le natif avait.
    ///
    /// Mesuré avant unification : `Tab`/`CMD_FCS_NEXT` et `i`/`CMD_INFO` n'existaient que dans
    /// `bridge.ts`, `NumpadEnter` que dans `nie-game`. Ce test empêche qu'on en reperde une.
    #[test]
    fn la_table_porte_lunion_des_trois_anciennes() {
        assert_eq!(command_for(Key::Tab), Some("CMD_FCS_NEXT"), "venait du web");
        assert_eq!(command_for(Key::I), Some("CMD_INFO"), "venait du web");
        assert_eq!(
            command_for(Key::NumpadEnter),
            Some("CMD_ENTER"),
            "venait du natif"
        );
        // Et les deux dispositions de clavier restent servies.
        for (azerty, qwerty) in [(Key::Z, Key::W), (Key::Q, Key::A)] {
            assert_eq!(
                command_for(azerty),
                command_for(qwerty),
                "AZERTY et QWERTY doivent naviguer pareil"
            );
        }
    }

    /// Un nom inconnu ne déclenche rien — un hôte ne devine pas.
    #[test]
    fn un_nom_inconnu_ne_declenche_rien() {
        for inconnu in ["F13", "cmd_enter", "shift", "é", "1"] {
            assert_eq!(command_for_name(inconnu), None, "{inconnu}");
        }
    }

    /// Le déplacement lit l'ÉTAT, et deux touches opposées s'annulent.
    #[test]
    fn le_deplacement_lit_letat_et_les_opposees_sannulent() {
        let mut k = ButtonInput::default();
        assert_eq!(movement(&k), (0.0, 0.0));
        k.press(Key::Right);
        assert_eq!(movement(&k), (1.0, 0.0));
        k.press(Key::Left);
        assert_eq!(movement(&k), (0.0, 0.0), "gauche + droite = immobile");
        k.release(Key::Left);
        k.press(Key::Z); // AZERTY : haut
        assert_eq!(movement(&k), (1.0, 1.0));
    }

    /// La table du navigateur (`bridge.ts`) dit EXACTEMENT la même chose que [`BINDINGS`].
    ///
    /// `commandForKey` est synchrone et testé sans WebAssembly : le brancher sur le module le
    /// coupleraient à son initialisation, et un repli TypeScript recréerait la seconde
    /// implémentation qu'on vient de supprimer. La garde vaut mieux que le couplage — c'est
    /// précisément cette dérive-là qui s'est produite (`Tab` et `i` d'un côté, `NumpadEnter` de
    /// l'autre), et elle n'avait rien pour la signaler.
    ///
    /// Saut bruyant si le fichier est absent : cette crate se compile aussi hors du dépôt web.
    #[test]
    fn la_table_du_navigateur_dit_la_meme_chose() {
        let chemin = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../apps/nie-web/src/game/bridge.ts");
        let Ok(source) = std::fs::read_to_string(&chemin) else {
            eprintln!("SKIP: {} absent", chemin.display());
            return;
        };
        let Some(debut) = source.find("const KEY_COMMANDS") else {
            panic!("`KEY_COMMANDS` introuvable dans bridge.ts : la garde ne garde plus rien");
        };
        let corps = &source[debut..];
        let fin = corps.find("};").expect("table non terminée");
        let corps = &corps[..fin];

        // `"Nom": "CMD_X"` ou `Nom: "CMD_X"`, et la barre d'espace s'écrit `" "`.
        let mut web: Vec<(String, String)> = Vec::new();
        for ligne in corps.lines().skip(1) {
            let Some((gauche, droite)) = ligne.split_once(':') else {
                continue;
            };
            let touche = gauche.trim().trim_matches('"');
            let Some(cmd) = droite.split('"').nth(1) else {
                continue;
            };
            if touche.is_empty() && !gauche.contains('"') {
                continue;
            }
            web.push((touche.to_owned(), cmd.to_owned()));
        }
        assert!(
            !web.is_empty(),
            "aucune entrée lue : le parseur de cette garde est cassé"
        );

        for (touche, attendu) in &web {
            assert_eq!(
                command_for_name(touche),
                Some(attendu.as_str()),
                "`{touche}` → `{attendu}` dans bridge.ts, mais pas dans BINDINGS"
            );
        }

        // Et l'inverse : une commande ajoutée côté Rust doit arriver au navigateur.
        let commandes_web: std::collections::HashSet<&str> =
            web.iter().map(|(_, c)| c.as_str()).collect();
        for (touche, cmd) in BINDINGS {
            assert!(
                commandes_web.contains(cmd),
                "`{cmd}` (touche {touche:?}) est dans BINDINGS et absent de bridge.ts"
            );
        }
    }
}
