# @rosegriffon/mcp

Serveur **Model Context Protocol** du monorepo Rose Griffon : il ouvre à un
agent les données extraites d'*Inazuma Eleven: Victory Road* (wiki Azalée,
miroir SQLite, index des fichiers du jeu, texte du jeu) ainsi que le dépôt et
l'état de la production. Deux portées, décidées par le jeton présenté :
**lecture seule** par défaut, **écriture complète** avec le jeton
d'administration.

Implémentation **Bun native, sans aucune dépendance Node** : `Bun.serve` pour
le Streamable HTTP, les flux standard pour stdio, `bun:sqlite` pour les
données, zod pour les schémas. Une seule dépendance de production (`zod`) en
plus des paquets du monorepo.

## Démarrer

```bash
bun packages/mcp/src/cli.ts --list          # inventaire
bun packages/mcp/src/cli.ts serve --stdio   # transport stdio (Claude Code local)
bun packages/mcp/src/cli.ts serve --http --port 8808
bun packages/mcp/src/cli.ts --probe https://mcp.rosegriffon.fr/
```

Dans ce dépôt, `.mcp.json` déclare déjà le serveur en stdio : Claude Code le
propose à l'ouverture du projet.

Depuis une autre machine :

```bash
claude plugin marketplace add .  # plugin `rose-griffon` : MCP + skills + agents
scripts/mcp/install.sh serveur   # VPS : systemd + nginx + les deux jetons
scripts/mcp/install.sh client    # poste Linux/macOS, en lecture seule
scripts/mcp/install.sh admin     # …ou en écriture
pwsh scripts/mcp/install.ps1 -Jeton "<jeton>"          # poste Windows
pwsh scripts/mcp/install.ps1 -Jeton "<jeton>" -Admin   # …en écriture
```

## Ce qu'il expose

**20 outils de lecture** — `azalee_search`, `azalee_get`, `azalee_list`,
`azalee_dataset` ; `db_tables`, `db_schema`, `db_query` ; `cpk_browse`,
`cpk_search`, `cpk_file` ; `game_text_search` ; `rag_search` ; `repo_list`,
`repo_read`, `repo_grep`, `repo_git` ; `ops_status`, `ops_logs`, `ops_http` ;
`access_info`.

**6 outils d'administration** — `repo_write`, `repo_edit`, `repo_delete`,
`repo_move`, `shell_run`, `ops_service`.

**Ressources** — `rg://context/*` (fiches d'orientation livrées avec le
paquet), `rg://docs/*` (documentation versionnée du dépôt),
`rg://schema/<table>` (schéma réel d'une des 66 tables du miroir),
`rg://repo/readme`.

**Prompts** — `fiche-personnage`, `diagnostic-prod`, `explorer-donnees`,
`contexte-monorepo`.

Le détail des paramètres est dans
`plugins/rose-griffon/skills/donnees-jeu/reference.md`, la skill Claude servie
par le plugin du dépôt.

## Conformité au protocole

Serveur **dual-era**, ce que la spécification autorise explicitement
(« a dual-era server MAY serve both eras concurrently on the same endpoint ») :

| Ère | Versions | Ce qui est implémenté |
| --- | --- | --- |
| moderne | `2026-07-28` | pas de session, métadonnées `_meta.io.modelcontextprotocol/*` par requête, `server/discover`, validation des en-têtes miroir `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` (`-32020`), `-32021`, `-32022`, `resultType`, `405` sur GET/DELETE |
| à handshake | `2025-11-25`, `2025-06-18`, `2025-03-26` | `initialize`, `notifications/initialized`, en-têtes de session ignorés (le serveur reste sans état) |

C'est nécessaire, pas décoratif : Claude Code 2.1.x est encore un client de
l'ère à handshake.

Méthodes servies : `server/discover`, `initialize`, `ping`, `tools/list`,
`tools/call`, `resources/list`, `resources/templates/list`, `resources/read`,
`prompts/list`, `prompts/get`, `completion/complete`, `logging/setLevel`.
Pagination par curseur opaque, `notifications/progress` et
`notifications/message` sur flux SSE quand le client fournit un
`progressToken`.

### Écart assumé : l'authentification

La spécification décrit OAuth 2.1 + métadonnées de ressource protégée
(RFC 9728) pour un serveur HTTP protégé — mais l'autorisation y est
*optionnelle*, et les parties « MAY negotiate their own custom authentication
strategies ». Ce serveur utilise un **jeton porteur statique** hors bande :
c'est ce que Claude Code sait configurer (`--header "Authorization: Bearer …"`)
et cela évite de monter un serveur d'autorisation pour un usage à un seul
utilisateur. Conséquence assumée : le serveur n'est pas auto-découvrable par
un client OAuth conforme et doit être configuré explicitement. Il ne publie
donc pas de document de ressource protégée, qui devrait référencer un serveur
d'autorisation inexistant.

Protections effectivement en place : validation de l'`Origin` (403 si
présent et non autorisé), écoute sur la boucle locale, TLS et jeton imposés
par nginx, comparaison du jeton sur condensat SHA-256.

