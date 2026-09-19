# Stack vidéo — ce qu'on utilise, et pourquoi

Recherche menée le **2026-09-19** sur les deux écosystèmes du dépôt, Rust et Bun. Les chiffres
ci-dessous sont mesurés sur cette machine, pas cités de mémoire.

Besoin d'origine : produire nativement une vidéo à partir d'images rendues par `nie-render3d` —
cible 1 280 × 720, ~60 i/s, quelques secondes, son compris.

## Les deux faits qui commandent tout le reste

**1. Il n'existe pas d'encodeur VP9 en Rust pur utilisable.** Les deux seuls candidats sur
crates.io sont `rusty_vp9` 0.1.1 (421 téléchargements, 2 versions) et `oxideav-vp9` 0.0.13, dont
la description amont admet n'être qu'un échafaudage en attente de réimplémentation. VP9 en Rust
impose donc un binding `libvpx`, et `pkg-config --modversion vpx` **échoue ici** (pas de paquet
dev). En revanche **AV1 par `rav1e` est du Rust pur, mûr, et se muxe dans le même conteneur
WebM**. Le rail natif est donc **AV1 + Opus**, pas VP9 + Opus.

**2. Bun 1.4 n'implémente aucune WebCodecs.** Mesuré : `VideoEncoder`, `VideoFrame`,
`AudioEncoder`, `OffscreenCanvas`, `createImageBitmap`, `ImageDecoder` sont tous `undefined`.
`mediabunny` se charge parfaitement sous Bun mais répond `canEncodeVideo("vp9") === false`. Sans
backend natif, **aucun encodage côté serveur en TypeScript**.

## Le piège de licence, deux fois

Le champ `license` d'un paquet décrit **le code de liaison**, pas ce qu'il embarque.

- **Rust** — `ffmpeg-next` / `video-rs` s'affichent WTFPL / MIT-Apache. Le ffmpeg de cette
  machine est compilé `--enable-gpl --enable-libx264 --enable-libx265`. **Le lier ferait basculer
  le binaire en GPL-2.0+**, incompatible avec une distribution Apache-2.0.
- **Bun** — `@seydx/node-av-linux-x64` (167 Mo) déclare `"license": "MIT"`. Un `strings` sur le
  `.node` livré rend `--enable-gpl --enable-version3 --enable-libx264 --enable-libx265` : c'est
  un **FFmpeg GPLv3 chargé en process**.

**Ce qui ne pose pas ce problème** : invoquer le binaire `ffmpeg` en **sous-processus**. Ce n'est
pas de l'édition de liens, donc aucune contamination — y compris avec le build GPL déjà installé.
C'est `ffmpeg-sidecar` (MIT) côté Rust, `Bun.spawn` côté Bun.

## Décision — Rust

| Rôle | Crate | Version · licence · date | Pur Rust |
|---|---|---|---|
| Encodage vidéo | `rav1e` (AV1) | 0.8.1 · BSD-2 + AOM Patent 1.0 · commit 2026-08-31 | ✅ (NASM si `asm`) |
| RGBA → I420 | `yuv` | 0.8.19 · BSD-3 / Apache-2.0 · 2026-09-17 | ✅ |
| Encodage audio | `opus-rs` | 0.1.33 · BSD-3 · 2026-09-07 | ✅ `no_std` |
| Muxing WebM | `webm` 2.2.1 (MPL-2.0, libwebm en C++) ou `webm-iterable` 0.7.1 (MIT, 100 % Rust) | 2026-08-25 / 2026-08-28 | ❌ / ✅ |
| Muxing MP4 | `mp4-atom` | 0.15.0 · MIT / Apache-2.0 · commit 2026-09-17 | ✅ |
| Décodage AV1 | `rav1d` 1.1.0 (BSD-2) ou `dav1d` 0.11.1 | — | ✅ / lie libdav1d |
| Décodage VP9 | — aucun pur Rust crédible | — | ❌ |
| Repli global | `ffmpeg-sidecar` | 2.5.2 · **MIT** · sous-processus | zéro contamination |

Deux pièges relevés au passage :

- **`mp4` 0.14.0 est mort** malgré 13 M de téléchargements : dernière release 2023-08-01, 38
  issues ouvertes. Le compteur de téléchargements est un historique, pas un signe de vie.
- **`rav1e` en bibliothèque exige `default-features = false`**, sinon il tire `clap`, `y4m`,
  `av-metrics` et `git2`.

**Placement** : `rav1e` tire `rayon`/`std` et n'a rien à faire dans `nie-formats`. Le muxing
(`webm-iterable`, `mp4-atom`) et `opus-rs` sont `no_std`-compatibles et prolongent naturellement
`nie-formats/src/{webm,mp4,ivf}.rs` ; l'encodeur va dans un crate natif, à côté de `nie-render3d`.

## Décision — Bun

