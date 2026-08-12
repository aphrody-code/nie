# Azalée — le wiki IEVR de Rose Griffon, et son rapport à niers

Azalée désigne trois choses distinctes, qu'il faut séparer avant toute décision :

| | Quoi | Où |
|---|---|---|
| **le paquet** | `@rosegriffon/azalee` — bibliothèque TS de présentation | npm public, source `rose-griffon/rg` → `packages/azalee` |
| **le monorepo** | `rose-griffon/rg` — azalée + site + bot Discord (Bun, Next 16, React 19, Supabase, Turborepo) | GitHub, **privé** |
| **le site** | `azalee.rosegriffon.fr` — le wiki public, assets servis par `cdn.rosegriffon.fr` | en ligne |

## Le fait structurant : niers est l'amont, azalée est l'aval

Rien dans azalée ne décode un format binaire du jeu. Pas un parseur `cfg.bin`, pas un décodeur G4TX,
pas un lecteur CPK natif. Les données qu'il publie **sortent de ce dépôt**, et les fichiers le
déclarent eux-mêmes :

```
data/formations-full.json   meta.source = "nie-data/formation.rs via export_formations bin"
data/passives-full.json     meta.source = "nie-data/passives.rs via export_passives bin"
data/skills-cutin.json      meta.source = "nie-data/skill.rs (cutin_assets) via export_skills bin"
```

Ces binaires sont ici : `crates/engine/nie-data/src/bin/export_{formations,passives,skills}.rs`.

Le pipeline complet :

```
nie.exe → niers (Rust, nie-data) ─┬→ export_* ──→ @rosegriffon/azalee ──→ wiki web
                                  └→ inagle (TS, parseurs) → Supabase → mirror.sqlite ┘
```

**Conséquence de conception : ne jamais consommer les données d'azalée depuis niers.** Ce serait
reboucler sur notre propre sortie, avec une latence de publication npm en plus et le risque de lire
une version périmée de nos propres extractions.

Le couplage existe déjà, et dans le bon sens : `apps/azalee/lib/cpk-wasm.ts` est un pont navigateur
vers **`nie-wasm`**, compilé `--target web` et vendoré dans `lib/nie-wasm-web/`. Le wiki appelle
`cfgbin_typed_json`, `g4tx_to_png`, `model_to_glb`, `g4pk_parse_json`, `audio_to_wav`.

## Le paquet `@rosegriffon/azalee`

- Publié **en TypeScript source** (`exports` pointe vers `./src/*.ts`) et en compilé (`dist/`).
  Aucun build nécessaire côté consommateur : Bun résout le TS nativement.
- 1,5 Mo compressé, 16 Mo installé, 108 fichiers `.ts` (~19 400 lignes) + 23 JSON (~6,9 Mo).
- **Attention au scope** : le monorepo nomme le paquet `@rose-griffon/*` (avec tiret, publié sur
  GitHub Packages, versions en retard) ; npm public porte `@rosegriffon/*` (sans tiret, à jour).
  **C'est le second qu'il faut consommer.**
- Dépendances runtime : `@rosegriffon/db`, `@rosegriffon/inagle`, `@supabase/supabase-js`,
  `commander`, `drizzle-orm`, `wanakana`.

### Modules

| Module | Rôle | Utilisable sans Supabase ? |
|---|---|---|
| `game/` | règles pures : formations, synergies, interpolation de stats, code d'équipe | **oui** |
| `text/` | glossaire FR, formatage des tags du jeu, romaji, gaiji | **oui** |
| `search/` | Levenshtein, fuzzy, recherche multilingue | **oui** |
| `images/` | résolution d'URLs CDN, mappings code → fichier | **oui** |
| `remote/` | client HTTP typé des 41 routes (12,2 Ko en bundle navigateur) | **oui** |
| `cpk/`, `game-text/`, `cross/` | index NDJSON → SQLite | partie `*-shared` seulement |
| `wiki/` | lecture des entités (SQL sur le miroir) — `service.ts` fait 94,7 Ko | non |
| `db/`, `server/`, `rag.ts`, `cli/` | miroir, API, embeddings, orchestration | non |

