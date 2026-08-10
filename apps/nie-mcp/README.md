# niers-game — serveur MCP

Expose **tout** *Inazuma Eleven: Victory Road* (le projet de réécriture RE `niers`) à un
client MCP (Claude Desktop / Claude Code) : le VFS des 250 800 fichiers CPK, les assets
décodés (textures, cfg.bin, audio, modèles 3D), la base de connaissance reverse-engineering,
et le code du repo. Objectif : explorer et streamer le jeu entier depuis un client MCP.

Écrit en **Bun / TypeScript** (Bun 1.4.0). Transport **stdio**. Aucun bundler : Bun exécute
le TS directement.

## Outils exposés (8)

| Outil          | Rôle |
|----------------|------|
| `vfs_list`     | Liste les sous-dossiers/fichiers immédiats sous un préfixe VFS (navigation arborescente). |
| `vfs_search`   | Recherche sous-chaîne (insensible à la casse) ou glob (`**`, `*`, `?`…) sur les 250 800 chemins. |
| `vfs_stat`     | Métadonnées d'un chemin : `.cpk` conteneur, extension, mode de décodage applicable. |
| `asset_get`    | Récupère/décode un asset via `nie-model-serve` : `cfg`→JSON, `tex`→PNG, `audio`→WAV, `model`→GLB, `raw`→octets. |
| `re_query`     | Requête **SELECT** (lecture seule) sur la KB SQLite `var/niers.sqlite`. |
| `re_function`  | Détail d'une fonction reversée (par nom ou vaddr) + xrefs entrants/sortants. |
| `re_coverage`  | Dernière ligne de couverture RE (≈ 93,4 % / 52 783 fonctions) + comptes réels. |
| `repo_read`    | Lit un fichier source/docs du repo (anti-traversal strict). |

Les colonnes d'adresse (`vaddr`, `from_addr`, `to_addr`…) sont renvoyées **en hexadécimal**.
`asset_get` ne renvoie jamais des Mo de base64 par défaut : pour le binaire il donne un
résumé (taille, content-type) + l'**URL model-serve exacte** à ouvrir, et n'inline le contenu
(base64 / texte) que s'il tient sous `maxBytes` (défaut ≈ 256 Ko).

## Sources de données

Tous les chemins par défaut sont déduits de l'emplacement du serveur
(`<repo>/apps/nie-mcp/src/`) : aucun chemin absolu codé en dur, le serveur tourne tel quel
sur le VPS Linux **et** sur l'installation Steam Windows.

| Source | Détail | Env |
|--------|--------|-----|
| Index VFS | Les **CPK eux-mêmes**, montés en process par le paquet `nie` (bindings Bun FFI de `libnie_ffi` → `nie-formats::vfs`) : 255 308 fichiers indexés en ~1 s, contenu lisible directement. Repli sur Redis (HASH `iev:file:index`, db 3) pour un hôte qui a l'index mais pas les packs — l'index Redis ne donne que les chemins. | `NIE_GAME_DIR` (défaut : racine déduite), `NIERS_REDIS` |
| KB RE | SQLite `var/niers.sqlite`, ouvert en **lecture seule** + `safeIntegers`. | `NIERS_SQLITE` (défaut `<repo>/var/niers.sqlite`) |
| Décodeur d'assets | `raw`, `cfg` et `tex` sont décodés **en process** par `nie` (mêmes crates que l'explorateur, champ `source: "ffi"` dans la réponse). `audio` et `model`, que le FFI n'expose pas, passent par le service HTTP `nie-model-serve` (`source: "model-serve"`). | `MODEL_SERVE_URL` (défaut `http://127.0.0.1:8790`) |
| Code du repo | Racine `niers` (refs/ data/ var/ .git/ target/ node_modules/ interdits). | `NIERS_REPO` (défaut : racine déduite) |

### Une seule implémentation, deux façades

`nie-explorer` (UI Tauri) lie les crates `nie-formats`, `nie-data`, `nie-core`… en Rust ;
`nie-mcp` atteint les mêmes crates depuis Bun via `packages/nie` (FFI). Le VFS listé, les
textures décodées et les `cfg.bin` parsés sont donc produits par **le même code** des deux
côtés — pas deux implémentations à tenir synchronisées.

**Prérequis** : `libnie_ffi` doit être construite (`bun run build:ffi` à la racine, ou
`cargo build -p nie-ffi`).

## Lancer

Le serveur est un workspace du monorepo Bun (`apps/nie-mcp`) : ses dépendances viennent du
`bun install` de la racine, il n'a **pas** de `node_modules` ni de lockfile propre.

```bash
bun install                        # une fois, à la racine du repo
bun run apps/nie-mcp/src/index.ts  # démarre le serveur MCP sur stdio
# ou : bun run --filter '@niers/nie-mcp' start
```

Le serveur logue son état sur **stderr** (stdout est réservé au JSON-RPC MCP).

## Smoke-test

Démarre le serveur en sous-process stdio, s'y connecte avec un vrai client MCP et appelle
chaque outil contre les vraies sources :

```bash
bun run --filter '@niers/nie-mcp' test
```

Le smoke-test complet exige les services du VPS (Redis + `nie-model-serve`). Sans eux, le
serveur démarre quand même : les outils VFS passent par le repli CLI, `re_*` et `repo_read`
fonctionnent, seul `asset_get` échoue proprement.

Attendu : `14 PASS / 0 FAIL` (re_coverage ≈ 93,36 %, vfs_search/list peuplés, asset_get cfg/tex
décodés par model-serve, re_function/re_query, gardes de sécurité).

## Brancher à un client MCP

### Claude Code (`.mcp.json` à la racine d'un projet, ou via `claude mcp add`)

C'est déjà le `.mcp.json` versionné à la racine du repo — chemin **relatif**, donc valable
sur le VPS comme sous Windows :

```json
{
  "mcpServers": {
    "niers-game": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "apps/nie-mcp/src/index.ts"],
      "env": {
        "NIERS_REDIS": "redis://127.0.0.1:6379",
        "MODEL_SERVE_URL": "http://127.0.0.1:8790"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Même bloc `mcpServers`. Si `bun` n'est pas sur le PATH du client, mettre le chemin absolu
du binaire dans `command` (`which bun`).

## Sécurité

- Anti-traversal strict sur tous les chemins (`..`, chemins absolus, antislash, octets de
  contrôle refusés). `repo_read` n'autorise que des sous-chemins de `NIERS_REPO`, résout les
  symlinks, et interdit `refs/ data/ var/ .git/ target/ node_modules/` ainsi que les fichiers
  > 8 Mo.
- `re_query` : **SELECT-only** (rejette `INSERT/UPDATE/DELETE/DROP/PRAGMA/ATTACH/…` et les
  instructions multiples). La base est de toute façon ouverte en lecture seule.

## Notes

- Le binaire RE canonique est la vue `.pdata` (`binary_id = 2`, 52 783 fonctions) — c'est celui
  dont parle la table `coverage`. La table `function` contient aussi `binary_id = 1` (index
  Ghidra brut, 60 183 lignes, désaligné) ; `re_coverage` renvoie les deux comptes.
- Convention `/tex` : passer le chemin **avec** `.g4tx` ; la route model-serve remplace `.png`
  par `.g4tx`, donc l'URL générée est `…/x.png` (jamais `…/x.g4tx.png`).
- `asset_get decode=model` attend un **code perso** (ex. `c01000010`), pas un chemin VFS.
