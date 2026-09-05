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
| CLI `niers`, binaires `crates/` | exécution de code par un fichier de jeu malformé, écriture hors du répertoire visé |
| `nie-explorer` (Tauri) | contournement de l'allowlist, exécution de commande depuis le front, chaîne de mise à jour (signature) |
| `nie-model-serve`, `apps/azalee` | traversée de chemin, SSRF, divulgation d'un fichier hors du VFS servi |
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

Les installeurs de l'application de bureau sont signés par la clé `~/.tauri/niers.key`, et
l'updater refuse un paquet dont la signature ne correspond pas. Un installeur non signé ou
signé par une autre clé n'est pas un livrable de ce projet : le signaler.

## Secrets

Aucun secret ne doit entrer dans le dépôt. Les jetons de service vivent dans
`~/.config/niers/` (permissions `0600`) et dans les unités systemd du VPS. Un secret
committé par erreur doit être révoqué avant d'être retiré de l'historique — retirer sans
révoquer ne protège rien.
