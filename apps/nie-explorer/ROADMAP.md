# Roadmap nie-explorer

Suivi des demandes utilisatrice sur l'app desktop Tauri — chaque entrée cite l'état réel du
code, pas une supposition. Complète (ne remplace pas) `docs/PLAN.md`
(portage pixel-perfect `nie.exe`), scope ici = l'app `nie-explorer` uniquement.

**Bilan (2026-08-08)** : toutes les sections marquées ✅ ci-dessous ont été vérifiées par des
tests réels contre le vrai jeu (round-trip byte/pixel-exact, pas juste « ça compile ») —
détail dans chaque section.

**Mise à jour (2026-08-10) — l'app ne démarrait plus, et pourquoi.** Le portage `nie-trace` live
(§4.3, 2026-08-09) avait introduit des DTO à champs `u64`/`i64`. `specta` **refuse** d'exporter les
types « BigInt » vers TypeScript (perte de précision silencieuse) et ce refus est **fatal** : le
thread d'export des bindings (lancé à chaque `cargo tauri dev`, cf. `run()`) paniquait avant même
la création de la fenêtre. `nie-explorer` ne se lançait donc plus du tout en dev — d'où « l'UI est
cassée ». Tous les champs concernés (`ReTraceRegionDto::size`, `ReTraceDumpStatsDto::bytes`,
`TrophyDto::category`, `QuestDto::{phase,quest_type}`, `ItemDto::price`, et les retours de
`copy_disk_file_to_appdata`/`export_mod_as_cpk`/`stage_texture_replacement`) sont passés en `f64` :
toutes ces valeurs sont bornées très en dessous de 2⁵³, donc la conversion est **sans perte**,
contrairement à un `as u32` qui tronquerait. Le round-trip est vérifié par un lancement réel
(`bun run tauri dev` va jusqu'à `Running target\debug\nie-explorer.exe`, plus aucune panique).

Corrigés dans la foulée, tous vérifiés sur le code (pas supposés) :
- **Frameless réel.** `menu.setAsWindowMenu()` demandait à Windows une barre de menu native, ce qui
  suppose une frame native : bordure, légende et boutons système revenaient malgré
  `decorations: false`. Idem `window_vibrancy::apply_mica`, qui étend la frame DWM dans la zone
  client. Les deux sont supprimés. La barre Fichier/Édition/Affichage est désormais rendue dans la
  barre supérieure custom (`components/AppMenu.tsx`) et déroule de **vrais popups Win32**
  (`Menu.popup()`), avec les accélérateurs réenregistrés en écoute clavier
  (`useAppMenuShortcuts`). `set_titlebar_theme` ne fait plus que `DWMWA_USE_IMMERSIVE_DARK_MODE`.
- **Boutons réduire/agrandir/fermer inopérants.** `capabilities/default.json` n'accordait aucune
  permission `core:window:*` : chaque clic était refusé silencieusement, y compris
  `start-dragging` (donc la zone de titre custom elle-même). Le fichier accorde maintenant toutes
  les permissions `allow-*`/`default` du schéma (demande utilisatrice explicite) et une portée
  `fs` couvrant tout le disque.
- **Fenêtre non redimensionnable.** Sans cadre natif, plus de zone de saisie sur les bords :
  8 poignées invisibles (`components/ui/window-resize-handles.tsx`) appellent
  `startResizeDragging`, donc le redimensionnement reste fait par Windows.
- **La palette de commandes plantait l'app.** `CommandDialog` ne plaçait pas ses enfants dans
  `<Command>` ; `CommandInput`/`CommandList`/`CommandItem` (cmdk) lisent un contexte fourni par ce
  composant racine et levaient à la première ouverture.
- **Boutons imbriqués dans `ModsView`.** La rangée d'un mod était un `<button>` contenant un
  `Switch` (autre `<button>`) et, en renommage, un `<input>` : HTML invalide, le navigateur
  restructure le DOM et le contrôle intérieur ne reçoit plus ses clics. Passée en
  `<div role="button">`, plus un bouton ✏️ explicite pour renommer.
- **« Ajouter à un mod… » invisible.** `showVfsFileContextMenu` sait afficher l'entrée depuis
  toujours, mais `ExplorerView` ne lui passait jamais `onStageIntoMod`.
- **Menu contextuel de barre latérale** (écart §2.8 explicitement laissé ouvert) :
  `showPlaceContextMenu` — ouvrir/épingler/désépingler/retirer des récents/copier le chemin, plus
  `forgetRecent`/`clearRecents` côté `lib/places.ts` (un récent ne pouvait pas être retiré).
- **Recherche sans garde anti-race** (§2.7, écart relevé et non fermé) : jeton de séquence dans
  l'effet de chargement d'`ExplorerView`, toute réponse périmée est jetée.
- **Doublons UI** : deux barres latérales concurrentes (onglets globaux + `PlacesSidebar` interne)
  fusionnées en une seule, comme `SpacesSidebar` amont ; `<select>` HTML brut de `DetailPane`
  remplacé par le `Select` du design system ; double navigation `onClick`+`onDoubleClick` sur les
  dossiers.

## 12. Binder `Live.*` — Lua lit le process `nie.exe` vivant (lecture seule) ✅ (2026-08-10)

Demande utilisateur : « on doit pouvoir exécuter des scripts Lua dans le process de nie.exe,
utilise nie-trace pour ça ». Clarifiée ensuite : **lire** le process, pas changer sa RAM.

**Ce qui a été livré** : un binder `Live` (`nie_lua::host::LiveBinder`) exposé à la session Lua —
`Live.FindProcess()`, `Live.Read(addr, len)`, `Live.ReadU32(addr)`, `Live.ReadU64(addr)`. Le
script tourne dans NOTRE VM (mlua) et lit la mémoire de `nie.exe` en cours d'exécution via
`nie-trace`. Suivi de pointeur, lecture de structure, valeur réelle à l'instant T — sans dump figé
ni binaire Rust à recompiler.

**Strictement lecture seule, et vérifié comme tel.** Le binder n'expose aucune écriture ; un test
(`live_lit_la_memoire_sans_jamais_ecrire`) confirme qu'aucun `Write`/`Poke`/`Set` n'existe sur la
table `Live`. Les fermetures qui l'alimentent s'appuient sur `nie_trace::{find_pid_by_name,
read_exact, find_module_base}`, dont la surface est elle-même lecture seule (cf. §4.3/§5 :
`write`/`patch_eac` sur un process vivant restent non exposés — inchangé). **Aucun octet n'est
écrit dans `nie.exe`** par ce chemin. L'injection de code dans le process vivant a été explicitement
écartée : elle supposerait d'écrire dans la mémoire du jeu et d'y détourner l'exécution sous EAC
actif, ce qui sort du cadre du projet.

**Détails d'implémentation** :
- Le binder est **générique** (fermetures `find_process`/`read`), défini dans `nie-lua` sans
  dépendre de `nie-trace` : la couche moteur (`crates/engine/`) ne doit pas dépendre d'une crate
  de RE (`crates/forge/`). Le câblage `nie-trace` réel vit dans `nie-explorer`
  (`lua_session.rs::build_session`), où `nie-trace` est déjà une dépendance (`re_trace.rs`).
- Le pid trouvé est **mis en cache** entre deux lectures — un suivi de pointeur ferait sinon des
  dizaines d'énumérations de process. Cache invalidé sur échec de lecture, avec une ré-résolution
  (le jeu a pu être relancé sous un nouveau pid).
- Les adresses acceptent nombre ou chaîne (`"0x…"`) ; `ReadU32`/`ReadU64` décodent en
  petit-boutiste (le geste de base du suivi de pointeur). Lectures plafonnées à 1 Mio.
- UI : bouton « Exemple Live » dans l'onglet Lua qui amorce un script prêt à lancer (FindProcess +
  lecture de 16 octets à la base du module, affichés en hexa). `Live` apparaît dans le panneau
  « API moteur » comme fourni.

33 tests host verts (dont le nouveau), clippy 0 warning, `tsc`/`vite build` verts.

---

## 11. Lua « moteur de jeu » — patterns repris d'Overload ✅ (2026-08-10)

Demande utilisateur : « analyse comment Overload intègre Lua dans un game engine et améliore
nie-engine / nie-editor / nie-lua / nie-explorer ».

**Analyse d'Overload** (`OvCore/Scripting`, C++ + sol3) :
- `ScriptInterpreter` détient le `sol::state` ; `RefreshAll()` **détruit et recrée** le contexte
  entier, avec ce constat en commentaire amont : *« unconsidering a script is impossible with Lua,
  we have to reparse every behaviours »*.
- `Behaviour` (composant ECS) charge `<nom>.lua`, **exige que le script renvoie une table**, et y
  injecte `owner`.
- Cycle de vie `OnAwake/OnStart/OnEnable/OnUpdate/OnFixedUpdate/OnDestroy…`, où **un callback
  absent est silencieusement ignoré**.
- Exposition **par binders séparés** (`LuaGlobalsBinder`, `LuaMathsBinder`, `LuaActorBinder`…)
  agrégés par `LuaBinder::CallBinders`, chacun posant une table cohérente (`Debug`, `Inputs`,
  `Math`, `Resources`, `Physics`).

**Asymétrie assumée** : Overload *conçoit* l'API que ses scripts consommeront ; niers la
*retro-conçoit* à partir de ~1 100 scripts déjà compilés. Les patterns valent, la finalité diffère
— d'où l'ajout qui n'existe pas chez Overload : mesurer l'écart entre ce que les scripts réclament
et ce que l'hôte fournit.