Convention respectée dans tout le paquet : tout fichier qui touche `bun:sqlite` ou `node:fs` a un
jumeau pur `<x>-shared.ts`. C'est ce qui rend la racine importable dans un navigateur.

**Supabase n'est jamais importé à l'exécution** : `createClient()` renvoie par défaut le client
SQLite miroir, l'injection Supabase est facultative (`setDatabaseProvider`). Les données JSON
s'importent directement — `import passives from "@rosegriffon/azalee/data/passives-full.json"` — sans
aucune dépendance.

### Données embarquées (6,9 Mo)

| Fichier | Taille | Contenu | Origine |
|---|---|---|---|
| `passives-full.json` | 2,2 Mo | 1 716 passifs + 653 lots + 21 équipe | **export niers** |
| `skills-cutin.json` | 1,9 Mo | 1 001 techniques, dont 992 avec cut-in | **export niers** |
| `formations-full.json` | 535 Ko | 91 formations, coords byte-exactes | **export niers** |
| `menu-gallery-manifest.json` | 484 Ko | 2 370 assets de menu | scan de `dx11/menu` |
| `item-enrichment.json` | 120 Ko | descriptions fr/en/ja, `maxStack` | export |
| `emblem-crc-map.json` | 7,3 Ko | CRC32 → `emNNNNNN` | export |
| `data/cross/*` | 1,6 Mo | **Inazuma Eleven Cross** (autre jeu, Unity/IL2CPP) | dump UnityPy |

La valeur ajoutée nette d'azalée, une fois retirés les ré-exports : **la couche de traduction
FR/EN/JA**, les **mappings code interne → nom de fichier** (avec leurs trous documentés), et le
corpus Cross.

`skills-cutin.json` mérite une mention à part : c'est une table `skill_id` → chemins VFS des assets
de cut-in (g4md, g4mg, g4tx, son, effets, telop en 8 langues). Produite depuis niers, mais
consolidée et prête à charger.

## Spritesheets — état comparé

Azalée gère quatre systèmes de sprites, **tous à coordonnées figées à la main** :

| Système | Config | Composant | Atlas |
|---|---|---|---|
| rôles/postes | `apps/azalee/config/sprites.ts` | `SpriteIcon.tsx` | `icon_common2.webp` 516×568 |
| icônes communes | `config/sprites-common.ts` (205 régions) | `CommonSpriteIcon.tsx` | `icon_common.webp` 1140×1152 |
| icônes menu teintées | `config/game-icons.ts` | `GameSpriteIcon.tsx` | `icon_category*.webp` |
| gaiji | `packages/azalee/src/text/gaiji.ts` (21 glyphes) | `GaijiGlyph.tsx` | `gaiji_game2.g4tx` 416×436 |

Les coordonnées viennent bien des `G4txSubTexture`, **via `nie_wasm::g4tx_info_json`** — puis ont
été **recopiées à la main** dans du TS figé. La duplication est triple : `sprites.ts`,
`sprite-roles.config.ts` et `apps/azalee/app/sprites.css` régénèrent les mêmes 22 règles, la
troisième étant du code mort annoté « Example CSS implementation ». Aucun générateur n'existe.

### Ce que `nie_formats::sprite_sheet` fait mieux

| Capacité | niers | azalée |
|---|---|---|
| régions lues du `.g4tx` | ✅ `depuis_g4tx` | ❌ copie manuelle |
| identifiants CSS assainis | ✅ `assainir_nom` | ❌ |
| CSS généré | ✅ `vers_css` | ❌ écrit à la main |
| SVG `<symbol>` autonome | ✅ `vers_svg` | ❌ |
| manifeste JSON | ✅ `vers_json` | ❌ |
| CLI | ✅ `niers convert --to css\|svg\|json` | ❌ |
| composant de rendu | ❌ | ✅ ×4 |
| **masque teinté `currentColor`** | ❌ | ✅ |
| mise à l'échelle runtime | ❌ | ✅ |

### Les trois idées à reprendre

