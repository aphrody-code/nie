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
//! `0x140542840` (créneau 58) : le pas PAR PAGE, même prologue de gardes, mais il déplace
//! l'ANCRE de la marge au lieu de la tête de 1. Validé de la même façon,
//! `scripts/validate_listview_page.py`, **18 ✓ / 0 ✗** dont 13 qui écrivent.
//!
//! ## Les noms viennent du MOTEUR depuis le 2026-09-13
//!
//! `0x1400AB120` construit dans `dist/nie.exe` une table de descripteurs où chaque propriété de
//! `CMenuListView` déclare son nom, son offset et sa taille — 44 champs. Les noms employés ici
//! en viennent : `mViewStart` (`0xC0`), `mViewNum` (`0xC4`), `mLineNum` (`0xC8`),
//! `mMoveTime` (`0xE0`), `mLocatorNum` (`0xE8`), `mIsListMoveForce` (`0x1B3`),
//! `mLockFocusIdx` (`0x198`). Carte complète : `docs/re/cmenulistview-fields.md`.
//!
//! Deux corrections que cette table impose : `0xC0` n'est pas « l'étendue visible » mais
//! `mViewStart`, et `0xC4` n'est pas une « marge » mais `mViewNum` — les deux étaient des noms
//! posés faute de mieux. Et `0x198`, le champ dont le rôle avait été qualifié d'« interprétation
//! à ne pas citer comme un fait », s'appelle `mLockFocusIdx` : la lecture initiale était juste.
//!
//! ## ⚠ C'est le comportement de BASE, et 94 dérivées peuvent le remplacer
//!
//! `lives::CMenuListView` a **94 classes dérivées** dans `dist/nie.exe`, et une vtable dérivée
//! remplace un créneau quand l'écran veut autre chose. Mesuré le 2026-09-13 sur les 94 :
//!
//! | créneau | porté ici | redéfini par |
//! | --- | --- | --- |
//! | 58 | `step_page` | 5 — `CharaFilter`, `DropRateList`, `ItemFilter`, `SoccerSpiritFilter`, `UniverseChara` |
//! | 59 | `step_row` | 6 — les mêmes plus `CharaEditParts`, `InacodeComment` |
//! | 60 | `cell_index` | 5 — les mêmes plus `MenuListViewArmedChara` |
//!
//! Donc ce module est juste pour ~94 % des vues-listes et FAUX pour celles-là. Vérifier la
//! classe de l'écran avant de s'en servir ; `scripts/re/vtable.py --class <nom>` le dit en une
//! commande. `CMenuListViewCharaBank` — l'écran `PlayerBank` — ne redéfinit AUCUN des trois,
//! donc le port le décrit exactement ; il redéfinit en revanche le créneau 56, que ce module ne
//! porte pas (23 dérivées sur 94 le font, ce qui est la raison de ne pas l'avoir porté).
//!
//! ## Ce qui n'est PAS prouvé
//!
//! Quelle entrée appelle quel créneau. Le pas par page porte aussi un chemin de DÉLÉGATION
//! (`[this+0xC8] > 1` et son quatrième paramètre nul donnent un `jmp [vt+1C8h]`) : il sort vers
//! une vtable, il ne calcule rien, et il n'est pas modélisé ici.
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
    /// `[this+0xC0]` — **`mViewStart`**, le nom du moteur. Borne le défilement vers le haut, à
    /// `-mViewStart`. Le champ s'appelait `visible` ici tant que le nom n'était pas mesuré.
    pub view_start: i32,
    /// `[this+0xC4]` — **`mViewNum`**. S'ajoute à `mViewStart` dans la borne vers le bas.
    /// S'appelait `margin` ici, également par défaut de mesure.
    pub view_num: i32,
    /// `[this+0x1C7]` — le drapeau qui décide si une dernière ligne partielle compte.
    pub counts_partial_row: bool,
    /// `[this+0x1B3]` — **`mIsListMoveForce`**. Change la façon dont le pas PAR PAGE recalcule
    /// la ligne de tête.
    ///
    /// Mesuré : sur le même départ, le pas avant rend `top = 5` à 0 et `top = 8` à 1. Ce n'est
    /// donc pas un réglage cosmétique, et le deviner aurait décalé la vue d'une page entière.
    pub keeps_relative_top: bool,
}

/// Le sens d'un pas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// `dl != 0` — vers le bas.
    Forward,
    /// `dl == 0` — vers le haut.
    Backward,
}

