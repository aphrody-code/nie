# Formats et données du jeu

Référence des formats propriétaires d'IEVR, et état de leur exploitation par `nie-formats`.

## Le VFS

**255 308 fichiers** répartis dans **936 CPK**, montés par CRI File System sous le préfixe `#/`.
Sur l'installation Steam Windows, le VFS **est le répertoire courant** : `resolve_game_dir()` le
détecte via `data/cpk_list.cfg.bin`. `Vfs::init()` prend `<racine>/data`, pas la racine.

**Un dump extrait se monte à la place des packs**, et sert les mêmes chemins logiques
(`data/common/…`) : `Vfs::init` y bascule seule quand `cpk_list.cfg.bin` manque mais que
`common/`/`dx11/` sont là, `NIE_DUMP_DIR` le force. Un dump local couvre 255 308 / 255 308 chemins
de l'index (100,000 %, mesuré le 2026-08-28) et rend des octets identiques à l'extraction.

Inspection : `niers vfs ls|find|stat|cat|extract|stats|formats`.

**Ce que le dépôt sait réellement lire** — `niers vfs formats --parse` sur les 255 316 fichiers du
dump (2026-08-28) :

| Catégorie | Fichiers | Part |
|---:|---|---:|
| Décodés par un parseur | 224 497 | **87,93 %** |
| Magic connu, sans décodeur autonome (`@UTF`, `AWB`, `USM`) | 11 215 | 4,39 % |
| Ni magic ni parseur (dont ~15 900 `.g4mg`) | 19 604 | 7,68 % |
| Illisibles | 0 | 0 % |

Un `.g4mg` n'a pas de magic et n'est pas décodable seul : c'est un tampon de sommets brut dont la
structure vit dans le `.g4md` frère. Le compter comme « format manquant » serait faux.

| Champ | Valeur |
|---|---|
| Préfixe | `#/` → résolution par hash CRC32 |
| Préfixe CPK | `C[cpk_name]` → lookup dans le binder du CPK |
| Config par défaut | 16 fichiers max, chemins de 256 caractères, 16 binds |

Placeholders runtime dans les chemins : `<LG>` (langue), `<EVENT>`, `<SHADER_VERSION>`, `%s`.

### Répartition par extension

| Fichiers | Extension | Contenu | Module `nie-formats` |
|---:|---|---|---|
| 72 308 | `.bin` | configurations et tables (`cfg.bin`) | `cfgbin` |
| 54 203 | `.g4tx` | textures | `g4tx`, `g4tx_decode` |
| 45 591 | `.g4pk` | archives de packages | `g4pk` |
| 21 047 | `.p3lip` | lip-sync des voix | `lip` |
| 15 876 | `.g4mg` | géométrie de maillage | `g4mg` |
| 12 190 | `.objbin` | objets de menu et de scène | `objbin` |
| 8 956 | `.g4md` | métadonnées de modèle | `g4md` |
| 6 992 | `.g4pkm` | packages de motion | `g4pkm`, `g4pkm_motion` |
| 5 512 + 5 512 | `.awb` / `.acb` | banques audio | `cri_audio` |
| 1 335 + 1 113 + 29 + 20 | `.vfxo` / `.pfxo` / `.cfxo` / `.gfxo` | shaders compilés (DXBC) | `dxbc` |
| 1 217 | `.g4cm` | caméras de cutscene | `g4cm` (+ crate `nie-camera`) |
| 1 150 | `.col` | collision de map (PXCL) | `col` |
| 657 | `.ptlb` | tables de particules | — |
| 372 | `.fxbin` | binaires d'effet | — |
| 339 | `.g4sk` | squelettes | `g4sk` |
| 328 | `.mevbin` | motion-events | `mevbin` |
| 194 | `.usm` | vidéos Sofdec2 | `cri_audio` |
| 160 | `.g4nv` | navmesh | `navm` |
| 71 | `.g4mt` | matériaux | `g4mt` |
| 39 | `.clobin` | physique de tissu | — |
| 35 | `.g4ma` | animation de matériau | `g4ma` |
| 16 | `.linb` | — | — |
| 9 | `.g4tg` | textures d'effet | — |
| 4 + 4 | `.g4vs` / `.g4la` | effets et lumières d'événement | `g4vs`, `g4la` |

