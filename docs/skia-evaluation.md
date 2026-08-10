# niers — Évaluation de rust-skia (skia-safe 0.98) pour le rendu

> Brique évaluée : **`rust-skia` / `skia-safe` 0.98.0** (FFI vers Skia C++ `m149-0.97.4`), réf. lue : `/tmp/rust-skia-ref`.
> Contexte : pilier **C4 / rendu** (compositeur 2D des menus, voie GPU, lacune « texte »). Cette note prolonge la doctrine de [`docs/STACK.md`](STACK.md) (RÈGLE D'OR §5, « Pourquoi pur transport » §36) et la complète dans le style **« Alternatives rejetées »** du tableau de synthèse : un verdict par dimension, **adossé à une raison byte/pixel**, sans argumentaire de vente.
>
> Objectif non négociable rappelé : **rejouer IEVR (`nie.exe`, moteur Level-5 « Lives ») au byte et au pixel près.** Le rendu de RÉFÉRENCE doit être bit-identique au raster D3D11 du jeu — pas « ressemblant ».

## TL;DR (verdict global honnête)

**Skia est ÉCARTÉ du cœur pixel-perfect de niers.** C'est un **rasteriseur tiers complet** (couverture/AA/blend/sampling/shaping propres, FFI C++) : par construction il ne peut être bit-identique ni au raster D3D11 du moteur « Lives », ni au compositeur CPU maison qui en est la transcription byte-exacte (`crates/engine/nie-game/src/main.rs:870`). Les quatre dimensions techniques convergent : raster, texte, GPU et build/wasm le rejettent toutes — soit par **doctrine byte/pixel**, soit parce qu'il **double une brique déjà choisie** (wgpu + compositeur maison). La seule exception doctrinale qui aurait pu l'autoriser — le **texte vectoriel** des menus — **ne s'applique pas** : le texte d'IEVR est un atlas bitmap pré-cuit (`font_def.g4tx` + métriques `.g4tg`), pas du vectoriel runtime. Sur les niches non-référence (compagnon web azalee, outillage), Skia est **redondant et coûteux** (toolchain C++/LLVM, ~100+ Mo, cible wasm `emscripten` incompatible). **Aucun cas d'usage ne le sauve aujourd'hui.**

## 1. Raster 2D (SkCanvas / SkPaint / SkPath / blend) vs rendu de RÉFÉRENCE — **ÉCARTÉ par doctrine**

Skia embarque **son propre moteur de rastérisation et de blend**. La surface CPU `Surface::raster_n32_premul` (`/tmp/rust-skia-ref/skia-safe/src/core/surface.rs:51`) écrit en N32 prémultiplié via le **SkRasterPipeline** interne, qui sélectionne `lowp`/`highp` selon les features du CPU (→ **non déterministe cross-machine**). L'anti-alias et le dither sont des étages **maison** de Skia (`paint.rs:85-108` : `set_anti_alias`/`set_dither`) ; le blend par défaut est **`BlendMode::SrcOver` de Skia** (`paint.rs:250-259`). Même configuré « au plus simple » (AA off, SrcOver), ce sont l'arithmétique de couverture, la division-par-255 et l'arrondi du **SkBlitter** qui décident des octets — pas ceux du jeu.

Or la cible n'est pas « un alpha-over correct », c'est **l'alpha-over EXACT du moteur « Lives »**. Le compositeur maison en est l'autorité byte, avec un arrondi précis et choisi :

> `crates/engine/nie-game/src/main.rs:870` → `canvas[d + k] = ((sc * a + dc * (255 - a) + 127) / 255) as u8;`

Cette ligne (`blit_over` l.844-876, `scale_nearest` l.825 nearest sans filtrage caché) **est** la référence. Skia applique une formule div-255 différente → divergence d'**au moins 1 LSB** sur les pixels semi-transparents, ce qui fait échouer la gate « égalité octet d'abord » (STACK.md §20, §36).

Preuve la plus forte que Skia est hors-jeu : **niers ne fait même pas confiance à wgpu** comme référence. Le pipeline GPU prémultiplié (`main.rs:2898-2908`) n'est accepté que parce qu'il est **réconcilié au compositeur CPU « à ≤1-2 LSB près »** (`main.rs:2890-2897`, `premultiply_rgba`/`unpremultiply_rgba` l.2991/3008), et STACK.md (ligne GPU/fenêtrage, §13) impose d'**épingler `force_fallback_adapter` (lavapipe/llvmpipe)** car « raster non bit-identique entre vendeurs ». Si la divergence inter-vendeurs d'un **même** backend wgpu est déjà un problème traité, un rasteriseur tiers entièrement **étranger** (Skia) est par construction encore plus inacceptable. C'est la même classe de rejet que rodio/kira (mixeur audio) ou le SIMD de glam qui réordonne les FMA (STACK.md §15, §17).

## 2. Rendu de TEXTE (Skia `textlayout` : SkParagraph / SkFont / SkShaper) — **ÉCARTÉ par doctrine, et hors-cible**

La « lacune texte » de niers est réelle, mais **Skia ne la comble pas**, car l'exception doctrinale (« SI le jeu utilise du texte vectoriel ») **ne se déclenche pas**.

**Ce que fait réellement le jeu** (`docs/DESIGN.md:601-637`, décompilé `crates/archive/nie-engine/src/g4.rs:656-662,789`) : le texte est **bitmap pré-cuit**. `font_def.g4tx` = atlas DDS **4096×2048 (~44 Mo)**, `sub_texture_count=0` → les rects de glyphes viennent d'un fichier externe **`.g4tg`** (codepoint → rect atlas + advance/bearing/baseline) ; le chargeur calcule `%s.g4tx` **et** `%s.g4tg`. Verdict DESIGN.md:622-624 : « police = atlas bitmap (BCn/DDS) + table de glyphes externe, **PAS une police vectorielle** » — `find -iname '*.ttf' -o '*.otf' -o '*.fnt'` = **0**, aucun FreeType dans `nie.exe`. Deux mécanismes : (1) libellés UI **pré-rendus, une texture par locale** (DESIGN.md:645-649) → simple blit de sprite ; (2) texte composé = **blit glyphe-par-glyphe** depuis `font_def` avec avance/kerning du `.g4tg`, **positionnement entier, AA déjà cuit dans l'atlas, aucun AA ajouté** (DESIGN.md:653-655, 677-680). Cible : **égalité octet**.

**Ce qu'est Skia `textlayout`** (`skia-safe/Cargo.toml:41`, `modules/paragraph.rs`, `modules/shaper.rs` `mod harfbuzz`, `features.rs:228`) : un **pipeline vectoriel** TTF/OTF → **shaping HarfBuzz** (+ ICU bidi/segmentation via `embed-icudtl`, feature **défaut** `Cargo.toml:52`) → **raster FreeType** (AA/hinting/subpixel propres, `build_support/platform/linux.rs:41,63`). Il exigerait une police **TTF/OTF que le jeu n'a pas** ; même alimenté par un faux TTF reconstruit, il produirait d'autres contours, un autre AA, un autre hinting → **jamais bit-identique** à l'atlas pré-cuit, et il réintroduit le non-déterminisme inter-plateforme que niers neutralise déjà côté wgpu.

La voie correcte est **déjà spécifiée et pur-Rust** : parser `.g4tg` (NON_FAIT, DESIGN.md:668-671) + blitter de glyphes à positionnement entier (NON_FAIT, DESIGN.md:676-680), réutilisant le container g4tx + décodage DDS **déjà faits** (`g4tx.rs:167-272`). Skia n'y a aucun rôle.

## 3. Backends GPU Skia (Ganesh GL/Vulkan/Metal/D3D + Graphite) vs wgpu — **REDONDANT-AVEC-EXISTANT + écarté par doctrine**

Activer `gl`/`vulkan`/`metal`/`d3d` (`skia-safe/Cargo.toml:34-40`, tous → `gpu = []` l.60) n'« accélère » pas wgpu : ça instancie **Ganesh, une abstraction GPU complète et autonome**. Point d'entrée `DirectContext::new_gl/new_vulkan/new_metal/new_d3d` (`src/gpu/ganesh/direct_context.rs:81-110`), avec son **propre resource-cache** (`set_resource_cache_limit` l.185), son **propre flush/submit** (`flush_and_submit` l.232) et son **propre rasteriseur** (tessellation, AA par couverture, shaders de gradient). C'est une **seconde stack GPU**, parallèle à wgpu, pas un complément.

**Interop wgpu ⇄ Skia : quasi inexistant et unsafe.** `grep -ri wgpu /tmp/rust-skia-ref` ne renvoie **rien** : aucune intégration wgpu fournie. Graphite (backend Dawn/WebGPU) n'est **pas exposé** dans cette version (pas de répertoire `gpu/graphite/`, seul le commentaire `gpu.rs:11`). Le seul pont théorique passe par des **handles bruts** (`surface_ganesh.rs:75/116` `wrap_backend_texture`/`wrap_backend_render_target` à partir d'un `GL id`/`VkImage`/ressource D3D), extraits via `wgpu-hal` — chemin **deeply unsafe** (`new_d3d` est `pub unsafe fn`, `direct_context.rs:110`) qui **viole `#![forbid(unsafe_code)]`** (`crates/engine/nie-game/src/main.rs:36`).