/// Les paramètres qu'un `.objbin` DÉCLARE pour sa vue-liste.
///
/// La correspondance n'est pas déduite des noms : la table de descripteurs que `0x1400AB120`
/// construit dans `dist/nie.exe` associe elle-même chaque nom à son offset, et
/// `nie_formats::objbin` parse déjà ces paramètres typés depuis le fichier. Les deux bouts se
/// rejoignent donc sur une mesure — `docs/re/cmenulistview-fields.md`.
///
/// Relevé sur `team14_01_chara_bank_list.objbin` : `mViewStart 1`, `mViewNum 7`, `mLineNum 6`,
/// `mLocatorNum 54`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DeclaredParams {
    /// `mViewStart` → `[this+0xC0]`.
    pub view_start: i32,
    /// `mViewNum` → `[this+0xC4]`.
    pub view_num: i32,
    /// `mLineNum` → `[this+0xC8]`. Ce module ne s'en sert pas encore : le diviseur de l'`idiv`
    /// est `[this+0xD4]`, que la table NE déclare PAS — c'est donc de l'état d'exécution, pas un
    /// paramètre de fichier, et les confondre remettrait une supposition dans le moteur.
    pub line_num: i32,
    /// `mLocatorNum` → `[this+0xE8]`, le nombre d'emplacements de l'anneau.
    pub locator_num: i32,
}

