# Monorepo Rose Griffon — carte d'orientation

Dépôt unique `rose-griffon/rg` sur un VPS OVH. Runtime **Bun** partout (jamais
`node`, `npm` ni `tsx`), workspaces Bun + Turborepo, versions partagées via la
`catalog:` de la `package.json` racine.

## Ce qui tourne

| Surface | Workspace | Cible |
| --- | --- | --- |
| Wiki Azalée (Inazuma Eleven: Victory Road) | `apps/azalee` → `@rosegriffon/azalee-web` | VPS, `azalee.rosegriffon.fr` |
| Site principal | `apps/website` → `@rosegriffon/website` | VPS, `rosegriffon.fr` |
| Bibliothèque du wiki (données, CLI, API headless) | `packages/azalee` → `@rosegriffon/azalee` | consommée par l'app, le CLI, un futur GUI Tauri |
| Serveur MCP (ce serveur) | `packages/mcp` → `@rosegriffon/mcp` | VPS, `mcp.rosegriffon.fr` |
| Tâches planifiées | `packages/cron` | `rg-cron.service` |
| Bot Discord | `apps/bot` | **non déployé** — ne pas tenter de le relancer |
| Toolkit de rétro-ingénierie C#/.NET | `iecode/` | outillage local |

Paquets partagés : `ui` (design system shadcn/Tailwind v4), `db` (client
Supabase), `auth`, `types` (schémas zod), `inagle` (extraction des données du
jeu), `assets`, `config`.

## Séparation `@rosegriffon/azalee` (lib) / `azalee-web` (app)

Le cœur du wiki vit dans la **bibliothèque**, pas dans l'app Next :

- racine du paquet = **client-safe** (règles de jeu, URLs CDN, recherche,
  types `*-shared`) — se bundle dans un navigateur ;
- `@rosegriffon/azalee/server` = tout ce qui touche le disque ou la base
  (miroir SQLite, index CPK, index de texte) ;
- `@rosegriffon/azalee/remote` = client HTTP typé vers l'API headless, avec
  repli automatique quand la machine n'a ni miroir ni dump du jeu.

L'app Next passe par des façades `apps/azalee/lib/**` qui portent
`import "server-only"` ; **la bibliothèque, elle, ne doit jamais importer
`server-only`** (cela casserait le CLI et un sidecar Tauri).

## Règles de contribution

- Tout le texte produit est en **français** : commentaires, documentation,
  messages de commit.
- Commit : une ligne, `feat|fix|chore|refactor|docs(scope): description`.
  Pas d'emoji, pas de mention d'outil de génération.
- Les fichiers `*.md` et `*.txt` sont ignorés par git **sauf**
  README/CHANGELOG/SECURITY/LICENSE et `docs/**` : aucune note de travail ne
  doit atterrir dans le dépôt.
- Vérification avant de pousser : `bun run type-check` puis `bun run build` à
  la racine.

## Pièges qui coûtent cher

- **`bun.lock` doit rester en `lockfileVersion: 1`.** Le Bun local (1.4
  canary) le réécrit en 2, illisible par le Bun 1.3.x de la CI et de la
  production. Remettre la valeur à 1 après chaque `bun install`.
- **Ne jamais supprimer un `dist/` ou un `.next/` servi par un service.**
  Effacer `packages/inagle/dist` casse `rg-cron`, effacer
  `apps/azalee/.next` met le wiki en 500.
- **Turbopack refuse les liens symboliques sortant de la racine** : ne jamais
  symlinker `apps/azalee/data` vers un dossier hors du dépôt, cela met le wiki
  hors service.
- **`kysely` est épinglé en `0.28.2`** volontairement (une version plus
  récente casse le build) : ne pas le mettre à jour.
- **Données personnelles** : les fichiers publics (`humans.txt`, `llm.txt`,
  JSON-LD) utilisent le pseudonyme `yoyo`, jamais un nom réel. Les sauvegardes
  Supabase contiennent des adresses e-mail et ne sont jamais versionnées.
