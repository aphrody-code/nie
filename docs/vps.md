# Profil VPS & réglages iecode « sur mesure »

Ce document décrit la machine sur laquelle iecode tourne en production data, et comment
les défauts d'exécution s'y adaptent. Il sert de référence pour le tuning et le
dépannage. Les valeurs sont un instantané (à réactualiser si le VPS change).

## Matériel & contraintes réelles

| Ressource | Valeur | Conséquence pour iecode |
|---|---|---|
| **CPU** | 12 vCPU — Intel Haswell, 1 thread/cœur (pas d'HT), pas de TSX/AVX-512 (AVX2 ok) | Parallélisme utile ≈ 12, mais voir « partagé » ci-dessous |
| **Machine partagée** | load voisin observé **~6.5/12** au repos d'iecode | Réclamer 12 threads sur-souscrit CPU → on dimensionne sur les cœurs **libres** |
| **RAM** | 45 Gi total, **~23 Gi disponibles**, swap 4 Gi | Marge large pour buffers I/O et pools — à exploiter pour la vitesse |
| **Disque** | `/dev/sda1`, 193 G, **~64 G libres**. **Mono-disque** (OVH) | Les I/O parallèles se disputent un seul disque → le dump plafonne les CPK concurrents ; le dump doit être **disk-aware** |
| **Réseau** | OVH FR. CDN Steam servi par l'edge **Paris** (`cache*-par1.steamcontent.com`, IPv6) | Download proche, faible latence |

## Emplacements canoniques

Définis dans `.secrets/steam.env` (gitignoré) — cohérents entre download / dump / inagle :

| Variable | Chemin | Rôle |
|---|---|---|
| `IEVR_GAME_DIR` | `~/.local/share/Steam/iecode/inazuma` | Install du jeu (921 CPK, ~57 G) |
| `STEAM_TOKEN_STORE` | `~/.local/share/iecode/steam-tokens.json` | Refresh token (re-login sans 2FA) |
| `DUMP_OUT` | `~/.local/share/iecode/dump` | Sortie d'extraction CPK |
| `DATA_PATH` | `~/data` | Corpus + images lus par inagle (symlinks → install) |

## Adaptation automatique : `HostProfile`

`src/IECODE.Core/Runtime/HostProfile.cs` centralise les défauts au lieu de hardcoder
`Environment.ProcessorCount` partout. Deux propriétés, toutes deux surchargeables par env :

### `HostProfile.Parallelism` — degré de parallélisme par défaut
- Lit la charge système (`/proc/loadavg`, 1 min) et ne réclame que les cœurs **réellement
  libres** : `floor(cores - load1)`, borné `[2, cores]`. iecode reste ainsi bon voisin sur
  le VPS partagé sans tomber à 1 thread.
- Sur ce VPS (load ~6.5/12), le défaut calculé ≈ **5–6 threads** plutôt que 12.
- **Override** : `IECODE_PARALLELISM=<n>` (honoré tel quel — pour saturer la machine quand
  elle est à toi, ex. `IECODE_PARALLELISM=12`).
- Câblé dans : chunks de download (`SteamDownloadOptions.MaxDownloads`), extraction CPK
  (`DumpService.MaxParallelism`, `CpkService.ExtractAllAsync`), options CLI `--threads`.

### `HostProfile.IoBufferBytes` — taille des buffers I/O séquentiels
- Défaut **1 Mo** (vs 128 Ko avant) : sur un disque unique avec RAM large, des buffers plus
  gros réduisent le nombre de syscalls en lecture CPK / écriture chunks.
- **Override** : `IECODE_IO_BUFFER=<Ko>`.

## Recommandations de réglage

| Scénario | Réglage |
|---|---|
| **VPS partagé (défaut)** | Ne rien forcer — `HostProfile` s'ajuste à la charge. |
| **Machine à toi / nuit** | `IECODE_PARALLELISM=12` pour saturer les 12 cœurs. |
| **Dump volumineux** | Vérifier l'espace : un dump *complet* (décompressé) dépasse 64 G ; préférer un preset (`inagle`/`azalee`/`inagle-azalee`). Le dump est disk-aware (cf. `DumpService`). |
| **I/O lentes** | Augmenter `IECODE_IO_BUFFER` (ex. `4096` = 4 Mo) ; ne pas monter les CPK concurrents (mono-disque). |

## Audit réseau (endpoints Steam du download)

Capturé via `strace -e connect -yy` + `ss` pendant un login + résolution depots. Tout en
TLS/chiffré, surface minimale (3 hosts, 2 ports) :

| Service | Host | Port | Rôle |
|---|---|---|---|
| WebAPI Directory | `api.steampowered.com` (Akamai) | 443 | bootstrap → liste des CM |
| CM | `*.valve.net` | 27017 | auth, PICS, manifest codes, depot keys |
| CDN SteamPipe | `cache*-par1.steamcontent.com` (edge Paris, IPv6) | 443 | manifests + chunks |
