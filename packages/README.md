# `packages/` — les bibliothèques Bun/TypeScript

19 paquets du workspace Bun. Règle de rangement : **une bibliothèque va ici, une
application avec un `bin` va dans [`apps/`](../apps)**. Un seul lockfile, à la racine.

| Paquet | Rôle |
|---|---|
| `nie` | bindings FFI de `libnie_ffi` — la porte d'entrée TS vers les crates Rust |
| `nie-bridge` | protocole de contrôle partagé `nie-mcp` ↔ `nie-explorer` |
| `nie-catalog` | **la façade des quatre gisements** (jeu / extrait / re / anime) et leurs jointures |
| `nie-plugin` | plugin Bun d'import des formats — préchargé par `bunfig.toml` |
| `azalee` | la bibliothèque du wiki — service, images, clients CDN client-safe |
| `inagle` | le pipeline des données du jeu : parsers, entités, push vers Postgres |
| `inagle-cross` | les rapprochements entre gisements |
| `cron` | le démon de tâches, dont `src/tasks/ie-crawl/` |
| `ietv`, `ietv-client` | le catalogue d'épisodes de la série |
| `wonderbot` | le bot Discord |
| `zukan` | le zukan officiel |
| `db`, `types`, `auth`, `config`, `ui`, `assets`, `mcp` | le socle partagé du wiki |

## Règles qui ont déjà coûté cher

- **`bun install` depuis la racine, jamais dans un sous-paquet.** Sans lui,
  `import … from "nie"` résout vers le paquet `nie` du registre npm, pas vers
  `packages/nie`, et l'erreur (`Export named 'decode' not found`) n'y fait pas penser.
- **`bun run build:ffi` avant tout autre `bun run`.** Un `dlopen` raté casse *tout*
  `bun`/`bunx` lancé depuis le dépôt, même sans rapport avec le jeu : `bunfig.toml`
  précharge `nie-plugin`, qui charge `libnie_ffi`.
- **Versions par catalogue** (`catalog:` / `catalog:mcp`), jamais en dur : une version en
  dur fait cohabiter plusieurs TypeScript et plusieurs zod, ce qui rend les schémas
  d'outils MCP inassignables.
- **`bun --bun`, jamais `bun run` seul** pour les scripts : le shebang `node` serait
  honoré.
- Un paquet dont `exports` pointe sur `./dist/*` ne résout pas sans build : le pointer sur
  `./src/index.ts`, Bun lit le TypeScript.

```bash
bun install          # depuis la racine
bun run build:ffi    # requis avant tout le reste
bun run typecheck && bun run test && bun run lint
```
