# Native UI sprite sheets and shared presentation

Source inventory recorded on 2026-09-08 on `vps-203bea89`, checkout `/home/ubuntu/niers`.
This document describes current scene resource declarations and their intended roles. It does
not certify visual fidelity, complete native state recovery, or that every declared region has
been exercised in the browser. Validation is deferred to the final gate for this batch.

## Ownership and integration

`crates/engine/nie-formats/src/g4tx.rs` resolves named textures and spatial sub-textures.
`g4tx_decode::decode_named_to_rgba` in the same crate decodes a named texture or crops a named
sub-texture using the container's own rectangle. A main texture and a spatial region are both
valid selectors; do not assume every name is a grid cell or strip a material suffix to invent
its texture name.

`AssetSource.urlTexture` is the host binding. The shared `nativeSpriteUrl` helper passes
`<VFS .g4tx path>/<native region>` through that binding. Browser hosts use the existing
`/assets/tex/…g4tx/<region>.png` adapter. Shared components do not decode G4TX in TypeScript,
copy game images into source, or fetch a full atlas and approximate its cells with CSS offsets.

The reusable presentation lives under `packages/inacord-ui/src/shell/`:

- `NativeSprite` in `native-sprite.tsx` paints one named region and its optional native mask.
  Its `rect`, `drawOrder`, `rotationDeg`, and `maskMode` come from native scene/slot metadata.
  `nativeSpriteGeometry` preserves those canvas coordinates. `native-sprite.css` owns absolute
  image positioning, unrestricted intrinsic image bounds, pointer pass-through and mask sizing.
- `NativeSceneLayers` in `native-scene-layers.tsx` composes scene sprites. Opening, front-menu and avatar reuse this owner. The native Options migration is pending
  and can consume the same interface once its scene is resolved. Text remains native bitmap text;
  controls and their reducer remain separate interactive elements over the native sprites.
- Avatar catalogue thumbnails now use `NativeSprite` too. The catalogue's `icone` identifies
  the native region; the existing atlas-name extraction is limited to the known avatar icon
  families. The renderer does not manufacture a thumbnail for an unresolved part.

Resource readiness includes the image and a separately loaded CSS mask. Missing bindings,
missing URLs and image/mask errors produce `failed`; a required missing mask is not a successful
unmasked render. Failed images remain hidden, while callers retain their existing error state.
Readiness resets when resource identity changes. Scene composition scopes aggregate state to the
scene, so a previously loaded region does not certify a different focused region.

`focusedId` and `selectedIds` select an authored `focusedRegion`; `visibleWhen: "focused"`
controls authored overlays. `activeLayerIds` overrides that decision per layer when the native
policy differs: avatar checkmarks and stage markers reflect selection, while other controls may
reflect selection or focus. `data-native-active` exposes the result without applying CSS tint,
brightness, invented pressed art or a generic focus border. Native source order is retained and
`drawOrder` supplies the z-index. Existing per-surface rotation origins remain unchanged.

## Opening and front-menu sheets

Paths below are full VFS identities. Region names are taken from the current JSON scenes in
`crates/engine/nie-formats/src/menu_scenes/`; each layer records its source object and placement
method. Movie logos are original USM media, not substitutes cut out of a sprite atlas.

