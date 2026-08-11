# Plan d'Implémentation par Phases (toolkit C++ — historique)

> **Document historique.** Ce plan a piloté la construction du toolkit C++ `iecode` avant que
> les trois dépôts ne fusionnent. Le plan en vigueur est `docs/PLAN.md` ; la répartition des
> rôles entre langages est `docs/ARCHITECTURE-POLYGLOTTE.md`. Plusieurs phases ci-dessous
> décrivent des capacités que la doctrine confie désormais au Rust ou au C# — les lire comme
> l'état d'un arbre, pas comme une feuille de route.

## Vue d'ensemble

IECODE-CPP est un **outil de modding et reverse engineering complet** pour nie.exe.

| Phase | Contenu | Dépendances | Livrable |
|-------|---------|-------------|----------|
| 1 | Foundation | — | `iecode_core` compile, tests passent |
| 2 | Crypto + CRILAYLA | Phase 1 | Déchiffrement CRI fonctionnel |
| 3 | Parsers Criware | Phase 2 | Extraction CPK complète |
| 4 | Parsers Level-5 | Phase 3 | Tous les formats lus |
| 5 | Converters (lecture) | Phase 4 | G4TX→PNG, G4MG→GLB, cfg.bin→JSON |
| 6 | CLI + Pipeline | Phase 5 | `iecode` CLI fonctionnelle (23 commandes) |
| 7 | Game Data + Decomp | Phase 4 | Données de jeu, bridge Ghidra |
| **8** | **Writers + Packers (modding)** | Phase 5 | Re-pack CPK, rebuild G4TX/G4MG/cfg.bin |
| **9** | **3D Preview (bgfx)** | Phase 8 | Viewer 3D CLI |
| **10** | **Scripting Lua (sol2)** | Phase 8 | Système de mods scriptés |

---

## Phase 1 : Foundation

**Objectif** : Build system fonctionnel, types de base, modules sans dépendances.

### Fichiers à créer

| Fichier C++ | Source C# | Description |
|-------------|-----------|-------------|
| `CMakeLists.txt` (root) | — | CMake root, C++20, vcpkg |
| `vcpkg.json` | — | Manifest dépendances |
| `cmake/CompilerWarnings.cmake` | — | Flags compilation |
| `cmake/SIMDDetect.cmake` | — | Détection AVX2/SSE2 |
| `src/include/iecode/types.h` | — | Types fondamentaux, endian helpers |
| `src/include/iecode/compression/lz10.h` | `Compression/Lz10Decoder.cs` | Header LZ10 |
| `src/compression/lz10.cpp` | `Compression/Lz10Decoder.cs` | Implémentation LZ10 |
| `src/include/iecode/compression/lz4_block.h` | `Compression/Lz4Decoder.cs` | Header LZ4 |
| `src/compression/lz4_block.cpp` | `Compression/Lz4Decoder.cs` | Implémentation LZ4 |
| `src/include/iecode/crypto/crc32.h` | `Crypto/Crc32.cs` | Header CRC32 |
| `src/crypto/crc32.cpp` | `Crypto/Crc32.cs` | Implémentation CRC32 |
| `src/include/iecode/io/binary_utils.h` | `IO/BinaryUtils.cs` | Header utils |
| `src/io/binary_utils.cpp` | `IO/BinaryUtils.cs` | Implémentation utils |
| `src/decomp/include/src/decomp/compat.h` | — | Typedefs Ghidra/IDA |
| `src/decomp/include/src/decomp/nie_types.h` | — | Structs du jeu |
| `src/decomp/include/src/decomp/bridge.h` | — | Déclarations bridge |
| `src/decomp/src/bridge.cpp` | — | Bridge stub |
| `tests/test_crc32.cpp` | — | Tests CRC32 |
| `tests/test_lz10.cpp` | — | Tests LZ10 |
| `tests/test_lz4.cpp` | — | Tests LZ4 |
| `tests/test_binary_utils.cpp` | — | Tests utils |

### Algorithmes à porter

**CRC32** (`Crypto/Crc32.cs` → `crypto/crc32.cpp`) :
- Table 256 entries, polynomial 0xEDB88320
- `compute(span)` et `compute(seed, span)`
- Port direct : ~50 lignes

**LZ10** (`Compression/Lz10Decoder.cs` → `compression/lz10.cpp`) :
- Circular buffer 4096 bytes
- Flag byte + 8 blocks pattern
- Compressed block : 4-bit length + 12-bit displacement
- Port : ~180 lignes, le CircularBuffer ref struct → classe stack-only

