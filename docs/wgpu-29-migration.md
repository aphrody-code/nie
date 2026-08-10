# Migration wgpu 22 → 29 + rendu déterministe (host `nie-game`, retarget D3D11, compagnon azalee)

> ✅ **EXÉCUTÉE 2026-06-16 — host `nie-game` migré wgpu 22 → 29.0.3 (+ pollster 0.4).** Les **16 ruptures
> A–P** (§1/§4) appliquées ; les **5 items `[v30]`** (§0) correctement **non** appliqués. Build 0 erreur /
> 0 warning, **clippy clean**, `#![forbid(unsafe_code)]` conservé (toutes les API utilisées sont safe :
> `ExperimentalFeatures::disabled()`, `InstanceDescriptor::new_without_display_handle()`, `create_surface`).
> **Rendu prouvé byte-identique** : SSIM gate inchangée (0.2511 / 0.4059 / 0.4180 / 0.0038), capture PNG
> `main_menu` = 788149 o identique, `title02_render_is_deterministic` vert (capture GPU reproductible),
> 14/14 tests `menu_render_gate`. Une `EtatFenetre.instance: wgpu::Instance` a été ajoutée pour la variante
> `CurrentSurfaceTexture::Lost` (recréation de surface). **RESTE (non fait, hors bump host)** : §3.6 retarget
> D3D11 `nie-engine/render.rs`, §3.7 branche wasm/WebGPU azalee, et les items `[v30]` à l'arrivée de wgpu 30.

> **Cible : `wgpu = "=29.0.3"`** (publiée 2026-05-02, cf. `docs/STACK.md:13`) · `winit = "0.30"` (0.30.13) · `pollster 0.3 → 0.4` · `bytemuck 1` (inchangé).
> **Cap D1/C4** : le host GPU natif `crates/engine/nie-game` est le chemin central vers le jeu jouable ; azalee (wasm/WebGPU) est un compagnon secondaire.
> **Doctrine pixel-perfect** (cf. `docs/STACK.md:13/24-33`) : la RÉFÉRENCE bit-identique est la capture **headless** sur `force_fallback_adapter` (lavapipe/llvmpipe), blit `Rgba8Unorm` / `Nearest` / **sans sRGB**, readback déterministe aligné 256 o. `nie-game` est `#![forbid(unsafe_code)]` (`main.rs:36`) — wgpu est safe, on garde cette garantie.

---

## 0. PIÈGE STRUCTURANT — le checkout `/tmp/wgpu-ref` est EN AVANCE sur 29.0.3

`/tmp/wgpu-ref` est sur **trunk** : son `CHANGELOG.md` plafonne à `## v29.0.1 (2026-03-26)` (l.268) et `## v29.0.0` (l.291), surmontés d'un bloc `## Unreleased` (l.43-267) qui vise **v30**. La source (`wgpu/src`, `wgpu-types/src`) et les `examples/` suivent ce tip. **29.0.3 étant un patch de 29.0.x (semver : pas de breaking change après 29.0.0)**, son API = **v29.0.0**, PAS le tip.

Conséquence : **quatre items que la source/les exemples affichent NE sont PAS dans 29.0.3** (ils sont dans `## Unreleased` → v30). Ne PAS les appliquer maintenant :

| Item « visible » dans le checkout | Réalité 29.0.3 | Preuve (Unreleased) |
|---|---|---|
| `RequestAdapterOptions.apply_limit_buckets` (4e champ) | **Absent** en 29.0.3 — les 3 champs niers compilent | CHANGELOG l.122 (`#9119`) |
| `Buffer::get_mapped_range() -> Result` (`.unwrap()`) | Renvoie **`BufferView` directement** en 29.0.3 (panique au lieu de Result) | CHANGELOG l.181 (`#9281`) |
| `Queue::present(frame)` au lieu de `SurfaceTexture::present()` | **`output.present()`** reste valable en 29.0.3 | CHANGELOG l.176 (`#9361`) |
| `VertexState.buffers: &[Option<VertexBufferLayout>]` | Reste **`&[VertexBufferLayout]`** en 29.0.3 (pas de `Some()`) | CHANGELOG l.47-63 |

Et **deux pièges de sections de recherche corrigés ici** :

- **`Instance::new` prend le descripteur PAR VALEUR en 29** (`wgpu/src/api/instance.rs:63` : `pub fn new(desc: InstanceDescriptor) -> Self`). L'épisode « par référence » (v24/v25, CHANGELOG l.1999) a été **annulé** avant v29. niers passe déjà par valeur (`main.rs:1326/1476/3068`) → **n'inverse rien**, ne corrige que la perte de `Default` (voir A).
- **`ExperimentalFeatures::disabled()` est `pub const fn` SAFE** (`wgpu-types/src/tokens.rs:13`). Seul `enabled()` est `const unsafe fn` (l.37). Sous `#![forbid(unsafe_code)]`, on utilise `disabled()` **sans bloc `unsafe`**.

---

## 1. Résumé exécutif

**16 changements d'API cassants 22→29 touchent `nie-game` pour la cible 29.0.3**, plus **5 changements `[v30]` à anticiper mais NE PAS appliquer**. Tout casse à la compilation (structs non-exhaustives, signatures, enums) — le compilateur les listera ; ce doc fournit le fix avant→après par call-site.

