# Référence des Formats de Fichiers

Formats propriétaires utilisés par Inazuma Eleven: Victory Road (nie.exe).

## Formats Criware (CRI Middleware)

### CPK — CRI Package Archive

| Champ | Valeur |
|-------|--------|
| Magic | `CPK ` (0x43504B20) |
| Endianness | Little-endian |
| Structure | Header → TOC (@UTF table) → Content |
| Compression | Optionnelle (CRILAYLA par fichier) |
| Encryption | XOR (clé = CRC32 du nom de fichier) |

**TOC** : Table @UTF contenant `FileName`, `FileOffset`, `FileSize`, `ExtractSize`, `Directory`.
Si `FileSize != ExtractSize`, le fichier est compressé en CRILAYLA.

**Clé de chiffrement IEVR** : `0x1717E18E` (clé par défaut, découverte par Viola).

### @UTF — CRI Universal Table Format

| Champ | Valeur |
|-------|--------|
| Magic | `@UTF` (0x40555446) |
| Endianness | Big-endian |
| Encoding | 0x09 = Shift-JIS (CP932), sinon UTF-8 |
| Base offset | 0x08 |
| Column table | Offset 0x20 |

Structure : Header → Metadata → Columns → Rows → String pool.

### USM — CRI Movie Container

| Champ | Valeur |
|-------|--------|
| Magic | `CRID` |
| Streams | `@SFV` (H.264), `@SFA` (HCA audio), `@ALP` (alpha), `@SBT` (subtitles), `@CUE` |
| Header per chunk | 0x18 bytes (stripped on demux) |

### CRILAYLA — CRI Compression

| Champ | Valeur |
|-------|--------|
| Magic | `CRILAYLA` (ASCII) |
| Algorithm | LZSS avec encodage Fibonacci variable-length |
| Direction | Décompression arrière (de la fin vers le début) |
| Bit encoding | 1 bit flag (1=copie, 0=littéral), 13 bits offset, Fibonacci length (2,3,5,8 bits) |

## Formats Level-5

### G4TX — Texture Container

| Champ | Valeur |
|-------|--------|
| Magic | `G4TX` (0x47345458) |
| Header size | 0x60 bytes |
| Entry size | 0x30 bytes par texture |
| Sub-entry | 0x18 bytes (atlas regions) |
| Contenu | Chunks NXTCH |

### NXTCH — Nintendo Switch Texture Chunk

| Champ | Valeur |
|-------|--------|
| Magic | `NXTCH` (ASCII, 5 bytes) |
| Header size | 44 bytes |
| Formats | BC1, BC2, BC3, BC4, BC5, BC6H, BC7, RGBA8 |
| Swizzling | Tegra X1 block-linear (GOB layout) |

**Formats de texture (G4TX format int → BCn)** :

| G4TX Format | Nom | Block size | BPP |
|-------------|-----|-----------|-----|
| 0x18 | BC1 (DXT1) | 4x4 | 4 |
| 0x19 | BC2 (DXT3) | 4x4 | 8 |
| 0x1A | BC3 (DXT5) | 4x4 | 8 |
| 0x1B | BC4 | 4x4 | 4 |
| 0x1C | BC5 | 4x4 | 8 |
| 0x1D | BC6H | 4x4 | 8 |
| 0x1E | BC7 | 4x4 | 8 |
| 0x20 | RGBA8 | 1x1 | 32 |

### G4MG — Mesh Geometry

| Champ | Valeur |
|-------|--------|
| Magic | `G4MG` (0x474D3447, little-endian) |
| Header size | 0x40 bytes |
| Contenu | Mesh entries → vertex buffer + index buffer |
| Note | Pas de string ASCII dans nie.exe — magic vérifié par valeur numérique 0x474D3447 |

**Vertex format flags** : Position, Normal, UV0, UV1, Color, BoneWeights, BoneIndices.
Le stride est calculé dynamiquement selon les flags actifs.

### G4MD — Model Metadata

| Champ | Valeur |
|-------|--------|
| Magic | `G4MDP` (5 bytes, confirmé à `0x141c01840` dans .rdata nie.exe) |
| Header size | 0x44+ bytes |
| Endianness interne | Big-endian (converti en LE au parsing) |
| Sections | VertexData, FaceData, BoneData (à base+offset) |

### G4SK — Skeleton

| Champ | Valeur |
|-------|--------|
| Magic | `G4SK@` (5 bytes, confirmé à `0x141c00fb0` dans .rdata nie.exe) |
| Contenu | Liste de bones avec name + parent index |

### G4MT — Materials

| Champ | Valeur |
|-------|--------|
| Magic | `G4MT` (0x544D3447 LE = bytes `G4MT`, confirmé depuis animation_play_anime) |
| Type enum | Animation dispatch type 2 = G4MT reference |
| Contenu | Entries avec offset/size → data blocks |

### G4PK — Package Archive