`/health` répond sans jeton (sonde systemd et nginx) et ne divulgue que le nom
du serveur, les versions de protocole et des compteurs.

## Deux portées

La portée est décidée par le **jeton présenté**, jamais par le client :

| Jeton | Où il vit | Portée | Ce qu'elle ouvre |
| --- | --- | --- | --- |
| `RG_MCP_TOKEN` | `/etc/rg-mcp.env` (0600 root) | `read` | les 20 outils de lecture |
| `RG_MCP_ADMIN_TOKEN` | `.env` du dépôt (gitignoré, chargé nativement par Bun) | `admin` | + écriture, suppression, déplacement, `shell_run`, actions systemd |

Un client en lecture seule ne voit même pas les outils d'écriture dans
`tools/list` ; un appel direct est refusé avec
`data.requiredScope: "admin"`. `access_info` renvoie la portée accordée.

Sur **stdio**, la portée est `admin` par défaut : le client a lancé le
processus lui-même et dispose déjà d'un shell sur la machine, restreindre
n'apporterait rien. `--scope read` la bride si besoin.

Le jeton d'administration donne l'écriture dans le dépôt **et** l'exécution de
commandes : c'est l'équivalent d'un accès SSH, à traiter comme tel. Chaque
opération est tracée dans le journal du service (`journalctl -u rg-mcp | grep
mcp-admin`).

## Sécurité des outils

- **Prison de chemin** : `repo_*` résout les liens symboliques et refuse tout
  ce qui sort de la racine du dépôt — y compris en portée `admin`, et y
  compris pour un chemin absolu.
- **Liste noire** : `.env*`, `.secrets/`, clés, `*.sqlite`, `node_modules`,
  `.next`, `.turbo`, binaires.
- **SQL bridé** : connexion SQLite ouverte en lecture seule, une seule
  instruction, `SELECT`/`WITH` uniquement, `LIMIT` imposé.
- **Domaines bornés** : `ops_http` n'accepte que `rosegriffon.fr` et ses
  sous-domaines.
- **Bac à sable systemd** : `ProtectSystem=strict` + `ProtectHome=read-only`
  avec `ReadWritePaths=/home/ubuntu/rg /tmp` — même `shell_run` ne peut écrire
  que dans le dépôt et `/tmp`.
- En portée `read`, aucun outil n'écrit, ne redémarre ni ne déploie.

## Étendre

```ts
import { defineTool, McpRegistry } from "@rosegriffon/mcp/registry";
import { structured } from "@rosegriffon/mcp/protocol";
import { z } from "zod";

const outil = defineTool({
  name: "mon_outil",
  description: "Ce que fait l'outil, l'essentiel en premier.",
  inputSchema: z.object({ q: z.string().describe("terme recherché") }),
  annotations: { readOnlyHint: true },
  handler: ({ q }) => structured({ q }),
});
```

Le type des arguments du gestionnaire est **déduit** du schéma zod, et le JSON
Schema publié dans `tools/list` en est dérivé (dialecte 2020-12, celui de MCP
depuis `2026-07-28`). Un nom d'outil non représentable dans un en-tête HTTP
est refusé à la déclaration.

## Tests

```bash
bun test packages/mcp/test
```

94 tests : conformité du protocole (routage, erreurs, pagination, dual-era),
sémantique HTTP exacte, cadrage stdio, cloisonnement des portées (un jeton de
lecture ne peut ni voir ni appeler un outil d'écriture, la prison de chemin
tient même en administration) et vérification des outils **contre les vraies
données** du VPS (les cas qui dépendent du miroir sont ignorés s'il est
absent, jamais faussés).
