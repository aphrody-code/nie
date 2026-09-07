# `deploy/` — ce qui tourne, versionné

Les unités systemd et les vhosts nginx de ce dépôt. Ce dossier est la **source** ;
`/etc/systemd/system/` et `/etc/nginx/conf.d/` en sont les copies installées. Les deux peuvent
diverger, et ce sont `systemctl` et `nginx -T` qui font foi sur ce qui est actif — pas ce
fichier. Chaque écart connu est écrit ci-dessous plutôt que supposé absent.

## nginx

| Fichier | Hôtes | Amont |
|---|---|---|
| `nginx/aphrody.com.conf` | `nie.aphrody.com` | `127.0.0.1:8085` — `nie-site`, **le site** |
| | `aphrody.com`, `www.` | 308 vers `https://nie.aphrody.com` |
| | `api.aphrody.com` | `127.0.0.1:8085`, API seule (`404` ailleurs), `noindex` |
| | `downloads.` `cdn.` `bot.` `admin.` `n2b.` | `127.0.0.1:8084` — `bxc-site`, dépôt `bxc` |
| | `mcp.aphrody.com` | `127.0.0.1:8808` — serveur MCP |
| `nginx/bxc.aphrody.com.conf` | `bxc.aphrody.com` | `127.0.0.1:8084` — **capture, ne pas modifier ici** |

Les onze hôtes partagent le certificat `letsencrypt/live/aphrody.com`. `bxc.aphrody.com` a son
propre fichier depuis le 2026-09-07 : il est copié ici pour que l'inventaire du domaine soit
complet, mais il appartient au dépôt `bxc` et toute évolution vient de là.

**`nie-model-serve` n'a plus de vhost public.** Il occupait `nie.aphrody.com`, que le site
prend depuis le 2026-09-07 ; aucun autre hôte n'est libre, les cinq du bloc partagé servant
tous `bxc-site`. Le décodage reste joignable par `nie.aphrody.com/assets/*`, que `nie-site`
proxifie avec ce que le service n'a pas : limite de débit, budget de temps, taille bornée,
cache. C'est la règle du dossier de décisions — « exposer `nie-model-serve` nu : jamais » — et
la façade directe en était l'exception.

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
    ~/niers/deploy/nginx/aphrody.com.conf > vhost.conf
printf 'events {}\nhttp { include %s/vhost.conf; }\n' "$PWD" > nginx.conf
nginx -t -c "$PWD/nginx.conf"
```

Attendu : **`syntax is ok`**. L'échec qui suit — `open() "/run/nginx.pid" failed (13)` — est
normal en non-root et arrive **après** la validation : la configuration a été lue et chargée.

## systemd

| Unité | Ce qu'elle sert |
|---|---|
| `nie-site.service` | le site, `127.0.0.1:8085`, derrière nginx |
| `nie-model-serve.service` | le décodage des fichiers du jeu à la volée, `127.0.0.1:8790` |
| `nie-cron.service` | le démon de tâches (`packages/cron`) |
| `nie-miroir.service` + `.timer` | la rotation nocturne du miroir des données extraites, à 04:10 UTC |
| `nie-miroir-cloud.service` + `.timer` | la même, vers l'origine distante |
| `azalee-web.service`, `azalee-web-b.service` | le site du wiki, en bleu/vert (deux emplacements, un seul actif) |
| `azalee-api.service` | l'API du wiki |
| `rg-storage`, `rg-realtime`, `rag-api` | le socle du wiki en Bun natif |
| `rg-mcp.service` | le serveur MCP |

## Ce qui n'est PAS ici, et pourquoi

La machine porte aussi les unités `bxc-*` et `rg-*` (CDN, postgrest, sauvegarde, watchdogs) et
les vhosts `rosegriffon.conf`, `cdn.rosegriffon.conf`, `supabase*`, `studio.*`. Ils
appartiennent aux dépôts `bxc` et `rg` : les recopier ici créerait une seconde source de vérité
pour des fichiers que ce dépôt ne modifie pas. La frontière est celle du 2026-09-05 — Codex
tient `rg`, ce dépôt tient `niers`.

## Avant de renommer ou de déplacer quoi que ce soit

`nie-miroir.service` cible **en dur** `scripts/donnees/miroir-inagle.sh`, son timer est actif,
et son `ExecStartPost` redémarre `nie-model-serve`. Déplacer ce script casse la rotation du
miroir, et la réparation demande un `daemon-reload` — donc l'accord de l'utilisateur. C'est
pour cette raison que `scripts/donnees/` n'a pas été anglicisé.

```bash
systemctl list-unit-files | grep -E 'azalee|nie-|rg-'   # ce qui est installé
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
