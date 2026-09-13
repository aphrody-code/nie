# Convergence visuelle de `nie-web` et Inacord

Mesure effectuée le 2026-09-13 sur le checkout
`db79c30743ec47fbd1b20555ed3f69f99a3557d2`. Ce document analyse les trois captures fournies
avec la demande et le code qui les produit. Il ne transforme aucune capture en asset et n'en
reproduit aucune dans le dépôt.

## Conclusion de la baseline `db79c307`

À ce commit, le code était déjà unifié au niveau du routeur, de la feuille d'entrée et du shell :
`App.tsx` annonçait un état de route, un `UnifiedShell` et un `app.css`. La dislocation visible ne
venait donc plus de deux applications concurrentes. Elle venait du fait que le shell unifié restait la coquille
sombre d'un outil desktop, tandis que ses enfants tentent de dessiner les écrans clairs et plein
cadre du jeu. L'Avatar cumule même trois navigations visibles : barre latérale de l'outil, menu
interne du jeu et bandeau d'onglets ajouté au pied.

La décision issue de cette baseline était :

1. les écrans du jeu occupent le cadre de jeu entier, sans barre latérale ni barre supérieure de
   l'outil ;
2. les fonctions de catalogue — recherche, filtres, compteurs, catégories, pagination, favoris,
   téléchargements — restent disponibles, mais dans des écrans composés avec les primitives et
   les layouts du jeu ;
3. Rust/WASM possède l'état de présentation, le layout, le choix des régions VFS et la
   composition des pixels ; React/TypeScript reste un hôte mince pour la route, le DOM
   accessible, le focus, les API navigateur et le montage du `<canvas>`.

« Tout en WASM » ne doit pas signifier réimplémenter le routeur, `ResizeObserver`, les champs
accessibles ou l'historique navigateur en Rust. La cible mesurable est **une seule présentation
Rust/WASM et aucune seconde composition visuelle en CSS**, avec un binding web mince.

## État du lot de convergence au 2026-09-13

Le working tree postérieur à la baseline a supprimé le shell auteur autour des routes publiques.
La sidebar, la top bar, les contrôles Lua/mod/RE, le SQLite générique, l'hexadécimal et les chemins
CPK physiques restent sous `/inacord/*`; les mêmes propriétaires servent des variantes publiques
explicitement read-only. Les actions principales du menu sont Chara Edit (contrôle natif),
Explorer, Éditeur 3D et Galerie. `/modes` reste interne et aucun faux mode public ne prétend lancer
un monde distinct.

Les filtres URL/API des catalogues, modèles, textes, joueurs, entités, Explorer, Galerie et
recherche sont conservés dans leurs vues. Le chargement initial ne précharge pas les médias : il
fait partir le WASM tôt et attend le VFS alimenté, le bundle et une lecture réussie des deux bases
SQLite avant d'entrer dans le menu. Modèles, textures, vidéo, audio, fonte bitmap et scènes
secondaires restent à la demande.

Cette convergence n'atteint pas encore la cible finale de présentation unique. Le menu principal
et plusieurs écrans restent des compositions DOM/CSS pilotées par des scènes et régions VFS; ils
ne sont pas un canevas entièrement rasterisé par Rust/WASM. Les couleurs structurelles utilisent
une seule palette de rôles mesurés, mais certaines cartes de données conservent des couleurs
sémantiques propres. Enfin, le gate fonte réelle est rouge et le dernier résultat connu de
`just ecrans` n'est pas vert; une nouvelle exécution du lot doit encore être consignée. Aucune
revendication de parité `nie.exe`, de pixel-perfect ou de production-ready n'est recevable.

## Hiérarchie des sources