impl ListScroll {
    /// Monte l'état de défilement à partir des paramètres DÉCLARÉS et de l'état d'EXÉCUTION.
    ///
    /// La séparation est la mesure elle-même : `mViewStart` et `mViewNum` viennent du fichier,
    /// tandis que `total`, `columns`, `top`, `anchor` et `selected` vivent à des offsets que la
    /// table de descripteurs ne déclare pas (`0x140`, `0xD4`, `0x12C`, `0x134`, `0x138`). Un
    /// appelant doit donc fournir les seconds — le runtime Lua rend `scroll_index` et
    /// `selected_index`, et le reste se compte sur la donnée de l'écran.
    #[must_use]
    pub fn from_declared(params: DeclaredParams, total: i32, columns: i32) -> Self {
        Self {
            total,
            columns,
            top: 0,
            anchor: 0,
            selected: 0,
            view_start: params.view_start,
            view_num: params.view_num,
            counts_partial_row: false,
            keeps_relative_top: false,
        }
    }
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
                if self.view_num + self.view_start + self.top >= rows {
                    return false;
                }
                let probe = self.view_num + self.view_start + self.top + 1;
                let mut top = self.top + 1;
                if probe > rows {
                    top = rows - self.view_start - self.view_num;
                }
                self.top = top;
                self.anchor = top + delta;
                if partial && self.selected >= remainder && rows - 1 == self.anchor {
                    self.selected = remainder - 1;
                }
                true
            }
            Step::Backward => {
                let floor = -self.view_start;
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

impl ListScroll {
    /// Applique un pas d'une PAGE. Rend `false` quand la liste est déjà en butée.
    ///
    /// Le nombre de lignes se calcule ici sans le drapeau `counts_partial_row` : ce créneau
    /// emploie un simple `cmovge` sur la sélection, là où le pas d'une ligne teste en plus
    /// `[this+0x1C7]`. Les deux frères ne comptent donc PAS les lignes de la même manière —
    /// une observation qu'aucune symétrie n'aurait laissé supposer.
    pub fn step_page(&mut self, step: Step) -> bool {
        if self.columns == 0 {
            return false;
        }
        let quotient = self.total / self.columns;
        let remainder = self.total % self.columns;
        let rows = if self.selected >= remainder { quotient } else { quotient + 1 };

        match step {
            Step::Forward => {
                let last = rows - 1;
                if last <= self.anchor {
                    return false;
                }
                let anchor = (self.anchor + self.view_num).min(last);
                if self.view_num >= rows {
                    self.anchor = anchor;
                    return true; // seule l'ancre bouge : la vue tient déjà tout
                }
                let delta = self.anchor - self.top;
                let mut top = if self.keeps_relative_top {
                    if delta >= self.view_num { anchor - self.view_num } else { anchor - self.view_start }
                } else {
                    anchor - self.view_start - self.view_num + 1
                };
                if self.keeps_relative_top && top + self.view_num >= last {
                    top = rows - self.view_num - 1;
                }
                self.top = top;
                self.anchor = anchor;
                true
            }
            Step::Backward => {
                if self.anchor <= 0 {
                    return false;
                }
                let mut anchor = (self.anchor - self.view_num).max(0);
                if self.view_num >= rows {
                    self.anchor = anchor;
                    return true;
                }
                let mut top = anchor - self.view_start;
                if self.keeps_relative_top {
                    let candidate = (self.top - self.view_num).max(-self.view_start);
                    if candidate < top {
                        top = candidate;
                        anchor = candidate + self.view_start;
                    }
                }
                self.top = top;
                self.anchor = anchor;
                true
            }
        }
    }
}

/// Le pas d'une vue-liste de FILTRE : la sélection bouge de ±1 et BOUCLE.
///
/// `0x14102B170` — créneau 58 de `game::CMenuListViewCharaFilter`, qui redéfinit le pas par page
/// de la base. Prouvé par `scripts/validate_listview_filter_step.py`, **16 ✓ / 0 ✗**.
///
/// Ce n'est pas une variante de [`ListScroll::step_page`], c'est un autre MODÈLE. La base
/// déplace la ligne de tête et écrête ; celle-ci déplace l'index sélectionné et boucle dans les
/// deux sens. 256 octets contre 820 : la redéfinition est plus SIMPLE, pas plus riche — pas de
/// fenêtre, juste un curseur circulaire.
///
/// Les quatre classes qui redéfinissent les trois créneaux portés ici sont toutes des listes de
/// filtre, ce qui rend le modèle cohérent : un filtre est court et se parcourt en boucle, une
/// liste de contenu est longue et s'arrête au bout. Mais elles ne partagent PAS une
/// implémentation — mesuré sur leur créneau 58 :
///
/// - `CharaFilter` `0x14102B170`, 256 o — compte LU dans `[this+0xC8]` ;
/// - `ItemFilter` `0x14109ADD0` et `SoccerSpiritFilter` `0x14119B5F0`, 207 o chacun à 13 octets
///   près — même forme, mais le compte est **codé en dur à 2** (`mov r11d,1` / `cmp r11d,2`) :
///   un basculement à deux états, pas un curseur sur N ;
/// - `UniverseChara` `0x141152A40`, **10 octets** — `mov rax,[rcx] ; jmp qword [rax+1C8h]`, un
///   thunk qui délègue inconditionnellement au créneau 57. La base fait la même délégation,
///   mais seulement sous condition. Il ne calcule rien.
///
/// Les TROIS qui calculent sont prouvés (`validate_listview_filter_step.py`, 24 ✓ / 0 ✗) et
/// cette fonction les couvre toutes : l'appelant fournit le compte, `2` pour les jumelles.
///
/// La leçon des jumelles vaut d'être gardée : 194 octets identiques sur 207, et la différence
/// tient entièrement dans les 13 autres — le modulo. « Presque le même code » ne dit rien du
/// comportement ; c'est la constante qui décide.
///
/// Autre forme rencontrée : `MenuListViewArmedChara` remplace son créneau 60 par
/// `0x14004D760`, la souche `ret` — elle DÉSACTIVE la ré-indexation des cellules au lieu de la
/// redéfinir.
#[must_use]
pub fn filter_step(count: i32, selected: i32, step: Step) -> i32 {
    if count <= 0 {
        return selected;
    }
    let suivant = selected + if step == Step::Forward { 1 } else { -1 };
    if suivant < 0 {
        return count - 1;
    }
    if suivant >= count {
        return 0;
    }
    suivant
}

/// Une matrice affine 4×3 telle que la table de placement les stocke : trois rangées de
/// 16 octets, la translation dans la dernière colonne.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CellTransform {
    /// Translation lue à `+0x0C`, `+0x1C`, `+0x2C` de l'entrée.
    pub translation: [f32; 3],
}