Les 16 (ordre du chantier ci-dessous) : (A) `InstanceDescriptor` perd `Default` ; (B) `request_adapter → Result` ; (C) `request_device` 1-arg ; (D) `DeviceDescriptor.+experimental_features` ; (E) `DeviceDescriptor.+trace` ; (F) `device.poll` `Maintain→PollType`+`Result` (`panic_on_timeout` supprimé) ; (G) `entry_point: Option<&str>` ; (H) `bind_group_layouts: &[Option<&BGL>]` ; (I) `push_constant_ranges → immediate_size` ; (J) `RenderPipelineDescriptor.multiview → multiview_mask` ; (K) `RenderPassDescriptor.+multiview_mask` ; (L) `RenderPassColorAttachment.+depth_slice` ; (M) `mipmap_filter: FilterMode → MipmapFilterMode` ; (N) `ImageDataLayout → TexelCopyBufferLayout` ; (O) `ImageCopyBuffer → TexelCopyBufferInfo` ; (P) `get_current_texture → enum CurrentSurfaceTexture` (`SurfaceError` supprimé).

Les 5 `[v30]` (ne PAS faire) : vertex-buffer `Option` ; `Queue::present` ; `get_mapped_range → Result` ; `apply_limit_buckets` ; I/O entière `@interpolate(flat)`.

**Ordre de chantier recommandé**
1. `Cargo.toml` : `wgpu 22→"=29.0.3"`, `pollster 0.3→0.4`, garder `winit "0.30"` + `bytemuck "1"`.
2. Init/device (A–F) : `Instance::new`, `request_adapter`, `creer_device`.
3. Pipelines (G–J) : `creer_pipeline`, `creer_pipeline_sprite`.
4. Render-pass / textures (K–O) : 3 render-pass, `mipmap_filter`, `Image*→TexelCopy*`.
5. Surface (P) : `EtatFenetre::rendre` (`CurrentSurfaceTexture`).
6. `cargo build -p nie-game` → corriger les résidus signalés par le compilateur.
7. Re-valider le golden : `--capture` (PNG headless `Rgba8Unorm`/`Nearest`, readback aligné 256 o, `force_fallback_adapter`) puis `--window` (Vulkan/WSLg), égalité octet inchangée.
8. Mettre à jour `docs/STACK.md §GPU` (l.26-31, incomplète : voir §3.7).
9. Plus tard : retarget D3D11 (`nie-engine/render.rs`) et branche wasm/WebGPU azalee.

---

## 2. Compatibilité des versions (confirmée)

- `wgpu 29.0.3` MSRV 1.87 — couverte par le pin `nightly-2026-05-17` (rustc 1.97-nightly), cf. `STACK.md:7/39`.
- `winit 0.30` : **inchangé**. Le checkout wgpu épingle lui-même `winit = "0.30.8"` pour ses exemples 29.x (`/tmp/wgpu-ref/Cargo.toml`), niers est sur 0.30.13 → même mineur, API stable (`ApplicationHandler`, `run_app`, `owned_display_handle`). **Le bump n'est PAS un changement winit** : `resumed`/`window_event`/`about_to_wait` de `nie-game` (`main.rs:3299/3329/3367`) restent bons. Toutes les ruptures sont côté wgpu.
- `pollster 0.3 → 0.4` : `block_on` inchangé.
- `bytemuck 1` (+ `derive`) : inchangé.

---

## 3. Migration par dimension

### 3.1 Init / device — host `nie-game` (le cœur)