STACK.md (§13) a **déjà acté wgpu** comme backend unifié et rejeté GL brut et ash/D3D11 (« surface unsafe — incompatible `forbid(unsafe_code)` »). Ganesh **réinjecte son raster** — exactement ce que proscrit le §36 (« toute couche qui réinjecte son propre raster/scheduler empêche de matcher l'octet ») — et seul wgpu permet le `force_fallback_adapter` qui fonde la fidélité. Un quad blit Skia ne sera **jamais** bit-identique au moteur « Lives ». Note : la lacune texte relève du **raster CPU/`textlayout`** (dimension 2), pas de ces backends GPU.

## 4. Coût de build / taille binaire / faisabilité wasm — **ÉCARTÉ (le coût confirme la doctrine)**

Même en se plaçant **uniquement** sur l'axe build/taille/wasm (sans invoquer le byte-identique), Skia se disqualifie pour le seul créneau où il pourrait théoriquement vivre (compagnon web azalee).

- **Toolchain C++ obligatoire, pas pur-Rust.** `skia-bindings/build.rs:114-146` (« STARTING A FULL BUILD ») + `skia-bindings/README.md:17` : pull **depot_tools + skia** depuis Google, `git-sync-deps` en **Python**, config **GN**, compile **Ninja** ; prérequis `README.md:61` **LLVM/clang 16+, Python 3, Ninja** ; build-deps Cargo (`skia-bindings/Cargo.toml:70-73`) tirent `cc`, `bindgen 0.72` (→ libclang), `pkg-config`. Exactement la classe rejetée pour SDL2 (« dép C, mauvais fit wasm », STACK.md §13) et flecs-ecs (« dép C, hostile wasm », §19). L'éthos est gravé : `nie-formats/src/lib.rs:1` « no_std-friendly (alloc) pour la portabilité wasm », `nie-wasm/Cargo.toml` choisit `image_dds`/`cridecoder` en `default-features=false` (« décodeur pur Rust compatible wasm32 »).
- **Taille : ~100+ Mo de lib statique C++.** `skia-bindings/Cargo.toml:34` épingle `skia = "m149-0.97.4"` ; le défaut `["binary-cache","embed-icudtl","pdf"]` (l.37 ; skia-safe ajoute `"jpeg"` l.30) **télécharge par curl** (`README.md:42`) des libs statiques C++ massives, `embed-icudtl` embarquant en plus la table ICU Unicode (multi-Mo). En face, le compositeur niers = **3 fonctions pur-Rust** sur `Vec<u8>` : `crop_rgba` (`main.rs:681`), `scale_nearest` (`main.rs:825`), `blit_over` (`main.rs:844`) — zéro octet de dépendance native.
- **WASM : incompatibilité dure.** `README.md:193-194` est sans ambiguïté : « *wasm32-unknown-unknown is unsupported because it is fundamentally incompatible with linking C code* ». Skia n'existe en wasm que via **`wasm32-unknown-emscripten`** (`README.md:51`, EMSDK + `EMCC_CFLAGS`, emscripten 3.1.57+). Or azalee est sur **`wasm32-unknown-unknown` + `wasm-bindgen`** (`nie-wasm/Cargo.toml`, confirmé `PLAN.md §4`). Adopter Skia forcerait azalee à **basculer toute sa cible wasm vers emscripten**, cassant la chaîne wasm-bindgen + décodeurs pur-Rust déjà livrée. Le compositeur actuel **compile déjà en wasm** sans gymnastique.

## 5. Skia vs le compositeur MAISON (crop/scale/blit + g4tx + voie wgpu) — **ÉCARTÉ : surplus, pas apport**

niers fait **déjà** tout ce que le contenu réel exige, **de façon déterministe par construction** : décodage + régions d'atlas (`g4tx.rs:241 region_rect`, `main.rs:681 crop_rgba`) ; compositeur CPU (`scale_nearest` l.825, `blit_over` l.844, `cmd_compose_layout` l.884 scale+anchor+z-order) ; **affine 2D complet** déjà implémenté (`nie-formats/src/menu.rs:203 blit_sprite` : translate **+ scale + rotation** sin/cos l.209, échantillonnage l.242, straight-alpha over l.255) ; voie GPU offscreen wgpu (`main.rs:2831+`, llvmpipe/lavapipe + Nearest + sans sRGB).

Skia apporterait **SkPath/Bézier, Effects & Shaders, PDF/SVG, shaping HarfBuzz+ICU, skparagraph, Skottie** (`skia-safe/README.md`, features `textlayout/svg/skottie/pdf`). Or le contenu IEVR est **100 % quads texturés à transform 2D** : `g4pkm.rs:382,404-417` décompose `(scaleX, scaleY, rot)` d'une matrice 2D — **aucun path/bezier/SVG/filtre vectoriel** dans le format. Et le texte est **atlas bitmap** (DESIGN.md:622). La **seule** exception qui aurait justifié Skia — texte vectoriel — **n'existe pas** ; la vraie lacune est le parseur `.g4tg` + un blit de glyph-rects, **la même primitive quad** que tout le reste. Skia est donc un raster tiers pour un contenu qu'il sur-spécifie : **surplus non nécessité ET interdit par la RÈGLE D'OR**.

## 6. Récapitulatif : dimension → verdict → raison byte/pixel

| Dimension | Verdict | Raison byte/pixel (décisive) |
|---|---|---|
| **Raster 2D** (SkCanvas/SkPaint/SkPath/blend CPU) | **Écarté — doctrine** | SkRasterPipeline/SkBlitter = couverture/arrondi/SrcOver propres → ≥1 LSB d'écart vs `main.rs:870` ; SkRasterPipeline `lowp/highp` = non déterministe cross-machine. |
| **Texte** (`textlayout` SkParagraph/SkFont/SkShaper) | **Écarté — doctrine + hors-cible** | Le texte IEVR est un **atlas bitmap pré-cuit** (`font_def.g4tx`+`.g4tg`, DESIGN.md:622), pas du vectoriel → l'exception « texte vectoriel » ne s'applique pas ; shaping/FreeType jamais bit-identique à l'atlas. |
| **Backends GPU** (Ganesh GL/Vulkan/Metal/D3D + Graphite) | **Redondant + écarté** | Seconde stack GPU autonome (raster Ganesh réinjecté), **zéro interop wgpu**, pont par handles bruts `unsafe` (viole `forbid(unsafe_code)`) ; wgpu déjà acté + `force_fallback_adapter`. |
| **Build / taille / wasm** | **Écarté — coût + doctrine** | Toolchain C++ (LLVM/Python/GN/Ninja/libclang), ~100+ Mo, FFI unsafe ; wasm **uniquement `emscripten`**, incompatible avec `wasm32-unknown-unknown`+wasm-bindgen d'azalee. |
| **Fit vs compositeur maison** | **Écarté — surplus** | Contenu = 100 % quads + atlas (`g4pkm.rs:382`) ; crop/scale/blit/affine **déjà faits** (`main.rs`, `menu.rs:203`) ; Skia sur-spécifie (paths/SVG/Skottie inutiles). |

## 7. Où Skia pourrait fitter (le cas échéant) — sans complaisance

La doctrine ouvre trois portes **non-référence** : compagnon web azalee, outillage/preview/debug, texte vectoriel des menus. **Aucune ne sauve Skia aujourd'hui** :

- **Compagnon web azalee** (« ça ressemble » suffit) : **redondant et régressif**. azalee recompile le **même code niers** en wasm et réutilise gratuitement le blitter d'atlas pur-Rust (portable WebGPU). Skia-on-wasm impose **emscripten + EMBED_FREETYPE + ICU multi-Mo** (`wasm-example`, `emscripten.rs:81`) pour zéro gain de fidélité, et **casse la cible `wasm32-unknown-unknown`**.
- **Outillage / preview / debug** : seul créneau théorique (overlay de debug, annoter du SVG). Mais c'est trivial et **ne justifie pas** une chaîne de build C++/LLVM/GN/Ninja + FFI unsafe (incompatible `#![forbid(unsafe_code)]`). À écarter sauf besoin futur **prouvé et isolé** hors du chemin pixel.
- **Texte vectoriel runtime** : **le seul créneau à rediscuter** *si un jour* on prouvait qu'IEVR rasterise du vrai texte vectoriel à l'exécution (TTF/OTF + shaping). La preuve moteur actuelle dit le contraire (atlas + `.g4tg`). Tant que ce n'est pas démontré, et même alors uniquement **hors du chemin pixel-exact**, Skia reste hors-jeu.

## 8. Conclusion

**Écarté du cœur pixel-perfect.** Skia est un rasteriseur tiers (couverture/arrondi/blend/shaping propres, non déterministe, FFI C++) : il **ne peut pas** être bit-identique au raster D3D11 du jeu « Lives », ni au compositeur CPU maison qui en est la transcription byte-exacte (`main.rs:870`). Sur le GPU il **double wgpu** sans interop propre et avec de l'`unsafe` interdit ; sur le build il impose une toolchain C++/LLVM et ~100+ Mo ; sur le wasm il **brise** le pipeline azalee (emscripten ≠ wasm-bindgen). La lacune texte se comble en **pur-Rust** (parseur `.g4tg` + blit de glyph-rects à positionnement entier), pas avec un moteur de fontes.

**Recommandation : ne pas introduire Skia.** Le cœur de rendu reste **pur-Rust (crop_rgba/scale_nearest/blit_over/blit_sprite) + wgpu maîtrisé et épinglé**. **Réservé** — au mieux — à un éventuel outillage de debug non-référence, et **uniquement** si un besoin futur (ex. texte vectoriel runtime avéré) était démontré et isolable hors du chemin byte-exact. Aucune action attendue côté stack.