1. **Le masque CSS teinté** (`GameSpriteIcon.tsx`) — utiliser l'atlas en `mask-image` avec
   `background-color: currentColor` au lieu de `background-image`. Les icônes du jeu se comportent
   alors comme des icônes vectorielles : elles prennent la couleur du thème, en clair comme en
   sombre. L'atlas est prétraité en masque par ImageMagick.
2. **La taille cible plutôt que l'échelle** — `size / icon.h` normalise des cellules hétérogènes
   (256×200 vs 192×120) à la même hauteur visuelle. Un CSS statique en pixels ne sait pas faire ça :
   **le manifeste JSON est donc le livrable le plus utile des trois**, un composant React le
   consommant couvre CSS, échelle et teinture d'un coup.
3. **Le repli** (`Icon.tsx`) — table nom sémantique → clé de sprite, essai sprite puis repli sur
   lucide, et en développement un glyphe visible + `console.warn` pour les noms inconnus. Sans ça,
   une icône manquante laisse un carré vide invisible.

## L'explorateur CPK web

`apps/azalee/app/cpk/` (15 composants, ~2 500 lignes) est un `nie-explorer` en React, bâti sur
`nie-wasm`. Son routeur d'aperçu (`CpkFilePreview.tsx`) est directement transposable au `DetailPane`
de notre explorateur :

```
image   → CpkImageViewer    g4tx→PNG, damier alpha, `pixelated` si ≤256 px, export
model   → CpkModelViewer    g4md+g4mg → GLB
sound   → CpkAudioViewer    HCA/ADX/ACB/AWB → WAV, repli .acb → .awb voisin
movie   → <video>           USM → MP4 H.264 remuxé
config  → CpkConfigViewer   cfg.bin typé
package → CpkPackageViewer  listing g4pk
raw     → CpkHexViewer      offset | hex | ASCII
```

Détails de qualité à emprunter : le damier de transparence en une ligne
(`repeating-conic-gradient`), le `imageRendering: pixelated` conditionnel, le repli `.acb` → `.awb`,
et l'annulation systématique (`cancelled` + `URL.revokeObjectURL`) dans chaque nettoyage d'effet.

## Design system

`packages/ui` (`@rosegriffon/ui`) : 82 composants shadcn sur Radix + Tailwind v4, avec 35 tokens
`--md-sys-color-*` Material 3, échelle de formes, 6 easings, 16 durées, 6 élévations, 15 rôles
typographiques, 4 thèmes.

**`nie-explorer` est déjà compatible** : il utilise Tailwind v4, shadcn (`components.json`, style
`base-nova`), `lucide`, `next-themes`, et `src/styles.css` définit **déjà un pont MD3 complet**
(`--color-surface`, `--color-on-surface-variant`, `--color-outline-variant`…) redirigé vers les
tokens spacedrive. Les classes d'azalée (`bg-surface`, `text-on-surface-variant`,
`border-outline-variant`) y rendent donc correctement, **aux couleurs de l'explorateur**.

Ne **pas** importer `@rosegriffon/ui/styles.css` : il imposerait la palette MD3 d'azalée à la place
de la palette spacedrive, choisie délibérément.

## Composants réutilisables, par portabilité

| Composant | Lignes | Dépendances | Portable dans Vite+React ? |
|---|---|---|---|
| `GaijiGlyph` | 61 | aucune | ✅ tel quel |
| `StatHeptagon` | 437 | SVG pur + `SpriteIcon` | ✅ zéro Next |
| `StatCurve` | 297 | `useId` | ✅ zéro Next, aligné sur `nie-zukan` |
| `GalleryLightbox` | 274 | `next/image` | ⚠️ une ligne à changer |
| `data-table` (`@rosegriffon/ui`) | — | TanStack | ✅ |
| `CharacterComparator`, `CharacterSheet`, `BaseCharacterTable` | 668–1093 | `next/image`, `next/link`, `useRouter` | ⚠️ navigation à refaire |
| `FilterChips`, `WikiSearchToolbar` | — | `useSearchParams` | ❌ à réécrire en état local |

## 3D, audio, vidéo