/// La position d'une cellule : `base + translation[index]`.
///
/// Séquence `0x140544DF6`..`0x140544E4E` du créneau 73 (`0x140544BD0`), la passe de placement
/// que le créneau 9 appelle par `[vt+0x248]` quand l'écran est STABILISÉ. Prouvée par
/// `scripts/validate_listview_cell_position.py`, **5 ✓ / 0 ✗**.
///
/// Le pas de la table est de 48 octets (`index * 6 * 8`) et x/y/z sont espacés de 16 : c'est la
/// colonne de translation d'une affine 4×3. Le jeu additionne ensuite une position de base lue
/// dans un registre, puis remet le tout au widget.
///
/// ## D'où vient la base — lu dans les instructions, pas émulé
///
/// `mov r13,r8` au prologue : la base est le TROISIÈME argument du créneau 73. Le créneau 9 lui
/// passe `lea r8,[rsp+30h]`, un tampon qu'il vient de mettre à zéro (`xorps xmm0,xmm0` puis
/// `movdqa [rsp+30h],xmm0`). Sur un écran STABILISÉ ce tampon reste nul, donc
/// `position == translation[index]`, sans plus.
///
/// Le chemin ANIMÉ écrit dans `[rsp+34h]` — la composante Y de ce même vecteur (cf. le créneau 9,
/// `movss [rsp+34h],xmm1` après la courbe). Le modèle complet est donc : les rangées restent à
/// la translation de leur table, et c'est la LISTE ENTIÈRE qui glisse d'un décalage Y adouci.
/// Ce module ne porte pas ce décalage : il dépend du temps.
///
/// Voir [`settled_cell_position`] pour le cas stabilisé, qui est celui qu'un compositeur
/// mono-image peut reproduire.
#[must_use]
pub fn cell_position(base: [f32; 3], cell: CellTransform) -> [f32; 3] {
    [
        base[0] + cell.translation[0],
        base[1] + cell.translation[1],
        base[2] + cell.translation[2],
    ]
}

/// La position d'une cellule sur un écran STABILISÉ — la base y est nulle.
///
/// C'est le cas qu'un compositeur mono-image reproduit exactement : tant que `[+0x1B6]` vaut 0,
/// le créneau 9 saute son bloc d'accélération et transmet un vecteur de base nul, si bien que la
/// position se réduit à la translation de la table.
#[must_use]
pub fn settled_cell_position(cell: CellTransform) -> [f32; 3] {
    cell_position([0.0; 3], cell)
}

/// Le rang d'anneau qu'une cellule occupe, depuis l'état de la vue.
///
/// `0x1405438CD`..`0x1405438E8` : `mov ecx,[this+0x198]` ; `cmp ecx,-1` ; `mov eax,[this+0x12C]` ;
/// `add eax,ecx` ; `div [this+0xE8]` — division NON SIGNÉE, le reste est le rang. Prouvé par les
/// 9 cas de `scripts/validate_listview_cell_index.py`, qui comparent la valeur écrite par le jeu
/// à ce calcul.
///
/// Les cellules sont un ANNEAU de `cells` widgets réutilisés, pas une liste d'éléments : ce rang
/// dit quel widget sert, jamais quel élément il montre. Ne pas le confondre avec un index
/// d'élément — c'est ce que `cell_index` borne ensuite sur le compte propre de la cellule.
///
/// `focus` est `[this+0x198]`. Le NOM est une lecture, pas une mesure : ce qui est établi, c'est
/// un champ 32 bits comparé à `-1` qui décale le rang. Rien dans `CMenuListView` ni dans les 28
/// appelants du notificateur `OnEnter` ne l'ÉCRIT (vérifié au désassembleur le 2026-09-13), donc
/// son propriétaire reste inconnu et « focus » ne doit pas être cité comme un fait.
///
/// `-1` fait basculer le jeu sur un rang calculé depuis les arguments de l'appel, que ce module
/// ne modélise pas : d'où le `None`.
#[must_use]
pub fn cell_ring_slot(top: i32, focus: i32, cells: i32) -> Option<u32> {
    if focus < 0 || cells <= 0 {
        return None;
    }
    let somme = u32::try_from(top).ok()?.checked_add(u32::try_from(focus).ok()?)?;
    Some(somme % u32::try_from(cells).ok()?)
}

