# Dépendances

IECODE-CPP est un **outil de modding complet** : extraction, édition, prévisualisation 3D, re-pack et injection de mods dans nie.exe.

## Mapping .NET → C++

### Portage direct (extraction & conversion)

| Package .NET | Package C++ | Type | Raison du choix |
|-------------|-------------|------|-----------------|
| `System.CommandLine` 2.0 | **CLI11** 2.4+ | vcpkg | Header-only, subcommands, options typées, callbacks, config files. Score Context7: 90 |
| `System.Text.Json` | **nlohmann-json** 3.11+ | vcpkg | Header-only, `NLOHMANN_DEFINE_TYPE_*` macros pour sérialisation auto. Score: 80 |
| `SharpGLTF.Toolkit` | **tinygltf** 2.9+ | vcpkg | Header-only C++11, lecture/écriture glTF 2.0 + GLB, embarque stb_image |
| `String.Format` / interpolation | **fmt** 11+ | vcpkg | Compile-time checked, hex/bin/oct/padding, `{:#04x}` pour bytes. Score: 90 |
| `LogService` (singleton custom) | **spdlog** 1.14+ | vcpkg | Multi-sink (console couleur + fichier), async, utilise fmt. Score: 91 |
| `SixLabors.ImageSharp` | **stb_image** + **stb_image_write** | vendored | Public domain, load/write PNG/BMP/TGA/JPG |
| `BCnEncoder.Net` | **bcdec.h** (décompression) | vendored | Header-only, décompression BC1-BC7 |
| aucun | **gtest** 1.15+ | vcpkg | Tests unitaires (GTest + GMock) |
| `CommunityToolkit.HighPerformance` | `std::span` (C++20) | builtin | Aucune dépendance nécessaire |
| `System.IO.Hashing` | implémentation custom | — | CRC32 poly 0xEDB88320, ~50 lignes |
| `System.Runtime.Intrinsics` | `<immintrin.h>` (AVX2/SSE2) | builtin | Intrinsics Intel natifs |

### Nouvelles libs (modding, prévisualisation)

| Besoin | Package C++ | Type | Raison du choix |
|--------|-------------|------|-----------------|
| Rendering 3D preview | **bgfx** | vcpkg | Abstraction multi-API (D3D11, OpenGL, Vulkan, Metal), shader cross-compile, mesh rendering |
| Import/export 3D multi-format | **Assimp** 5.4+ | vcpkg | 40+ formats (FBX, OBJ, glTF, Collada, Blender...), import & export. Permet aux modders d'importer depuis n'importe quel DCC |
| Compression textures BCn | **DirectXTex** | vcpkg | Compression BC1-BC7 (CPU + GPU via DirectCompute), lecture/écriture DDS, mipmaps, resize. Microsoft officiel |
| Physique (lecture/édition) | **Bullet3** | vcpkg | Backend physique — remplace PhysX 3.4 de nie.exe |
| Maths 3D | **glm** | vcpkg | Vecteurs, matrices, quaternions — embarqué par tinygltf, réutilisable partout |
| Scripting mods | **sol2** (Lua) | vcpkg | Bindings Lua C++, le jeu utilise Lua 5.2 — permet de scripter les mods |

## vcpkg (installées automatiquement)

| Package | Version | Usage |
|---------|---------|-------|
| **CLI11** | 2.4+ | Parsing CLI, sous-commandes, options typées |
| **nlohmann-json** | 3.11+ | Sérialisation JSON (cfg.bin ↔ JSON) |
| **tinygltf** | 2.9+ | Export GLB/glTF (modèles 3D) |
| **fmt** | 11+ | Formatage de strings (rapide, type-safe, compile-time) |
| **spdlog** | 1.14+ | Logging structuré |
| **gtest** | 1.15+ | Tests unitaires (GTest + GMock) |
| **assimp** | 5.4+ | Import/export 3D multi-format (FBX, OBJ, glTF, Blender...) |
| **bgfx** | latest | Rendering 3D cross-API (preview modèles/textures) |
| **directxtex** | latest | Compression/décompression BCn, DDS, mipmaps |
| **glm** | 1.0+ | Maths 3D (vecteurs, matrices, quaternions) |
| **sol2** | 3.3+ | Bindings Lua C++ pour le scripting de mods |
| **capstone** | 5.x | Désassemblage x86_64, analyse instructions, registres |
| **tree-sitter** | 0.24+ | Parsing incrémental AST du pseudo-C Ghidra (4M lignes nie.c) |

### vcpkg.json

```json
{
  "name": "iecode",
  "version": "1.0.0",
  "description": "IEVR Modding & RE Toolkit (C++)",
  "dependencies": [
    "cli11",
    "nlohmann-json",
    "tinygltf",
    "fmt",
    "spdlog",
    "gtest",
    "assimp",
    "bgfx",
    "directxtex",
    "glm",
    "sol2",
    "capstone",
    "tree-sitter"
  ]
}
```

