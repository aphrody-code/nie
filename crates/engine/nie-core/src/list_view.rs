//! Le défilement d'une liste de menu — port byte-exact de `lives::CMenuListView`.
//!
//! ## Ce qui est prouvé
//!
//! `0x140542B80` dans `dist/nie.exe` (créneau 59 de la vtable, COL `0x141A5FFB8`) : le pas
//! d'UNE ligne. Validé par l'oracle uemu sur le binaire cible,
//! `scripts/validate_listview_scroll.py`, **20 ✓ / 0 ✗** dont 16 cas qui écrivent réellement et
//! 4 en butée. Les valeurs comparées sont les trois champs que la fonction écrit.
//!
//! La fonction vit en DEUX fragments `.pdata` contigus (`..0x140542BD7` puis `..0x140542DBD`) ;
//! le second n'a pas de prologue. Ne lire que le premier tronque le corps là où l'arithmétique
//! commence, et le pas se lit alors comme une souche.
//!
//! ## Ce qui n'est PAS prouvé
//!
//! Quelle entrée appelle ce créneau. Le créneau 58 (`0x140542840`) est son frère et déplace la
//! vue de l'étendue visible — le pas « par page ». Il n'est pas porté ici.
//!
//! ## Pourquoi ce n'est pas `list-page.ts`
//!
//! `apps/nie-web/src/game/list-page.ts` dérive tout du curseur (`floor(cursor / pageSize)`).
//! Le moteur, lui, garde trois champs INDÉPENDANTS : la ligne de tête, l'index sélectionné, et
//! une ancre maintenue à un delta constant de la tête. Une page dérivée ne peut pas représenter
//! une vue qui défile d'une ligne pendant que la sélection ne bouge pas. Le module TypeScript
//! reste une pagination d'hôte assumée ; il n'est pas la même chose et ne le prétend plus.

/// L'état de défilement d'une liste, avec l'offset du champ d'origine dans `CMenuListView`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListScroll {
    /// `[this+0x140]` — nombre total d'éléments.
    pub total: i32,
    /// `[this+0xD4]` — nombre de colonnes ; c'est le diviseur de l'`idiv`.
    pub columns: i32,
    /// `[this+0x12C]` — la ligne de tête. Elle peut être NÉGATIVE, jusqu'à `-visible`.
    pub top: i32,
    /// `[this+0x134]` — une seconde ligne, maintenue à un delta CONSTANT de `top`.
    pub anchor: i32,
    /// `[this+0x138]` — l'index sélectionné. Le pas d'une ligne n'y touche presque jamais.
    pub selected: i32,
    /// `[this+0xC0]` — l'étendue visible. Borne aussi le défilement vers le haut, à `-visible`.
    pub visible: i32,
    /// `[this+0xC4]` — une marge qui s'ajoute à `visible` dans la borne vers le bas.
    pub margin: i32,
    /// `[this+0x1C7]` — le drapeau qui décide si une dernière ligne partielle compte.
    pub counts_partial_row: bool,
}

/// Le sens d'un pas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// `dl != 0` — vers le bas.
    Forward,
    /// `dl == 0` — vers le haut.
    Backward,
}

impl ListScroll {
    /// Le nombre de lignes, `idiv` compris.
    ///
    /// La division du binaire est SIGNÉE et tronquée vers zéro (`cdq` puis `idiv`), ce qui n'est
    /// pas le `/` de Rust pour les négatifs... si, justement : Rust tronque vers zéro lui aussi,
    /// contrairement au `//` de Python. Le piège est pour le miroir Python, pas ici.
    fn rows(self) -> (i32, i32, bool) {
        if self.columns == 0 {
            return (0, 0, false);
        }
        let mut rows = self.total / self.columns;
        let remainder = self.total % self.columns;
        let mut partial = false;
        if self.selected < remainder {
            rows += 1;
        } else if self.counts_partial_row && remainder > 0 {
            partial = true;
            rows += 1;
        }
        (rows, remainder, partial)
    }