| Besoin | Outil | Motif |
|---|---|---|
| **Serveur** : images → WebM | `Bun.spawn` + ffmpeg 8.0.1 | **1,36 s / 88 923 o** contre 2,59 s / 210 424 o pour mediabunny ; zéro dépendance, pas de GPL lié |
| Serveur : métadonnées vidéo | `mediabunny` 1.58.1 **seul** | chemin 100 % TS, aucun natif, aucun risque de licence |
| Serveur : PNG → RGBA | `sharp` 0.35.4 (Apache-2.0) | mesuré OK sous Bun |
| **Navigateur** : encoder / muxer | `mediabunny` 1.58.1 (MPL-2.0) | **39 KB gzip** tree-shaké contre 174 KB pour le bundle complet |
| Navigateur : lecture + UI | `hls.js` 1.7.3 + `media-chrome` 4.19.2 | déjà au catalogue |
| **Comparaison image par image** | **Rust par `bun:ffi`** | voir ci-dessous |

`Bun.$` marche aussi, mais **seulement pour un tampon unique** ; pour alimenter image par image,
`Bun.spawn` est la bonne primitive, et c'est `stdin.flush()` qui porte la contre-pression.

Si `mediabunny` est utilisé côté serveur malgré tout, employer **`FilePathTarget`** et non
`BufferTarget` : mesuré à 120 images, RSS crête **440 Mo** en streaming — `BufferTarget` garde
tout le fichier en mémoire, intenable sur une séquence longue.

### Un bug Bun à connaître

Reproductible 3 fois sur 3 : **une exception non rattrapée pendant un décodage natif actif fait
planter Bun en SIGSEGV (exit 132)**, pas en exit 1. L'erreur réelle s'affiche *avant* le panic,
mais le rapport de crash accuse Bun. Rattrapée dans un `try/catch`, la même erreur passe
proprement.

**Mitigation obligatoire** : tout `for await (… of sink.samples())` sous `try/catch`, et
`close()` systématique sur chaque `VideoSample`.

### Ce qui est écarté, et pourquoi

- **`mp4-muxer` / `webm-muxer`** — dépréciés **par leur propre auteur** : « *This library is
  deprecated… in favor of Mediabunny, which entirely supersedes it.* » Dernière publication
  2025-07-02.
- `beamcoder` **GPL-3.0**, mort depuis 2022 · `ffmpeg-static` **GPL-3.0-or-later** ·
  `@ffmpeg/core` **GPL-2.0-or-later** · `@ffmpeg-installer/ffmpeg` figé en 2021 · `remotion`
  licence propriétaire non-OSI · `@webav/av-cliper` **aucun champ licence** · `mux.js` publié
  pour la dernière fois en 2023 · `fluent-ffmpeg` MIT mais API callback, contraire à la doctrine
  du dépôt.

## Comparaison d'images : rester en Rust

`nie_formats::imgmetric` fait déjà le travail — ΔE2000, fenêtres chevauchantes, ROI,
`heatmap_rgba`, couverture alpha — et son en-tête rejette explicitement `image-compare` comme une
façade qui cache la mesure. Le dépôt a déjà tranché.

La règle : **dès que le pixel est *jugé* plutôt que simplement *transporté*, ça passe par Rust.**
Transporter des octets vers ffmpeg, TypeScript le fait bien. Mesurer un écart de rendu,
`imgmetric` le fait mieux, et l'exposer en `extern "C"` évite une seconde implémentation qui
dérive. `nie-ffi` expose 48 symboles, **aucun pour `imgmetric`** : c'est l'ajout cadré à faire.

Côté API, noter que `VideoSample.toBuffer()` **n'existe pas** — la méthode est
`copyTo(buf, { format: "RGBA" })`.

## Dérives du catalogue relevées

- **`mp4-muxer` épinglé `^5.2.2` et importé nulle part** (`package.json`, catalogue) — déprécié
  en amont par son propre auteur, entrée morte. **À supprimer** : le retrait a été vérifié
  (`bun install` passe, zéro référence résiduelle dans `package.json` et `bun.lock`) mais n'est
  pas committé ici, `package.json` étant en cours d'édition par un autre chantier au moment de
  la mesure. Le geste est d'une ligne.
- **`sharp` épinglé `^0.34.5`**, alors que la version courante est **0.35.4**. Le caret ne
  franchit pas `0.35` : la mise à jour est donc volontaire et demande un test. Laissée en l'état,
  signalée ici.

## Réserve honnête

`node-av` ne mentionne Bun nulle part (`engines: node >=22.18.0`, zéro occurrence de « bun » dans
son README) et ne le teste pas en CI. Le chargement N-API sous Bun fonctionne — il a été exécuté —
mais il n'est garanti par personne en amont, et la version courante publie ses prebuilds en
`6.2.0-beta.24`.

L'exemple de code Rust produit par la recherche n'a **pas été compilé** : les signatures viennent
du source des crates, mais le `pre-skip` d'`OpusHead` et l'entrelacement des horodatages
audio/vidéo restent à valider sur un vrai fichier.