| Sheet | Regions and intended role | Source declaration |
|---|---|---|
| `data/dx11/menu/11_loading/loading01/loading01_01/loading01_01.g4tx` | `load_ball01`: loading football | `loading.json` |
| `data/dx11/menu/50_title/title00/title00_01_st/title00_01_st.g4tx` | `bg_sky01_st`, `bg_chr02_st`, `bg_chr01_st`: separate sky and foreground-character layers | `start.json` |
| `data/dx11/menu/50_title/title00/title00_03_02/fr/title00_03_02.g4tx` | `logo02`: localized START logo | `start.json` |
| `data/dx11/menu/10_win/win04/win04_01/win04_01.g4tx` | `win_base01`, `win_base_illust01`: autosave notice window and illustration | `autosave.json` |
| `data/dx11/menu/20_cmn/cmn03/cmn03_03/cmn03_03.g4tx` | `cmd_press_btn_base_on01`: notice confirmation button base | `autosave.json` |
| `data/dx11/menu/20_cmn/cmn01/cmn01_20/cmn01_20.g4tx` | `icon_saving01` through `icon_saving05`: declared save-icon parts; native playback timing remains separate evidence | `autosave.json` |
| `data/dx11/menu/50_title/title02/title02_00/title02_00.g4tx` | `bg_title02_01`, `bg_title02_02`, `bg_title02`, `bg_title02_par`: native title background components | `title-menu.json` |
| `data/dx11/menu/50_title/title02/title02_01/fr/title02_01.g4tx` | `logo02`: localized front-menu logo | `title-menu.json` |
| `data/dx11/menu/50_title/title02/title02_11/fr/title02_11.g4tx` | `avatar_base03`, `gtxt_avatar01`, `avatar_base01_ol`: avatar banner, label and outline | `title-menu.json` |
| `data/dx11/menu/50_title/title02/title02_10/fr/title02_10.g4tx` | `myteam_base02`, `gtxt_myteam01`: team banner and label | `title-menu.json` |
| `data/dx11/menu/50_title/title00/title00_07/title00_07.g4tx` | `btn_base01_off/on` through `btn_base11_off/on`, `icon_btn01` through `icon_btn11`, `btn_shadow01`, `btn_focus01`, `btn_base01_msk`: authored tile states, icons, shadow, focus and mask | `title-menu.json` |

The tile mask `btn_base01_msk` stores coverage in RGB with opaque alpha. Its scene declaration
therefore requires `maskMode: "luminance"`; treating it as an alpha mask exposes the full image.
The shared sprite renderer preserves this material choice and checks that the mask actually loads.
The native title action sequence is declared by the scene's control identities and provenance;
icon numbers are not a substitute for those action bindings.

## Avatar sheets and icon families

For the first column below, `A` expands to
`data/dx11/menu/161_avatar/avatar01/`. A row such as `A/avatar01_17/avatar01_17.g4tx` is one
specific sheet, not a glob to search at runtime.

| Sheet | Native regions and role |
|---|---|
| `A/avatar01_00/avatar01_00.g4tx` | `bg01`, `bg_pattern01`: separate editor background layers |
| `A/avatar01_10/avatar01_10.g4tx` | `edit_win_base01`, `edit_line01`: editor panel and separator |
| `A/avatar01_52/avatar01_52.g4tx` | `gender_list01`, `gender_list01_ol`, `edit_check01`: gender choice tiles, outline and selected checkmark |
| `A/avatar01_12/avatar01_12.g4tx` | `body_list01`, `body_list01_ol`, `edit_check01`: body choices and selected state |
| `A/avatar01_11/avatar01_11.g4tx` | `arrow01_l`, `arrow01_r`: body-page navigation |
| `A/avatar01_13/avatar01_13.g4tx` | `edit_bar_base01_off`, `edit_bar_gauge_base01`: height control base and track |
| `A/avatar01_17/avatar01_17.g4tx` | `preset_list01`, `preset_list01_ol`, `edit_check01`: face-preset grid and selected state |
| `A/avatar01_14/avatar01_14.g4tx` | `arrow01_l`, `arrow01_r`: face-preset paging |
| `A/avatar01_02/avatar01_02.g4tx` | `list_base01_off/on`, `list_base01_ol`, `icon_edit_list01_off/on` through `icon_edit_list13_off/on`: face/stat category rows and authored icons |
| `A/avatar01_20/avatar01_20.g4tx` | `dress_preset_base01`: clothing preset panel |
| `A/avatar01_21/avatar01_21.g4tx` | `type_icon_list01_l`, `type_icon_list01_l_ol`, `edit_check01`: clothing choices and selected state |
| `A/avatar01_46/avatar01_46.g4tx` | `memo_base02`: clothing note panel |
| `A/avatar01_41/avatar01_41.g4tx` | `cmd_type_list01`: stat-category control base |
| `A/avatar01_50/avatar01_50.g4tx` | `type_base01_off`: stat-selection panel base |
| `A/avatar01_44/avatar01_44.g4tx` | `name_base01_off/on`: native name-field states |

Additional shared sheets:

- `data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_02/fr/mainmenu90_02.g4tx`:
  `header_base02`, `mode_base08`, `icon_header_avatar01` supply the editor header.