**LZ4 Block** (`Compression/Lz4Decoder.cs` → `compression/lz4_block.cpp`) :
- Token : high 4 bits literal length, low 4 bits match length (+4)
- 0xFF extension bytes
- 16-bit LE match offset
- Overlapping copy (RLE) handling
- Port : ~155 lignes

**Binary Utils** (`IO/BinaryUtils.cs` → `io/binary_utils.cpp`) :
- Shannon entropy (stackalloc int[256] → std::array)
- Hex dump formatter
- XOR decrypt
- Pattern search (SequenceEqual → std::equal)
- Magic bytes detection

### Vérification Phase 1

```bash
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=~/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build build -j$(nproc)
ctest --test-dir build --output-on-failure
```

---

## Phase 2 : Crypto + CRILAYLA

**Objectif** : Pouvoir déchiffrer les fichiers CRI et décompresser CRILAYLA.

### Fichiers à créer

| Fichier C++ | Source C# | Description |
|-------------|-----------|-------------|
| `src/include/iecode/crypto/cri_crypto.h` | `Native/NativeCrypto.cs` | Header crypto CRI |
| `src/crypto/cri_crypto.cpp` | `Native/NativeCrypto.cs` | XOR CRI + SIMD |
| `src/include/iecode/crypto/xorshift.h` | `Crypto/Level5/XorShift.cs` | Header XORShift |
| `src/crypto/xorshift.cpp` | `Crypto/Level5/XorShift.cs` | Implémentation XORShift |
| `src/include/iecode/compression/crilayla.h` | `CriFs/Compression/CriLayla.cs` | Header CRILAYLA |
| `src/compression/crilayla.cpp` | `CriFs/Compression/CriLayla.cs` | Décompression CRILAYLA |
| `tests/test_cri_crypto.cpp` | — | Tests crypto CRI |
| `tests/test_xorshift.cpp` | — | Tests XORShift |
| `tests/test_crilayla.cpp` | — | Tests CRILAYLA |

### Points d'attention

**NativeCrypto** (le plus complexe) :
- Porter d'abord le chemin scalaire (`DecryptBlock` sans SIMD)
- Ajouter les chemins SIMD derrière `#ifdef IECODE_HAS_AVX2` / `IECODE_HAS_SSE2`
- La table CRC32 de 256 entries est identique à celle de `crc32.cpp` → réutiliser
- Clé IEVR : `0x1717E18E`
- Stream decryption avec buffer 4MB

**XORShift** :
- 4-state generator seeded from file footer
- OddPrimes lookup table (256 entries)
- 4096 iterations shuffle phase
- Position-dependent key derivation

**CRILAYLA** :
- Le code C# est déjà en `unsafe` pointer-style → traduction quasi 1:1
- Décompression arrière (lire depuis la fin)
- Encodage Fibonacci : lecture de bits (1, 2, 3, 5, 8 bits)
- Fast path : unrolled 3-8 bytes copy

### Vérification Phase 2

Déchiffrer un fichier CPK connu et comparer le hash avec le résultat C#.

---

## Phase 3 : Parsers Criware

**Objectif** : Lire les archives CPK et extraire des fichiers.

### Fichiers à créer

| Fichier C++ | Source C# | Description |
|-------------|-----------|-------------|
| `src/include/iecode/formats/format_detector.h` | `Formats/FormatDetector.cs` | Détection magic |
| `src/formats/format_detector.cpp` | `Formats/FormatDetector.cs` | |
| `src/include/iecode/formats/criware/utf_parser.h` | `Formats/Criware/UtfParser.cs` | Parser @UTF |
| `src/formats/criware/utf_parser.cpp` | `Formats/Criware/UtfParser.cs` | |
| `src/include/iecode/formats/criware/cpk_reader.h` | `CriFs/CpkReader.cs` + TOC | Reader CPK |
| `src/formats/criware/cpk_reader.cpp` | `CriFs/CpkReader.cs` + TOC | |
| `src/include/iecode/formats/criware/usm_demuxer.h` | `Formats/Criware/UsmDemuxer.cs` | Demux USM |
| `src/formats/criware/usm_demuxer.cpp` | `Formats/Criware/UsmDemuxer.cs` | |

### Dépendances internes

```
cpk_reader → utf_parser (pour lire la TOC)
cpk_reader → crilayla (décompression optionnelle)
cpk_reader → cri_crypto (déchiffrement optionnel)
```

