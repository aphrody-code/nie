# Ce serveur MCP — ce qu'il expose et ce qu'il refuse

`@rosegriffon/mcp` publie les données et l'infrastructure du projet Rose
Griffon via le **Model Context Protocol**. Implémentation Bun native, sans
aucune dépendance Node : `Bun.serve` pour le Streamable HTTP, les flux
standard pour stdio, zod pour les schémas.

## Inventaire

**26 outils** : 20 en lecture, 6 réservés à la portée `admin`.

| Famille | Outils |
| --- | --- |
| Wiki du jeu | `azalee_search`, `azalee_get`, `azalee_list`, `azalee_dataset` |
| Base de données | `db_tables`, `db_schema`, `db_query` (SQL `SELECT` uniquement) |
| Fichiers du jeu | `cpk_browse`, `cpk_search`, `cpk_file` |
| Texte du jeu | `game_text_search` |
| Recherche sémantique | `rag_search` |
| Dépôt | `repo_list`, `repo_read`, `repo_grep`, `repo_git` |
| Production | `ops_status`, `ops_logs`, `ops_http` |
| Portée | `access_info` |
| **Administration** (`admin`) | `repo_write`, `repo_edit`, `repo_delete`, `repo_move`, `shell_run`, `ops_service` |

**Ressources** : `rg://context/*` (ces fiches), `rg://docs/*` (documentation
versionnée du dépôt), `rg://schema/<table>` (schéma réel d'une table du
miroir), `rg://repo/readme`.

**Prompts** : `fiche-personnage`, `diagnostic-prod`, `explorer-donnees`,
`contexte-monorepo`.

## Deux portées

Le **jeton** présenté décide de ce qui est accessible :

- `read` — les 20 outils de lecture. Aucun outil n'écrit : ni fichier, ni
  base, ni service. Une action de production se propose, avec la commande
  exacte, et s'exécute à la main sur le VPS.
- `admin` — s'ajoutent l'écriture, la suppression, le déplacement,
  l'exécution de commandes et les actions systemd. Équivalent d'un accès SSH.

`access_info` renvoie la portée accordée. En lecture seule, les outils
d'administration n'apparaissent même pas dans la liste.

Trois protections encadrent les lectures :

1. **prison de chemin** — `repo_*` résout les liens symboliques et refuse tout
   ce qui sort de la racine du dépôt, dans les deux portées ;
2. **liste noire** — `.env`, `.secrets/`, clés, sauvegardes SQLite, binaires
   et `node_modules` sont invisibles ;
3. **SQL bridé** — connexion ouverte en lecture seule, une seule instruction,
   `SELECT`/`WITH` uniquement, résultat plafonné.

## Protocole

Serveur **dual-era** : il répond aux clients de la révision courante
`2026-07-28` (sans session, métadonnées par requête, `server/discover`,
validation des en-têtes miroir `Mcp-Method` / `Mcp-Name`) **et** aux clients
des révisions à handshake `initialize` (`2025-11-25`, `2025-06-18`,
`2025-03-26`) — ce que parlent les clients actuels, Claude Code compris. La
spécification autorise explicitement cette double compatibilité.

Le serveur est **sans état** : aucun identifiant de session n'est émis, `GET`
et `DELETE` sur le point d'entrée répondent `405`, conformément à la révision
courante.

## Accès

- En local, dans le dépôt : transport **stdio**, aucun réseau.
- À distance : `https://mcp.rosegriffon.fr/` (ou `https://api.rosegriffon.fr/mcp`),
  protégé par un jeton porteur
  (`Authorization: Bearer …`). C'est une stratégie d'authentification hors
  bande, pas un flux OAuth : le serveur ne publie donc pas de métadonnées de
  ressource protégée et doit être configuré explicitement côté client.