### Installation vcpkg

```bash
# Cloner vcpkg (une seule fois)
git clone https://github.com/microsoft/vcpkg.git ~/vcpkg
cd ~/vcpkg && ./bootstrap-vcpkg.sh

# Build avec vcpkg
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=~/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build build -j$(nproc)
```

## Headers vendored (third_party/)

| Header | Licence | Usage |
|--------|---------|-------|
| **stb_image.h** | MIT/Public Domain | Chargement PNG/JPG/BMP/TGA → pixels RGBA |
| **stb_image_write.h** | MIT/Public Domain | Export PNG/BMP/TGA/JPG depuis pixels RGBA |
| **bcdec.h** | MIT | Décompression BC1-BC7 (fallback CPU, DirectXTex gère aussi) |

### third_party/CMakeLists.txt

```cmake
add_library(iecode_third_party INTERFACE)
target_include_directories(iecode_third_party INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/stb
    ${CMAKE_CURRENT_SOURCE_DIR}/bcdec
)
```

### Téléchargement des headers vendored

```bash
# stb (image loading + writing)
curl -o third_party/stb/stb_image.h \
  https://raw.githubusercontent.com/nothings/stb/master/stb_image.h
curl -o third_party/stb/stb_image_write.h \
  https://raw.githubusercontent.com/nothings/stb/master/stb_image_write.h

# bcdec
curl -o third_party/bcdec/bcdec.h \
  https://raw.githubusercontent.com/iOrange/bcdec/main/bcdec.h
```

## Exemples d'utilisation rapide (depuis Context7)

### CLI11 — Subcommands avec options globales

```cpp
CLI::App app{"iecode — IEVR RE Toolkit"};
bool verbose = false;
app.add_flag("-v,--verbose", verbose, "Verbose output");

auto* extract = app.add_subcommand("extract", "Extract CPK archive");
std::string cpk_path;
extract->add_option("cpk", cpk_path, "Path to CPK file")->required();
extract->callback([&] { /* ... */ });

CLI11_PARSE(app, argc, argv);
```

### nlohmann-json — Sérialisation automatique de structs

```cpp
struct PlayerData {
    uint32_t player_id;
    std::string name;
    uint8_t position;
};
NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(PlayerData, player_id, name, position)

// Usage :
json j = player;                          // struct → JSON
auto p = j.get<PlayerData>();             // JSON → struct
std::ofstream("out.json") << std::setw(4) << j;  // pretty-print
```

### spdlog — Logging multi-sink (console + fichier)

```cpp
auto console = spdlog::stdout_color_mt("console");
console->info("Extracting {} files...", count);
console->error("Failed to parse: {}", path);
spdlog::set_level(spdlog::level::debug);  // --verbose
```

### fmt — Formatage hex pour le reverse engineering

```cpp
fmt::format("{:#04x}", 0x1717E18E);      // "0x1717e18e"
fmt::format("Offset: nie.exe+{:#x}", addr);
fmt::format("{:08X}", magic);              // "47345458" (G4TX)
```

### stb — Écriture PNG depuis pixels RGBA

```cpp
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

stbi_write_png("texture.png", width, height, 4, rgba_data, width * 4);
```

### tinygltf — Export GLB

tinygltf fournit les structs `Model`, `Mesh`, `Accessor`, `BufferView`, `Buffer` pour construire un fichier GLB programmatiquement. Utilisé pour convertir G4MG → GLB.

### Assimp — Import multi-format pour modders

```cpp
#include <assimp/Importer.hpp>
#include <assimp/scene.h>
#include <assimp/postprocess.h>
#include <assimp/Exporter.hpp>

// Import FBX/OBJ/Blender → structure unifiée
Assimp::Importer importer;
const aiScene* scene = importer.ReadFile("character.fbx",
    aiProcess_Triangulate | aiProcess_GenNormals | aiProcess_FlipUVs);

// Export vers glTF pour injection dans le jeu
Assimp::Exporter exporter;
exporter.Export(scene, "gltf2", "output.glb");
```

### DirectXTex — Compression/décompression BCn (modding textures)

```cpp
#include <DirectXTex.h>
using namespace DirectX;

// Charger une image PNG modifiée par le modder
ScratchImage srcImage;
LoadFromWICFile(L"skin_mod.png", WIC_FLAGS_NONE, nullptr, srcImage);

// Compresser en BC7 (format utilisé par nie.exe) — CPU
ScratchImage bcImage;
Compress(srcImage.GetImages(), srcImage.GetImageCount(),
    srcImage.GetMetadata(), DXGI_FORMAT_BC7_UNORM,
    TEX_COMPRESS_DEFAULT, 1.0f, bcImage);

// Ou compression GPU (plus rapide, nécessite D3D11)
Compress(g_pd3dDevice, srcImage.GetImages(), srcImage.GetImageCount(),
    srcImage.GetMetadata(), DXGI_FORMAT_BC7_UNORM,
    TEX_COMPRESS_DEFAULT, 1.0f, bcImage);

// Décompresser BC → RGBA pour preview
ScratchImage rgbaImage;
Decompress(bcImage.GetImages()[0], DXGI_FORMAT_R8G8B8A8_UNORM, rgbaImage);
```