**Livré dans `nie-lua`** :
- **`host`** — trait `HostBinder` + `HostRegistry` composable, sur le modèle de `CallBinders`.
  Binders `Debug` (journal par niveau, dans un tampon et non sur stdout), `Math` (générateur
  **déterministe** : deux exécutions du même script donnent la même suite, sans quoi comparer deux
  passages serait impossible) et `Vfs` (parcourir les ~255 000 assets depuis un script d'analyse,
  au lieu d'un binaire Rust à recompiler). `installed_names()` trace ce que chacun pose.
- **`session`** — `LuaSession` : VM **persistante**, `attach()` avec le contrat « le script renvoie
  une table », `broadcast()` d'un callback (absent = ignoré, comme l'amont), `reload()` qui recrée
  la VM et ré-attache — le `RefreshAll` d'Overload, pour la raison exacte qu'il documente.
  `api_report()` confronte réclamé et fourni : **la liste de travail du portage moteur, produite
  par l'exécution elle-même**.

**Livré dans `nie-explorer`** :
- **`lua_session.rs`** — la session vit sur un **thread dédié** avec un canal de requêtes :
  `mlua::Lua` n'est ni `Send` ni `Sync`, et Tauri exige les deux de tout état géré. C'est
  l'équivalent applicatif du `ScriptInterpreter` qui vit tant que l'app vit.
- Onglet Lua enrichi : bascule **session persistante** (la console devient un vrai REPL — avant,
  `x = 1` puis `x` répondait `nil`, et chaque évaluation repayait une exécution complète du
  script), boutons **Attacher** / **Recharger**, barre de diffusion du cycle de vie, et panneau
  **API moteur** listant côte à côte le réclamé-absent et le fourni.

**Un bug de conception attrapé par les tests** : `LuaSession::new` créait son propre tampon de
journal, distinct de celui confié au `DebugBinder` — `take_logs()` lisait un tampon que personne
n'alimentait, la session paraissait muette. D'où `LuaSession::standard()`, qui construit les deux
ensemble.

**Non touché : `nie-engine`.** C'est le portage RE exclu du workspace Cargo (`exclude` racine),
conservé en lecture seule comme carte de référence tant qu'il n'est pas re-validé byte-exact
(cf. `docs/PLAN.md`). Y injecter du Lua contredirait cette règle.

---

## 10. Atelier Lua — chaîne complète sur les scripts du moteur ✅ (2026-08-10)

Demande utilisateur : « analyse nie-lua pour ajouter un éditeur lua, émulateur, interpréteur,
éditeur de valeur et décodeur/décompilateur, le tout end-to-end et automatisé ».

