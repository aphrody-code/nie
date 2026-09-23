# `deploy/` — ce qui tourne, versionné

Les unités systemd et les vhosts nginx de ce dépôt. Ce dossier est la **source** ;
`/etc/systemd/system/` et `/etc/nginx/conf.d/` en sont les copies installées. Les deux peuvent
diverger, et ce sont `systemctl` et `nginx -T` qui font foi sur ce qui est actif — pas ce
fichier. Chaque écart connu est écrit ci-dessous plutôt que supposé absent.

## nginx

| Fichier | Hôtes | Amont |
|---|---|---|
| `nginx/aphrody.com.conf` | `nie.aphrody.com` | `127.0.0.1:8085` — `nie-site`, **le site** |
| | `inacord.aphrody.com` | 308 vers `https://nie.aphrody.com/inacord` (fusion du 2026-09-12) ; seul le manifeste updater reste servi ici, pour les clients installés |
| | `aphrody.com`, `www.` | 308 vers `https://nie.aphrody.com` |
| | `api.aphrody.com` | `127.0.0.1:8085`, API seule (`404` ailleurs), `noindex` |
| | `cdn.aphrody.com` | `127.0.0.1:8790` — `nie-model-serve`, sous limite de débit |
| | `downloads.` `bot.` `admin.` `n2b.` | `127.0.0.1:8084` — `bxc-site`, dépôt `bxc` |
| | `mcp.aphrody.com` | `127.0.0.1:8808` — serveur MCP |
| `../aphrody-infra/nginx/aphrody/bxc.aphrody.com.conf` | `bxc.aphrody.com` | propriété du dépôt `aphrody-infra` |

Les douze hôtes partagent le certificat `letsencrypt/live/aphrody.com`. `bxc.aphrody.com` a son
propre fichier depuis le 2026-09-07 : il est copié ici pour que l'inventaire du domaine soit
complet, mais il appartient au dépôt `bxc` et toute évolution vient de là.

### Publication Inacord

Depuis la fusion du 2026-09-12, l’espace de travail est une route du site
(`nie.aphrody.com/inacord`) servie par le bundle `apps/nie-web/dist`, et le catalogue des
binaires natifs est `nie.aphrody.com/downloads`. Le vhost `inacord.` ne sert plus qu’un lien
atomique du checkout de production, `var/releases/inacord/public`, pour le manifeste updater
que les clients déjà installés interrogent encore ; tout le reste y répond 308.

`bun run release:inacord` refuse une branche autre que `main`, un checkout sale et tout écart
entre `HEAD` et `origin/main`. Il vérifie les signatures et hashes avant de déplacer le lien
`public`. La publication complète reste intégrée à `bun run release:all --deploy`; il n’existe pas
de second orchestrateur de release. Le rollback précédent est conservé dans les manifestes de
release, et le vhost ne publie ni source map ni chemin de forge.