### bgfx — Preview 3D cross-API

```cpp
// Chargement shader adapté au backend actif (D3D11/OpenGL/Vulkan)
bgfx::ShaderHandle vsh = loadShader("vs_model");
bgfx::ShaderHandle fsh = loadShader("fs_model");
bgfx::ProgramHandle program = bgfx::createProgram(vsh, fsh, true);

// Créer texture depuis pixels RGBA (préview G4TX décodée)
bgfx::TextureHandle tex = bgfx::createTexture2D(
    width, height, false, 1, bgfx::TextureFormat::RGBA8,
    BGFX_TEXTURE_NONE, bgfx::copy(rgba_data, width * height * 4));

// Render mesh (préview G4MG)
bgfx::setVertexBuffer(0, vbh);
bgfx::setIndexBuffer(ibh);
bgfx::setTexture(0, s_texColor, tex);
bgfx::setState(BGFX_STATE_DEFAULT);
bgfx::submit(0, program);
```

### sol2 — Scripting Lua pour les mods

```cpp
#include <sol/sol.hpp>

sol::state lua;
lua.open_libraries(sol::lib::base, sol::lib::math, sol::lib::string);

// Exposer les types du jeu au Lua
lua.new_usertype<PlayerData>("Player",
    "kick", &PlayerData::kick,
    "speed", &PlayerData::speed,
    "element", &PlayerData::element,
    "position", &PlayerData::position
);

// Le modder peut écrire des scripts
lua.script(R"(
    function boost_player(player)
        player.kick = player.kick + 10
        player.speed = math.min(player.speed + 5, 99)
    end
)");

// Appel depuis C++
sol::function boost = lua["boost_player"];
boost(player);
```

## Dépendances système

### Windows (dev principal)

```powershell
# Visual Studio 2022 Build Tools (C++20)
winget install Microsoft.VisualStudio.2022.BuildTools
# ou MSYS2 GCC 13+ / Clang 17+
```

### Ubuntu/Linux

```bash
sudo apt install build-essential cmake git pkg-config
# GCC 13+ ou Clang 17+ requis pour C++20 (std::span, std::expected, std::bit_cast)
sudo apt install gcc-13 g++-13  # ou clang-17
```

### Reverse engineering & analyse binaire

| Besoin | Package C++ | Type | Raison du choix |
|--------|-------------|------|-----------------|
| Parsing AST du pseudo-C Ghidra (4M lignes) | **tree-sitter** + **tree-sitter-c** | vcpkg + FetchContent | Parser incrémental ultra-rapide, queries S-expression pour extraire FUN_*/DAT_*/structs, renommage batch |
| Désassemblage x86_64 instruction-level | **Capstone** 5.x | vcpkg | Framework léger, `cs_disasm_iter` zero-alloc, analyse registres, calling conventions, vtable dispatch |
| Analyse binaire PE complète | **Rizin** 0.8+ (librz) | système (pkg-config) | Auto-analysis, xrefs, call graphs, RTTI recovery, scripting via C API. Optionnel — désactivé si non installé |

## Dépendances runtime optionnelles

| Outil | Usage |
|-------|-------|
| **ffmpeg** | Conversion USM → MP4 (appelé en subprocess) |
| **Ghidra** 12.0+ | Décompilation nie.exe → pseudo-C (voir decomp-integration.md) |
| **Rizin** 0.8+ (CLI) | Analyse PE rapide en ligne de commande (`rz-bin`, `rizin`) |
| **Blender** 4.x | Validation des GLB exportés, conversion FBX ↔ glTF en batch headless |
| **PhysX** 5.x SDK | Lecture/édition des données physiques (collisions, ragdoll) si modding avancé |

## Pipeline modding complet

```
[Extraction]                      [Édition]                     [Re-pack]
CPK → CpkReader → fichiers   →   Edition CLI / scripts     →   CpkPacker → CPK modifié
  .g4tx → DirectXTex decode   →   Texture preview (bgfx)    →   DirectXTex BC7 compress
  .g4mg → tinygltf GLB        →   bgfx 3D preview           →   G4MG rebuild
  .cfg.bin → JSON              →   JSON editor               →   XorShift encrypt → cfg.bin
                                  Assimp import FBX/OBJ      →   Convert → G4MG
                                  sol2 Lua scripts            →   Apply mod rules
                                  Blender (external)          →   Export GLB → import
```