**Analyse préalable de `nie-lua`** (ce qui existait déjà) : VM Lua 5.2 **réelle** (mlua, PUC-Rio
5.2.4 vendored — la VM exacte du moteur), `load_bytecode`, `install_include` (système de modules
`INCLUDE` du moteur), `discover_host_calls` (surface d'API hôte par instrumentation de `_G`) et
`menu_host` (1 917 lignes : `MenuState`, `run_menu`, `drive_menu`). Manquaient : tout ce qui
permet de **lire** et **manipuler** un script plutôt que seulement l'exécuter.

**Livré côté crate `nie-lua`** :
- **`bytecode`** — décodeur du format PUC-Rio Lua 5.2 (`lundump.c`) : en-tête, prototypes
  imbriqués, constantes, instructions, upvalues, tables de débogage (`lineinfo`, `locvars`), plus
  un **désassembleur** annoté (opérandes RK résolues en valeur, lignes source rappelées). Les
  tailles (`size_t`, `Instruction`, `lua_Number`) sont **lues dans l'en-tête**, pas supposées : le
  jeu est 32 bits sur certaines cibles, et un `size_t` mal deviné décale tout le fichier.
  **Vérifié sur les vrais scripts : 1143/1143 décodés, 985 971 instructions**, aucun échec.
- **`runtime`** — exécution instrumentée : capture de `print` (sans quoi la sortie d'un script
  lancé depuis une interface part dans un terminal que personne ne regarde), limite d'instructions
  par hook VM (les scripts du jeu bouclent en attendant un moteur), stubs de globals qui relèvent
  l'**API moteur réclamée** au lieu de planter au premier appel, inspection des globals et
  évaluation d'expression (console). 6 tests, dont l'interruption d'une boucle infinie.

**Portée honnête — désassembleur, pas décompilateur.** On produit un listing d'instructions
annoté, pas du Lua source reconstruit. Reconstruire du source exige de réassembler le flot de
contrôle depuis les sauts : c'est un travail distinct, et prétendre le contraire produirait du
code faux d'aspect plausible. Les tables de débogage sont conservées — ce sont elles qui
alimenteraient un décompilateur ultérieur.

**Livré côté app** : onglet **Lua** (`components/LuaView.tsx`) — catalogue des ~1 100 scripts du
VFS, désassemblage dans Monaco, éditeur de source Lua, console d'évaluation dans l'état laissé par
le script, et éditeur de valeurs listant les globals avec **valeurs forcées** posées *avant*
l'exécution (rejouer un script « comme si » une variable moteur valait autre chose). Chaque
commande accepte soit un chemin VFS, soit une source éditée — jamais de fichier temporaire.

---

## 9. Mode Éditeur — nie-explorer en logiciel type Unreal Engine 🟡 EN COURS (2026-08-10)

Nouveau but utilisateur : « transformer nie-explorer en logiciel type Unreal Engine ». Premier
palier livré — la disposition canonique d'un éditeur de moteur, chaque zone servie par ce que
niers sait déjà faire :

```
┌──────────────────── barre d'outils (grille, fil de fer, stats de scène) ────────────────────┐
│  viewport 3D temps réel (WebGL)                        │  Hiérarchie (outliner)             │
│  caméra orbitale libre, sélection au clic (raycast)    │  Détails (PropertyEditor)          │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  navigateur de contenu — VFS, vignettes, filtres par type d'asset                            │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Le changement de fond : la caméra passe du backend au frontend.** Toutes les commandes d'aperçu
3D existantes rastérisent côté Rust et renvoient une **image** (`vfs_glb_preview_png_b64`) ou une
**vidéo turntable pré-rendue de 36 images** (`..._turntable_mp4_b64`) — « interactif » se limitait
à faire défiler des images déjà calculées, avec une caméra décidée par le serveur. Nouvelle
commande **`vfs_glb_bytes_b64`** (+ `raw_cpk_glb_bytes_b64`) : elle renvoie le **GLB assemblé
lui-même**, auto-suffisant (géométrie + textures embarquées via `to_glb_embedded`, cf.
`assemble_glb_for_preview` — aucun aller-retour supplémentaire). Le frontend le charge dans un
vrai moteur temps réel (`three` en dépendance npm, bundlé par Vite — **aucun CDN**, l'app reste
intégralement hors ligne comme Monaco).

Livré (`src/components/editor/`) :
- **`Viewport3D.tsx`** — renderer WebGL, `OrbitControls`, éclairage trois sources (les modèles du
  jeu n'embarquent pas de lumières), grille, cadrage automatique sur la boîte englobante (un
  modèle de 2 unités et un de 200 s'afficheraient sinon l'un microscopique, l'autre hors champ),
  mode fil de fer, **sélection au clic par lancer de rayon**, statistiques de scène (meshes,
  triangles, vertices, matériaux). `dispose()` explicite du modèle précédent — sans lui, chaque
  changement d'asset fuit géométrie et textures en mémoire GPU.
- **`ContentBrowser.tsx`** — bandeau bas : fil d'Ariane, filtres par famille d'asset
  (Modèles/Textures/Audio/Configs), grille de vignettes réelles pour les textures
  (`api.texturePngB64` + `IntersectionObserver` + cache), menus contextuels natifs identiques à
  l'Explorateur. Même VFS, pas une seconde base d'assets.
- **`EditorView.tsx`** — assemblage, avec panneau **Détails** = `PropertyEditor` : sélectionner un
  modèle ouvre à la fois sa géométrie dans le viewport ET sa fiche complète (fichiers liés,
  `.cfg.bin` éditables, fonctions/adresses de `nie.exe`).
- **`ui/split-pane.tsx`** — panneaux redimensionnables deux axes, panneau de tête OU de queue,
  taille persistée (`localStorage`). Écrit ici plutôt que porté de
  `spaceui/primitives/Resizable.tsx` : celui-ci dépend de `react-resizable-layout` (absent) et ne
  gère qu'un panneau de tête sur un seul axe, alors que l'inspecteur de droite se redimensionne
  par son bord gauche.

**Pas encore fait** (prochains paliers d'un « vrai » éditeur) : pas de gizmos de transformation
(déplacer/tourner/redimensionner), pas de sauvegarde de la scène éditée vers le jeu, pas de
lecture d'animations (`g4la`/`g4pkm_motion` sont décodés par `nie-formats` mais pas encore
exposés au viewport), pas de multi-assets dans une même scène, pas d'onglets de documents
multiples. Le viewport est aujourd'hui un **visualiseur temps réel + inspecteur**, pas encore un
éditeur de scène qui écrit.

---

**Nouveau (2026-08-10) — éditeur de propriétés (`components/PropertyEditor.tsx`).** Demande
utilisatrice : « il manque un éditeur de propriété qui link lua, cfgbin, code source, adresse
mémoire sur chaque objet du moteur ». Une entité du jeu n'existe pas dans UN fichier : elle est
éclatée entre modèle, textures, sons, lignes de `.cfg.bin` et code machine de `nie.exe`. Le
panneau prend un **code interne** (`c01000010`, `whs00340`, …) et rassemble :
- **Fichiers** — tous les fichiers VFS du même code, groupés par nature (modèle/texture/audio/
  vidéo/config/script), cliquables vers l'éditeur adéquat. Index SQL exact (`vfs_files.code`) si
  la réindexation a été faite, repli `vfs_related` sinon.
- **Données** — les `.cfg.bin` liés, décodés en JSON dans Monaco et **réécrits** par les encodeurs
  déjà vérifiés (`encode_cfgbin_config`, T2B **et** RDBN), avec la même confirmation EAC que
  `DetailPane` — pas une seconde implémentation d'édition.
- **Moteur** — fonctions labellisées et classes RTTI de `niers.sqlite` (`nie-re`) dont le nom
  mentionne le code, avec leur **adresse statique** (`0x140…`, copiable pour r2/Ghidra ou l'onglet
  Live de lecture mémoire).

Branché aux deux endroits demandés : panneau droit de l'**Explorateur** (onglets Aperçu /
Propriétés — sélectionner la texture d'un joueur ouvre la fiche du joueur) et page **Données**
(cliquer une technique/un objet/un Avatar ouvre sa fiche). Les entrées identifiées par un simple
hash sans asset (boutiques, passifs, quêtes) ne sont volontairement pas cliquables — pas de fausse
affordance.

**§4.1 — 4 modules `nie-data` de plus (2026-08-10)** : `shop` (boutiques, inventaire résolu en
noms d'objets), `stadium` (stades), `passive` (capacités passives, portée et type de boost
classifiés), `special_tactics` (tactiques spéciales, élément/puissance/effets). Neuf jeux de
données câblés au total dans `GameDataView`, même patron `load_t2b` + parseur typé.

**Mise à jour (2026-08-09)** : §4.3/§5 `nie-trace` live câblé — décision utilisatrice tranchée
(confirmation explicite). Onglet **Live** de `ReToolsView` (`src-tauri/src/re_trace.rs`) : détection
du process (`find_pid_by_name`), plages mémoire du module (`module_regions`), lecture ponctuelle
d'octets (`read_exact`) et dump des plages lisibles vers `AppData/re-dumps/<pid>-<horodatage>/`
(`dump_regions`). **Strictement lecture seule** — `write`/`patch_eac` sur un process vivant
restent non exposés à l'IPC. Reste bloqué : §5 scan AOB (conflit de lien natif
`rusqlite`/`sqlx-sqlite`, pas par manque d'effort — cf. le détail dans la section).

Convention de statut : ❌ pas commencé · 🟡 partiel · 🔵 bloqué (décision utilisatrice ou
contrainte technique documentée) · ✅ fait et vérifié.

---

## 1. Encodeurs manquants (bloque « tout doit être éditable »)

### 1.1 Encodeur RDBN ✅
`nie_formats::cfgbin::encode_rdbn` existe et est vérifié par round-trip réel sur le vrai jeu
(230/231 sur scan quasi-complet ~50 123 candidats — le seul échec, un cas de liste vide légitime,
a été corrigé ; 24/24 en sample régulier `crates/engine/nie-formats/src/cfgbin.rs` test
`encode_rdbn_round_trip_sur_le_vrai_jeu`) + pont JSON (`nie_explore::bridge::json_to_rdbn_lists`,
25/25 réel, test `json_bridge_rdbn_round_trip_sur_le_vrai_jeu`). Porté depuis une réécriture C++20
externe (`aphrody-code/iecode`, PAS le `IECODE.Core` C# d'origine — celui-ci ne contient que des
lecteurs) après cross-vérification de son layout d'octets contre le lecteur Rust déjà validé
(un bug réel — `name_hash` de type jamais écrit — a été trouvé et corrigé au portage). Édition en
mode **patch** (valeurs uniquement, gabarit = fichier original relu — le JSON seul perd
l'information de type par colonne) plutôt que reconstruction libre, cf. doc de
`patch_rdbn_value`/`json_to_rdbn_lists`. Câblé côté Tauri : `encode_cfgbin_config` dispatch
T2B/RDBN automatiquement selon la forme du JSON (`"entries"` vs `"lists"`), `DetailPane` édite et
sauvegarde les deux formats identiquement. `vfs_decode_cfgbin` est maintenant éditable pour
100 % des `.cfg.bin` du jeu (T2B **et** RDBN).

### 1.2 Encodeur CPK (pack) ✅
`nie_formats::cpk_encode::encode_cpk` existe — CPK **non chiffré, non compressé** (magic `CPK `
en clair, `ExtractSize==FileSize` pour toutes les entrées) : portée délibérément restreinte et
documentée (le chiffrement position-based XOR et CRILAYLA ne sont PAS implémentés — ni utiles
pour un CPK de mod exporté, ni vérifiés, cf. doc de tête du module). Écrit lui-même un encodeur
`@UTF` générique (`encode_utf`, byte-exact avec `crate::cpk::parse_utf`, colonnes toujours
`HAS_NAME|ROW_STORAGE`) — pas de portage externe cette fois, le lecteur `nie-formats::cpk` déjà
validé sur le vrai jeu a suffi comme unique vérité terrain. **Vérifié par round-trip réel contre
`CpkReader`** (`encode_cpk_round_trip_via_cpk_reader` + `..._many_entries_noms_repetes`, noms
dupliqués entre dossiers) : ré-ouvre le CPK généré, ré-extrait chaque entrée, compare octet à
octet à l'original — 3/3 tests verts. **Non vérifié en revanche par chargement réel dans
`nie.exe`** (contrairement à §1.1/§2.2) : aucun moyen sûr de tester un CPK reconstruit dans le
jeu sans risquer une détection EAC — limite documentée dans le module, pas cachée. Câblé côté
Tauri (`export_mod_as_cpk`) et frontend (`ModsView` → « 📦 Exporter en .cpk… », lit les fichiers
mis en scène du mod depuis `AppData`, écrit une VRAIE archive rechargeable par
`open_raw_cpk`/`RawCpkView`).

### 1.3 Unpack en masse d'un CPK ✅
`raw_cpk_extract_all(dest_dir)` — boucle sur `RawCpkState.entries`, écrit chaque entrée en
préservant l'arborescence `directory/filename`, renvoie `(n_ok, n_err)` (les échecs individuels
n'interrompent pas le reste). Bouton « Tout extraire… » dans `RawCpkView` (visible dès qu'un CPK
est ouvert).

---

## 2. Éditeurs de contenu

### 2.1 Éditeur texte façon VS Code (Monaco) ✅
`monaco-editor`/`@monaco-editor/react` intégrés (`src/lib/monacoSetup.ts`) — **100 % offline**
(pas de CDN) : le loader `@monaco-editor/react` est repointé vers le paquet npm importé
statiquement (bundlé par Vite), les workers JSON/éditeur passés par les imports natifs `?worker`
de Vite 5+ (`monaco-editor/editor/editor.worker`/`monaco-editor/language/json/json.worker` — le
sous-chemin SANS `esm/vs/` : c'est ce que le champ `exports` du package réécrit). Remplace le
`<textarea>` brut de `DetailPane` pour l'édition du JSON config (T2B/RDBN) : coloration
syntaxique, recherche Ctrl+F, pliage, thème suivant clair/sombre de l'appli (`next-themes`
`resolvedTheme`). Vérifié par un vrai `vite build` (pas juste `tsc`) après un premier échec de
résolution des workers.

### 2.2 Éditeur d'image (textures) ✅ (remplacement — pas d'édition pixel)
`nie_formats::g4tx_encode` (nouveau module) : `encode_dds_bgra8` (DDS non compressé BGRA8 32bpp,
format public Microsoft, reconnu par le décodeur `g4tx_decode` déjà validé comme le format
« défaut Level-5 ») + `decode_png_to_rgba8` (décodage PNG via le crate `png`, normalisation
palette/gris/16-bit → RGBA8) + `encode_g4tx_single_texture` (conteneur G4TX **mono-texture, sans
région d'atlas** — le cas `font_def.g4tx`, PAS les atlas multi-région type `gaiji_game.g4tx` où
« remplacer » n'aurait pas de sens univoque, rejeté explicitement). **Vérifié par round-trip
pixel-exact sur 998/998 vrais `.g4tx` mono-texture du jeu** (`encode_g4tx_round_trip_sur_un_vrai_
fichier`, échantillon ~54 200 candidats) + tests synthétiques (2×2, 16×16, PNG→RGBA8→DDS→G4TX
bout en bout). Câblé : `stage_texture_replacement` (Tauri) décode un PNG choisi et écrit le
`.g4tx` réencodé directement dans l'espace de travail du mod ; bouton « 🖼️ Remplacer par un
PNG… » dans `DetailPane` (visible pour les `.g4tx`, à côté du sélecteur de mod). Pas de
recadrage/luminosité/dessin en revanche — remplacement intégral de la texture uniquement.

### 2.3 Viewer 3D interactif ✅ (turntable vidéo — pas un vrai wgpu live embarqué)
Alternative délibérée à l'embarquement d'une fenêtre wgpu native dans WebView2 (fenêtrage Win32
imbriqué jugé trop fragile pour le temps disponible) : `vfs_glb_preview_turntable_mp4_b64`
rend 36 frames (`nie_render3d::render::render`) → turntable 360° remuxé en MP4 par `ffmpeg` en
sous-processus. Affiché dans un `<video controls loop>` : la barre de défilement native EST la
caméra orbitale (glisser = tourner autour du modèle). Bouton « 🔄 Aperçu 3D interactif » dans
`DetailPane`, à côté de l'aperçu PNG fixe existant. Vérifié de bout en bout sur un vrai modèle du
jeu (`c04002230.g4md`, pipeline complète assemble→GLB→MP4).

**Bug de packaging corrigé (2026-08-08) — rendu passé EN PROCESS.** `vfs_glb_preview_png_b64`/
`vfs_glb_preview_turntable_mp4_b64` shellaient vers un `nie-render3d.exe` compilé séparément,
résolu sous `<racine>/target/{debug,release}/` : introuvable dans TOUT build **distribué** de
`nie-explorer` (`scripts/package.sh` ne packages QUE nie-game/nie-headless/nie-play/nie-runtime,
jamais `nie-render3d` ; `tauri.conf.json` n'a pas de `bundle.resources`/`externalBin` pour lui) —
l'aperçu 3D échouait silencieusement hors poste de dev, avec un message renvoyant à
`cargo build -p nie-render3d --release` (inutilisable pour une utilisatrice finale). Le rasterizer
étant du pur-Rust sans état global (`nie_render3d::{glb::parse, render::render}`), les deux
commandes l'appellent maintenant **en process** (`nie-render3d` ajouté aux dépendances Cargo de
`nie-explorer`, cf. `docs/PLAN.md`) — seul `ffmpeg` (déjà requis pour l'aperçu vidéo USM)
reste un sous-processus, pour le mux MP4 du turntable. Élimine aussi le double aller-retour disque
(écrire le GLB, relire chaque PNG). **Vérifié par un golden réel** (`cargo test -p nie-explorer
--lib --features real-fixtures`, `glb_preview_png_en_process_sur_un_vrai_modele`) : assemble
`c01000010.g4md` depuis le vrai `data/`, rend, vérifie >1000 pixels de mesh (pas un fond vide) et
une signature PNG valide — pas juste « ça compile ».

### 2.4 Intégration Blender (`tools/niers`) ✅ (2026-08-08 — bug corrigé + lien persistant ajouté)

**Bug corrigé — « Ouvrir dans Blender » ouvrait Blender VIDE.** Cause racine identifiée en lisant
le code source de l'addon (`tools/niers/g4_port_addon.py`) : le script d'amorçage appelait
`level5_g4_port.load_original_model`, qui n'est **pas** un import de scène mais l'opérateur
« choisir le template original » du **wizard d'export/portage** (panneau « 1. Original model
template ») — il peuple des réglages internes pour un futur export, ne crée **aucun objet
maillage**. Le vrai importeur (« File > Import > Level-5 G4 Model » du README de l'addon) est
`import_scene.level5_g4`. Corrigé + **validé par un test réel `blender.exe` GUI complet** (pas
supposé) : le nouveau bootstrap (opérateur correct, `skip_character_setup=True` pour un import
direct sans wizard interactif, appel **différé** via `bpy.app.timers.register` — même mécanisme
que l'addon utilise lui-même pour ses propres opérateurs différés, `g4_animation_addon.
defer_blender_call` — le contexte fenêtre n'est pas garanti prêt à l'instant `--python` du
démarrage GUI) importe réellement **3 objets** (`c01000010_20`/`eye_10`/`mouth_10`) depuis le vrai
`c01000010.g4md`, contre 0 avant. Erreurs désormais écrites dans un fichier log
(`_nie_explorer_import_error.log`, plus jamais avalées silencieusement) + bannière dans la barre
de statut Blender.

**Sous-jacent trouvé en même temps** : le submodule Git `tools/niers` (`.gitmodules` pointait
dessus, `https://github.com/The-RealBobi/G4_Blender.git`) avait été supprimé de l'index par erreur
lors d'un commit de nettoyage (« license officiel », gitlink retiré sans que `.gitmodules` le
soit) — le dossier n'existait plus du tout sur disque. Restauré au commit exact précédemment
pinné (`7ac55b7`), **puis vendorisé** (2026-08-08, demande utilisatrice « ça ne doit pas être un
submodule ou repo, ça doit être une partie claire de niers ») : `tools/niers` est désormais 24
fichiers réguliers versionnés dans l'historique de `niers` (plus de `.gitmodules`/gitlink), un
clone de `niers` l'a directement, sans étape `git submodule update --init`. Licence amont absente
(`license: null` côté API GitHub) — republication confirmée autorisée par le propriétaire du
projet (cf. `tools/niers/NIERS_VENDORING_NOTE.md`). `ensure_niers_blender_addon` (clone Git à la
volée) reste comme filet de sécurité pour le seul cas où `game_dir` n'est PAS un checkout de ce
repo (build distribué de `nie-explorer` pointé sur une simple install Steam).

