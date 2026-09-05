# `deploy/` — les unités systemd

13 unités décrivant ce qui tourne en production sur le VPS Linux. Ce dossier est la
**source** ; `/etc/systemd/system/` en est la copie installée. Les deux peuvent diverger,
et c'est `systemctl` qui fait foi sur ce qui est actif.

| Unité | Ce qu'elle sert |
|---|---|
| `azalee-web.service`, `azalee-web-b.service` | le site du wiki, en bleu/vert (deux emplacements, un seul actif) |
| `azalee-api.service` | l'API du wiki |
| `nie-model-serve.service` | le serveur d'assets, qui décode les fichiers du jeu à la volée |
| `nie-cron.service` | le démon de tâches (`packages/cron`) |
| `nie-miroir.service` + `.timer` | la rotation nocturne du miroir des données extraites, à 04:10 UTC |
| `rg-cdn`, `cdn-variants` | le CDN d'images et ses variantes |
| `rg-storage`, `rg-realtime`, `rag-api` | le socle du wiki en Bun natif |
| `rg-mcp.service` | le serveur MCP |

## Avant de renommer ou de déplacer quoi que ce soit

`nie-miroir.service` cible **en dur** `scripts/donnees/miroir-inagle.sh`, son timer est
actif, et son `ExecStartPost` redémarre `nie-model-serve`. Déplacer ce script casse la
rotation du miroir, et la réparation demande un `daemon-reload` — donc l'accord de
l'utilisateur. C'est pour cette raison que `scripts/donnees/` n'a pas été anglicisé.

```bash
systemctl list-unit-files | grep -E 'azalee|nie-|rg-'   # ce qui est installé
systemctl --failed                                       # ce qui est tombé
```

Le déploiement du site se fait **en bleu/vert** par `scripts/ops/deploy.ts`, jamais par un
`restart` : un redémarrage sec sert une version à moitié construite. Après un build Next,
la copie de `.next/static` est obligatoire — la sauter rend un site sans style, sans
qu'aucune erreur ne le dise.