| Source | Usage retenu | Limite ou rejet |
|---|---|---|
| `data/menu/main_menu_alt.png`, 2560×1440, SHA-256 `b4500eeff3a27884f74865eadc450f2e5de1805a906027038d8423e8f4327507` | Oracle pixel local du menu, conformément à `docs/mainmenu01-visual-analysis.md` | Capture de comparaison, pas texture VFS ni layout runtime ; elle ne doit jamais devenir un fond public |
| `data/menu/avatar_edit_top.png`, 2560×1440, SHA-256 `5db9a5f513ca1100e73059db2870040476acf0e91b25bc77c3a8d070c047d7c6` et famille `avatar_edit_*.png` | Oracles visuels secondaires pour le cadre Avatar, la pose et le chrome | Comparer uniquement le même sous-écran et le même état ; `avatar_edit_style.png` contient une notification du système et ne convient pas à un SSIM global |
| Capture A `codex-clipboard-1fe2…png`, 2559×1284, SHA-256 `114bb3e3…cdc35f` | Mesurer ce que le site affiche actuellement pour le menu | La barre du navigateur et le redimensionnement sont inclus ; ce n'est pas une capture directe de `nie.exe` |
| Capture B `codex-clipboard-10d969…png`, 2559×1275, SHA-256 `26ca996a…006ff6` | Mesurer l'assemblage shell + Avatar, le texte corrompu et la pose | L'état exact de l'écran Avatar ne correspond pas avec certitude à un oracle `avatar_edit_*.png` ; aucun SSIM n'est donc recevable |
| Capture C `codex-clipboard-db6ef…png`, 2515×1258, SHA-256 `87317fee…d10b` | Mesurer l'assemblage shell + catalogue Modèles | Capture navigateur et contenu dynamique ; utile pour l'écart structurel, pas comme vérité de géométrie du jeu |
| `docs/mainmenu01-visual-analysis.md` | Baseline existante : runtime partiel, géométrie, SSIM et frontières non résolues | Les nombres restent ceux de leur propre date et de leur propre commande ; ne pas les mélanger aux captures de cette demande |
| `packages/inacord-ui/src/shell/game-tokens.css` | Expliquer la palette actuellement injectée | Rejeté comme source des couleurs natives du menu : le fichier dit lui-même que ses teintes viennent des 74 frames du pet Aphrody, puis que clarté et chroma sont ajustées par rôle |
| `data/menu/main_menu.png` | Ancien oracle utile aux baselines déjà publiées | Rejeté comme source principale : `docs/mainmenu01-visual-analysis.md` signale une surimpression d'outil de capture |

L'ordre de vérité pour une correction reste : région G4TX extraite du VFS, rendu déterministe du
dépôt, layout runtime Lua/C++, puis capture. Une couleur prélevée dans A, B ou C décrit le rendu
observé ; elle ne devient pas pour autant une constante du jeu.

## Mesures des trois captures

### A — menu affiché dans le navigateur

La capture fait 2559×1284. La barre navigateur occupe `y=0..46`; le viewport analysé est donc
`2559×1237` (`y=47..1283`). Sa palette k-means à huit classes est dominée par :

| Part | Couleur | Interprétation limitée à la capture |
|---:|---|---|
| 54,67 % | `#F2F8FB`, Oklch `0.975 0.008 228.9°` | fond blanc bleuté |
| 22,78 % | `#BFDDED`, Oklch `0.881 0.039 231.1°` | motifs et aplats bleu pâle |
| 9,64 % | `#54BE68`, Oklch `0.718 0.157 147.6°` | panneau vert de l'équipe |
| 4,57 % | `#2B5288`, Oklch `0.438 0.100 257.0°` | famille bleu nuit des tuiles |

La première grande tuile se segmente dans la boîte `x=308..600`, `y=750..903`, soit
`293×154`. Son bord gauche mesure `dx/dy=-0,4007`, donc `-21,84°`, avec `R²=0,9996`. Le bord
droit est contaminé par le contenu (`R²=0,2771`) et est explicitement rejeté. Sur la rangée
complète (`x=300..2280`, `y=750..925`), les classes principales sont `#1C4379` (14,49 %),
`#2D5893` (14,48 %), `#4070AF` (10,96 %) et `#0B2B5B` (10,61 %). Le liseré de sélection de
l'action inférieure est `#0CFDDC` à 79,71 % du masque cyan mesuré.

Les huit actions principales puis les trois actions inférieures sont de grandes cibles directes,
centrées dans la scène. Le bouton HTML « Réessayer le son », en haut à droite, est un contrôle de
l'hôte : il ne faut pas l'utiliser comme référence du chrome natif.

Pour vérifier que A n'est pas l'oracle natif, un canevas 16:9 a été **inféré** au centre du
viewport (`2199×1237+180+47`), puis ramené à 2560×1440. `pixel comparer` contre
`main_menu_alt.png` donne un SSIM de **0,363226** et **11,0417 %** de pixels exactement égaux.
Le recadrage est une hypothèse et ce nombre n'est donc qu'un diagnostic ; ce n'est pas un gate de
publication. Visuellement, les blocs Informations, compteurs, version, DLC et aides du pied de
l'oracle manquent aussi dans A.