**`nie-model-serve` passe de `nie.` à `cdn.`** (décision de l'utilisateur, 2026-09-07). Il
occupait `nie.aphrody.com`, que le site prend ; `cdn.` décrit ce qu'il fait — servir des octets
dérivés, décodés à la demande.

Ce que ce déplacement coûte, écrit plutôt que découvert : `cdn.aphrody.com` ne répondait pas
`502`, il rendait **200** depuis `bxc-site` comme les quatre hôtes qui l'entouraient, et ce
contenu cesse d'y être servi. Les quatre autres ne bougent pas.

Le service n'a **aucune protection propre** — il ne lit même pas la méthode HTTP. Sur `cdn.`,
les `limit_req`/`limit_conn` du vhost sont donc la seule chose entre lui et Internet ; par
`nie.aphrody.com/assets/*`, `nie-site` ajoute en plus un budget de temps, une taille bornée et
un cache. Le décodage reste aussi public via `cdn.rosegriffon.conf`, qui ne dépend pas de ce
fichier.

### Vérifier une modification sans toucher à la production

`nginx -t` sur la configuration installée teste ce qui tourne, pas ce que le dépôt propose.
Pour tester **ce fichier-ci**, il faut un `nginx.conf` jetable qui l'inclut, avec des certificats
de remplacement (les vrais ne sont lisibles que par `root`) :

```bash
cd "$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -keyout k.pem -out c.pem -days 1 -nodes -subj /CN=test
openssl dhparam -out dh.pem 2048          # 512 bits est refusé par OpenSSL 3
echo 'ssl_session_timeout 1d;' > opts.inc  # l'include SSL, au niveau `server`
: > mcp.inc                                # l'include MCP, au niveau `location`
sed -e 's#/etc/letsencrypt/live/aphrody.com/fullchain.pem#'"$PWD"'/c.pem#g' \
    -e 's#/etc/letsencrypt/live/aphrody.com/privkey.pem#'"$PWD"'/k.pem#g' \
    -e 's#/etc/letsencrypt/options-ssl-nginx.conf#'"$PWD"'/opts.inc#g' \
    -e 's#/etc/letsencrypt/ssl-dhparams.pem#'"$PWD"'/dh.pem#g' \
    -e 's#/etc/nginx/conf.d/snippets-mcp.inc#'"$PWD"'/mcp.inc#g' \
    ~/aphrody-infra/nginx/aphrody/aphrody.com.conf > vhost.conf
printf 'events {}\nhttp { include %s/vhost.conf; }\n' "$PWD" > nginx.conf
nginx -t -c "$PWD/nginx.conf"
```

Attendu : **`syntax is ok`**. L'échec qui suit — `open() "/run/nginx.pid" failed (13)` — est
normal en non-root et arrive **après** la validation : la configuration a été lue et chargée.

## systemd

Les unités n'embarquent plus le chemin d'un checkout particulier. Elles utilisent
`NIE_REPO_ROOT` et `NIE_GAME_DIR`, avec les valeurs par défaut `/home/ubuntu/nie` et
`%h/.local/share/Steam/iecode/inazuma`. Sur un hôte existant, créer avant l'installation
`/etc/nie/nie.env` :

```ini
NIE_REPO_ROOT=/home/ubuntu/nie
NIE_GAME_DIR=/home/ubuntu/.local/share/Steam/iecode/inazuma
```

Le fichier est lu par `nie-site` et `nie-model-serve`; il permet de changer de checkout sans
modifier les unités ni le code.

| Unité | Ce qu'elle sert |
|---|---|
| `nie-site.service` | le site, `127.0.0.1:8085`, derrière nginx |
| `nie-model-serve.service` | le décodage des fichiers du jeu à la volée, `127.0.0.1:8790` |

## Ce qui n'est PAS ici, et pourquoi

The native Rust MCP server is a per-client stdio process (`nie-mcp` or `nie mcp`), not a
long-running HTTP unit. The retired HTTP unit remains masked on the host to prevent accidental
reactivation.

External infrastructure units are owned by their respective deployment repositories and are not
duplicated here.

La machine porte aussi les unités `bxc-*` et `rg-*` (CDN, postgrest, sauvegarde, watchdogs) et
les vhosts `rosegriffon.conf`, `cdn.rosegriffon.conf`, `supabase*`, `studio.*`. Ils
appartiennent aux dépôts `bxc` et `rg` : les recopier ici créerait une seconde source de vérité
pour des fichiers que ce dépôt ne modifie pas. La frontière est celle du 2026-09-05 — Codex
tient `rg`, ce dépôt tient `nie`.

## Avant de renommer ou de déplacer quoi que ce soit

```bash
systemctl list-unit-files | grep -E 'nie-|mcp'           # ce qui est installé
systemctl --failed                                       # ce qui est tombé
diff /etc/systemd/system/nie-site.service deploy/systemd/nie-site.service
```

## Installer

**Aucune de ces installations ne se fait depuis une session d'agent.** `cp` dans `/etc`,
`daemon-reload`, `nginx -t` et `reload` sont des actes de production : ils demandent le go
explicite de l'utilisateur, et chaque fichier porte le mode d'emploi dans son propre en-tête.

Le déploiement du wiki se fait **en bleu/vert** par `scripts/ops/deploy.ts`, jamais par un
`restart` : un redémarrage sec sert une version à moitié construite. Après un build Next, la
copie de `.next/static` est obligatoire — la sauter rend un site sans style, sans qu'aucune
erreur ne le dise.
