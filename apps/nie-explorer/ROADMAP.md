# Roadmap nie-explorer

Suivi des demandes utilisatrice sur l'app desktop Tauri — chaque entrée cite l'état réel du
code, pas une supposition. Complète (ne remplace pas) `docs/PLAN.md`/`docs/ROADMAP-100.md`
(portage pixel-perfect `nie.exe`), scope ici = l'app `nie-explorer` uniquement.

**Bilan (2026-08-08)** : toutes les sections marquées ✅ ci-dessous ont été vérifiées par des
tests réels contre le vrai jeu (round-trip byte/pixel-exact, pas juste « ça compile ») —
détail dans chaque section. Restent volontairement non câblés : §5 capture de dump live et
§4.3 `nie-trace` live (attache à un process protégé EAC, refus ferme maintenu sans confirmation
explicite) et §5 scan AOB (bloqué par un conflit de lien natif `rusqlite`/`sqlx-sqlite`, pas par
manque d'effort — cf. le détail dans la section).

Convention de statut : ❌ pas commencé · 🟡 partiel · 🔵 bloqué (décision utilisatrice ou
contrainte technique documentée) · ✅ fait et vérifié.

---

## 1. Encodeurs manquants (bloque « tout doit être éditable »)

### 1.1 Encodeur RDBN ✅
`nie_formats::cfgbin::encode_rdbn` existe et est vérifié par round-trip réel sur le vrai jeu
(230/231 sur scan quasi-complet ~50 123 candidats — le seul échec, un cas de liste vide légitime,
a été corrigé ; 24/24 en sample régulier `crates/nie-formats/src/cfgbin.rs` test
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
`nie-explorer`, cf. `docs/PLAN.md` §3octies) — seul `ffmpeg` (déjà requis pour l'aperçu vidéo USM)
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

### 4.3 `nie-trace` : lecture seule 🔵 (décision utilisatrice en suspens)
Proposé explicitement (`read`/`find_pid_by_name`/`enumerate_regions`/`dump_regions`, **jamais**
`patch_eac` — refus ferme et définitif, cf. discussion). L'utilisatrice a dévié la conversation
vers le dump hors-ligne (`niers.sqlite`, maintenant câblé dans l'onglet RE) sans confirmer
explicitement le « oui » ou le « non » sur la lecture live. **Ne pas câbler sans confirmation
explicite** — l'attache à un process protégé EAC reste un risque réel même en lecture seule.

### 4.4 `nie-queue` : hors scope confirmé
File BFS Redis du workflow RE (outillage pour les humains qui reversent `nie.exe`), pas
applicable à un navigateur/éditeur de données pour l'utilisatrice finale. Pas de suite prévue.

---

## 5. Outillage RE (« toolbox »)

L'onglet **RE** (`ReToolsView`, base `var/niers.sqlite`) couvre aujourd'hui : recherche de
fonctions labellisées, classes RTTI, xrefs — tout en lecture seule sur une base déjà calculée
hors ligne.

- **Capture de dump live** 🔵 (refus maintenu, même famille que §4.3) — `niers.sqlite`/
  l'exploitation documentée dans `docs/game-data/dump-exploitation.md` s'appuient sur un `.dmp`
  capturé **manuellement** hors de l'app (`MiniDumpWriteDump`, hors repo). Toujours AUCUN bouton
  « capturer un dump » dans l'app : ce serait une attache à un process protégé EAC — refusé sans
  confirmation explicite, décision non révisée par ce cycle de travail.
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
