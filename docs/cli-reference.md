# Référence des Commandes CLI

Commandes à implémenter avec CLI11, reproduisant l'interface de la version C#.

## Options globales

| Option | Alias | Type | Défaut | Description |
|--------|-------|------|--------|-------------|
| `--game` | `-g` | string | Auto-detect Steam | Chemin vers le dossier du jeu |
| `--verbose` | `-v` | flag | false | Sortie détaillée + stack traces |

## Commandes

### dump — Extraction CPK complète

```
iecode dump -g <game_path> -o <output> [options]
```

| Option | Alias | Type | Défaut | Description |
|--------|-------|------|--------|-------------|
| `--output` | `-o` | string | **requis** | Dossier de sortie |
| `--smart` | `-s` | bool | true | Skip fichiers existants (resume) |
| `--threads` | `-t` | int | CPU count | Threads parallèles |
| `--no-loose` | | flag | false | Ne pas copier les fichiers loose |

### extract — Extraction CPK unitaire

```
iecode extract <cpk> -g <game_path> -o <output> [options]
```

| Argument/Option | Type | Description |
|-----------------|------|-------------|
| `cpk` | string (requis) | Chemin vers le fichier CPK |
| `--output`, `-o` | string (requis) | Dossier de sortie |
| `--filter` | string | Pattern de filtre (ex: `*.g4tx`) |
| `--list` | flag | Lister uniquement, sans extraire |

### pack — Pack mod

```
iecode pack <input> -o <output> [options]
```

| Argument/Option | Type | Description |
|-----------------|------|-------------|
| `input` | string (requis) | Dossier mod à packer |
| `--output`, `-o` | string (requis) | Dossier de sortie |
| `--cpklist` | string | Chemin vers cpk_list.cfg.bin |
| `--platform` | string | `PC` ou `SWITCH` (défaut: `PC`) |

### config — Configuration cfg.bin

```
iecode config <subcommand> [options]
```

#### Sous-commandes

| Sous-commande | Arguments | Options | Description |
|---------------|-----------|---------|-------------|
| `read` | `file` (requis) | `-o` output | Lire cfg.bin → JSON |
| `info` | `file` (requis) | | Afficher infos cfg.bin |
| `cpklist` | | `-o` output | Lire cpk_list |
| `list` | | | Lister les configs |
| `search` | `file`, `pattern` (requis) | | Chercher dans cfg.bin |
| `decrypt` | `file` (requis) | `-o` output | Déchiffrer cfg.bin |
| `encrypt` | `file` (requis) | `-k` key, `-o` output | Chiffrer cfg.bin |
| `convert` | `path` (requis) | `-r` recursive | Convertir cfg.bin ↔ JSON |
| `loose` | `path` (requis) | `--size` | Fichier loose |
| `restore-loose` | | | Restaurer fichiers loose |

### crypto — Chiffrement/déchiffrement CRI

```
iecode crypto decrypt <file> -o <output>
iecode crypto encrypt <file> -o <output> --key <hex_key>
```

| Argument/Option | Type | Description |
|-----------------|------|-------------|
| `file` | string (requis) | Fichier à traiter |
| `--output`, `-o` | string (requis) | Fichier de sortie |
| `--key` | string | Clé hex (encrypt uniquement, ex: `0x1717E18E`) |

### pipeline — Pipeline complet

```
iecode pipeline -g <game_path> [options]
```

| Option | Type | Défaut | Description |
|--------|------|--------|-------------|
| `--output`, `-o` | string | `data/extracted` | Dossier de sortie |
| `--packs`, `-p` | string | `game/data/packs` | Dossier packs |
| `--convert`, `-c` | bool | true | Convertir les formats binaires |
| `--delete-cpk` | flag | false | Supprimer CPK après extraction |
| `--delete-binary` | flag | false | Supprimer binaires après conversion |
| `--parallel-cpks` | int | CPU/2 | CPKs en parallèle |
| `--parallel-conversions` | int | CPU*2 | Conversions en parallèle |
| `--no-resume` | flag | false | Repartir de zéro |
| `--pattern` | string | `*.cpk` | Pattern fichiers CPK |
| `--no-recursive` | flag | false | Ne pas chercher en sous-dossiers |

### g4tx — Textures

```
iecode g4tx <file> [options]
```

Parse et exporte les textures G4TX en PNG.

### g4mg — Modèles 3D

```
iecode g4mg <file> [options]
```

Parse et exporte les modèles G4MG en GLB.

### g4md — Métadonnées modèle

```
iecode g4md <file> [options]
```

### g4pk — Packages

```
iecode g4pk <file> [options]
```

### g4ra — Archives

```
iecode g4ra <file> [options]
```

### agi — Animations

```
iecode agi <file> [options]
```

### utf — Tables CRI UTF

```
iecode utf <file> [options]
```

### info — Informations jeu

```
iecode info -g <game_path> [--json]
```

### analyze — Analyse structure

```
iecode analyze -g <game_path> [-o report.json] [--deep]
```

### convert — Conversion batch

```
iecode convert [options]
```

Conversion batch cfg.bin → JSON.

### format — Détection format

```
iecode format <file>
```

Détecte le format d'un fichier par magic bytes.

### search-char — Recherche personnages

```
iecode search-char [options]
```

Recherche de personnages dans les données Level-5.

### dump-gamedata — Dump game data

```
iecode dump-gamedata [options]
```

Dump de types de données spécifiques vers JSON avec modèles typés.

### generate-classes — Génération de classes

```
iecode generate-classes [options]
```

Génère des classes C# depuis les fichiers JSON gamedata.

### benchmark — Benchmarks

```
iecode benchmark [options]
```

### passive — Skills passifs

```
iecode passive <subcommand>
```

| Sous-commande | Options | Description |
|---------------|---------|-------------|
| `analyze` | `--skill-config`, `--effect-config`, `-o`, `--build-type` | Analyser les skills |
| `buildtypes` | | Lister les types de build |
| `help` | | Aide |

## Codes de retour

| Code | Signification |
|------|---------------|
| 0 | Succès |
| 1 | Erreur générique |
| 2 | Arguments invalides |
