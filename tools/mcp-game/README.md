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

## Sources de données (toutes locales au VPS)

| Source | Détail | Env |
|--------|--------|-----|
| Index VFS | Redis db **3**, HASH `iev:file:index` (250 800 entrées chemin→.cpk), chargé une fois au démarrage via un seul `HGETALL`. | `NIERS_REDIS` (défaut `redis://127.0.0.1:6379`) |
| KB RE | SQLite `var/niers.sqlite` (248 Mo), ouvert en **lecture seule** + `safeIntegers`. | `NIERS_SQLITE` (défaut `/home/ubuntu/niers/var/niers.sqlite`) |
| Décodeur d'assets | Service HTTP `nie-model-serve`. | `MODEL_SERVE_URL` (défaut `http://127.0.0.1:8790`) |
| Code du repo | Racine `niers` (refs/ data/ var/ .git/ target/ node_modules/ interdits). | `NIERS_REPO` (défaut `/home/ubuntu/niers`) |

## Lancer

```bash
cd /home/ubuntu/niers/tools/mcp-game
bun install              # une fois (node_modules local, n'affecte pas le workspace)
bun run src/index.ts     # démarre le serveur MCP sur stdio
```

Le serveur logue son état sur **stderr** (stdout est réservé au JSON-RPC MCP).

## Smoke-test

Démarre le serveur en sous-process stdio, s'y connecte avec un vrai client MCP et appelle
chaque outil contre les vraies sources :

```bash
bun run test/smoke.ts
```

Attendu : `14 PASS / 0 FAIL` (re_coverage ≈ 93,36 %, vfs_search/list peuplés, asset_get cfg/tex
décodés par model-serve, re_function/re_query, gardes de sécurité).

## Brancher à un client MCP

### Claude Code (`.mcp.json` à la racine d'un projet, ou via `claude mcp add`)

```json
{
  "mcpServers": {
    "niers-game": {
      "command": "bun",
      "args": ["run", "/home/ubuntu/niers/tools/mcp-game/src/index.ts"],
      "env": {
        "NIERS_REDIS": "redis://127.0.0.1:6379",
        "NIERS_SQLITE": "/home/ubuntu/niers/var/niers.sqlite",
        "MODEL_SERVE_URL": "http://127.0.0.1:8790",
        "NIERS_REPO": "/home/ubuntu/niers"
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