### B — Avatar enchâssé dans le shell

La capture fait 2559×1275. La zone latérale mesurée est `278×1275` et la barre supérieure
`2281×60`. Elles laissent à la scène une boîte de `2281×1215`, au lieu d'un plein cadre 16:9.
Le code confirme l'intention : `SIDEBAR_WIDTH=200`, `TopBar` fait 48 unités CSS et tout écran sauf
`/` passe dans `UnifiedShell`.

La barre latérale alterne presque à parts égales `#131420` (43,36 %) et le gris clair
`#BDC1C8` (43,30 %). Une ligne inactive mesurée à `253×30` contient 88,19 % de `#C0C0C2`; la
classe bleu clair associée aux lettres et bords est `#9EC0F2` (3,79 %). Leur contraste calculé
est **1,03:1**, insuffisant même pour du grand texte. Une ligne active contient 83,60 % de
`#0265E5`; `#F8F8F8` sur ce bleu vaut **4,95:1** et reste lisible.

Ce gris n'est pas un fallback de chargement. Une sonde live 1920×1080 du 2026-09-13 a compté
**22** éléments `.native-tool-surface`, et les deux régions off/on de
`option01_02.g4tx` ont répondu HTTP 200. Le code explique la déformation : la région source est
déclarée `1216×76` (ratio 16,0), puis l'`<svg>` utilise `preserveAspectRatio="none"` dans une
ligne observée à ratio 8,43. À hauteur constante, elle n'occupe que 52,7 % de la largeur que son
ratio demanderait, soit environ **47 % de compression horizontale**. Un matériau natif prévu
pour une longue ligne d'options ne peut pas devenir une petite ligne de sidebar par étirement.

La scène Avatar présente deux écarts immédiatement bloquants :

- les libellés composés dans la scène sont remplacés par des suites de glyphes ressemblant à du
  CJK, alors que les libellés React du shell restent lisibles ; la capture prouve le mojibake,
  pas sa cause ;
- le modèle est en T-pose, bras horizontaux, tandis que les oracles Avatar montrent des poses
  de présentation. Une composition correcte des pièces ne prouve donc pas encore une animation,
  une pose ou un cadrage fidèle.

`PLAN.md` consigne qu'un défaut du blitter `nie_formats::font` touchait tous les hôtes et a été
corrigé. Il faut vérifier le SHA du bundle live avant toute nouvelle correction d'encodage : la
capture peut représenter un déploiement antérieur au checkout analysé.

### C — catalogue Modèles dans le shell

La capture fait 2515×1258. La barre navigateur occupe `y=0..47`; dans le viewport restant, la
sidebar mesure environ `272×1210` et la barre supérieure `2243×60`. Le contenu utile mesuré
`2243×1150` est composé à 51,94 % de `#141521`, 29,60 % de `#272E3C` et 12,89 % de blanc.
Cette masse sombre est l'inverse de la hiérarchie claire de A.

Quelques boîtes structurantes :

| Élément | Boîte mesurée | Palette dominante |
|---|---:|---|
| onglets du catalogue | `451×60` | `#292A37` à 93,52 % |
| titre biseauté « Modèles » | `403×70` | `#1F5BB0` à 41,99 %, `#3F72BD` à 38,94 % |
| champ de recherche | `1987×60` | blanc à 91,52 %, bord `#31558A` à 6,74 % |
| première carte | `252×324` | `#2B3241` à 36,84 %, `#1E222F` à 36,12 %, pied blanc à 21,75 % |

Le catalogue préserve bien les capacités demandées : quatre vues média (`Textures`, `Modèles`,
`Sons`, `Vidéos`), recherche textuelle, grille de modèles et identifiants. La capture fixe aussi
la parité minimale des filtres visibles : `Personnages 5 490`, `Techniques 273`, `Objets 237`,
`Animaux 2`, `Keshin 100`, `Armures 189`. Ces nombres décrivent la réponse de cette capture, pas
un inventaire durable du VFS. Mais l'écran combine trois vocabulaires :
sidebar grise issue d'une région native étirée, onglets/cartes rectangulaires d'outil desktop et
seul titre biseauté proche du jeu. L'unification fonctionnelle ne suffit donc pas à produire une
unité visuelle.

## Ce que le code de la baseline explique

- `apps/nie-web/src/App.tsx` fait déjà de `UnifiedShell` le cadre de chaque écran secondaire,
  tandis que `/` garde seul le plein viewport. La rupture est une branche de layout explicite,
  pas une feuille CSS chargée au hasard.
