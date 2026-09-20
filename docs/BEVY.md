# Bevy et niers — ce qu'il a, ce qu'on a, ce qu'on lui prend

Relevé du 2026-09-20 sur **Bevy 0.19.1**, par lecture des sources publiées
(`static.crates.io`), pas de la mémoire.

Ce document existe pour une raison précise : en une seule session, j'ai **réécrit à la main deux
briques que Bevy fournit** (`FixedStep` ≈ `bevy_time::Fixed`, `Segment`/`grid_segments`/
`box_segments` ≈ `bevy_gizmos`) et **déclaré « à faire » une troisième qui est livrée**
(`bevy_gizmos::transform_gizmo`). La cause est identifiable : j'avais regardé 7 sous-crates en
croyant les avoir vus tous. **Il y en a 55.**

## La règle qui décide

`docs/STACK.md` écarte les ECS pour le **cœur** : le byte-exact exige des structs 1:1 avec le
layout C++. Bevy est donc admis comme **adaptateur** — assets, rendu, outillage — jamais comme
simulation. Trois questions à poser avant de tirer un crate `bevy_*` :

1. **Est-ce sur le chemin du cœur ?** Si oui, non. La frontière est vérifiable :
   `cargo tree -p nie-runtime -i bevy_ecs` doit rester vide.
2. **Combien ça coûte là où ça vivrait ?** Le module WebAssembly du jeu tient à **4,56 Mio sur un
   budget de 6** (`apps/nie-web/scripts/build-wasm.ts`). Un crate qui tire `bevy_ecs` dans le wasm
   se mesure avant, pas après.
3. **`STACK.md` a-t-il déjà tranché la dépendance transitive ?** `bevy_audio` tire `rodio`, que
   `STACK.md` écarte nommément (« impose son mixeur et son resampler, là où l'identité audio est
   le PCM du mixeur CRI »). Le crate Bevy n'annule pas le rejet de ce qu'il tire.

Quand la réponse est « on ne peut pas tirer le crate », il reste **la structure**, et elle vaut
souvent le détour : `nie_app::input::ButtonInput` est calqué sur `bevy_input::ButtonInput`, et
c'est de là que vient sa subtilité utile — un `press()` sur une touche déjà enfoncée n'alimente
pas `just_pressed`, donc la répétition clavier ne fait pas défiler un menu.

## Les 55 sous-crates

`bevy_a11y`, `bevy_android`, `bevy_animation`, `bevy_anti_alias`, `bevy_app`, `bevy_asset`,
`bevy_audio`, `bevy_camera`, `bevy_camera_controller`, `bevy_clipboard`, `bevy_color`,
`bevy_core_pipeline`, `bevy_derive`, `bevy_dev_tools`, `bevy_diagnostic`, `bevy_ecs`,
`bevy_feathers`, `bevy_gilrs`, `bevy_gizmos`, `bevy_gizmos_render`, `bevy_gltf`, `bevy_image`,
`bevy_input`, `bevy_input_focus`, `bevy_light`, `bevy_log`, `bevy_material`, `bevy_math`,
`bevy_mesh`, `bevy_pbr`, `bevy_picking`, `bevy_platform`, `bevy_post_process`, `bevy_ptr`,
`bevy_reflect`, `bevy_remote`, `bevy_render`, `bevy_scene`, `bevy_shader`, `bevy_solari`,
`bevy_sprite`, `bevy_sprite_render`, `bevy_state`, `bevy_tasks`, `bevy_text`, `bevy_time`,
`bevy_transform`, `bevy_ui`, `bevy_ui_render`, `bevy_ui_widgets`, `bevy_utils`, `bevy_window`,
`bevy_winit`, `bevy_world_serialization`, `bevy_dylib`.

## Ce qu'on a déjà réécrit sans le savoir

| Notre code | L'équivalent Bevy | Ce que le leur a en plus |
|---|---|---|
| `nie_runtime::FixedStep` | `bevy_time::Fixed` | `from_hz`, `set_timestep_hz`, `discard_overstep`, `accumulate_overstep`, et **`overstep_fraction`** — repris depuis (cf. plus bas) |
| `nie_render3d::scene::Segment`, `grid_segments`, `box_segments` | `bevy_gizmos` | `linestrip`, `lineloop`, `line_gradient`, `ray`, `rect`, `cube`, `aabb_3d`, `grid_2d`/`grid_3d`, plus les modules `arcs`, `arrows`, `circles`, `cross`, `curves`, `frustum`, `rounded_box`, `primitives`, `retained`, `skinned_mesh_bounds`, `stroke_text` (du texte tracé en segments, sans atlas de police) |
| `depth_test: bool` sur un segment | `GizmoConfig::depth_bias: f32` | Un biais continu plutôt qu'un booléen : on peut rapprocher un trait sans le sortir complètement du test |
| Le gizmo de manipulation, annoncé « reste à faire » | `bevy_gizmos::transform_gizmo` | **Existe** : `TransformGizmoPlugin`, modes translation/rotation/échelle, espaces local/monde, `intersect_plane`, `axis_direction` |