**A. `InstanceDescriptor` perd `Default`** (v29.0.0, CHANGELOG l.318-340 « InstanceDescriptor initialization APIs and display handle changes », `#8782` ; source `wgpu-types/src/instance.rs:26` = `#[derive(Debug)]` seul ; constructeurs `new_without_display_handle()` l.67, `new_with_display_handle(Box)` l.79, `..._from_env()` l.87/95). `Instance::new` reste **par valeur** (`instance.rs:63`).
```diff
  let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
      backends: wgpu::Backends::all(),          // ou ::VULKAN (fenêtre headless WSLg)
-     ..Default::default()
+     ..wgpu::InstanceDescriptor::new_without_display_handle()
  });
```
Sites : `main.rs:1326-1329` (capture), `1476-1479` (fenêtre, `Backends::VULKAN`, contournement SIGSEGV WSLg Wayland), `3068-3071` (capture menu). niers force Vulkan → **pas besoin de display handle** ; `new_without_display_handle()` suffit. (Option avancée Wayland/EGL `new_with_display_handle_from_env(Box::new(event_loop.owned_display_handle()))` : inutile tant qu'on reste sur le backend Vulkan.)

**B. `request_adapter → Result<Adapter, RequestAdapterError>`** (v25.0.0, CHANGELOG l.1818, `#7330` ; source `wgpu/src/api/instance.rs:167`). Était `Option`. **`RequestAdapterOptions` garde exactement ses 3 champs en 29.0.3** (`power_preference`, `compatible_surface`, `force_fallback_adapter`) — le 4e champ `apply_limit_buckets` est `[v30]` (voir §0), **ne rien ajouter**.
```diff
- if let Some(a) = adapter { return Ok(a); }
+ if let Ok(a) = adapter { return Ok(a); }
  ...
- }))
- .ok_or_else(|| anyhow::anyhow!("aucun adaptateur wgpu (ni GPU ni logiciel)"))
+ }))
+ .context("aucun adaptateur wgpu (ni GPU ni logiciel)")   // RequestAdapterError: std::error::Error
```
Sites : `demander_adaptateur_hors_ecran` `main.rs:1131` (`if let Some(a)` ~l.1135 → `Ok`), `1146` (`.ok_or_else` → `.context`) ; fenêtre `creer_etat` `main.rs:3383` (`.ok_or_else(…)?` `:3388` → `.context("aucun adaptateur wgpu compatible avec la surface")?`).

**C+D+E. `request_device` 1-arg + `DeviceDescriptor` +`experimental_features` +`trace`** (1-arg : v25/v27 ; `experimental_features` : v27.0.0, CHANGELOG l.1171-1185, `#8163` ; `trace` restauré comme champ : v29.0.0, CHANGELOG l.566 ; source `wgpu/src/api/adapter.rs:58` 1-arg, `wgpu-types/src/device.rs:12-35` champs `label, required_features, required_limits, experimental_features, memory_hints, trace`).
```diff
  pollster::block_on(adapter.request_device(
      &wgpu::DeviceDescriptor {
          label: Some("nie-game"),
          required_features: wgpu::Features::empty(),
          required_limits: limits,                          // = adapter.limits(), garder (sprites >4096 px)
+         experimental_features: wgpu::ExperimentalFeatures::disabled(),  // const fn SAFE (tokens.rs:13)
          memory_hints: wgpu::MemoryHints::default(),
+         trace: wgpu::Trace::Off,                           // enum Trace (device.rs:90), défaut
      },
-     None,
  ))
```
Site unique : `creer_device` `main.rs:1155-1164` (utilisé par capture, fenêtre, menu). `Trace::Off` est le défaut ; `ExperimentalFeatures::disabled()` est **safe** (pas de `unsafe` — compatible `forbid(unsafe_code)`).

**F. `device.poll` : `Maintain → PollType` + `Result`, `panic_on_timeout()` supprimé** (v25 `Maintain→PollType` CHANGELOG l.1605-1612 ; v26 retrait `MaintainBase` l.1508 ; v27 `PollType::Wait{submission_index,timeout}` l.1197 ; source `wgpu-types/src/lib.rs` `PollType`, helper `PollType::wait_indefinitely()`). En 29.0.3 `get_mapped_range()` **panique encore** (ne renvoie PAS `Result` : c'est `[v30]`, §0) → **pas de `.unwrap()` dessus**.
```diff
  readback.slice(..).map_async(wgpu::MapMode::Read, |_| {});
- device.poll(wgpu::Maintain::Wait).panic_on_timeout();
+ device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
  ...
- let mapped = readback.slice(..).get_mapped_range();        // INCHANGÉ en 29.0.3
+ let mapped = readback.slice(..).get_mapped_range();        // (le .unwrap() est [v30])
```
Sites : capture `main.rs:1411` (poll) / `1413` (get_mapped_range inchangé) ; capture menu `main.rs:3193` / `3197`. `MapMode::Read` inchangé. Le `PollType::wait_indefinitely()` (timeout `None`) garantit le déterminisme du readback (jamais de `PollError::Timeout` → image partielle).

### 3.2 Pipelines — `creer_pipeline` / `creer_pipeline_sprite`

**G. `entry_point: &str → Option<&str>`** (v23, CHANGELOG l.2340 ; source `render_pipeline.rs:105/137`).
```diff
- entry_point: "vs_main",   →  + entry_point: Some("vs_main"),
- entry_point: "fs_main",   →  + entry_point: Some("fs_main"),
```
Sites : `main.rs:1212` & `1218` (`creer_pipeline`) ; `2862` & `2883` (`creer_pipeline_sprite`).

**H+I. `PipelineLayoutDescriptor` : `bind_group_layouts → &[Option<&BGL>]` + `push_constant_ranges → immediate_size`** (bind_group_layouts optionnels : v29.0.0, CHANGELOG l.342 ; immediates : v28.0.0, CHANGELOG l.884-925 ; source `wgpu/src/api/pipeline_layout.rs:38` `&'a [Option<&'a BindGroupLayout>]`, `:44` `immediate_size: u32`).
```diff
  let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
      label: Some("pipeline_layout"),
-     bind_group_layouts: &[bgl],
-     push_constant_ranges: &[],
+     bind_group_layouts: &[Some(bgl)],
+     immediate_size: 0,
  });
```
Sites : `main.rs:1204-1205` (`creer_pipeline`) ; `2854-2855` (`creer_pipeline_sprite`).

**J. `RenderPipelineDescriptor.multiview → multiview_mask`** (v28.0.0, rework multiview `#8206`, CHANGELOG l.816-846 ; source `render_pipeline.rs` `multiview_mask: Option<NonZeroU32>`). `cache: None` inchangé.
```diff
-     multiview: None,
+     multiview_mask: None,
      cache: None,
```
Sites : `main.rs:1241` ; `2929`.

**Inchangé (ne PAS toucher) :** `buffers: &[]` (`main.rs:1213`) et `buffers: &[wgpu::VertexBufferLayout {…}]` (`main.rs:2863`) — l'enrobage `Some()` est `[v30]` (§0). `ShaderSource::Wgsl(include_str!(…).into())` (`1200/2850`), `PipelineCompilationOptions::default()`, `ColorTargetState`, `BlendState`/`BlendComponent` `One`/`OneMinusSrcAlpha` (`2898-2909`), `VertexFormat::Float32x2`, `PrimitiveState`, `MultisampleState`, `cache: None`.

### 3.3 Render-pass + textures + sampler

**K. `RenderPassDescriptor.+multiview_mask`** (v28.0.0, même rework, CHANGELOG l.830-846 ; source `render_pass.rs:682`).
```diff
      depth_stencil_attachment: None,
      timestamp_writes: None,
      occlusion_query_set: None,
+     multiview_mask: None,
  });
```
Sites (après `occlusion_query_set`) : capture `main.rs:1376`, fenêtre `1563`, capture menu `3157`.

**L. `RenderPassColorAttachment.+depth_slice`** (v23 ; source `render_pass.rs:625` `pub depth_slice: Option<u32>` ; exemple `render_to_texture/mod.rs:88`). **Manqué par les listes API/WGSL des sections** — c'est un vrai cassage 29.0.3.
```diff
  color_attachments: &[Some(wgpu::RenderPassColorAttachment {
      view: …,
+     depth_slice: None,
      resolve_target: None,
      ops: …,
  })],
```
Sites (RenderPassColorAttachment) : `main.rs:1366-1373`, `1553-1560`, `3141-3154`.

**M. `SamplerDescriptor.mipmap_filter : FilterMode → MipmapFilterMode`** (v28.0.0, CHANGELOG l.801-814 ; source `wgpu-types/src/texture.rs`). `mag_filter`/`min_filter` **restent** `FilterMode`.
```diff
      min_filter: wgpu::FilterMode::Nearest,
-     mipmap_filter: wgpu::FilterMode::Nearest,
+     mipmap_filter: wgpu::MipmapFilterMode::Nearest,
```
Sites : `charger_gpu_texture` `main.rs:1290` (Nearest/Nearest/Nearest) ; `creer_sampler_lineaire` `main.rs:2982` (Linear/Linear/**Nearest** → `mipmap_filter: MipmapFilterMode::Nearest`).

**N+O. Renommage `Image* → TexelCopy*`** (v24, `#6504` ; aucun alias conservé — `ImageDataLayout`/`ImageCopyBuffer` n'existent plus ; source `command_encoder.rs:45` `TexelCopyBufferInfo`, `texture.rs:108` `as_image_copy() -> TexelCopyTextureInfo`). `as_image_copy()` **conservé tel quel**.
```diff
- wgpu::ImageDataLayout { offset, bytes_per_row, rows_per_image }
+ wgpu::TexelCopyBufferLayout { offset, bytes_per_row, rows_per_image }
- wgpu::ImageCopyBuffer { buffer, layout }
+ wgpu::TexelCopyBufferInfo { buffer, layout }
```
Sites `ImageDataLayout` : `main.rs:1274` (write_texture), `1399` (copy_texture_to_buffer), `2960` (write_texture menu), `3182` (copy menu). Sites `ImageCopyBuffer` : `main.rs:1397`, `3180`. `as_image_copy()` inchangé : `1272`, `1396`, `2958`, `3179`.

### 3.4 Surface + cycle de vie (`EtatFenetre::rendre`)

**P. `Surface::get_current_texture → enum CurrentSurfaceTexture` ; `SurfaceError` supprimé** (v29.0.0, CHANGELOG l.295-316 « get_current_texture now returns CurrentSurfaceTexture enum », `#9141`/`#9257` ; source `surface.rs:119`, `surface_texture.rs:41`). 7 variantes : `Success(frame)`, `Suboptimal(frame)`, `Timeout`, `Occluded`, `Outdated`, `Lost`, `Validation`. Le `match Ok/Err(SurfaceError::…)` (`main.rs:1531-1537`) ne compile plus (match non-exhaustif).
```diff
- let output = match self.surface.get_current_texture() {
-     Ok(t) => t,
-     Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
-         self.surface.configure(&self.device, &self.config);
-         self.surface.get_current_texture()
-             .context("surface reconfigurée mais get_current_texture échoue")?
-     }
-     Err(e) => return Err(e.into()),
- };
+ use wgpu::CurrentSurfaceTexture as Cst;
+ let output = match self.surface.get_current_texture() {
+     Cst::Success(frame) | Cst::Suboptimal(frame) => frame,
+     Cst::Outdated => {
+         self.surface.configure(&self.device, &self.config);
+         match self.surface.get_current_texture() {
+             Cst::Success(f) | Cst::Suboptimal(f) => f,
+             _ => return Ok(()),                       // sauter la trame
+         }
+     }
+     Cst::Lost => {                                    // recréer la surface, pas juste reconfigure
+         self.surface = self.instance.create_surface(self.fenetre.clone())?;
+         self.surface.configure(&self.device, &self.config);
+         return Ok(());                                // re-tenter au prochain redraw
+     }
+     Cst::Timeout | Cst::Occluded => return Ok(()),    // sauter la trame, request_redraw assuré par about_to_wait
+     Cst::Validation => return Ok(()),                 // pas d'error-scope enregistré
+ };
```
Site : `main.rs:1531-1540`. **`output.present()` (`main.rs:1570`) reste valable en 29.0.3** (`Queue::present` est `[v30]`, §0). Restent valides en 29 : `surface.configure(&device,&config)` (`1526/1534/3413`), `Surface<'static>`, `SurfaceConfiguration` avec `desired_maximum_frame_latency` (`3403-3412`), `surface.get_capabilities` + `find(|f| !f.is_srgb())` (`3394-3400`, choix format **non-sRGB**, à garder). Clamp `width/height ≥ 1` avant `configure` déjà présent (`1523` `>0`, `3406-3407` `.max(1)`) — ne pas régresser. Optionnel (cible Metal) : suivre `WindowEvent::Occluded` pour ne pas rendre quand caché.

### 3.5 Capture déterministe / readback pixel-perfect

Patron canonique 29 à suivre : `/tmp/wgpu-ref/examples/features/src/render_to_texture/mod.rs` — `copy_texture_to_buffer(TexelCopyTextureInfo, TexelCopyBufferInfo{ layout: TexelCopyBufferLayout{ bytes_per_row: Some(mult. de 256), rows_per_image }})` (l.104-126), `submit`, `map_async(MapMode::Read, cb)`, `device.poll(PollType::wait_indefinitely()).unwrap()` (l.136), dé-padding, `unmap`. La règle des 256 = `wgpu::COPY_BYTES_PER_ROW_ALIGNMENT` (toujours exporté, = 256).

**Le `cmd_capture` niers (`main.rs:1323-1440`) et son jumeau menu (`3168-3207`)** ne touchent que les items déjà listés : B (request_adapter), C/D/E (device), F (poll ; **PAS** `.unwrap()` sur get_mapped_range), G (entry_point), J (multiview_mask), K (multiview_mask render-pass), L (depth_slice), N/O (TexelCopy*), A (InstanceDescriptor). **Ne change PAS** : `as_image_copy()`, `COPY_BYTES_PER_ROW_ALIGNMENT`, `div_ceil(256)*256` (`1385/3169`), dé-padding ligne par ligne (`1418-1421/3200-3203`), format `Rgba8Unorm` non-sRGB (`1266/1353`), sampler `Nearest`.

**`force_fallback_adapter` reste le levier de RÉFÉRENCE** (`force_fallback_adapter: bool` intact, `wgpu-types/src/adapter.rs:42`). Recommandations déterminisme :
- **Mode RÉFÉRENCE** : forcer directement `force_fallback_adapter: true` (lavapipe), **sans tenter le matériel** d'abord — sinon le hash dépend du GPU de la machine. Scinder en `adaptateur_reference()` (toujours fallback) vs `adaptateur_perf()` (matériel). niers tente actuellement matériel puis fallback (`1131-1146`).
- **Asserter** après obtention : `adapter.get_info().device_type == DeviceType::Cpu` et `name` contient `llvmpipe`/`lavapipe`, sinon refuser la capture (reproductibilité).
- **Env** : installer `mesa-vulkan-drivers` (lavapipe) ; épingler `VK_ICD_FILENAMES`/`VK_DRIVER_FILES` + `WGPU_ADAPTER_NAME=llvmpipe`. `force_fallback_adapter` peut renvoyer **`Err`** si aucun ICD logiciel — gérer ce `Result` (cf. B).
- **Octets** : `Rgba8Unorm` ⇒ ordre mémoire R,G,B,A = PNG RGBA (pas de swizzle B↔R) ; ne **jamais** prendre le format préféré de la surface (souvent `Bgra8Unorm`) pour la cible offscreen ; garder non-sRGB ; fixer une convention **alpha** unique (pré-multiplié vs straight — `main.rs:3195` lit « encore pré-multipliées ») identique référence vs comparé ; ne jamais hasher `mapped[..]` paddé.

### 3.6 Retarget du D3D11 décompilé (`nie-engine/src/render.rs`) — chantier ultérieur

> Port byte-exact des `FUN_…` D3D11/DXGI de `nie.exe`. Le retarget ne sert qu'à **reproduire la même image** que le D3D11 original, pas à imiter son API. Chemin de référence = **SDR** + `force_fallback_adapter` (lavapipe).

- **`DxgiFormat → wgpu::TextureFormat`** : encapsuler `impl DxgiFormat { fn to_wgpu(self) -> Option<wgpu::TextureFormat> }` **à côté** de l'enum, **sans** toucher `from_u32`/`as_u32` (chemin DDS byte-exact). Correspondances 1:1 principales : `R8G8B8A8_Unorm(28)/_Srgb(29)→Rgba8Unorm/Srgb` (**pivot** du blit), `B8G8R8A8(87/91)→Bgra8Unorm(Srgb)` (swapchain Windows), `R16G16B16A16_Float(10)→Rgba16Float`, `BC1..BC7(71-99)→Bc1..Bc7` (g4tx), `R11G11B10_Float(26)→Rg11b10Ufloat`, `R9G9B9E5(67)→Rgb9e5Ufloat`, depth `D32(40)→Depth32Float`, `D16(55)→Depth16Unorm`, `D24S8(45)→Depth24PlusStencil8` (⚠ « Plus » = ≥24 bits, layout non garanti — ne pas readback le depth byte-exact), `D32S8(20)→Depth32FloatStencil8` (feature `DEPTH32FLOAT_STENCIL8`). Gater : `Rgba16Unorm/Snorm`, `Rg16`/`R16` norm → `TEXTURE_FORMAT_16BIT_NORM` ; `NV12(103)`/`P010(104)` → `TEXTURE_FORMAT_NV12` (DX12/Vulkan).
- **Formats SANS équivalent wgpu** (vérifié `wgpu-types/src/texture/format.rs`) → renvoyer `None` et résoudre/upscaler au chargement : **TYPELESS** (1,5,9,15,19,…) → format concret + srgb-ness via `view_formats` (seul reinterpret autorisé) ; `R32G32B32(5-8)` (96 bits 3 canaux) → padder `Rgba32*` ; `A8_Unorm(65)` → `R8Unorm` + swizzle `.rrrr`/`.000r` dans le shader (sprites alpha-only g4tx) ; `B5G6R5(85)/B5G5R5A1(86)/B4G4R4A4(115)` → décoder en `Rgba8Unorm` ; `B8G8R8X8(88/92/93)` → `Bgra8Unorm`, X=1.0 ; `R10G10B10_XR(89)`, `R1(66)`, YUV (100-114 hors NV12/P010) → hors chemin (vidéo libvpx→YUV→RGBA en shader).
- **BindFlags D3D11 → Usages** : `SHADER_RESOURCE→TEXTURE_BINDING` ; `RENDER_TARGET`/`DEPTH_STENCIL→RENDER_ATTACHMENT` ; UAV tilelight (`render.rs:1471` `0x10000`)→`STORAGE_BINDING`(+compute) ; staging readback→`COPY_SRC`+buffer `MAP_READ` (déjà fait, align 256) ; `USAGE_DYNAMIC→Queue::write_texture/write_buffer`. Buffers `VERTEX/INDEX/CONSTANT→VERTEX/INDEX/UNIFORM`.
- **Swapchain `FUN_14045c780` → `SurfaceConfiguration`** : `usage=RENDER_ATTACHMENT`(+`COPY_SRC` si capture) ; `format` **non-sRGB** via table ; `SyncInterval` 0→`Immediate`/`AutoNoVsync`, 1→`Fifo`/`AutoVsync`, `FLIP_DISCARD`≈`Mailbox` ; `AlphaMode` `IGNORE→Opaque`, `PREMULTIPLIED→PreMultiplied`, `STRAIGHT→PostMultiplied` ; `desired_maximum_frame_latency` défaut 2 ; `view_formats: vec![]`. **⚠ HDR sans équivalent portable** : le bloc HDR10 de `FUN_14045c780` (`render.rs:1054-1192` : luminance, primaires Rec.2020, flag `0xde`, ST2084/scRGB `SetColorSpace1`) **n'a aucune API wgpu 29** — garder en données mortes documentées, **forcer SDR** (rouvrir seulement si un golden HDR du vrai jeu apparaît).
- **Backends/Instance** : natif `Backends::VULKAN|DX12|METAL|GL` ; garder `Backends::VULKAN` en headless WSLg (`main.rs:1477`). VRAM max → `PowerPreference::HighPerformance` ; **WARP (`want_warp` `render.rs:735`) → `force_fallback_adapter:true`** (= le pin de référence lavapipe, mêmes flags des deux côtés) ; debug layer → `InstanceFlags::VALIDATION`. MSAA : sonde x1→x8 (`render.rs:762`) mais **golden = 1 sample**.

### 3.7 Cible wasm / WebGPU (compagnon azalee) — chantier d'AJOUT

> **État réel** : `crates/engine/nie-wasm` ne dépend **ni de `wgpu`, ni de `winit`, ni de `web-sys`** — c'est un banc de décodeurs CPU (`image_dds` G4TX→RGBA8 `lib.rs:785-846`, GLB `906-932`) exposé via `wasm-bindgen`. Brancher `wgpu` côté wasm est un **ajout**, pas un retarget.

- Mêmes ruptures qu'au host (A, P, B, H, M…) **plus** : `request_adapter().await` / `request_device().await` (sur wasm, **jamais `pollster::block_on`** — `wasm-bindgen-futures` déjà présent `nie-wasm/Cargo.toml:36`). `request_adapter` reste `Result`.
- **Surface canvas SAFE** : `instance.create_surface(SurfaceTarget::Canvas(html_canvas))` / `OffscreenCanvas(...)` est **sûr** (seul `create_surface_unsafe`/`SurfaceTargetUnsafe` est `unsafe`) → `#![forbid(unsafe_code)]` de `nie-wasm` (`lib.rs:80`) **tient**. Ajouter `web-sys` (absent du workspace) pour `HtmlCanvasElement`/`OffscreenCanvas`.
- **Détection backend** : `wgpu::util::new_instance_with_webgpu_detection` + `is_browser_webgpu_supported` (v23, CHANGELOG l.2410) → `BROWSER_WEBGPU` sinon `GL`/WebGL2. **WebGL2 impose** : créer la surface **AVANT** `request_adapter` + passer `compatible_surface` (v23, l.2652). `InstanceDescriptor::new_without_display_handle()` (pas de display handle sur wasm).
- **Réconcilier `wasm-bindgen`** : workspace `=0.2.125` (`Cargo.toml:23`) vs doc `nie-wasm/src/lib.rs:13-14` qui dit CLI `0.2.121` → **aligner CLI = crate exactement** (plancher wgpu 29 = 0.2.115). À vérifier dans `Cargo.lock` après ajout de wgpu.
- **DÉTERMINISME — le navigateur ne peut PAS être la référence.** Rasterizer/échantillonneur = Dawn/WebKit/Gecko ≠ llvmpipe ; latitude spec sur interpolation/filtrage/arrondis ⇒ **égalité octet impossible** dès qu'on laisse le GPU échantillonner/blender ; color-management OS du canvas. **Mitigation** (transposition exacte du blit natif) : **composer en CPU pur Rust** (déjà fait : `image_dds` decode + `blit_over`, `lib.rs:842-873`), uploader **une** texture `Rgba8Unorm` pré-composée, blit **1:1** quad plein écran, sampler `Nearest`, **non-sRGB**, **sans mipmaps**. Vérifier par `copy_texture_to_buffer` (align 256) sur le **framebuffer en readback**, jamais le canvas affiché. **Le gate golden (égalité octet) reste exclusivement natif lavapipe** ; azalee = viewer (tolérance SSIM≥0,99 au mieux).
- Aligner les deux mondes : activer `InstanceFlags::STRICT_WEBGPU_COMPLIANCE` **côté natif** (`[v30]` — anticiper) pour emprunter les limites WebGPU ; fallback WebGL2 → `Limits::downlevel_webgl2_defaults()`. **Réutiliser** le pipeline blit de `nie-game` (`creer_pipeline_sprite`, `Rgba8Unorm`/`Nearest`/sans sRGB) en l'extrayant dans une crate partagée plutôt que dupliquer.

### 3.8 WGSL / pipeline / bytemuck — ce qui NE change PAS

- **WGSL** (`fullscreen.wgsl`, `menu_sprite.wgsl`) : **aucune modif**. I/O 100 % `f32` (`vec2/vec4<f32>`) → le durcissement naga « integer I/O no longer defaults to `@interpolate(flat)` » (CHANGELOG `## Unreleased` l.65/67) ne s'applique pas (et est `[v30]`).
- **bytemuck** : `#[repr(C)] + Pod + Zeroable` sur `SpriteVertex` (`main.rs:2763`) et `cast_slice` (`3123`) identiques (motif `examples/cube` v29). Garder `bytemuck = { version = "1", features = ["derive"] }`.
- **Réglages bit-exacts** : `Rgba8Unorm` (PAS sRGB), `FilterMode::Nearest` mag/min (`1288-1289`), `blend: None`/tone-map absent → sémantique inchangée en 29.

### 3.9 `docs/STACK.md §GPU` (l.26-31) — à compléter

La liste actuelle voit B (request_adapter→Result), C (request_device 1-arg), F (poll→PollType), G (entry_point), A (Instance/InstanceDescriptor). Elle **manque** : A (perte de `Default`), D/E (`trace`/`experimental_features`), H (bind_group_layouts Option), I (immediate_size), J (multiview_mask pipeline), K (multiview_mask render-pass), L (depth_slice), M (MipmapFilterMode), N/O (TexelCopy*), P (CurrentSurfaceTexture). Ajouter ces items + la note `[v30]`.

---

## 4. Checklist globale ordonnée

**Étape 0 — Cargo**
1. `crates/engine/nie-game/Cargo.toml:29-31` : `wgpu = "22"` → `"=29.0.3"` ; `pollster = "0.3"` → `"0.4"` ; garder `winit = "0.30"`, `bytemuck = { version = "1", features = ["derive"] }`.

**Étape 1 — Init / device**
2. (A) `main.rs:1328, 1478, 3070` : `..Default::default()` → `..wgpu::InstanceDescriptor::new_without_display_handle()` (les 3 `Instance::new`, qui restent **par valeur**).
3. (B) `main.rs:1131` : `if let Some(a) = adapter` → `if let Ok(a) = adapter`. **Ne PAS ajouter `apply_limit_buckets`** (les 3 champs de `RequestAdapterOptions` suffisent en 29.0.3).
4. (B) `main.rs:1146` : `.ok_or_else(|| anyhow!("aucun adaptateur wgpu (ni GPU ni logiciel)"))` → `.context("aucun adaptateur wgpu (ni GPU ni logiciel)")`.
5. (B) `main.rs:3388` : `.ok_or_else(|| anyhow!(…))?` → `.context("aucun adaptateur wgpu compatible avec la surface")?`.
6. (C) `main.rs:1163` : supprimer le 2e argument `None` de `adapter.request_device(...)`.
7. (D/E) `main.rs:1156-1161` : ajouter `experimental_features: wgpu::ExperimentalFeatures::disabled(),` (const fn safe) **et** `trace: wgpu::Trace::Off,` au `DeviceDescriptor`.
8. (F) `main.rs:1411, 3193` : `device.poll(wgpu::Maintain::Wait).panic_on_timeout();` → `device.poll(wgpu::PollType::wait_indefinitely()).unwrap();`. **Laisser `get_mapped_range()` (`1413, 3197`) tel quel** (le `.unwrap()` est `[v30]`).

**Étape 2 — Pipelines**
9. (G) `main.rs:1212, 1218, 2862, 2883` : `entry_point: "vs_main"/"fs_main"` → `Some("vs_main")/Some("fs_main")`.
10. (H) `main.rs:1204, 2854` : `bind_group_layouts: &[bgl]` → `&[Some(bgl)]`.
11. (I) `main.rs:1205, 2855` : `push_constant_ranges: &[]` → `immediate_size: 0`.
12. (J) `main.rs:1241, 2929` : `multiview: None,` → `multiview_mask: None,` (RenderPipelineDescriptor).
13. (inchangé) `main.rs:1213` (`buffers: &[]`) et `2863` (`buffers: &[VertexBufferLayout {…}]`) : **NE PAS** enrober dans `Some()` (`[v30]`).

**Étape 3 — Render-pass / textures / sampler**
14. (K) `main.rs:1376, 1563, 3157` : ajouter `multiview_mask: None,` à la fin des 3 `RenderPassDescriptor` (après `occlusion_query_set`).
15. (L) `main.rs:1366-1373, 1553-1560, 3141-3154` : ajouter `depth_slice: None,` dans les 3 `RenderPassColorAttachment`.
16. (M) `main.rs:1290, 2982` : `mipmap_filter: wgpu::FilterMode::Nearest` → `wgpu::MipmapFilterMode::Nearest` (mag/min inchangés).
17. (N) `main.rs:1274, 1399, 2960, 3182` : `wgpu::ImageDataLayout` → `wgpu::TexelCopyBufferLayout`.
18. (O) `main.rs:1397, 3180` : `wgpu::ImageCopyBuffer` → `wgpu::TexelCopyBufferInfo`. `as_image_copy()` (`1272/1396/2958/3179`) conservé.

**Étape 4 — Surface**
19. (P) `main.rs:1531-1540` : réécrire `EtatFenetre::rendre` sur l'enum `wgpu::CurrentSurfaceTexture` (`Success`/`Suboptimal`→frame ; `Outdated`→reconfigure+retry ; `Lost`→`create_surface(fenetre.clone())`+reconfigure ; `Timeout`/`Occluded`/`Validation`→`return Ok(())`) ; supprimer toute réf. à `wgpu::SurfaceError`. Garder `output.present()` (`1570`) — `Queue::present` est `[v30]`.

**Étape 5 — Build & validation**
20. `cargo build -p nie-game` ; lever les résidus signalés par le compilateur (champs/typage).
21. Vérifier que `#![forbid(unsafe_code)]` (`main.rs:36`) tient (tout est safe : `disabled()`, `new_without_display_handle()`, `create_surface`).
22. Valider `--capture` (PNG headless `Rgba8Unorm`/`Nearest`, readback aligné 256) avec `force_fallback_adapter` ; asserter `device_type == Cpu` + name `llvmpipe`/`lavapipe` ; comparer le golden **octet-à-octet** (inchangé).
23. Valider `--window` (Vulkan/WSLg) : resize, present, pas de panique.
24. Mettre à jour `docs/STACK.md §GPU` (l.26-31) : ajouter A(Default)/D/E/H/I/J/K/L/M/N/O/P + note `[v30]`.

**Étape 6 — `[v30]` à anticiper (NE PAS appliquer pour 29.0.3)**
25. Vertex-buffer `Option` : `main.rs:2863` enrober `VertexBufferLayout` dans `Some(…)`.
26. `Queue::present` : `main.rs:1570` `output.present()` → `self.queue.present(output)`.
27. `get_mapped_range → Result` : `main.rs:1413, 3197` ajouter `.unwrap()`.
28. `apply_limit_buckets` : ajouter le champ aux `RequestAdapterOptions` (`1131/1141/3383`).
29. WGSL `@interpolate(flat)` sur I/O entière : N/A tant que `fullscreen.wgsl`/`menu_sprite.wgsl` restent en `f32`.
30. `InstanceFlags::STRICT_WEBGPU_COMPLIANCE` côté natif (alignement wasm).

**Chantiers ultérieurs (hors bump host)**
31. Retarget D3D11 `nie-engine/src/render.rs` : `to_wgpu()`, BindFlags→Usages, swapchain→`SurfaceConfiguration` (SDR, pas d'HDR10), WARP→`force_fallback_adapter`.
32. Branche wasm/WebGPU `nie-wasm` : ajouter `wgpu`+`web-sys`, async adapter/device, `create_surface(SurfaceTarget::Canvas)` safe, compositing CPU + blit 1:1, gate octet réservé au natif lavapipe.

---

## 5. Risques, inconnues et pièges pixel-perfect

**Pièges « checkout en avance » (déjà neutralisés ci-dessus)**
- Source/exemples montrent `apply_limit_buckets`, `get_mapped_range().unwrap()`, `Queue::present`, `buffers: &[Option<…>]` — **tous `[v30]`** (CHANGELOG `## Unreleased` l.43-267). Pour 29.0.3, **ne pas les appliquer**. Stratégie robuste : compiler tôt contre `=29.0.3` et **laisser le compilateur lister** les structs non-exhaustives plutôt que se fier au tip.
- `Instance::new` est **par valeur** en 29 (pas par référence) ; `ExperimentalFeatures::disabled()` est **safe** (pas de `unsafe`).

**Risques de fidélité (pixel-perfect)**
- **Référence vendor-indépendante** : forcer directement `force_fallback_adapter: true` pour le golden (pas de tentative matériel) ; sans lavapipe/llvmpipe le hash dépend du GPU. Installer `mesa-vulkan-drivers` ; gérer le `Err` de `request_adapter` si aucun ICD logiciel.
- **Pas de swizzle / sRGB** : cible offscreen `Rgba8Unorm` non-sRGB (jamais le `Bgra8Unorm` préféré de la surface) ; le `find(|f| !f.is_srgb())` (`main.rs:3399`) doit rester ; conserver `FilterMode::Nearest`, MSAA 1 sample, alpha de convention unique (pré-multiplié, `main.rs:3195`).
- **Surface = confort, pas preuve** : le format de la fenêtre dépend du compositeur ; l'identité octet/pixel sort **uniquement** du chemin headless `Rgba8Unorm`/`Nearest`/sans-sRGB. Le viewer fenêtré n'est jamais la référence.

**Inconnues à clore au build**
- Confirmer empiriquement que lavapipe respecte `COPY_BYTES_PER_ROW_ALIGNMENT=256` à l'identique sur toutes les cibles (Vulkan/D3D12/Metal/GL) — test de hash croisé.
- **HDR10** : confirmer qu'IEVR tourne en SDR sur le chemin de référence avant d'écarter le retarget HDR (`render.rs:1054-1192`, aucune API portable wgpu 29).
- **wasm** : Chrome/Dawn applique-t-il un color-management au canvas même en non-sRGB ? Mesurer par `copy_texture_to_buffer` vs golden lavapipe sur un patch BCn connu (départage écart compositeur vs framebuffer). Divergence Firefox(Gecko) vs Chrome(Dawn) à quantifier. `Cargo.lock` : vérifier que `=29.0.3` n'épingle pas un `wasm-bindgen` incompatible avec le `=0.2.125` du workspace.
- **Patch 29.0.2/29.0.3** absents du CHANGELOG du checkout (plafonne à 29.0.1) : aucune surprise breaking attendue (semver patch), mais re-vérifier au build la signature exacte de `present`/`get_mapped_range`/`ExperimentalFeatures` si le compilateur diverge.
- `RenderPipelineDescriptor.multiview → multiview_mask` : version exacte d'introduction (v28 vs v29) non isolée, sans impact (le compilateur force `multiview_mask` en 29.x).
