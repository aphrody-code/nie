# `packages/` — les bibliothèques Bun/TypeScript

6 bibliothèques locales du workspace Bun. Règle de rangement : **une bibliothèque va ici, une
application avec un `bin` va dans [`apps/`](../apps)**. Un seul lockfile, à la racine.

| Paquet | Rôle |
|---|---|
| `nie` | bindings FFI de `iecode` — la porte d'entrée TS vers les crates Rust |
| `nie-bridge` | protocole de contrôle partagé entre les hôtes Inacord |
| `nie-game` | types et logique de jeu purs, partagés par les hôtes |
| `asset-source` | contrat de lecture des assets pour web et desktop |
| `inacord-ui` | présentation Inacord et adaptateurs de surface |
| `nie-media` | catalogue canonique Inazuma Eleven, sources, URLs, navigation et lecteur |

Les services Bun historiques (Discord, Wonderbot, cron, MCP, auth, assets et
infrastructure RG copiée) ne font plus partie du workspace. La logique média IETV/Inazuma TV
est réintégrée sous forme pure dans `nie-media`, sans scraper, bot ni service résident. Les API natives et le MCP
maintenu vivent dans les crates Rust ; Bun ne garde que les bindings, types, logique pure et
les deux hôtes produit.

## Règles qui ont déjà coûté cher

- **`bun install` depuis la racine, jamais dans un sous-paquet.** Sans lui,
  `import … from "nie"` résout vers le paquet `nie` du registre npm, pas vers
  `packages/nie`, et l'erreur (`Export named 'decode' not found`) n'y fait pas penser.
- **`bun run build:ffi` avant tout autre `bun run`.** Un `dlopen` raté casse *tout*
  `bun`/`bunx` lancé depuis le dépôt, même sans rapport avec le jeu : `bunfig.toml`
  précharge le module interne de formats, qui charge `iecode`.
- **Versions par catalogue** (`catalog:`), jamais en dur : une version en dur fait cohabiter
  plusieurs versions d'une même dépendance.
- **`bun --bun`, jamais `bun run` seul** pour les scripts : le shebang `node` serait
  honoré.
- Un paquet dont `exports` pointe sur `./dist/*` ne résout pas sans build : le pointer sur
  `./src/index.ts`, Bun lit le TypeScript.

```bash
bun install          # depuis la racine
bun run build:ffi    # requis avant tout le reste
bun run typecheck && bun run test && bun run lint
```
