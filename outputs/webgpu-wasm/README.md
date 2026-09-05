# Pont NIE WebGPU — lot isolé de validation

Ce répertoire est indépendant du WASM public de base d’Azalée. Il contient les bindings
`--target web` de `nie-wasm`, compilé avec la feature facultative `webgpu`.

## Utilisation

Servir les fichiers en HTTP sur localhost ou en HTTPS (ESM et MIME `application/wasm`).
Ne pas ouvrir par `file://`. Fournir un canvas neuf, sans contexte 2D/WebGL préexistant.

```js
import init, { WebGpuViewer } from './nie_wasm.js';

await init();
canvas.width = 1280;
canvas.height = 720;
const viewer = await WebGpuViewer.create(canvas);
console.log(JSON.parse(viewer.backend_info()));
viewer.load_glb(new Uint8Array(await file.arrayBuffer()));
viewer.orbit(0.6, 0.2, 3.1);
viewer.render();
// L'hôte pilote requestAnimationFrame, les événements et le calcul du DPR.
// Lors du démontage : arrêter les appels/RAF, puis viewer.free().
```

- `create(canvas)` : Promise, WebGPU exclusivement, device dédié.
- `load_glb(bytes)` : remplacement du modèle après parsing/validation, maximum 64 Mio.
- `orbit(yaw, pitch, distance)` : caméra absolue, radians et distance en rayons du modèle.
  Valeurs non finies et distance non positive refusées ; tangage/distance bornés comme en natif.
- `resize(width, height)` : dimensions physiques entières positives, bornées par les limites
  du device. Ne modifie pas le CSS. Ne pas appeler avec 0×0 lorsque le canvas est caché.
- `render()` : `true` = frame présentée ; `false` = frame sautée, à retenter au prochain RAF.
  Perte de surface/device ou erreur de validation : exception, recréer le viewer.
- `backend_info()` : chaîne JSON contenant backend réellement obtenu, nom/type/vendor/device,
  format de surface et `readback: false`. Les informations matérielles peuvent être anonymisées.
- `free()` : méthode générée par wasm-bindgen ; libère le renderer et son device.

Le rendu réutilise `GpuRenderer::from_device` et `render_to_texture`, puis un quad GPU
présente la texture sur le canvas. Aucun readback, canvas 2D, RAF interne ni fallback WebGL/CPU.
Le fond de présentation est opaque noir. Ce pont ne modifie pas la politique des hôtes natifs.

## Limites d’import

Le parseur GLB NIE existant n’est pas universel : positions déjà en espace monde,
géométrie triangulaire et textures PNG embarquées attendues. Transforms de nœuds, skins,
animations, matériaux glTF complets et codecs compressés ne sont pas interprétés par ce pont.
Normaliser les fichiers en amont. La limite d’entrée de 64 Mio n’est pas une protection
universelle contre tous les fichiers malformés ou les bombes de décompression d’images.

## Reproduction (PowerShell, racine du dépôt)

```powershell
cargo build -p nie-wasm --lib --release --target wasm32-unknown-unknown --features webgpu --offline
& ./outputs/webgpu-wasm-tools/wasm-bindgen-0.2.125-x86_64-pc-windows-msvc/wasm-bindgen.exe `
  ./target/wasm32-unknown-unknown/release/nie_wasm.wasm --target web --out-dir ./outputs/webgpu-wasm
```

CLI officiel 0.2.125, identique au pin du workspace. Archive Windows contrôlée contre le
SHA256 GitHub : `ddf9edc68a1ad546932f8bb65e4346caeb916a4822477e2c5b3c25941cc38a76`.
Pas d’installation globale et pas de mise à jour de dépendances.

## Vérifications

- Tests `web::tests` : caméra finie/bornée, dimensions strictes et validation Naga du quad.
- Clippy natif et WASM avec `-D warnings` ; check WASM avec et sans feature.
- Vérification navigateur volontairement laissée à l’hôte intégrateur.
