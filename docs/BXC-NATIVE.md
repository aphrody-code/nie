# BXC natif dans nie

Le moteur navigateur BXC reste externe à nie et n'est plus accompagné d'une couche
de service Bun locale. Les anciens services IETV, Zukan, Wonderbot et iecrawl ont été
retirés ; les contrats média utiles sont réunis dans `packages/nie-media`, sans scraper,
bot ni service résident. Nie conserve ses contrats et sa logique pure maintenus côté Rust/Bun.

## Installation Windows vérifiée

Le tag BXC `v0.9.7` est actuellement une release source sans asset GitHub.
Le binaire a donc été construit depuis le checkout BXC tagué, puis installé
dans `%USERPROFILE%\.bxc\bin\bxc.exe`. Vérification effectuée :

```powershell
bxc --version # bxc 0.9.7
```

Le chemin `%USERPROFILE%\.bxc\bin` doit précéder les anciens chemins BXC dans
le PATH utilisateur. Les appels de recon peuvent être forcés explicitement :

```powershell
$env:BXC_BIN = "$env:USERPROFILE\.bxc\bin\bxc.exe"
$env:BXC_CWD = "$env:USERPROFILE\.bxc\bin"
```

`BXC_CWD` est important dans ce monorepo : le binaire standalone ne doit pas
hériter du `bunfig.toml` de nie, qui précharge le plugin de formats IEVR.

## Paquet TypeScript

Les imports `@aphrody/bxc` restent intentionnellement sur `0.9.6`, dernière
version effectivement publiée au registre au moment de cette migration. Ils
seront relevés vers `0.9.7` dès que le paquet npm correspondant sera publié ;
le CLI natif vérifié est déjà `0.9.7`.

Les secrets, cookies, profils CDP et bases BXC restent hors dépôt.

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `hash_name` — VFS and network endpoint hashes
- `function` — network client and Steam backend bindings in `nie.exe`
- `coverage` — coverage metrics
- `xref` — call graphs for network telemetry

Key binary functions:
- `0x140435320` — Network session dispatcher
- `0x1406d5840` — Async event loop