**1 121 fichiers (0,44 %)** restent sans parser : `.ptlb`, `.fxbin`, `.clobin`, `.g4tg`, `.linb`,
et une poignée d'extensions numérotées `.r*`.

### Racines de données

`data/common/` — `action`, `camera`, `chr`, `craft`, `effect`, `event`, `event_cfg`, `font`,
`gamedata`, `input`, `map`, `menu`, `movie`, `property`, `script`, `sound`, `sound_asset`,
`system`, `text`. `data/dx11/` porte les variantes PC des assets graphiques (menu, chr, map,
effect, shader, movie, font).

Deux formats se cachent derrière `.cfg.bin` : **RDBN** à listes (`cfgbin::is_rdbn` → `parse` +
`read_values`) et **T2B** (`cfgbin::cfgbin_parse`, arbre `CfgEntry`). Tout `common/property/**`
est du T2B.

## Formats Criware

### CPK — CRI Package Archive

| Champ | Valeur |
|---|---|
| Magic | `CPK ` (`0x43504B20`), little-endian |
| Structure | Header → TOC (@UTF) → contenu |
| Compression | CRILAYLA, optionnelle par fichier |
| Chiffrement | XOR, clé = CRC32 du nom de fichier |

Le TOC est une table @UTF portant `FileName`, `FileOffset`, `FileSize`, `ExtractSize`,
`Directory`. Si `FileSize != ExtractSize`, le fichier est compressé.

Clé par défaut IEVR : `0x1717E18E`. Il n'y a **ni clé non publique ni enveloppe** : les 936 CPK
se déchiffrent avec CRC32(nom de fichier).

### @UTF — CRI Universal Table Format

Magic `@UTF` (`0x40555446`), **big-endian**. Encodage `0x09` = Shift-JIS (CP932), sinon UTF-8.
Base offset `0x08`, table de colonnes à `0x20`. Structure : header → métadonnées → colonnes →
lignes → pool de chaînes.

### USM — conteneur vidéo Sofdec2

| Champ | Valeur |
|---|---|
| Magic | `CRID` |
| Flux | `@SFV` (**VP9**), `@SFA` (HCA), `@ALP` (alpha), `@SBT` (sous-titres), `@CUE` |
| En-tête par chunk | 0x18 octets, retirés au démux |

> Le flux vidéo est **VP9**, pas H.264. Le RE établit qu'aucun chemin H.264 n'existe dans
> `nie.exe` : le décodeur est libvpx via criVvp9. Toute doc ou étiquette annonçant H.264 est
> fausse.

### CRILAYLA — compression CRI

LZSS à encodage Fibonacci de longueur variable. Magic `CRILAYLA` en ASCII, **décompression
arrière** (de la fin vers le début) : 1 bit de flag (1 = copie, 0 = littéral), 13 bits d'offset,
longueur en Fibonacci (2, 3, 5, 8 bits).

## Formats Level-5

Les magics marqués « confirmé » ont été localisés dans `.rdata` de `nie.exe`.

