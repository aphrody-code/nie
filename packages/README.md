# `packages/` — les bibliothèques Bun/TypeScript

7 bibliothèques locales du workspace Bun, plus un dossier de configuration. Règle de rangement :
**une bibliothèque va ici, une application avec un `bin` va dans [`apps/`](../apps)**. Un seul
lockfile, à la racine.

| Paquet | Nom | Rôle |
|---|---|---|
| `nie` | `@aphrody/nie` | bindings FFI de `iecode` — la porte d'entrée TS vers les crates Rust ; ouvre la bibliothèque au premier appel natif, jamais à l'import |
| `nie-plugin` | `@nie/plugin` | préchargements de `bunfig.toml` : loaders des formats de jeu (`register.ts`) et DOM happy-dom des tests (`happydom.ts`) |
| `nie-bridge` | `@nie/bridge` | protocole de contrôle entre `nie-mcp` et la page Inacord de nie web |
| `nie-game` | `@nie/game` | types et logique de jeu purs, partagés par les hôtes |
| `asset-source` | `@nie/asset-source` | contrat de lecture des assets pour web et desktop |
| `inacord-ui` | `@nie/inacord-ui` | présentation Inacord et adaptateurs de surface |
| `nie-media` | `nie-media` | navigation entre épisodes et URLs des lecteurs intégrés (YouTube, Dailymotion) |
| `config` | — | `tsconfig-base.json`, étendu par `nie-game` et `asset-source` (règles relâchées) ; pas un paquet |

Les services Bun historiques (Discord, Wonderbot, cron, MCP, auth, assets et
infrastructure RG copiée) ne font plus partie du workspace. La logique média IETV/Inazuma TV
est réintégrée sous forme pure dans `nie-media`, sans scraper, bot ni service résident. Les API natives et le MCP
maintenu vivent dans les crates Rust ; Bun ne garde que les bindings, types, logique pure et
les deux hôtes produit.

## Règles qui ont déjà coûté cher

- **`bun install` depuis la racine, jamais dans un sous-paquet.** Sans lui,
  `import … from "nie"` résout vers le paquet `nie` du registre npm, pas vers
  `packages/nie`, et l'erreur (`Export named 'decode' not found`) n'y fait pas penser.
- **`iecode` n'est requis que par ce qui l'appelle.** Jusqu'au 2026-09-25, un `dlopen` raté
  cassait *tout* `bun`/`bunx` lancé depuis le dépôt, parce que `bunfig.toml` précharge
  `@nie/plugin`, qui importait `@aphrody/nie`, qui ouvrait la bibliothèque à l'import. Le
  chargement est désormais paresseux : sans `iecode`, typecheck, lint, docs:check et les tests
  sans décodage natif passent ; le premier appel natif lève `NativeLibraryError`, qui nomme la
  commande de build. `bun run build:ffi` reste requis pour les tests de `@aphrody/nie`.
- **Versions par catalogue** (`catalog:`), jamais en dur : une version en dur fait cohabiter
  plusieurs versions d'une même dépendance.
- **`bun --bun`, jamais `bun run` seul** pour les scripts : le shebang `node` serait
  honoré.
- Un paquet dont `exports` pointe sur `./dist/*` ne résout pas sans build : le pointer sur
  `./src/index.ts`, Bun lit le TypeScript.

```bash
bun install          # depuis la racine
bun run build:ffi    # requis par les tests de @aphrody/nie et par tout décodage natif
bun run typecheck && bun run test && bun run lint
```