    /// Applique un pas d'une ligne. Rend `false` quand la liste est déjà en butée.
    ///
    /// En butée, la fonction du jeu sort SANS RIEN ÉCRIRE — ce n'est pas un « écrire la même
    /// valeur », et la distinction se voit : elle n'émet alors aucune notification.
    pub fn step_row(&mut self, step: Step) -> bool {
        let (rows, remainder, partial) = self.rows();
        let delta = self.anchor - self.top;

        match step {
            Step::Forward => {
                if self.margin + self.visible + self.top >= rows {
                    return false;
                }
                let probe = self.margin + self.visible + self.top + 1;
                let mut top = self.top + 1;
                if probe > rows {
                    top = rows - self.visible - self.margin;
                }
                self.top = top;
                self.anchor = top + delta;
                if partial && self.selected >= remainder && rows - 1 == self.anchor {
                    self.selected = remainder - 1;
                }
                true
            }
            Step::Backward => {
                let floor = -self.visible;
                if self.top <= floor {
                    return false;
                }
                let top = (self.top - 1).max(floor);
                self.top = top;
                self.anchor = top + delta;
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les cas de `scripts/validate_listview_scroll.py`, avec ce que le JEU écrit.
    ///
    /// Ce ne sont pas des attentes rédigées à la main : chaque triplet est la sortie mesurée de
    /// `0x140542B80` émulée sur `dist/nie.exe`. Les recopier ici fait que ce test échoue si le
    /// port dérive, sans exiger unicorn dans `cargo test`.
    fn scroll(total: i32, columns: i32, top: i32, anchor: i32, selected: i32, visible: i32, margin: i32) -> ListScroll {
        ListScroll { total, columns, top, anchor, selected, visible, margin, counts_partial_row: false }
    }

    /// Un départ et les deux triplets `(top, anchor, selected)` que le jeu écrit.
    type Cas = (ListScroll, (i32, i32, i32), (i32, i32, i32));

    #[test]
    fn one_row_forward_and_backward_match_the_emulated_game() {
        let cas: &[Cas] = &[
            (scroll(40, 4, 0, 0, 0, 3, 0), (1, 1, 0), (-1, -1, 0)),
            (scroll(40, 4, 3, 5, 12, 3, 0), (4, 6, 12), (2, 4, 12)),
            (scroll(40, 4, -3, -1, 0, 3, 0), (-2, 0, 0), (-3, -1, 0)),
            (scroll(41, 4, 2, 4, 1, 2, 1), (3, 5, 1), (1, 3, 1)),
            (scroll(7, 3, 0, 0, 6, 1, 0), (1, 1, 6), (-1, -1, 6)),
            (scroll(100, 5, 10, 12, 55, 4, 2), (11, 13, 55), (9, 11, 55)),
        ];
        for (depart, avant, arriere) in cas {
            let mut v = *depart;
            v.step_row(Step::Forward);
            assert_eq!((v.top, v.anchor, v.selected), *avant, "avant sur {depart:?}");
            let mut v = *depart;
            v.step_row(Step::Backward);
            assert_eq!((v.top, v.anchor, v.selected), *arriere, "arriere sur {depart:?}");
        }
    }

    /// En butée, le jeu n'écrit RIEN. Le port doit le dire plutôt que réécrire la même valeur :
    /// l'appelant s'en sert pour savoir s'il doit notifier.
    #[test]
    fn a_list_at_its_end_reports_that_nothing_moved() {
        let mut bas = scroll(40, 4, 7, 7, 28, 3, 0);
        assert!(!bas.step_row(Step::Forward), "deja en bas");
        assert_eq!((bas.top, bas.anchor), (7, 7), "aucune ecriture");

        let mut haut = scroll(40, 4, -3, -1, 0, 3, 0);
        assert!(!haut.step_row(Step::Backward), "deja en haut");
        assert_eq!((haut.top, haut.anchor), (-3, -1));
    }

    /// Une liste vide ou d'un seul élément ne bouge pas — mesuré, pas supposé.
    #[test]
    fn degenerate_lists_do_not_move() {
        for mut v in [scroll(0, 4, 0, 0, 0, 2, 0), scroll(1, 1, 0, 0, 0, 1, 0)] {
            assert!(!v.step_row(Step::Forward));
            assert_eq!((v.top, v.anchor, v.selected), (0, 0, 0));
        }
    }

    /// L'ancre suit la tête à delta CONSTANT : c'est ce que `list-page.ts` ne peut pas exprimer.
    ///
    /// La butée n'est pas devinable et n'a pas été devinée : `total=100`, `columns=5` donnent
    /// `rows=20`, et le jeu émulé accepte le pas depuis `top=13` puis refuse depuis `top=14`
    /// (`validate_listview_scroll.py`, cas de butée). Depuis `top=10` il y a donc QUATRE pas,
    /// pas cinq — une attente écrite à la main disait cinq, et c'est l'émulateur qui a tranché.
    #[test]
    fn the_anchor_keeps_its_distance_from_the_top() {
        let mut v = scroll(100, 5, 10, 12, 55, 4, 2);
        for attendu in 11..=14 {
            assert!(v.step_row(Step::Forward), "pas vers {attendu}");
            assert_eq!(v.top, attendu);
            assert_eq!(v.anchor - v.top, 2, "l'ancre garde sa distance");
            assert_eq!(v.selected, 55, "un pas de ligne ne deplace pas la selection");
        }
        assert!(!v.step_row(Step::Forward), "top=14 est la butee mesuree");
        assert_eq!((v.top, v.anchor), (14, 16), "rien n'est ecrit en butee");
    }
}