- `data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_02_2/mainmenu90_02_2.g4tx`:
  `icon_base01`, `icon_menu_arrow01`, `icon_menu_avatar01_off/on` through
  `icon_menu_avatar06_off/on` supply the stage strip. A hover does not mark another stage selected.
- `data/dx11/menu/100_mainmenu/mainmenu01/mainmenu01_10/mainmenu01_10.g4tx`:
  `back_base01`; the adjacent `mainmenu01_12/mainmenu01_12.g4tx` supplies `next_base01`.
- `data/dx11/menu/200_icon/21_icon_avatar/icon_ava_gender01.g4tx`:
  `icon_ava_gender01_001`, `icon_ava_gender01_002` are the gender pictograms.
- `data/dx11/menu/200_icon/21_icon_avatar/icon_avacate.g4tx`:
  `icon_avacate_fashion_01_off` through `icon_avacate_fashion_03_off` are clothing-category icons.
- Dynamic face/body/uniform icons use the catalogue's complete region name in
  `data/dx11/menu/200_icon/21_icon_avatar/<atlas>.g4tx`. Supported atlas prefixes are
  `icon_ava_faceNN`, `icon_ava_bodyNN`, `icon_ava_uniformNN`, `icon_ava_genderNN`.
  Never infer character identity, a missing thumbnail, or a grid position from the display number.

The height-track correction has additional private source evidence in
`var/outputs/interface-delivery/avatar-gauge-vfs`, `avatar-gauge-probe.rs` and
`avatar-gauge-region.png`. On 2026-09-08, the existing G4PKM/G4MD parsers identified material slot
2 as `bar_gauge_base01_mat_01`; the shipped atlas metadata identifies
`edit_bar_gauge_base01` at `(0,32,240,12)`. The scene pairs them by base-layer role and exact
native dimensions. `bar_gauge_base01` is not an atlas region. The G4TP linkage remains undecoded;
this correction does not claim that material-to-texture linkage has been fully recovered.

## Options and controls

`setting_menu_setting.cfg.bin` owns Options. The separate
`keyconfig_setting_menu_setting.cfg.bin` owns controller/key configuration. Do not substitute
`camera_option_menu`, which is the in-match camera panel. The established source inventory is
`data/menu/screen-inventory.json` and `docs/game-data/menu-screen-inventory.md`:

- `cmn06_02_list_tab_attach`, `cmn06_20_list_tab_item`, and `icon_list_tab.g4tx` identify the
  Options tab assembly.
- `data/dx11/menu/108_option/option01/option01_01/option01_01.g4tx` and
  `data/dx11/menu/108_option/option01/option01_02/option01_02.g4tx` identify the row sheets;
  `data/dx11/menu/108_option/option01/option01_05/option01_05.g4tx` identifies the guide-band sheet.
  Region selections have not yet been verified.
- `option01_21/22/23_keyconfig_setting_list_*` and `cmn01_22_keyconfig_edit_icon` identify
  key-configuration rows/icons.

These setting object names are not texture-region names. The native Options scene must declare
its resolved atlas paths and regions before a sprite can be instantiated. The shared renderer
accepts that scene through the same API; it does not invent a mapping from these object names.
The native Options migration was paused before source integration; its runtime-discovery export
is not a reconstructed scene or an oracle. Unresolved tab/slider/keycap regions remain explicit
reconstruction work.

## Source inspection and remaining gates

To inspect declarations without rendering game assets, read each scene's `layers` and group by
`assetPath`; collect `region`, `focusedRegion`, `maskRegion` and `provenance`. The source inventory
for this document was obtained with `bun -e` over those checked-out JSON files on the host/date
above. For actual atlas metadata, the existing `/assets/tex-info/<path-without-data-prefix>.g4tx`
endpoint exposes named textures and `regionsDetail` from the Rust G4TX parser. It is an inspection
source, not a public diagnostic to embed in game screens.

The previously run gauge inspection used that endpoint and downloaded only its selected region
into private evidence. No new browser captures, tests or builds were run for this sprite batch.
Final validation still needs real-resource loads, native/Wasm scene parity, focused/selected state
transitions, missing-mask failure handling, and matched native-reference visual comparisons.
Existing legacy WebP grid configurations remain compatibility data for their consumers; they
have not been promoted into the reconstructed native-screen resource contract.