| Champ | Valeur |
|-------|--------|
| Magic | `G4PK@` (5 bytes, confirmé à `0x141c03290` dans .rdata nie.exe) |
| Header size | 0x40 bytes |
| Tables | File entries, hash table, string table |

### G4RA — Resource Archive

| Champ | Valeur |
|-------|--------|
| Magic | `` G4RA` `` (5 bytes avec backtick 0x60, confirmé à `0x141c017b0` dans .rdata nie.exe) |
| Contenu | Entry table + string table, avec runtime pointers et refcount |

### AGI — Animation

| Champ | Valeur |
|-------|--------|
| Magic | `AGI.` (0x2E494741) ou `.IGA` |
| Contenu | Frames, tracks, events, transforms (position X/Y, dimensions, flags) |

### cfg.bin — Configuration

| Champ | Valeur |
|-------|--------|
| Encryption | XORShift (Matsumoto-Kurita, seed dans les 4 derniers octets) |
| CRC32 | À offset -8 depuis la fin |
| Footer pattern | `0x01 0x74 0x32 0x62 0xFE` |
| Structure | Entries hiérarchiques (clé-valeur, typées) |

### RDBN — Modern Config

| Champ | Valeur |
|-------|--------|
| Magic | `RDBNP` (5 bytes, confirmé à `0x141c00ff0` dans .rdata nie.exe) |
| Sections | Root entries, Types, Fields, Strings (hash+offset), Values |
| Offset calculation | Multiply by 4, add data offset base |
| Taille parser | ~50 KB (FUN_1401c1430), 313+ références `RDBNP` dans nie.exe |

## Système de Fichiers Virtuel (VFS)

Le jeu utilise un VFS monté via CRI File System avec le préfixe `#/`.

| Champ | Valeur |
|-------|--------|
| Préfixe | `#/` → résolution par hash CRC32 (`FUN_1402b5cb0`) |
| Préfixe CPK | `C[cpk_name]` → lookup dans le binder CPK spécifique |
| Config défaut | 16 fichiers max, chemins 256 chars, 16 binds |
| Résolveur | `FUN_140ef7980` — hash puis binder lookup |

### Structure des assets VFS

| Chemin | Contenu |
|--------|---------|
| `#/chr/_uniform/` | Uniformes (ex: `n000201_10.g4tx`) |
| `#/effect/` | Effets visuels |
| `#/font/<LG>/` | Polices localisées |
| `#/map/ar/ao*/` | Areas outdoor (ao001–ao403) |
| `#/map/ar/gr*/` | Terrain (gr001–gr080) |
| `#/map/ar/pl*/` | Places (pl001–pl339) |
| `#/menu/220_img/` | Images menus, portraits, stades, saves |
| `#/shader/<SHADER_VERSION>/shader_list.cfg.bin` | Liste de shaders (version dynamique) |

Placeholders runtime : `<LG>` (langue), `<EVENT>`, `<SHADER_VERSION>`, `%s`.

**Note** : Les polices gaiji pour NX (Switch) sont présentes dans le binaire malgré l'absence d'une version Switch publiée (`vfs_font_gaiji_loader.c` charge 8 plateformes : PS4/PS5/Xbox/SteamDeck/Key/NX/Game/Game2).

## Réseau — Epic Online Services (EOS)

| Champ | Valeur |
|-------|--------|
| Backend | **EOS** (Epic Online Services), **pas** un serveur Level-5 propriétaire |
| Chargement | Fonctions EOS chargées dynamiquement via `GetProcAddress` à runtime |
| Lobbies | API version 10, max members, BucketId, attribut `"DATA_VERSION"` |
| Callbacks | 3 notifications : update lobby, member update, member status |
| Lua bridge | 39 commandes réseau via `funcLuaMenuNetworkCommand` |

## Audio — CRI Middleware

| Champ | Valeur |
|-------|--------|
| CRI Atom Ex | v2.29.4 (build juillet 2025) |
| CRI File System | v2.88.15 |
| Surround | 5.1 surround pour les cinématiques (Sofdec2/USM, 6 canaux) |
| Typo binaire | `"CriManaSoundAtomEx_AtomExPlaeyer"` (faute dans le source Level-5) |

## Compression utilisée dans les formats

| Contexte | Algorithme |
|----------|-----------|
| Fichiers dans CPK | CRILAYLA |
| Données internes Level-5 | LZ10 (LZSS Nintendo) |
| Formats modernes Level-5 | LZ4 block |
| cfg.bin | XORShift (pas compression, chiffrement) |
| Textures | BCn (BC1-BC7) — décompression GPU, pas LZ |

## Crypto

| Algorithme | Contexte | Clé |
|-----------|----------|-----|
| CRI XOR | Fichiers CPK, assets CRI | CRC32(filename) XOR 0x1717E18E |
| XORShift | cfg.bin | 4-state generator, seed = derniers 4 octets |
| CRC32 | Validation, dérivation de clés | Polynomial 0xEDB88320 |