/// L'index que porte une CELLULE, ramené dans ses bornes — et il BOUCLE.
///
/// `0x140543912` / `0x14054392D` dans `dist/nie.exe` (créneau 60, la boucle qui ré-indexe les
/// cellules visibles après un défilement). Prouvé par
/// `scripts/validate_listview_cell_index.py`, **9 ✓ / 0 ✗**.
///
/// C'est le contraire de la vue : `step_row` et `step_page` ÉCRÊTENT et ne bouclent jamais,
/// alors qu'ici un index hors borne revient au début et un index négatif va au dernier. Le
/// commentaire de `list-page.ts` énonçait « il ne boucle pas » comme une règle unique ; le
/// binaire a deux niveaux au comportement opposé.
///
/// Le `count` est `[cell+0x150]`. Un `count` nul laisse le champ INTACT côté jeu (garde
/// `test cx,cx ; jle`) — ici la fonction est pure, donc l'appelant ne doit pas l'appeler dans ce
/// cas ; `0` est rendu faute de mieux et non parce que le jeu l'écrirait.
#[must_use]
pub fn cell_index(raw: i16, count: i16) -> i16 {
    if count <= 0 {
        return 0;
    }
    if raw >= count {
        return 0;
    }
    if raw < 0 {
        return count - 1;
    }
    raw
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les cas de `scripts/validate_listview_scroll.py`, avec ce que le JEU écrit.
    ///
    /// Ce ne sont pas des attentes rédigées à la main : chaque triplet est la sortie mesurée de
    /// `0x140542B80` émulée sur `dist/nie.exe`. Les recopier ici fait que ce test échoue si le
    /// port dérive, sans exiger unicorn dans `cargo test`.
    fn scroll(total: i32, columns: i32, top: i32, anchor: i32, selected: i32, view_start: i32, view_num: i32) -> ListScroll {
        ListScroll { total, columns, top, anchor, selected, view_start, view_num, counts_partial_row: false, keeps_relative_top: false }
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

    /// Les cas de `scripts/validate_listview_page.py`, avec ce que le JEU écrit.
    #[test]
    fn one_page_forward_and_backward_match_the_emulated_game() {
        let cas: &[Cas] = &[
            (scroll(40, 4, 0, 3, 0, 3, 3), (1, 6, 0), (-3, 0, 0)),
            (scroll(40, 4, 2, 5, 12, 3, 3), (3, 8, 12), (-1, 2, 12)),
            (scroll(100, 5, 4, 8, 55, 4, 4), (5, 12, 55), (0, 4, 55)),
            (scroll(41, 4, 1, 4, 1, 2, 2), (3, 6, 1), (0, 2, 1)),
        ];
        for (depart, avant, arriere) in cas {
            let mut v = *depart;
            v.step_page(Step::Forward);
            assert_eq!((v.top, v.anchor, v.selected), *avant, "avant sur {depart:?}");
            let mut v = *depart;
            v.step_page(Step::Backward);
            assert_eq!((v.top, v.anchor, v.selected), *arriere, "arriere sur {depart:?}");
        }
    }

    /// `keeps_relative_top` n'est pas cosmétique : même départ, une page d'écart sur la tête.
    #[test]
    fn the_relative_top_flag_changes_where_the_view_lands() {
        let mut colle = scroll(100, 5, 4, 8, 55, 4, 4);
        assert!(colle.step_page(Step::Forward));
        assert_eq!((colle.top, colle.anchor), (5, 12));

        let mut relatif = ListScroll { keeps_relative_top: true, ..scroll(100, 5, 4, 8, 55, 4, 4) };
        assert!(relatif.step_page(Step::Forward));
        assert_eq!((relatif.top, relatif.anchor), (8, 12), "trois lignes plus bas");
    }

    /// Une ancre déjà en tête refuse le pas arrière — et n'écrit rien.
    #[test]
    fn a_page_step_at_the_top_reports_that_nothing_moved() {
        let mut v = scroll(40, 4, 0, 0, 0, 3, 3);
        assert!(!v.step_page(Step::Backward));
        assert_eq!((v.top, v.anchor), (0, 0));
    }

    /// Les cas de `scripts/validate_listview_cell_index.py` : le jeu écrit `[cell+0x154]`.
    #[test]
    fn a_cell_index_wraps_where_the_view_clamps() {
        // (brut, nombre d'éléments de la cellule, index attendu)
        let cas = [
            (0, 8, 0),
            (3, 8, 3),
            (3, 2, 0), // brut hors borne -> retour au début
            (7, 8, 7),
            (7, 4, 0),
            (5, 6, 5),
            (4, 8, 4),
        ];
        for (brut, count, attendu) in cas {
            assert_eq!(cell_index(brut, count), attendu, "brut={brut} count={count}");
        }
        // La borne basse est l'autre moitié du modulo, lue au même endroit.
        assert_eq!(cell_index(-1, 8), 7);
        assert_eq!(cell_index(-1, 1), 0);
    }

    /// Le rang d'anneau, sur les mêmes triplets que l'émulateur a validés.
    #[test]
    fn the_ring_slot_comes_from_the_view_state_not_from_the_arguments() {
        // (top, focus, cells) -> rang, tels que mesurés dans validate_listview_cell_index.py
        assert_eq!(cell_ring_slot(0, 0, 4), Some(0));
        assert_eq!(cell_ring_slot(1, 2, 4), Some(3));
        assert_eq!(cell_ring_slot(3, 4, 8), Some(7));
        assert_eq!(cell_ring_slot(0, 5, 8), Some(5));
        // L'anneau se referme : c'est un modulo, pas un écrêtage.
        assert_eq!(cell_ring_slot(6, 3, 4), Some(1));
        // `-1` = pas de focus ; le jeu prend alors un autre chemin, non modélisé ici.
        assert_eq!(cell_ring_slot(0, -1, 4), None);
        assert_eq!(cell_ring_slot(0, 0, 0), None);
    }

    /// Les cas de `scripts/validate_listview_filter_step.py` : le jeu écrit ces index.
    #[test]
    fn a_filter_list_wraps_where_the_content_list_clamps() {
        let cas = [
            (5, 0, 1, 4),
            (5, 4, 0, 3),
            (8, 7, 0, 6),
            (8, 0, 1, 7),
            (2, 1, 0, 0),
            (1, 0, 0, 0),
        ];
        for (count, selected, avant, arriere) in cas {
            assert_eq!(filter_step(count, selected, Step::Forward), avant, "avant {count}/{selected}");
            assert_eq!(filter_step(count, selected, Step::Backward), arriere, "arriere {count}/{selected}");
        }
        // Le contraste, sur un même départ : la vue de contenu ne bouclerait pas.
        let mut vue = scroll(40, 4, 7, 7, 28, 3, 0);
        assert!(!vue.step_row(Step::Forward), "la vue de contenu s'arrete");
        assert_eq!(filter_step(8, 7, Step::Forward), 0, "le filtre revient au debut");
    }

    /// Les cas de `scripts/validate_listview_cell_position.py` : ce que le jeu calcule.
    #[test]
    fn a_cell_sits_at_the_base_plus_its_translation() {
        let cas = [
            ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            ([0.0, 0.0, 0.0], [10.0, 20.0, 30.0], [10.0, 20.0, 30.0]),
            ([1.0, 2.0, 3.0], [10.0, 20.0, 30.0], [11.0, 22.0, 33.0]),
            ([0.5, 0.5, 0.5], [100.0, 200.0, 300.0], [100.5, 200.5, 300.5]),
            ([640.0, 100.0, 0.0], [0.0, 216.0, 0.0], [640.0, 316.0, 0.0]),
        ];
        for (base, translation, attendu) in cas {
            assert_eq!(cell_position(base, CellTransform { translation }), attendu);
        }
    }

    /// Les paramètres RÉELS de `team14_01_chara_bank_list.objbin`, décodés par `niers decode`.
    ///
    /// Ce test ne prouve pas un comportement du jeu : il fixe le PONT entre un fichier et le
    /// modèle, pour qu'un changement d'offset ou de nom se voie. La correspondance elle-même
    /// vient de la table de descripteurs du binaire, pas d'une lecture des noms.
    #[test]
    fn declared_params_of_the_player_bank_reach_the_model() {
        let params = DeclaredParams { view_start: 1, view_num: 7, line_num: 6, locator_num: 54 };
        let vue = ListScroll::from_declared(params, 600, 6);
        assert_eq!(vue.view_start, 1, "mViewStart -> [0xC0]");
        assert_eq!(vue.view_num, 7, "mViewNum -> [0xC4]");
        assert_eq!((vue.total, vue.columns), (600, 6), "etat d execution, fourni par l appelant");
        assert_eq!((vue.top, vue.anchor, vue.selected), (0, 0, 0), "position initiale");

        // La butée descendante emploie `mViewStart + mViewNum`, soit 8 lignes ici : un pas est
        // donc refusé dès que la tête atteint `rows - 8`. C'est ce que `step_row` calcule.
        let mut v = ListScroll { total: 60, columns: 6, ..vue };   // 10 lignes
        v.top = 1;
        assert!(v.step_row(Step::Forward), "1 + 8 < 10");
        assert_eq!(v.top, 2);
        assert!(!v.step_row(Step::Forward), "2 + 8 == 10 : butee");
    }
}