- `apps/nie-web/src/shell/UnifiedShell.tsx` réserve une sidebar de 200 CSS px et un `pt-12` au
  contenu. Ajouter l'Avatar à cette branche garantit que sa scène est réduite avant même sa
  composition.
- `packages/inacord-ui/src/shell/game-canvas.tsx` est la bonne frontière : les enfants restent
  dans le repère natif et un seul calcul met la scène à l'échelle. Le shell doit donner à ce
  composant le cadre voulu, pas modifier les coordonnées internes.
- `packages/inacord-ui/src/shell/native-tool-surface.tsx` possède une vraie provenance VFS, mais
  l'usage hôte n'a pas de provenance de placement. « Asset natif » et « interface fidèle » ne
  sont pas synonymes.
- `packages/inacord-ui/src/shell/inacord-tool-theme.css` dit honnêtement que ses rôles sont ceux
  d'un outil auteur et non des mesures du menu PC. Il ne doit plus piloter les écrans du jeu.
- `apps/nie-web/src/pages/avatar-studio.css` documente encore la tension : la scène serait « le
  chrome du jeu uniquement », mais sa boîte est celle que le shell lui accorde et un footer
  supplémentaire est superposé à la scène native.

## Décision vers mesure d'origine

| Décision de migration | Mesure ou preuve d'origine | Gate attendu |
|---|---|---|
| Ne jamais encadrer un écran jeu par la sidebar/topbar | B réserve 278 px à gauche et 60 px en haut ; C réserve environ 272 px et 60 px ; `App.tsx` applique le shell à tous les écrans secondaires | Rectangle du `GameCanvas` égal au viewport de test, hors éventuelle letterbox 16:9 mesurée |
| Conserver la géométrie native dans un seul repère | `GameCanvas` documente 1280×720 pour `mainmenu01`; les captures Avatar de référence sont 2560×1440 et `avatar-studio.css` documente une scène 1920×1080, même ratio 16:9 | Export de layout et capture portent le même ratio, positions comparées après une seule matrice d'échelle |
| Réutiliser la pente du menu, pas une approximation générique | Tuile A : `-21,84°`, `R²=0,9996`; la baseline du dépôt donne `-21,80°` pour cette famille. `game-screens.css` mesure par ailleurs environ `-10°` pour les onglets/options | Chaque famille conserve sa pente mesurée ; pas de jeton `skew` universel appliqué aux deux |
| Retirer `NativeToolSurface` de la sidebar | Asset 1216×76 (16,0) rendu 253×30 (8,43), compression horizontale ≈47 % ; 22 instances chargées avec HTTP 200 | Aucun `preserveAspectRatio="none"` sur une région native ; aspect ou découpe 9-slice prouvée |
| Corriger le contraste des lignes avant tout skin final | B inactive `#9EC0F2/#C0C0C2 = 1,03:1`; active `#F8F8F8/#0265E5 = 4,95:1` | Texte normal ≥4,5:1, grand texte ≥3:1, sans confondre ce gate d'accessibilité avec la fidélité pixel |
| Tirer les couleurs de l'écran visé | A : fond `#F2F8FB` 54,67 %, bleu pâle `#BFDDED` 22,78 % ; C : sombre `#141521` 51,94 %. `game-tokens.css` provient du pet Aphrody | Palette mesurée sur les régions VFS ou la capture oracle du même écran, provenance inscrite avec crop et part |
| Garder recherche et filtres en les remaquettant | C montre champ 1987×60, familles chiffrées et grille ; ces fonctions sont déjà présentes | Tests de parité des actions et des résultats avant/après, plus capture visuelle du nouvel écran |
| Bloquer une livraison Avatar avec mojibake | B : texte scène illisible mais shell français lisible ; `PLAN.md` relie un défaut antérieur au blitter partagé | `just ecrans` sur texte réel, vérification du SHA live, au moins une chaîne connue lisible dans chaque locale servie |
| Bloquer une livraison Avatar en T-pose | B : bras horizontaux ; oracles Avatar : poses de présentation | Animation/pose identifiée par modèle + temps, capture comparée sur même état et même caméra |
| Faire de Rust/WASM le propriétaire de la présentation | Le compositeur est déjà annoncé dans `nie_formats::menu_layout` via WASM ; les 629 lignes restantes classées dans `PLAN.md` sont surtout des modèles de présentation catalogue | Un DTO/display-list Rust par écran, consommé par web et natif ; TS ne recalcule ni pagination, ni placement, ni style visuel |
| Ne pas revendiquer « pixel-perfect » pendant la migration | A contre oracle, après crop 16:9 inféré : SSIM 0,363226 et 11,0417 % exact ; la baseline historique du menu reste partielle | SSIM publié sur viewport, état, crop et référence fixes ; hausse mesurée à chaque lot, puis seuil explicite avant la revendication |

