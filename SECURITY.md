# Politique de sécurité

## Signaler une vulnérabilité

Ouvrir un avis de sécurité privé sur GitHub
([Security → Report a vulnerability](https://github.com/aphrody-code/nie/security/advisories/new)),
ou écrire à `security@rosegriffon.fr`. Ne pas ouvrir d'issue publique pour une faille non
corrigée.

Réponse sous 72 h ouvrées, correctif proposé ou refus motivé sous 30 jours.

## Périmètre

Ce dépôt produit un moteur, une CLI, une application de bureau, un serveur d'assets et un
site. Sont dans le périmètre :

| Surface | Ce qui compte comme vulnérabilité |
|---|---|
| CLI `nie`, binaires `crates/` | exécution de code par un fichier de jeu malformé, écriture hors du répertoire visé |
| Inacord (`apps/inacord`, Tauri) | contournement de l'allowlist, exécution de commande depuis le front, chaîne de mise à jour (signature) |
| `nie-model-serve`, `nie-site` | path traversal, SSRF, or disclosure of a file outside the served VFS |
| `nie-mcp` | outil MCP permettant de lire ou d'écrire hors du dépôt |
| Parseurs binaires (`nie-formats`, `iecode`) | débordement, boucle infinie, allocation non bornée sur une entrée hostile |

Sont **hors** périmètre :

- les assets du jeu © LEVEL-5 (`data/`) — ils ne sont pas distribués par ce dépôt ;
- l'absence de bac à sable dans les outils de reverse-engineering, qui désassemblent par
  construction un binaire non fiable ;
- les binaires publiés par LEVEL-5 (`nie.exe`) — les signaler à LEVEL-5, pas ici ;
- un plantage sur un fichier de jeu volontairement corrompu **sans** franchissement de
  frontière de sécurité (c'est un bug, à signaler en issue normale).

## Chaîne de publication

Les installeurs de l'application de bureau sont signés par la clé `~/.tauri/nie.key`, et
l'updater refuse un paquet dont la signature ne correspond pas. Un installeur non signé ou
signé par une autre clé n'est pas un livrable de ce projet : le signaler.

## Secrets

Aucun secret ne doit entrer dans le dépôt. Les jetons de service vivent dans
`~/.config/nie/` (permissions `0600`) et dans les unités systemd du VPS. Un secret
committé par erreur doit être révoqué avant d'être retiré de l'historique — retirer sans
révoquer ne protège rien.

## Avis ouverts, et pourquoi ils ne sont pas exploitables ici

État mesuré le **2026-09-19**. Cette section se re-mesure, elle ne se cite pas.

Dependabot signale trois avis sur `rmcp` 1.8.0, le SDK Model Context Protocol :

| Avis | Sévérité | Ce qu'il vise | Corrigé en |
|---|---|---|---|
| `GHSA-9pj6-vhgr-3mwh` | haute (7.5) | fuite permanente de la table de sessions du transport **HTTP streamable** (déni de service) | 2.0.0 |
| `GHSA-33f5-2c5q-wgwj` | haute (8.2) | absence de validation du champ `resource` dans la découverte de métadonnées **OAuth** | 2.0.0 |
| `GHSA-9g45-5xwm-f3wc` | moyenne (6.8) | en-têtes HTTP personnalisés fuités vers une cible de **redirection cross-origin** | 2.1.0 |

Les trois portent sur des chemins HTTP. `nie-mcp` est un serveur **stdio**, et les features
`rmcp` réellement compilées sont au nombre de sept — `base64`, `default`, `macros`, `schemars`,
`server`, `transport-async-rw`, `transport-io` — **aucune HTTP** :

```sh
cargo tree -p nie-mcp -i rmcp -e features | grep -o 'rmcp feature "[^"]*"' | sort -u
cargo tree -p nie-mcp -i rmcp -e features | grep -Ei "http|auth|axum|hyper|reqwest|sse|oauth"
```

La seconde commande ne doit **rien** rendre. Si elle rend quoi que ce soit, les trois avis
deviennent vivants et le pin `rmcp = "1.8.0"` doit tomber avant que la feature ne soit fusionnée.
Ce pin est délibéré (cf. le commentaire de `Cargo.toml`) : il suit la révision revue du frère de
production `aphrody-mcp`, et la montée en 2.x est une rupture d'API attendant sa suite de
compatibilité.

**`cargo deny check advisories` rend `ok` sur cet état** : la base RustSec qu'il consulte ne porte
pas ces trois GHSA. Les deux sources ne se recouvrent donc pas, et passer l'une ne dispense pas de
lire l'autre.