Azalée utilise `<model-viewer>` (web component, auto-hébergé pour respecter la CSP), avec un
montage/démontage par `IntersectionObserver` — motivé par la limite navigateur d'environ 16
contextes WebGL simultanés.

**Notre `Viewport3D.tsx` est plus avancé** (three.js, `TransformControls`, outliner, multi-assets) :
rien à remplacer. Deux emprunts ciblés seulement :

- le **gating par `IntersectionObserver`** pour les vignettes de liste ;
- l'**export MP4 côté client** (`lib/cutin/export.ts`, 371 lignes) : rendu déterministe image par
  image → `VideoFrame` WebCodecs → `VideoEncoder` H.264 → `mp4-muxer`, avec piste AAC. Pure API
  navigateur, réutilisable tel quel pour un export de turntable.

Le visualiseur de cut-in (R3F + timeline Theatre) contient un **parseur `.g4cm` en TypeScript**
(`lib/cutin/g4cm.ts`, 300 lignes) : table des plans, plages de frames, 8 canaux, keyframes u16. Il
documente honnêtement que les **valeurs** de keyframes sont quantifiées et non déquantifiables sans
le lecteur natif, et renvoie `null` plutôt que d'inventer. À réconcilier avec notre
`crates/engine/nie-formats/src/g4cm.rs` — la connaissance de reverse vaut d'être récupérée même si
le code ne l'est pas.

**Aucune forme d'onde audio** dans tout le dépôt : `<audio controls>` sur un blob WAV, rien de plus.

## Ordre d'intégration recommandé

1. **Exposer `sprite_sheet` au front.** Il n'est atteignable que depuis `nie-cli` ; ni `nie-wasm` ni
   les bindings Tauri ne le connaissent. Ajouter une commande Tauri `vfs_sprite_sheet_json` et un
   `g4tx_sprite_sheet_json` dans `nie-wasm`, à côté de `g4tx_info_json`. C'est ce qui débloque tout
   le reste — et ce qui supprimerait les 400 lignes de coordonnées figées d'azalée.
2. **Un composant `<SpriteIcon>` piloté par le manifeste**, fusionnant les trois variantes
   d'azalée : mode image, mode masque teinté, taille cible, repli lucide.
3. **Le routeur d'aperçu par type** (`CpkFilePreview`) dans `DetailPane`, en remplaçant les URLs
   CDN par les commandes Tauri.
4. **Les composants de données** dans l'ordre de portabilité du tableau ci-dessus.

## Pièges

1. **Deux bibliothèques de primitives** : `@rosegriffon/ui` est sur Radix, `nie-explorer` sur
   `@base-ui/react`. Importer le barrel tire 28 paquets Radix — utiliser les imports par sous-chemin
   (`@rosegriffon/ui/data-table`), ou recopier le fichier.
2. **Scope divergent** : `@rose-griffon/*` (GitHub Packages, périmé) contre `@rosegriffon/*` (npm,
   à jour). Vérifier ce qui est réellement résolu.
3. **`@rosegriffon/azalee` et `inagle` tirent `@aphrody-code/bxc` et `zukan`**, publiés uniquement
   sur GitHub Packages en privé. Leur téléchargement exige un jeton portant `read:packages` —
   scope que `write:packages` **n'implique pas**.
4. **`zod` 4** chez `@rosegriffon/*` contre **`zod` 3.25.76** en `catalog:mcp` ici. Les importer dans
   `apps/nie-mcp` rendrait les schémas d'outils MCP inassignables. `nie-explorer` n'a ni `zod` ni le
   SDK MCP : c'est le seul point d'entrée sûr.
5. **`next/image`, `next/link`, `next/navigation`** dans 41 des 60 composants wiki. Les deux
   premiers se remplacent trivialement ; le troisième implique de réécrire la logique de filtres,
   entièrement pilotée par l'URL chez azalée.
6. **URLs CDN codées en dur** partout (`cdn.rosegriffon.fr`). `nie-explorer` doit rester
   intégralement hors ligne : toute URL importée doit devenir un chemin VFS.
7. **`react-konva`, `@theatre/core`, R3F, postprocessing** : lourds, à ne tirer que si la cible le
   justifie réellement.