### Vérification Phase 3

```bash
./build/iecode extract -g /path/to/game data_common.cpk -o /tmp/extract
diff -r /tmp/extract /tmp/extract_csharp  # comparer avec extraction C#
```

---

## Phase 4 : Parsers Level-5

**Objectif** : Parser tous les formats propriétaires Level-5.

### Fichiers (11 parsers)

| Parser | Magic | Priorité | Complexité |
|--------|-------|----------|-----------|
| G4TX + NXTCH | `G4TX` | Haute | Moyenne (struct overlay + swizzle) |
| Texture Swizzler | — | Haute | Haute (Tegra X1 block-linear) |
| G4PK | `G4PK` | Haute | Basse (archive simple) |
| cfg.bin | varies | Haute | Haute (encryption + hiérarchie) |
| RDBN | `RDBN` | Haute | Moyenne |
| G4MG | `G4MG` | Moyenne | Haute (vertex formats dynamiques) |
| G4MD | `G4MD` | Moyenne | Moyenne (endian swap) |
| G4SK | `G4SK` | Basse | Basse |
| G4MT | `G4MT` | Basse | Basse |
| G4RA | `G4RA` | Basse | Basse |
| AGI | `AGI.` | Basse | Basse |

### Pattern commun de portage

Tous les parsers Level-5 suivent le même modèle :

1. Vérifier le magic (4 bytes)
2. `reinterpret_cast` le header packed
3. Itérer les entries à offset fixe
4. Extraire les données par sous-span

---

## Phase 5 : Converters (lecture)

**Objectif** : Convertir les formats propriétaires en formats standards.