## Séquence de migration issue de la baseline

1. Geler une matrice de routes et d'actions. Pour chaque écran, compter filtres, catégories,
   actions clavier/manette, états vides/erreur, téléchargements et navigation. C'est le contrat de
   non-régression fonctionnelle.
2. Produire des captures déterministes au même viewport et au même état pour le menu, Avatar,
   Modèles et un écran de filtres. Enregistrer commit, dimensions, région comparée et SHA-256.
3. Retirer le shell desktop autour des écrans jeu. Exposer ses outils depuis une entrée du menu
   et, dans les écrans catalogue, depuis une barre de commandes dessinée comme un écran du jeu.
4. Remplacer la sidebar aux 22 surfaces étirées par une navigation de scène issue d'un layout
   Rust. La région `option_list_base02_*` ne doit être réutilisée que dans sa géométrie native ou
   avec une découpe démontrée par le format.
5. Déplacer les modèles `gallery`, `roster`, `shop`, recherche, filtre et pagination dans leur
   propriétaire Rust. Le module WASM renvoie état et display-list ; le binding monte canvas et
   contrôles sémantiques.
6. Réutiliser `nie_formats::menu_layout` comme unique compositeur pour fonds, sprites, texte,
   teinte, mélange et ancres. Les CSS `game-*` ne gardent que les contrôles DOM superposés dont la
   géométrie vient du même layout.
7. Corriger séparément le texte réel puis la pose/animation Avatar. Une police lisible avec un
   modèle en T-pose, ou une belle pose avec du mojibake, échoue encore le gate.
8. Exécuter les gates étroits (`nie-ui`, `nie-wasm`, typecheck) puis `just ecrans`. Publier les
   comptes et le SSIM ; ne pas transformer l'absence de régression fonctionnelle en preuve
   visuelle.

## Commandes et résultats de mesure

Les chemins `<capture-A>`, `<capture-B>` et `<capture-C>` désignent les trois fichiers fournis,
hors dépôt.

```text
identify <capture-A> <capture-B> <capture-C>
# 2559x1284 ; 2559x1275 ; 2515x1258

sha256sum <capture-A> <capture-B> <capture-C>
# 114bb3e3437895cf535a31389add1c45593be125345f62076fc5ba50dbcdc35f
# 26ca996a83f67a7aaa65e6b66a089764a9888359fc5a594c45382b1234006ff6
# 87317feee3c225f17236a90f3605d84b145cd05258df63d83199f294b9edd10b

target/release/pixel mesurer <capture-A> --boite 0 47 2558 1283 --k 8
# palette du viewport A ; 3 165 483 pixels analysés

target/release/pixel mesurer <capture-A> --boite 285 742 600 920 --sombre 150 --k 6
# bbox 308,750 -> 600,903 ; gauche -21,84°, R² 0,9996 ; droite rejetée, R² 0,2771

target/release/pixel mesurer <capture-B> --boite 12 86 264 115 --k 6
target/release/pixel mesurer <capture-B> --boite 12 320 264 351 --k 6
# ligne inactive 253x30, #C0C0C2 88,19 % ; active 253x32, #0265E5 83,60 %

target/release/pixel mesurer <capture-C> --boite 272 108 2514 1257 --k 8
target/release/pixel mesurer <capture-C> --boite 333 650 584 973 --k 8
# contenu 2243x1150 ; première carte 252x324

magick <capture-A> -crop 2199x1237+180+47 +repage -resize 2560x1440! /tmp/niers-capture1-canvas.png
target/release/pixel comparer /tmp/niers-capture1-canvas.png data/menu/main_menu_alt.png --json
# ssim 0.36322615020342736 ; pixels_dans_tolerance_pct 11.041666666666666 ; tolerance 0
```

Les palettes de boîtes pleines déclenchent volontairement l'avertissement « contour
invraisemblable » de `pixel` : elles servent ici à mesurer des aplats, pas une épaisseur de trait.