La réécriture de `Segment` n'est pas pour autant à jeter : `bevy_gizmos` dessine à travers le
pipeline Bevy (`bevy_render` + `bevy_camera`), alors que notre besoin est le **rastériseur CPU**,
qui est l'oracle des goldens et le repli du navigateur sans WebGPU. Ce qu'il faut en retenir,
c'est le **vocabulaire manquant** (flèches, cercles, arcs, texte en segments) et le biais de
profondeur continu.

## Ce qu'ils ont et qu'on n'a pas

| Manque niers, mesuré | Crate Bevy | Remarque |
|---|---|---|
| Aucune navigation de focus partagée — nos commandes s'appellent pourtant `CMD_FCS_MTX_{UP,DOWN,LEFT,RIGHT}` | **`bevy_input_focus`** | Fournit `InputFocus`, `FocusGained`/`FocusLost`, `tab_navigation` et **`directional_navigation`** : exactement notre « matrice de focus », en première main |
| Caméra orbitale dupliquée au moins 3 fois (`rust-model-viewport.tsx`, `nie-editor`, `WebViewer::orbit`) | **`bevy_camera_controller`** | Contrôleurs sous drapeaux séparés ; le crate dit lui-même que copier le code est un usage prévu |
| Aucun protocole d'inspection d'une application vivante | **`bevy_remote`** | JSON-RPC sur HTTP — colonne vertébrale d'un éditeur qui pilote un jeu en cours d'exécution |
| Inspecteur de propriétés écrit à la main, sérialisation `SceneDocumentV2` cousue main | **`bevy_reflect`** | Réflexion à l'exécution : un inspecteur générique au lieu d'un champ par champ |
| Aucune manette | **`bevy_gilrs`** | Les trois tables clavier ne parlent que du clavier |
| Aucune accessibilité | **`bevy_a11y`** | — |
| Aucun presse-papier | **`bevy_clipboard`** | — |
| Widgets d'éditeur écrits en egui (natif) et en React (web), deux fois | **`bevy_feathers`**, `bevy_ui_widgets` | `feathers` est le jeu de widgets orienté outillage de Bevy |
| Pas de rendu de texte vectoriel | `bevy_text` | Sans objet ici : le jeu a un **atlas bitmap pré-cuit**, et `STACK.md` écarte tout rastériseur de police |
| Pas d'antialiasing/post-traitement | `bevy_anti_alias`, `bevy_post_process` | Sans objet sur le chemin de fidélité : le rendu de référence doit être bit-identique, pas plus joli |

## Ce qu'on lui a déjà pris

- **`ButtonInput`** → `nie_app::input::ButtonInput`. Structure seulement : `bevy_input` tire
  `bevy_ecs`, hors budget wasm. Y compris le `Default` écrit à la main, que Bevy écrit aussi à la
  main parce que le dériver exigerait `T: Default` pour des ensembles vides.
- **`overstep_fraction`** → `nie_runtime::FixedStep::overstep_fraction`. Lire `bevy_time` a
  montré que notre `reste()` laissait la division à l'appelant, c'est-à-dire à personne : aucun
  hôte du dépôt n'interpole. `STACK.md` demande pourtant que « le rendu part d'un état
  interpolé ». Sans ce facteur, une simulation à 60 Hz sur un écran à 144 Hz répète des images
  puis saute — ça se lit comme une physique saccadée alors qu'elle est régulière.
- **Types d'assets** → `crates/engine/nie-bevy` : les `.g4tx`/`.g4md` du jeu deviennent
  `bevy_image::Image` et `bevy_mesh::Mesh`, lus **directement dans les CPK** par un `AssetReader`
  sur le VFS. Derrière la feature `bevy`, éteinte par défaut.

## Avant d'écrire quoi que ce soit

Chercher dans les 55. La liste ci-dessus est à jour du 2026-09-20 ; pour la revérifier :

```sh
curl -sS "https://crates.io/api/v1/crates/bevy_internal/<version>/dependencies" \
  | python3 -c "import json,sys;print(*sorted(x['crate_id'] for x in json.load(sys.stdin)['dependencies'] if x['crate_id'].startswith('bevy_')),sep='\n')"
```

Et pour lire une API sans deviner :

```sh
curl -sSL "https://static.crates.io/crates/<crate>/<crate>-<version>.crate" | tar xz
```

`docs.rs` rend sa barre latérale aux outils en ligne de commande, pas le contenu des pages :
c'est ce qui m'a fait croire, une première fois, que je regardais la documentation.