| Converter | Input → Output | Lib C++ | Remplace (C#) |
|-----------|---------------|---------|---------------|
| Texture | G4TX → PNG | bcdec + stb_image_write | BCnEncoder + ImageSharp |
| Model | G4MG → GLB | tinygltf | SharpGLTF |
| Video | USM → MP4 | ffmpeg (subprocess) | ffmpeg (subprocess) |
| Config | cfg.bin → JSON | nlohmann/json | System.Text.Json |

---

## Phase 6 : CLI + Pipeline

**Objectif** : CLI complète avec toutes les commandes.

23 commandes à implémenter (voir [cli-reference.md](cli-reference.md)).

Pipeline d'extraction parallèle :
- Thread pool avec sémaphore pour limiter la concurrence
- Resume support via manifest (fichier JSON de suivi)
- Progress callbacks

---

## Phase 7 : Game Data + Decomp

**Objectif** : Données de jeu et intégration du code décompilé depuis Ghidra.

### Portage des services C#

- Porter `PassiveSkillService`, `GameDataMapper`, `CharacterNameResolver`
- Définir les structs dans `nie_types.h` au fur et à mesure du reverse engineering

### Intégration Ghidra (pseudo-C → C++)

**Limitation** : Ghidra ne produit que du pseudo-C (pas de mode C++). La conversion vers C++ est manuelle.

Pipeline :

1. **Exporter** depuis Ghidra via `ExportDecompiled.java` → `src/decomp/functions/*.c`
2. **Identifier** les fonctions pertinentes via RTTI (1 234 classes dans `nie-rtti-classes.txt`)
3. **Mapper** les `FUN_XXXXXXXXX` aux classes `game::` / `lives::` connues
4. **Bridge** : écrire des wrappers C++ typés dans `bridge.cpp` avec `extern "C"`
5. **Réécrire** (optionnel) les fonctions bien comprises en C++ propre dans `src/`

### Cibles prioritaires pour la décompilation

| Domaine | Classes RTTI | Statut | Intérêt |
|---------|-------------|--------|---------|
| GDS*Config (268 classes) | `game::GDS*Config` | ✅ RDBN parser exporté (50 KB) | Chargement des données de jeu depuis cfg.bin |
| Soccer gameplay (30+ classes) | `game::CSoccer*` | ✅ 9 fichiers exportés | Logique de match, player stride 0x570 |
| Save system | `game::CGDDPlayData` | ✅ `rpg_savedata.c` 48 KB | Structure `RpgSaveData2` complète |
| Passive skills | `game::GDSPassiveSkill*` | 🔲 À faire | Système de compétences passives |
| Player data | `game::GDSCharaBase` | 🔲 À faire | Stats de base depuis cfg.bin |
| Lua bridge | `game::CObjLuaManager` | ✅ `lua_manager_init.c` 97 KB | 8 familles, 39 commandes réseau |
| Networking | `game::NetworkModule` | ✅ 4 fichiers EOS exportés | EOS lobbies, **pas Level-5 propriétaire** |
| Rendering D3D11 | `lives::CDeviceUnitDX11` | ✅ 8 fichiers exportés | Device init, HDR, tile deferred |
| PhysX 3.4 | `lives::CLivesPx*` | ✅ 4 fichiers exportés | `NpScene` complet |
| Audio CRI | `lives::CCriSoundController` | ✅ 2 fichiers exportés | CRI Atom Ex v2.29.4 |

### Outils d'inspection disponibles

| Outil | Installé | Usage |
|-------|----------|-------|
| Ghidra 12.0.4 | `C:\Users\yohan\ghidra` | Décompilation, analyse interactive |
| Rizin 0.8.2 | `winget` | Analyse PE, RTTI, métadonnées rapides |
| GhydraMCP | `http://localhost:8193/` | API HTTP Ghidra — `/functions`, `/xrefs`, `/decompile` |
| Scripts Ghidra | `scripts/ghidra/` | IECODEAnalyzer, ExportDecompiled, ExportSingleFunction |
| import_nie.ps1 | `scripts/` | Pipeline headless automatisé |

### État actuel (2026-04-05) — 60 fonctions exportées

**60 fonctions décompilées** disponibles dans `docs/ghidra-export/decompiled/` — 597 KB, 10 sous-systèmes :

| Sous-système | Fichiers | Découvertes clés |
|--------------|----------|-----------------|
| Lua 5.2 | 3 | 8 familles bridge (`funcLuaCommand` … `funcLuaMenuMultiplayCommand`) |
| Rendering D3D11 | 8 | Debug server `127.0.0.1:5425`, tile-based deferred (5 CS), 1100 render slots |
| Formats | 13 | RDBN parser 50 KB, G4TX loader, CPK scanner glob `"%s/*.cpk"` |
| Soccer | 9 | Player stride **0x570** (1392 B), max **58 joueurs**, `SoccerCommandEffect` ~1 MB |
| PhysX 3.4 | 4 | `NpScene` state machine (0=idle→3=advancing), MXCSR=0x9FC0 (FTZ+DAZ) |
| Animation | 3 | Dispatch type 0=direct/1=ref/2=G4MT, erreur `"PlayAnime Not Exist Anime"` |
| Audio CRI | 2 | CRI Atom Ex v2.29.4 (juillet 2025), 5.1 surround cutscenes |
| Réseau (EOS) | 4 | **Epic Online Services** (pas un serveur Level-5), `GetProcAddress` runtime |
| VFS | 3 | Hash CRC32 pour `#/`, fonts gaiji NX présentes (Switch non publié) |
| UI/Menu | 4 | `CMenuRender` 1100 slots × 0x38 = 0xF0A0 octets, sort SIMD |

Index complet : [`docs/ghidra-export/key-functions.md`](../../docs/ghidra-export/key-functions.md)

---

## Phase 8 : Writers + Packers (modding)

**Objectif** : Pouvoir modifier et re-pack les assets du jeu.

C'est la phase qui transforme IECODE d'un outil d'extraction en un **outil de modding**.

### Writers (formats → binaire)

| Writer | Lib | Description |
|--------|-----|-------------|
| `g4tx_writer` | **DirectXTex** | PNG/TGA → BC1-BC7 compress → rebuild G4TX avec headers + NXTCH + swizzle |
| `g4mg_writer` | **Assimp** + tinygltf | GLB/FBX/OBJ → import Assimp → rebuild G4MG (vertex buffers, index buffers) |
| `cfgbin_writer` | nlohmann/json | JSON → rebuild cfg.bin hiérarchique → XorShift encrypt → footer |
| `g4pk_writer` | — | Rebuild G4PK archive avec hash table + string table |
| `cpk_packer` | — | Rebuild CPK (TOC @UTF, CRILAYLA compress optionnel, CRI XOR encrypt) |

### Texture modding pipeline (DirectXTex)

```
skin_mod.png → LoadFromWICFile() → Compress(BC7) → Tegra swizzle → G4TX rebuild → CPK patch
```

DirectXTex fournit :
- `Compress()` CPU (BC1-BC7) et GPU via DirectCompute (BC6H/BC7, plus rapide)
- `Decompress()` pour preview
- `GenerateMipMaps()` pour les niveaux de détail
- `Convert()` entre formats DXGI
- Lecture/écriture DDS native

### Model modding pipeline (Assimp)

```
character.fbx → Assimp::Importer → aiScene (vertices, bones, materials) → G4MG rebuild
```

Assimp supporte 40+ formats en import :
- FBX, OBJ, glTF/GLB, Collada (.dae), Blender (.blend), 3DS, STL, PLY...
- Post-processing : triangulation, génération normales, flip UVs, calcul tangentes
- Export : glTF2, FBX, OBJ, Collada

### Asset injection

| Stratégie | Description | Complexité |
|-----------|-------------|-----------|
| **CPK patch** | Remplacer un fichier dans le CPK existant (même offset si taille ≤ originale) | Basse |
| **CPK rebuild** | Reconstruire le CPK complet avec les fichiers modifiés | Haute |
| **Loose files** | Override par fichier loose (si le jeu supporte) | Basse |
| **Memory patch** | Injection runtime via les pointer chains de MemoryAddresses.cs | Moyenne |

### Vérification Phase 8

1. Modifier une texture PNG → re-pack → le jeu affiche la texture modifiée
2. Modifier un cfg.bin JSON → re-pack → les stats sont changées en jeu
3. Round-trip : extract → convert → rebuild → extract → compare (identique)

---

## Phase 9 : 3D Preview (bgfx)

**Objectif** : Viewer 3D CLI pour prévisualiser les modèles G4MG.

### Fonctionnalités

- Rendu bgfx offscreen (texture exportée en PNG/EXR)
- Caméra orbite paramétrable
- Wireframe toggle, normals display, UV overlay
- Chargement G4MG → vertex/index buffers bgfx
- Textures G4TX appliquées (DirectXTex decode → bgfx texture)
- Squelette G4SK overlay (lignes)
- Grid au sol + axes

### Architecture

```
G4MG parser → iecode::render::MeshData (CPU)
    → bgfx::createVertexBuffer / createIndexBuffer (GPU)
    → bgfx::submit() dans un viewId dédié
    → bgfx render to texture
    → export PNG/EXR
```

### Vérification Phase 9

1. Charger un modèle de personnage → export PNG thumbnail
2. Textures correctement mappées
3. Import FBX via Assimp → preview → compare avec l'original

---

## Phase 10 : Scripting Lua (sol2)

**Objectif** : Permettre aux modders d'écrire des scripts Lua pour automatiser les modifications.

### API Lua exposée

```lua
-- Charger un CPK
local cpk = iecode.open_cpk("data_common.cpk")

-- Lister les fichiers
for _, file in ipairs(cpk:list_files()) do
    print(file.name, file.size)
end

-- Extraire un fichier
cpk:extract("chr/player001.g4tx", "output/player001.g4tx")

-- Charger et modifier une config
local config = iecode.load_config("player_param.cfg.bin")
config.players[1].kick = 99
config.players[1].speed = 95
iecode.save_config(config, "player_param_mod.cfg.bin")

-- Modifier une texture
local tex = iecode.load_texture("chr/player001.g4tx")
tex:replace_from_png("my_skin.png")
tex:save("chr/player001_mod.g4tx")

-- Batch : booster tous les joueurs
for _, player in ipairs(config.players) do
    player.kick = math.min(player.kick + 10, 99)
end

-- Re-pack dans le CPK
cpk:replace_file("player_param.cfg.bin", "player_param_mod.cfg.bin")
cpk:save("data_common_mod.cpk")
```

### Types exposés via sol2

```cpp
lua.new_usertype<PlayerData>("Player",
    "id", &PlayerData::player_id,
    "kick", &PlayerData::kick,
    "speed", &PlayerData::speed,
    "element", &PlayerData::element,
    "position", &PlayerData::position,
    "level", &PlayerData::level,
    "skills", &PlayerData::passive_skill_ids
);

lua.new_usertype<CpkArchive>("CpkArchive",
    "list_files", &CpkArchive::list_files,
    "extract", &CpkArchive::extract,
    "replace_file", &CpkArchive::replace_file,
    "save", &CpkArchive::save
);
```

Le jeu utilise Lua 5.2 en interne — les modders peuvent réutiliser leurs connaissances.

### Intégration

- Scripts `.lua` exécutés via la CLI (`iecode script run mod.lua`)
- Autocomplétion REPL minimal via sol2

### Vérification Phase 10

1. Script Lua qui modifie des stats → sauvegarder → vérifier en jeu
2. Script batch qui traite tous les joueurs d'un cfg.bin