| Format | Magic | Détail |
|---|---|---|
| **G4TX** — textures | `G4TX` (`0x47345458`) | Header 0x60, entrée 0x30 par texture, sous-entrée 0x18 (régions d'atlas), contenu en chunks NXTCH |
| **NXTCH** — chunk de texture | `NXTCH` (5 o) | Header 44 o, BC1–BC7 et RGBA8, swizzle Tegra X1 block-linear |
| **G4MG** — géométrie | `0x474D3447` (numérique) | Header 0x40, entrées de maillage → vertex buffer + index buffer. Stride calculé dynamiquement selon les flags actifs (Position, Normal, UV0, UV1, Color, BoneWeights, BoneIndices) |
| **G4MD** — modèle | `G4MDP` (confirmé `0x141c01840`) | Header 0x44+, endianness interne big-endian convertie au parsing, sections VertexData / FaceData / BoneData |
| **G4SK** — squelette | `G4SK@` (confirmé `0x141c00fb0`) | Liste d'os : nom + index du parent |
| **G4MT** — matériaux | `G4MT` | Entrées offset/taille → blocs de données ; type 2 du dispatch d'animation |
| **G4PK** — archive | `G4PK@` (confirmé `0x141c03290`) | Header 0x40, tables de fichiers, de hachage et de chaînes |
| **G4RA** — ressources | `` G4RA` `` (confirmé `0x141c017b0`) | Table d'entrées + table de chaînes, avec pointeurs runtime et refcount |
| **RDBN** — config moderne | `RDBNP` (confirmé `0x141c00ff0`) | Sections Root / Types / Fields / Strings (hash+offset) / Values. Offsets × 4 + base |
| **PXCL** — collision | — | `.col`, maps `common/` et `dx11/` |
| **G4NV** — navmesh | — | `.g4nv` |
| **MEVBIN** — motion-events | `MEVBIN` | Déclencheurs d'animation indexés par code de personnage |
| **OBJB** — objets-menu | `OBJB` | Définitions d'objets de menu |

### `cfg.bin` — configuration

| Champ | Valeur |
|---|---|
| Chiffrement | XORShift (Matsumoto-Kurita), graine dans les 4 derniers octets |
| CRC32 | à l'offset −8 depuis la fin |
| Footer | `01 74 32 62 FE` |
| Structure | Entrées hiérarchiques clé-valeur typées |

## Réseau — Epic Online Services

Le backend en ligne est **EOS**, pas un serveur Level-5 propriétaire. Les fonctions EOS sont
chargées dynamiquement par `GetProcAddress`. Lobbies en API version 10 (max members, BucketId,
attribut `DATA_VERSION`), trois callbacks de notification (update lobby, member update, member
status). Le pont Lua expose 39 commandes réseau via `funcLuaMenuNetworkCommand`.

## Audio

CRI Atom Ex v2.29.4, CRI File System v2.88.15. Surround 5.1 sur les cinématiques (6 canaux).
La clé HCA d'IEVR est `0x00D2997C0DC5EE72`.

> Curiosité utile au RE : le binaire contient la faute de frappe
> `"CriManaSoundAtomEx_AtomExPlaeyer"`, présente dans le source Level-5.

## Compression et crypto

| Contexte | Algorithme |
|---|---|
| Fichiers dans un CPK | CRILAYLA |
| Données internes Level-5 | LZ10 (LZSS Nintendo) |
| Formats Level-5 modernes | LZ4 block |
| Textures | BCn (BC1–BC7) — décompression GPU, pas LZ |

| Algorithme | Contexte | Clé |
|---|---|---|
| XOR CRI | fichiers CPK, assets CRI | CRC32(nom) XOR `0x1717E18E` |
| XORShift | `cfg.bin` | générateur à 4 états, graine = 4 derniers octets |
| CRC32 | validation, dérivation de clés | polynôme `0xEDB88320` |

Attention : `crc32` (avec complément final) et `crc32_nie` (accumulateur brut) sont **deux
fonctions distinctes** — cf. les fusions interdites dans [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Note sur les polices

Les polices gaiji pour Switch sont présentes dans le binaire malgré l'absence de version Switch
publiée : le loader couvre huit plateformes (PS4, PS5, Xbox, SteamDeck, Key, NX, Game, Game2).
Les métriques de glyphes vivent dans `font_def/font.cfg.bin` (T2B, entrées `INF`/`CHR`), pas dans
un `.g4tg` — les pixels sont pré-cuits dans l'atlas `font_def/font.g4tx`.