**Nouveau : bouton « 🧩 Installer l'extension Blender niers » (demande utilisatrice « lier au max
Blender et niers »)** — Paramètres → carte Blender. Jusqu'ici `open_in_blender` n'était qu'un lien
**transitoire** (addon activé via `sys.path` pour la durée d'UN process Blender lancé PAR
nie-explorer). La nouvelle commande `install_niers_blender_addon` installe l'extension **pour de
vrai** (`bpy.ops.preferences.addon_install`+`addon_enable`, dossier d'addons utilisateur réel —
comme Préférences > Add-ons > Install from Disk) **et** lie sa préférence `raw_data_root` (lue par
`inferred_raw_data_root`/`candidate_data_roots` de l'addon pour la résolution de squelette
partagé/pièces de personnage) au vrai `<jeu>/data`, **persisté** (`bpy.ops.wm.save_userpref()`).
Un Blender relancé indépendamment de nie-explorer (double-clic sur l'icône, aucun bootstrap) a
alors l'addon actif ET connaît déjà le dépôt de données niers. **Vérifié par 3 exécutions réelles
`blender.exe --background`** : install+enable+set-pref+save réussissent (marqueur
`NIE_EXPLORER_ADDON_INSTALL_OK`), ET un Blender relancé à froid ensuite confirme
`hasattr(bpy.ops.import_scene, "level5_g4") == True` + `raw_data_root` toujours correct après
rechargement des préférences — la persistance est réelle, pas supposée. `zip_addon_dir` (crate
`zip`, nouvelle dépendance) zippe `tools/niers` en préservant le nom de dossier comme racine de
l'archive (exigé par `addon_install` pour une extension multi-fichiers), exclut `.git`.

### 2.5 Panneau `niers_bridge` — recherche + import de fichiers DEPUIS Blender ✅ (2026-08-08)

Nouveau fichier `tools/niers/niers_bridge.py` (View3D > Sidebar > Level-5 > « niers — Recherche de
fichiers ») : cherche dans le VFS du jeu par sous-chaîne (`niers vfs find --json`, **aucune**
dépendance au miroir wiki contrairement à `chara`/`waza` — marche sur n'importe quelle install),
affiche les résultats dans une liste (chemin, taille, CPK conteneur), et importe directement le
résultat sélectionné dans la scène si c'est un modèle (`.g4md`/`.g4pkm`) via le VRAI importeur
`import_scene.level5_g4` — même correctif que §2.4.

Le `-j/--json` de `niers vfs find` **référençait déjà ce fichier avant qu'il n'existe DANS CE
CHECKOUT** (doc-comment Rust de `nie-cli` : « pour consommation programmatique (ex.
`niers_bridge.py` de l'addon Blender `tools/niers`) »). **Correction honnête (trouvé après coup en
inspectant l'archive déjà publiée `niers-1.0.22.zip`, release GitHub v0.1.0)** : une PREMIÈRE
version de `niers_bridge.py` avait réellement existé — contenu local non committé du submodule
`tools/niers` supprimé par erreur (§2.4 ci-dessus, jamais dans l'historique du dépôt AMONT
`The-RealBobi/G4_Blender`, ce qui reste exact — mais bien réel en local, un temps). Elle déléguait
TOUT à `niers vfs chara`/`waza --json` (déjà existant, zéro logique de recherche en Python — plus
strictement anti-doublon que la réécriture ci-dessous) mais appelait le même opérateur bogué que
§2.4 (`level5_g4_port.load_original_model`). Cette réécriture ajoute le miroir SQLite + GraphQL
azalee EN DIRECT (demande explicite, `niers vfs chara`/`waza` ne parle pas encore à azalee) avec
le bon opérateur d'import. `--json` de `niers vfs find` lui-même est neuf (absent avant, seuls
`chara`/`waza` l'avaient) — `FindJsonEntry {path, size, cpk}`, même convention compacte que
`SearchJsonEntry`.

`resolve_niers_exe` (nouvelle fonction) résout `niers.exe` dans l'ordre : préférence explicite
(nouveau champ `niers_cli_path` de `G4ImporterPreferences`, exposé dans Préférences avec un
indicateur ✓/✗ live) > `<racine du jeu déduite de raw_data_root>/target/{release,debug}/niers[.exe]`
> `NIE_GAME_DIR` > `PATH`. Import réel : extraction via `niers vfs extract <dossier> --out <tmp>`
(récupère les frères g4mg/g4sk/g4tx/g4mt du même dossier), puis `import_scene.level5_g4`.

**Recherche web (2026-08-08, demande utilisatrice « cherche les best API/feature pour une
extension Blender ») → 2 patterns appliqués, pas juste lus** :
- **Opérateurs NON bloquants** (`_NiersProcessOperator`, base commune recherche/import) —
  `subprocess.Popen` + timer modal (`wm.event_timer_add`/`modal()` qui poll `proc.poll()`), Échap
  annule (`proc.terminate()`). Un `subprocess.run()` synchrone (version initiale) gèle l'UI
  Blender pendant l'appel à `niers.exe` — pattern documenté par « Keeping Blender Responsive:
  Non-Blocking Renders with bpy.app.timers » (harlepengren.com) : timer + `Popen`, nettoyage du
  timer/process à l'annulation **et** au `unregister()` de l'addon (piège documenté : un timer
  encore actif après `unregister()` touche des données Blender potentiellement invalidées —
  `_active_procs`, terminés de force dans `unregister()`).
- **Filtre natif `UIList`** (`NIERS_BRIDGE_UL_results.filter_items`, `UI_UL_list.
  filter_items_by_name`) — boîte de recherche native (icône loupe) qui filtre les résultats DÉJÀ
  récupérés côté client, sans relancer `niers.exe` (ex. restreindre à `.g4tx` parmi une recherche
  plus large). Sans ce `filter_items`, le filtre par défaut de `UIList` chercherait une propriété
  `name` que `NiersBridgeResult` n'a pas (elle a `path`) — jamais de correspondance.
- **Corrigé après coup** : `blender_manifest.toml` avait d'abord été jugé « écarté » (portée
  disproportionnée) faute de savoir qu'un manifeste **existait déjà** — validé via `blender
  --command extension validate/build` dans une session antérieure, perdu avec le submodule
  supprimé par erreur, mais récupérable dans l'archive déjà publiée (`niers-1.0.22.zip`, release
  v0.1.0). **Restauré** (`tools/niers/blender_manifest.toml`, `version="1.1.0"`, permission
  `network` ajoutée pour azalee, `permissions.files` étendue au miroir SQLite) — coexiste avec le
  `bl_info` legacy (les deux formats peuvent cohabiter, Blender préfère le manifeste dès qu'il est
  présent). `paths_exclude_pattern` (PAS `paths_exclude_glob`, piège déjà documenté dans le
  fichier — vérifié empiriquement dans la session d'origine) exclut `img/`/`tests/`/`__pycache__`.
- **Écarté après recherche, pas retenu** : hooks Python de l'Asset Browser — API non stabilisée
  par l'équipe Blender au moment de la recherche (« aucun plan concret pour ces hooks », blog
  développeurs Blender, juillet 2026), rien d'utilisable aujourd'hui.

**Vérifié par des tests réels `blender.exe` GUI complète** (pas `--background` : un opérateur
modal a besoin d'une fenêtre pour `event_timer_add`/`modal_handler_add`, absente en background) —
addon réinstallé avec `niers_bridge.py` à jour, puis process Blender frais : `bpy.ops.niers_bridge.
search('INVOKE_DEFAULT')` renvoie bien `{'RUNNING_MODAL'}` (pas `{'FINISHED'}` synchrone — confirme
que l'appel est réellement asynchrone), recherche `"c01000010"` → **12 résultats réels**
(g4md/g4mg/acb/awb/g4tx…) complétée en tâche de fond ; sélection du `.g4md` +
`niers_bridge.import_selected('INVOKE_DEFAULT')` → également `{'RUNNING_MODAL'}`, puis **3 objets
créés** (`c01000010_20`/`eye_10`/`mouth_10`), identique au résultat de §2.4 — le panneau produit le
même résultat correct que le bouton `nie-explorer`, en autonome depuis Blender, sans jamais lancer
`nie-explorer`, et sans geler l'UI pendant l'appel.

### 2.6 Renommage + recherche perso/technique par NOM (miroir SQLite + azalee) ✅ (2026-08-08)

**Renommage** (demande utilisatrice) : `bl_info["name"]` passe de « Level-5 G4 Blender Tools » à
« **niers — G4 Blender Tools** » (auteur original Bobi préservé, mention niers ajoutée) ; les 2
onglets de sidebar (`G4 Port` + `niers_bridge`), auparavant séparés sous « Level-5 »/pas d'onglet,
sont unifiés sous un seul onglet **« niers »**. Le module Python (`ADDON_ID`/nom de dossier)
reste `niers` — déjà correct, référencé partout côté Rust (`tools/niers/__init__.py`).

**Connexion azalee (GraphQL + REST) + miroir SQLite** (demande utilisatrice « connecte-le à l'API
REST et GraphQL d'azalee et au miroir SQLite ») : `niers_bridge.py` a un second onglet « 👤
Personnage / ⚡ Technique » (bascule via `niers_bridge_kind`), recherche par **nom localisé**
FR/EN/JA — deux sources combinées, jamais bloquantes l'une sur l'autre :
- **Miroir SQLite local** (`sqlite3` stdlib, si un `supabase-*.sqlite` est trouvé — nouvelle
  fonction `resolve_wiki_db`, même logique que `default_wiki_db` côté Rust : `NIE_WIKI_DB`/
  `SQLITE_DB_PATH` > préférence `wiki_db_path` > fichier le plus récent sous `<jeu>/var/
  wiki-mirror/`). Requêtes SQL **copiées mot pour mot** de `nie_wiki::query::{search_characters,
  search_skills}`/`wikiDb.ts` — une seule vérité SQL, trois moteurs d'exécution.
- **GraphQL azalee** (`/api/graphql`, toujours tenté en complément — même requêtes que `remote_
  search_chara`/`remote_search_waza` côté `nie-explorer`), nouvelle préférence `azalee_url`
  (défaut `https://azalee.rosegriffon.fr`).
- Un résultat sélectionné (source locale OU azalee) → bouton **« Voir les fichiers »** bascule sur
  l'onglet Fichiers, cherche par CODE INTERNE (`niers vfs find`) et affiche les VRAIS fichiers VFS
  — enchaînable directement vers Import. Nom localisé → fichiers réels → import Blender, sans
  quitter le panneau.
- I/O non bloquante via une nouvelle base `_NiersThreadOperator` (même principe que `_NiersProcess
  Operator` §2.5, `threading.Thread` au lieu de `Popen` — l'I/O réseau/disque ne gèle jamais l'UI).

**Vérifié end-to-end sur données réelles** (Blender GUI complète) : recherche `"Mark"` →
**59 résultats combinés** (39 miroir local + 20 azalee, correctement étiquetés par source, noms
FR/EN/JA réels — ex. « Mark Evans / Mark Evans / 守 円堂 » = Endou Mamoru) ; sélection du premier
résultat + « Voir les fichiers » → bascule effective vers l'onglet Fichiers, requête `c01000010`
posée automatiquement → **12 fichiers VFS réels** ; sélection du `.g4md` + Import → **3 objets
créés**, identique aux résultats §2.4/§2.5. Chaîne complète nom→fichiers→import validée en un
seul test, pas 3 tests isolés.

### 2.7 Vue grille + vignettes (comparaison UI azalee `/cpk`) 🟡 (2026-08-08)

Demande utilisatrice : « compare l'UI de nie-explorer et azalee cpk explorer et fusionne le
meilleur des deux ». Lecture complète des deux (`ExplorerView.tsx`/`DetailPane.tsx` ici,
`rg/apps/azalee/app/cpk/{CpkExplorer,CpkFolderView,CpkTree,CpkModelThumb}.tsx` côté azalee,
2657 lignes) — les deux ne sont PAS interchangeables (azalee = catalogue web LECTURE SEULE d'un
index Redis/SQLite pré-calculé, 250 800 fichiers, sans accès au jeu local ; nie-explorer = éditeur
desktop avec mutation réelle — mods, Monaco, encodeurs, Blender), donc pas une « fusion » littérale
mais un portage ciblé des patterns UX supérieurs et réellement applicables :

- **Porté : vue grille + vignettes** (`FileThumbnail`, `viewMode` liste/grille, bouton à côté du
  tri) — la différenciation la plus marquante d'azalee (`CpkModelThumb`, grille façon Google
  Drive) que nie-explorer n'avait pas (liste seule). Vignettes réelles pour les `.g4tx`
  (`api.texturePngB64`, décodage déjà instantané) via `IntersectionObserver` (lazy, seulement ce
  qui devient visible) + cache module-level (survit à un aller-retour de dossier). Vignettes 3D
  (`.g4md`) volontairement HORS PORTÉE (assemblage GLB + rendu = coûteux même en process depuis
  §2.3, pas adapté à une grille de centaines d'entrées sans file d'attente dédiée — pas un faux
  raccourci, juste un icône générique pour l'instant).
- **Identifiés, PAS portés ce cycle** (notés pour un futur incrément, pas oubliés) :
  navigation par onglets multiples (`CpkExplorer` ouvre plusieurs dossiers en parallèle, façon
  navigateur) ; recherche avec anti-race explicite (`searchSeq` — la recherche VFS actuelle
  n'a pas de garde anti-réponse-périmée, risque mineur de flash sur frappe rapide) ; barre
  flottante Material 3 de multi-sélection (le menu contextuel natif existant couvre déjà l'essentiel
  des mêmes actions) ; viewers structurés spécialisés (`CpkFormationViewer`/`CpkTypedTable`/
  `CpkJsonTree` — DetailPane a déjà Monaco pour le JSON, moins spécialisé mais fonctionnel).
- Handlers de clic (`handleDirClick`/`handleFileClick`/`handleFileContextMenu`) extraits en
  fonctions partagées liste/grille au passage — même sémantique Ctrl/Shift-clic dans les deux vues,
  zéro duplication de la logique de sélection multiple.

Vérifié : `tsc --noEmit` + `vite build` propres. Pas encore re-packagé dans un nouvel installeur
(la release v0.1.0 publiée juste avant ce point ne l'inclut pas) — code source à jour uniquement.

### 2.8 Interactions OS/filesystem — inspiré de la lecture réelle de cosmic-files ✅ (2026-08-08)

Demande utilisatrice : « analyse le code de cosmic-files et inspire-toi-en pour compléter le
menu, la sidebar et les interactions OS/filesystem » — dépôt cloné et **lu en détail** (`menu.rs`
853 lignes en entier, `key_bind.rs`/`context_action.rs` en entier, `clipboard.rs` en entier,
sections `update_nav_model`/`nav_bar`/`nav_context_menu` d'`app.rs`, `trash.rs` en entier), pas
survolé — 3 gaps réels de nie-explorer identifiés par comparaison directe et fermés :

- **Presse-papiers FICHIERS natif Windows (CF_HDROP)** — cosmic-files pose SIMULTANÉMENT
  `text/plain`/`text/uri-list`/`x-special/gnome-copied-files` sur X11/Wayland (`clipboard.rs`,
  `ClipboardCopy`/`ClipboardPaste`) ; l'équivalent Windows exact est CF_HDROP, un SEUL format
  natif (ce que l'Explorateur Windows lit/écrit pour Ctrl+C/Ctrl+V). Nouvelle dépendance
  `clipboard-win` + commandes `clipboard_write_file_list`/`clipboard_read_file_list`. **Corrige un
  bug réel** : `doPaste` (Ctrl+V) ne lisait QUE du texte (`readText()`) — un Ctrl+C dans
  l'Explorateur Windows écrit CF_HDROP, PAS forcément de texte lisible, donc un copier-coller
  pourtant légitime depuis l'Explorateur pouvait rater. `clipboardReadFileList()` tenté en premier
  désormais, repli sur le texte. `doCopySelection` (Ctrl+C sur une sélection VFS) reste
  délibérément TEXTE — un chemin VFS est virtuel (dans un CPK), poser du CF_HDROP dessus
  tromperait l'Explorateur (chemin qui n'existe nulle part sur le vrai disque). **Vérifié par un
  test réel** (`clipboard_file_list_roundtrip_reel`, `#[ignore]`, écrit puis relit le VRAI
  presse-papiers Windows de ce poste) — vert.
- **VRAIE Corbeille Windows pour les fichiers de mod** — `trash.rs` de cosmic-files enveloppe le
  crate `trash` (`IFileOperation`/`SHFileOperationW` sous Windows) pour que « supprimer » soit
  RATTRAPABLE. `removeStagedFile`/`deleteModWorkspace` (nie-explorer) faisaient un `remove()`
  PERMANENT (`@tauri-apps/plugin-fs`) sur du VRAI travail utilisatrice (remplacements de
  texture/modèle édités, parfois de vraies heures de travail) — un clic accidentel sur
  « Retirer »/« Supprimer le mod » était irrattrapable. Même crate `trash` ajouté + commande
  `trash_appdata_files`, câblée dans `modWorkspace.ts` (`trashOrRemove`, repli sur suppression
  permanente SEULEMENT si la Corbeille échoue — jamais un échec silencieux qui laisse un fichier
  fantôme). **Vérifié par DEUX sources indépendantes** : test Rust (`trash_delete_reel`,
  `#[ignore]`, le fichier disparaît de son emplacement d'origine) ET `Shell.Application` COM
  PowerShell (`$shell.Namespace(10).Items()`, l'API que l'Explorateur lui-même utilise pour
  afficher la Corbeille) confirmant le fichier réellement présent sous `$Recycle.Bin\<SID>\$R*` —
  `trash::os_limited::list()` s'est avéré peu fiable en relecture immédiate dans le même process
  (faux négatif malgré un vrai succès, donc PAS gardé comme assertion automatisée, cf. commentaire
  du test).
- **« Ouvrir avec l'application par défaut »** — `tauri-plugin-opener` était déjà une dépendance
  déclarée (`Cargo.toml`) et enregistré dans `run()`, mais **jamais utilisé côté frontend** avant
  ce point (équivalent de `Action::OpenWith`/`mime_app.rs` amont). Nouveau helper
  `openWithDefaultApp` (`contextMenu.ts`) : extrait le fichier VFS/CPK vers un cache temporaire
  nommé (réutilisé d'un clic à l'autre, pas un nom aléatoire) puis `openPath` (Windows résout
  l'association par défaut). Ajouté aux menus contextuels fichier VFS **et** CPK brut.

Vérifié : `tsc --noEmit` + `vite build` + `cargo clippy --lib --tests` (0 warning) propres.
Sidebar (`PlacesSidebar`) et menu déjà couverts par les demandes précédentes (§ places
épinglées/récentes façon cosmic-files/yazi, Ctrl+D) — pas de gap supplémentaire identifié là après
comparaison directe à `nav_context_menu`/`update_nav_model` (le menu contextuel PAR ENTRÉE de la
sidebar — clic droit sur une place épinglée pour la retirer, l'ouvrir dans un nouvel onglet, etc.
— reste un écart réel non fermé ce cycle, noté pour un futur incrément : nie-explorer n'a pas de
notion d'onglets multiples, cf. §2.7, donc une partie de ce menu ne serait pas transposable telle
quelle).

---

### 2.9 Pont Blender ↔ niers — importer un `.blend`, construire une scène ✅ (2026-08-08)

Demande utilisatrice : « tu dois faire un pont entre blender et niers, pouvoir importer ce type
de fichier dans niers et pouvoir construire une scène blender via niers, par exemple fait moi une
scène avec byron love qui fait savoir supreme ». Complète §2.4/§2.5 (Blender→niers) dans l'autre
sens (niers→Blender), 3 commandes :

- **`blender_preview_png_b64`** : ouvre N'IMPORTE QUEL `.blend` local en headless, cadre une
  caméra sur les meshes/armatures (bounds → position calculée), rend un still EEVEE et renvoie le
  PNG en base64 — « importer ce type de fichier dans niers » : aperçu instantané sans lancer l'UI
  Blender, même patron que les autres `*_preview_png_b64` du fichier.
- **`blender_build_skill_scene(internal_code, skill_query)`** : construit une VRAIE scène —
  modèle du personnage (découvert par sous-chaîne sur le VFS réel, `chr/_face`) + modèle de cut-in
  de la technique (`SkillInfo::cutin_assets()`, résolue par [`game_data::find_skill`], nouveau,
  factorisé depuis `list_skills`). Sauvegarde un `.blend` réel + aperçu PNG. `warnings[]` explicite
  si personnage/technique sans assets 3D locaux plutôt qu'un échec silencieux ou une scène vide.
- **`blender_open_scene`** : ouvre un `.blend` dans le vrai Blender GUI (process séparé).

**Recette validée par un test réel headless AVANT d'écrire le code Rust** (`blender --background
--python`, même méthodologie que §2.4) sur Byron Love Aphrody (`c01001900`, cf. `nie-data::
aphrody`) + `whs00340`/« Savoir suprême »/God Knows (`ev60_00340`, une de ses 7 techniques
réelles) — **import réussi** : personnage 3 objets (`c01001900_20`/`eye_10`/`mouth_10`, 3/3
matériaux, 8/8 hashes) + cut-in 2 objets (`skeleton_root` ARMATURE + `wing_10` MESH, cohérent avec
l'élément Vent de la technique — effet d'ailes).

**Deux pièges réels découverts (documentés en commentaire de section dans `lib.rs`, pas juste ici)** :
1. Le segment de chemin série du VFS est **sensible à la casse** et PAS toujours celui que renvoie
   `nie_formats::assemble::series_dir_from_code` (`"01_ie1"`, utilisé pour les URLs CDN qui
   normalisent la casse côté serveur) — le VFS réel de ce personnage stocke `01_IE1` (majuscules).
   **Ne jamais reconstruire un chemin VFS depuis ce helper pour une lecture directe** : toujours
   découvrir le chemin réel par sous-chaîne sur `vfs.iter()` (même patron que `vfs_related`).
2. Le cut-in de `whs00340` n'a **pas** de `.g4md` dans le VFS (seulement `.g4mg`+`.g4pkm`+
   `.objbin`) — `MODEL_EXTENSIONS = {".g4md", ".g4pkm"}` côté addon : `import_scene.level5_g4`
   accepte aussi `.g4pkm` comme point d'entrée, confirmé par le test réel plutôt que deviné.

UI : carte « Pont Blender ↔ niers » (Paramètres) — import `.blend` (sélecteur de fichier + aperçu)
et construction de scène (2 champs perso/technique, résolution perso via GraphQL azalee comme
`SearchView`, résolution technique 100 % locale/serveur). `cargo check`+`clippy --lib --tests` (0
warning), `tsc --noEmit` (0 erreur) ; `cargo test --lib` cassé dans CET environnement de dev
(`STATUS_ENTRYPOINT_NOT_FOUND`, DLL manquante hors bundle Tauri complet — pré-existant, sans
rapport avec ce diff, vérifié en reproduisant sur les tests déjà présents avant ce changement).

---

## 3. Save manager (Steam userdata) ✅
`steam::userdata_save_candidates`/`pick_best_save` (nouveau, dans `steam.rs`) : énumère
`<bibliothèque Steam>/userdata/<steamid>/2799860/remote/*-USERDATALIVE` sur TOUTES les
bibliothèques/comptes trouvés (pas d'API simple pour « le compte actif » sans le client Steam en
cours d'exécution), trie par date de modification décroissante, et **valide réellement chaque
candidat par déchiffrement `nie-save`** (`nie_save::io::read_save`) plutôt que de faire confiance
au nom de fichier — un fichier corrompu/tronqué n'est jamais silencieusement retenu. Commande
Tauri `default_save_path` ; `SaveView` l'appelle au montage et n'ouvre le sélecteur manuel qu'en
repli (jamais un `open()` systématique). **Vérifié sur la vraie sauvegarde Steam Cloud de ce
poste** : 2 slots trouvés (`002AB8F4-*` 12,5 Mo récent, `002B8D10-*` 2,2 Mo 2024), le plus
récent+valide correctement sélectionné.

---

## 4. Crates du workspace pas (ou partiellement) exploitées

### 4.1 `nie-data` : 5 modules câblés avec DTO typé (techniques, objets, Avatar/Keshin, succès, quêtes) 🟡
`game_data.rs` câble désormais `list_skills` (préexistant), `list_items`, `list_auras`,
`list_trophies`, `list_quests` — chacun vérifié sur le vrai jeu (443/443 Avatar/Keshin = la
référence exacte du projet, 1820 objets, 347 succès, 182 quêtes, tous > seuils attendus). Bug
trouvé et corrigé au passage : `load_t2b` produisait des noms de noeuds T2B **non indexés**
(`nie_explore::bridge::t2b_to_json` ne désambiguïse pas les frères de même nom), ce qui faisait
échouer silencieusement `nie_data::text::parse_text_file` (0 texte résolu) — corrigé en
réimplémentant localement la conversion indexée (`to_indexed_json`, port du `to_iecode` dupliqué
dans chaque `nie-game/examples/export_*.rs`, factorisé ici une fois). `GameDataView` a maintenant
des onglets (Techniques/Objets/Avatar-Keshin/Succès/Quêtes/**Stats**, cf. §4.2). Reste ~110
autres modules `nie-data` (personnages/boutiques/tactiques/capsules/costumes…) — même patron,
extensible à la demande.

### 4.2 `nie-core` : calculateur de stats ✅
`game_data::list_chara_picker` (joint `chara_param`+`chara_base`+`chara_text` pour un nom
affichable, 6101/6470 personnages résolus sur le vrai jeu) + `game_data::calculate_character_
stats` (`nie_core::growth::calculate_stats` sur les tables de croissance IEVR **embarquées**,
`GrowthTables::load_embedded()` — pas besoin de reparser `growth_table_config` du VFS).
`play_style` lu directement depuis `CharaParam::raw_variables[5]` (absent du struct typé, comme
documenté dans `TeamSetup::from_chara_params_and_levels`). Nouvel onglet « Calculateur de stats »
dans `GameDataView` : recherche de personnage, niveau (1-99), rareté (N/R/SR/SSR/UR/LR/Legend/
BASARA), affichage des 7 stats + total. Vérifié sur le vrai jeu (calcul plausible, non nul, sur
un personnage réel du roster résolu).

### 4.3 `nie-trace` : lecture seule live ✅ (2026-08-09, confirmé explicitement)
Câblé (`find_pid_by_name`/`module_regions`/`read_exact`/`dump_regions`, **jamais** `write` ni
`patch_eac` sur un process vivant — refus ferme et définitif maintenu sur ces deux-là) dans l'onglet
**Live** de `ReToolsView` (`src-tauri/src/re_trace.rs`). Complète le dump hors-ligne (`niers.sqlite`,
onglet RE) par une lecture ponctuelle du process en cours : détection, plages du module, lecture
d'octets à une adresse, dump des plages lisibles. `cargo clippy --lib --tests` (0 warning),
`tsc --noEmit` (0 erreur).

### 4.4 `nie-queue` : hors scope confirmé
File BFS Redis du workflow RE (outillage pour les humains qui reversent `nie.exe`), pas
applicable à un navigateur/éditeur de données pour l'utilisatrice finale. Pas de suite prévue.

---

## 5. Outillage RE (« toolbox »)

L'onglet **RE** (`ReToolsView`, base `var/niers.sqlite`) couvre : recherche de fonctions
labellisées, classes RTTI, xrefs (lecture seule sur une base déjà calculée hors ligne) + un
sous-onglet **Live** (§4.3, câblé 2026-08-09) pour la lecture mémoire du process en cours.

- **Capture de dump live** ✅ (2026-08-09, même décision que §4.3) — bouton « Dumper les plages
  lisibles » de l'onglet Live (`re_trace_dump_module`) : dump des plages **lisibles** du module
  principal vers `AppData/re-dumps/<pid>-<horodatage>/` (`nie_trace::dump_regions`, jamais dans le
  dossier du jeu). Distinct du `.dmp` complet `MiniDumpWriteDump` (`docs/game-data/dump-exploitation.md`,
  capturé hors app, toujours manuel) : ici, dump ciblé par plage mémoire via `ReadProcessMemory`,
  pas un snapshot processus complet.
- **Scan AOB/pattern** 🔵 (bloqué techniquement, pas par manque d'effort) — `nie-re::dump`
  (`Minidump::scan`/`Pattern::parse`) sait chercher un motif avec wildcards dans un `.dmp` déjà
  capturé (AUCUNE attache process, donc pas un problème EAC en soi), mais `nie-re` entraîne
  `rusqlite` en dépendance transitive, qui entre en conflit de lien natif `sqlite3` avec le
  `sqlx-sqlite` de `tauri-plugin-sql` déjà utilisé pour `wikiDb`/`modsDb`/`reDb` (même contrainte
  que documentée dans `Cargo.toml` pour `nie-index`/`nie-seed`/`nie-zukan`/`nie-model-serve`).
  Le lever proprement demanderait de scinder `nie-re` (un sous-crate `dump`-only sans `rusqlite`)
  — chantier de restructuration de crate distinct, pas un ajout de commande.
- **Édition des labels** ✅ — `reDb.renameFunction`/`renameRttiClass` (`src/lib/reDb.ts`) :
  écrit directement dans `niers.sqlite` via `tauri-plugin-sql` (même mécanisme que les lectures
  existantes, la base n'est pas ouverte en lecture seule) ; `name_source` passe à `'user-edit'`
  pour distinguer un nom entré manuellement des sources RE (`'vtable-struct'`/`'ghidra'`/`'pdb'`).
  UI : icône ✏️ sur chaque fonction sélectionnée et chaque classe RTTI de la liste (édition
  inline, Entrée pour valider/Échap pour annuler).

---

## 6. Petits éléments UX en suspens

- **« Coller » (Ctrl+V) réel** ✅ — `editBus.paste()` lit le presse-papiers (chemin de fichier
  texte), valide qu'il pointe vers un fichier réel existant sur disque (`disk_file_exists`,
  `std::fs` direct — hors de la portée `fs:scope` JS, qui ne couvre que `$APPDATA`) et le met en
  scène comme remplacement du fichier VFS sélectionné, dans le mod le plus récent (créé à la
  volée si aucun n'existe). Copie réalisée par une nouvelle commande Rust dédiée
  (`copy_disk_file_to_appdata`) plutôt que `copyFile` du plugin `fs` : celui-ci n'aurait accepté
  qu'un chemin issu d'un sélecteur natif, pas du presse-papiers.
- **Multi-sélection dossiers** ✅ — Shift-clic sur un dossier sélectionne la plage entre la
  dernière ancre Ctrl/Shift-cliquée et le dossier cliqué (`folderAnchor`, séparé de
  `state.selected` — un clic simple sur un dossier NAVIGUE, contrairement à un fichier, donc
  piggy-backer sur `state.selected` aurait trompé `DetailPane`), même mécanique que les fichiers.
- **`RawCpkView` : parité d'outils avec `DetailPane`** 🟡 (audio/vidéo/3D faits, Blender seul
  reste hors de portée) — `raw_cpk_audio_preview_b64`/`raw_cpk_video_preview_b64` (factorisés avec
  les décodeurs VFS existants, `audio_wav_b64_from_bytes`/`video_mp4_b64_from_bytes`) : un
  `.hca`/`.adx`/`.usm` est un fichier autonome, pas de dépendance VFS. **Aperçu 3D fermé
  (2026-08-08)** : `assemble_glb_from_cpk_entries` reproduit la résolution de frères
  (`g4md`/`g4mg`/`g4tx` par dossier+basename) de `assemble_glb_for_preview` mais scopée aux
  `CpkEntry` du `CpkReader` déjà ouvert — plus besoin du VFS complet. Commande
  `raw_cpk_glb_preview_png_b64`, bouton « 🔄 Aperçu 3D » dans `RawCpkView` (visible pour les
  entrées `.g4md`). Vérifié par un golden réel (`raw_cpk_glb_preview_en_process_sur_un_vrai_pack`,
  ouvre `data/packs/eaabb0359e96871a72ea9f86c5d3d10d.cpk` en direct, hors VFS, même modèle
  `c01000010` que le test VFS §2.3). Blender reste VFS-only (`open_in_blender` dépend de l'addon
  `tools/niers` + `NIE_GAME_DIR`, pas juste de frères de fichiers) — non câblé pour un CPK ouvert
  hors VFS.
- **Barre de titre native** ✅ — `set_titlebar_theme(dark)` (nouvelle commande Tauri,
  `window_vibrancy::apply_mica`) appelée depuis `App.tsx` sur `resolvedTheme` (next-themes,
  tient compte de « system ») à chaque changement — le chrome natif suit maintenant le
  clair/sombre choisi dans Paramètres au lieu de rester figé en sombre.

---

## 7. Recherche & navigation (section manquante, ajoutée 2026-08-08 — code déjà présent, non documenté avant ce passage)

### 7.1 Recherche personnage/technique (`SearchView`) ✅
Deux sources interrogées en parallèle, jamais l'une au détriment de l'autre : **GraphQL azalee
distant** (`remote_search_chara`/`remote_search_waza`, commandes Tauri → `https://azalee.
rosegriffon.fr` par défaut, configurable dans Paramètres, toujours disponible sans config) +
**miroir SQLite local** (`wikiDb.ts` via `tauri-plugin-sql` **directement**, PAS de commande
Rust : `nie-wiki` dépend de `rusqlite`, qui entre en conflit de lien natif avec le `sqlx-sqlite`
du plugin dans ce binaire — même contrainte que RE §5/mods ; requêtes SQL copiées **telles
quelles** depuis `nie_wiki::query::{search_characters,search_skills}`, `sanitizeFilter` = port
JS de `sanitize_filter`). Un échec de source (azalee injoignable, miroir non configuré) devient
une notice non bloquante (`Alert` « Source indisponible »), jamais un silence ou un crash.
« Fichiers liés » (`loadRelated`) : index SQL précis (`vfsIndexDb`, si construit via
Paramètres → Réindexer) sinon repli substring en mémoire (`api.related` → `vfs_related`).

### 7.2 Palette de commandes (Ctrl/Cmd+K) ✅
`CommandPalette.tsx` — Ctrl/Cmd+K ouvre un saut instantané vers un emplacement épinglé ou
récent (`lib/places.ts`, frecency à la `zoxide`/yazi) ou une recherche libre relayée à
`SearchView`, sans quitter le clavier.

---

## 8. Job system durable (inspiré spacedrive) 🟡 EN COURS (2026-08-09 — premier portage livré)

Demande utilisateur (2026-08-09) : « clone spaceui + spacedrive dans `var/` (gitignoré), explore/
analyse/porte les libs utilisées dans niers, porte l'UI/le style/le design et une partie du
backend ». Dépôts clonés dans `var/spaceui` et `var/spacedrive` (gitignorés, `/var` déjà dans
`.gitignore` racine) — non committés, sources de référence pour le portage.

**Livré** :
- **`crates/tools/nie-tasks`** (nouveau crate workspace) : orchestration de job annulable/pausable avec
  progression — `Task`/`Interrupter`/`TaskSystem`/`TaskHandle`, architecture inspirée de
  `sd-task-system` (`var/spacedrive/crates/task-system`) mais **implémentation originale**
  (dispatch par `tokio::spawn`, pas de pool de workers à vol de tâches — inutile à l'échelle de
  nie-explorer). Testé (3 tests), `cargo clippy --lib --tests` 0 warning.
- Premier portage réel : `vfsIndexDb.reindex` (`SettingsView.tsx`). Nouvelles commandes
  `vfs_index_scan_start`/`_cancel`/`_take` (`src-tauri/src/lib.rs`) dispatchent un `VfsScanTask`
  chunké (8000 entrées/lot) sur `nie-tasks`, avec progression relayée par l'événement Tauri
  `vfs-index-progress` et annulation réelle exposée par un bouton « Annuler » (barre `Progress`,
  portée de `spaceui/primitives/ProgressBar.tsx` sur `@base-ui/react/progress`).
- **Non repris de ce plan initial** (`table jobs sqlite` + reprise au redémarrage) — le scan reste
  en mémoire process (`VfsScanState`), perdu si l'app ferme en cours de route. La collecte des
  ~255 800 entrées elle-même reste synchrone (même coût qu'avant) : ce que `nie-tasks` apporte ici
  est l'émission incrémentale + l'annulation, pas une accélération du scan. Persistance sqlite
  (`id, kind, status, progress, total, error, created_at, updated_at`) toujours l'étape suivante
  si un job vraiment long (export `.cpk` massif, conversion de lot) en a besoin.

**UI/style/design portés** (même demande) :
- Palette d'accent « Spacedrive » sélectionnable dans Paramètres (`accentTheme`, `lib/settings.ts`)
  — tokens hsl(235,…) de `var/spaceui/packages/tokens/src/css/{theme,themes/dark,themes/light}.css`
  réinjectés dans les rôles `--md-sys-color-*` existants via `[data-accent="spacedrive"]`
  (`styles.css`) — orthogonal au clair/sombre `next-themes`, n'affecte rien tant qu'il n'est pas
  choisi (défaut inchangé : palette MD3 « azalee »).
- Nouveaux primitifs `components/ui/` portés de `spaceui/packages/primitives` sur les briques
  `@base-ui/react` déjà en place (pas de nouvelle dépendance Radix) : `progress.tsx`, `popover.tsx`,
  `toggle-group.tsx`, `shortcut.tsx`, `collapsible.tsx`, `rename-input.tsx` (logique d'édition en
  ligne portée de `spaceui/packages/explorer/RenameInput.tsx`, double-clic/Entrée/Échap/blur comme
  le Finder macOS).
- UX câblée : bouton « Options d'affichage » (Popover + ToggleGroup Liste/Grille + slider de
  taille de vignettes) dans `ExplorerView`, barre de statut (compteur + taille de sélection),
  sections Épinglés/Récents repliables (`Collapsible`) dans la barre latérale, rappel de raccourcis
  (`Shortcut`) dans la palette de commandes, renommage de mod en ligne (`ModsView`, `modsDb.rename`
  déjà existant côté DB mais jamais câblé côté UI avant ce passage).
- **Non repris** : le menu contextuel HTML de spacedrive/`ContextMenu.tsx` — nie-explorer utilise
  déjà un VRAI menu popup Win32 natif (`@tauri-apps/api/menu`, `lib/contextMenu.ts`), supérieur en
  UX desktop à un `<div>` web ; le remplacer aurait été une régression, pas un portage.

**Fenêtre sans bordure (2026-08-09, 2ᵉ passage — demande explicite « le frameless windows de
spaceui »)** : référence visuelle EXACTE prise sur les vraies captures d'écran déjà présentes dans
le clone (`var/spacedrive/docs/public/SDGridView.webp`/`SDColumnView.webp` — fenêtre sans chrome
natif, traffic lights macOS intégrées à une seule barre outils+titre, coins arrondis). Constat :
`tauri.conf.json` de spacedrive garde `decorations: true` partout (le look « sans bordure » n'est
qu'un effet `hiddenTitle` macOS — Windows y montre un VRAI chrome natif classique) ; niers va plus
loin et porte un frameless RÉEL, y compris sur Windows (dans l'esprit Discord/VS Code/Spotify, pas
une imitation macOS hors de propos sur cette plateforme) :
- `tauri.conf.json` : `decorations: false`, `shadow: true` (ombre OS conservée malgré l'absence de
  chrome natif).
- `src-tauri/src/lib.rs` : `apply_rounded_corners` (`DWMWA_WINDOW_CORNER_PREFERENCE`, appel DWM
  brut comme `apply_dark_titlebar` de spacedrive) — sans lui, Windows 11 ne coins-arrondit QUE les
  fenêtres à légende native ; une `WS_POPUP` custom resterait à coins vifs.
- `App.tsx` : la barre outils devient elle-même la zone de titre (`data-tauri-drag-region`,
  double-clic = agrandir/restaurer natif Tauri) — pill de recherche centrée cliquable (ouvre la
  palette de commandes), `WindowControls` (réduire/agrandir/fermer, `components/ui/window-
  controls.tsx`) alignés à droite (convention Windows, pas des traffic lights macOS greffées hors
  contexte).

Demande utilisateur : « new goal, base-toi sur https://github.com/spacedriveapp/spacedrive ».
Reconnaissance faite (stack très proche : Rust core + Tauri v2 + React + Specta typegen — déjà
la stack de `nie-explorer`) — le concept le plus transposable et le plus utile ici est leur
**« Actions transactionnelles »** : chaque opération fichier devient un *job* durable qui survit
à une interruption (fermeture de l'app, crash), avec état persisté et reprise, plutôt qu'un
`useState` de progression perdu au moindre refresh.

**Candidats existants qui bénéficieraient d'un job unifié** (aujourd'hui : progression bespoke,
non persistée, perdue si l'app ferme pendant l'opération) :
- `vfsIndexDb.reindex` (`SettingsView.tsx` → `src/lib/vfsIndexDb.ts`, ~255 800 fichiers, plusieurs
  minutes) — callback de progression en mémoire seulement.
- `install_niers_blender_addon` (zip + install Blender headless, `src-tauri/src/lib.rs`) —
  bloquant, aucune progression intermédiaire exposée.
- Export de mods (`.cpk` réel) et conversions de textures par lot — mêmes symptômes.

**Périmètre PAS repris de spacedrive** (hors sujet niers, VFS jeu en lecture seule) : VDFS
multi-device, sync P2P sans leader (Iroh), indexation multi-source (emails/cloud), Spacebot IA.

**Prochaine étape concrète** (à lancer) : table `jobs` sqlite (via `tauri-plugin-sql`, même
moteur que le miroir wiki — pas de nouvelle dépendance `rusqlite`, cf. contrainte §RE/mods) —
`id, kind, status, progress, total, error, created_at, updated_at` — + un store Rust
(`JobRegistry` géré par `tauri::State`) émettant des events `job-progress`/`job-done` au lieu de
`Result` bloquant, et une UI de suivi (liste de jobs en cours/récents, reprise au relancement de
l'app via lecture de la table au démarrage). Premier candidat de portage : `reindex` (le plus
long, le plus souvent interrompu par erreur).
