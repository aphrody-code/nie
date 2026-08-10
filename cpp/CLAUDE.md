# CLAUDE.md — cli/

Toolkit C++20 pour Inazuma Eleven: Victory Road — parsers, compression, engine, modding.

## Architecture

```
cli/
├── include/iecode/     # Headers publics
│   ├── ffi.h          # API FFI unifiée (C ABI)
│   ├── compression/   # LZ10, LZ4, CRILAYLA, Huffman, RLE, ZLib
│   ├── crypto/        # CRI XOR, CRC32
│   ├── level5/        # G4TX, G4MG, G4MD, cfg.bin
│   ├── criware/       # CPK, UTF, USM, ACB, AWB
│   ├── vfs/           # Virtual File System (250K entries)
│   └── modding/       # Mod scanner, conflict detector, installer
├── src/
│   ├── core/          # Parsers binaires, utils
│   ├── compression/   # Implémentations décompression
│   ├── crypto/        # Cryptographie
│   ├── level5/        # Formats Level-5
│   ├── criware/       # Formats CriWare
│   ├── vfs/           # VFS O(1) lookup
│   ├── wasm/          # iecode_wasm.cpp (Emscripten exports)
│   └── ffi/           # Implémentations FFI C
├── ffi/
│   └── rust/          # iecode-sys crate
│       └── iecode-sys/
│           ├── build.rs       # Cross-platform linking
│           ├── src/lib.rs     # Raw bindings
│           └── src/safe.rs    # Safe wrappers RAII
├── tests/             # GTest (828+ tests)
└── scripts/           # PowerShell build scripts
```

## FFI Unifiée

### Principe

Une seule source de vérité : `include/iecode/ffi.h`
- Exports C ABI utilisés par **Rust FFI** et **WASM**
- Types explicites (`uint32_t`, `int32_t`) — compatible MSVC/GCC/Clang/Emscripten
- Handles opaques pour encapsulation mémoire

### Pattern mémoire

```cpp
// Input : pointeur alloué par l'appelant (JS/Rust)
iecode_g4tx_t* iecode_g4tx_parse(const uint8_t* data, uint32_t size);

// Output : buffer alloué par C++, à libérer par l'appelant
uint8_t* iecode_g4tx_decode_rgba(..., int32_t* out_width, int32_t* out_height);
void iecode_free(void* ptr);  // std::free wrapper

// Handles opaques : libération via fonction dédiée
void iecode_g4tx_free(iecode_g4tx_t* g4tx);
```

### WASM (`src/wasm/iecode_wasm.cpp`)

**Zero-copy** : JS alloue via `Module._malloc()`, C++ lit directement.

Exports principaux :
| Fonction WASM | Description |
|---------------|-------------|
| `wasm_decompress_level5` | Décompression auto-detect |
| `wasm_g4tx_parse` | Parse texture G4TX |
| `wasm_g4tx_decode_rgba` | Décode vers RGBA8 |
| `wasm_cpk_open` / `wasm_cpk_extract` | Archives CPK |
| `wasm_vfs_init` / `wasm_vfs_read` | VFS complet |
| `buffer_alloc` / `buffer_free` | Gestion mémoire |

## Build

### Windows (MSVC)

```powershell
cmake --preset debug && cmake --build --preset debug
ctest --preset debug
```

### Linux (GCC/Clang)

```bash
cmake --preset debug -DCMAKE_CXX_COMPILER=g++
cmake --build --preset debug
```

### WASM (Emscripten)

```bash
emcmake cmake -B build/wasm -S . -DIECODE_WASM=ON
emmake cmake --build build/wasm --parallel
```

### Rust FFI

```bash
cd ffi/rust/iecode-sys
cargo build
cargo test
```

## Tests

```bash
# CTest (C++)
ctest --preset debug --parallel

# Rust
ctest --preset rust
```

## Conventions

- C++20, `CXX_EXTENSIONS OFF`
- `CamelCase` classes, `lower_case` fonctions, `UPPER_CASE` constantes
- Pas d'exceptions dans les hot paths — `std::optional` / codes retour
- `std::span<const uint8_t>` pour parsing binaire
- 4 espaces, 100 colonnes (clang-format Google)
