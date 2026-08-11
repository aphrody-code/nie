# Guide de Portage C# → C++

> **Statut depuis l'unification (2026-08-11)** : ce guide décrit le portage qui a produit
> l'arbre C++ à partir du C#. Il reste utile comme table de correspondance des types et des
> patterns, mais **il ne dit plus où le code doit aller** : c'est
> `docs/ARCHITECTURE-POLYGLOTTE.md` qui fixe la doctrine, et `docs/PORTAGES.md` qui tient le
> registre des déplacements en cours — lesquels vont majoritairement **vers Rust**, et vers C++
> seulement pour le jeu jouable.

## Mapping des types fondamentaux

| C# | C++ | Notes |
|----|-----|-------|
| `byte` | `uint8_t` | |
| `sbyte` | `int8_t` | |
| `short` / `ushort` | `int16_t` / `uint16_t` | |
| `int` / `uint` | `int32_t` / `uint32_t` | |
| `long` / `ulong` | `int64_t` / `uint64_t` | |
| `float` | `float` | |
| `double` | `double` | |
| `bool` | `bool` | |
| `string` | `std::string` | |
| `string?` | `std::optional<std::string>` | |
| `byte[]` | `std::vector<uint8_t>` | |

## Mapping des patterns

### Span / Memory

```csharp
// C#
ReadOnlySpan<byte> data = buffer.AsSpan();
var slice = data[4..];
var sub = data.Slice(offset, length);
data.CopyTo(dest);
data.SequenceEqual(other);
```

```cpp
// C++
std::span<const uint8_t> data{buffer.data(), buffer.size()};
auto slice = data.subspan(4);
auto sub = data.subspan(offset, length);
std::copy(data.begin(), data.end(), dest.begin());
std::equal(data.begin(), data.end(), other.begin(), other.end());
```

### BinaryPrimitives (lecture endian)

```csharp
// C#
uint val = BinaryPrimitives.ReadUInt32LittleEndian(data);
ushort val2 = BinaryPrimitives.ReadUInt16BigEndian(data);
BinaryPrimitives.WriteUInt32LittleEndian(dest, value);
```

```cpp
// C++ — fonctions dans types.h
uint32_t val = iecode::read_u32_le(data.data());
uint16_t val2 = iecode::read_u16_be(data.data());
iecode::write_u32_le(dest.data(), value);
```

### MemoryMarshal (réinterprétation de structs)

```csharp
// C#
ref readonly var header = ref MemoryMarshal.AsRef<G4txHeader>(data[..HEADER_SIZE]);
var entries = MemoryMarshal.Cast<byte, G4txEntry>(data.Slice(offset, count * entrySize));
```

```cpp
// C++ — attention à l'alignement !
#pragma pack(push, 1)
struct G4txHeader { /* ... */ };
#pragma pack(pop)

const auto* header = reinterpret_cast<const G4txHeader*>(data.data());
// Pour un tableau :
const auto* entries = reinterpret_cast<const G4txEntry*>(data.data() + offset);
```

### stackalloc → stack array

```csharp
// C#
Span<int> frequency = stackalloc int[256];
Span<byte> buf = stackalloc byte[4];
```

```cpp
// C++
std::array<int, 256> frequency{};  // zero-initialized
std::array<uint8_t, 4> buf{};
```

### ArrayPool → vector ou unique_ptr

```csharp
// C#
byte[] rented = ArrayPool<byte>.Shared.Rent(size);
try { /* ... */ }
finally { ArrayPool<byte>.Shared.Return(rented); }
```

```cpp
// C++ — pas besoin de pool dans la plupart des cas
auto buffer = std::make_unique<uint8_t[]>(size);
// ou simplement :
std::vector<uint8_t> buffer(size);
```

### Classes statiques → fonctions libres dans namespace

```csharp
// C#
public static class Lz10Decoder
{
    public static byte[] Decompress(ReadOnlySpan<byte> input) { ... }
    public static bool IsLz10Compressed(ReadOnlySpan<byte> data) { ... }
}
```

```cpp
// C++
namespace iecode::compression {
    std::vector<uint8_t> lz10_decompress(std::span<const uint8_t> input);
    bool is_lz10_compressed(std::span<const uint8_t> data);
}
```

### readonly record struct → struct POD

```csharp
// C#
public readonly record struct G4txTexture(
    byte Id, string Name, int Width, int Height,
    int Format, int MipCount, byte[] TextureData
);
```

```cpp
// C++
struct G4txTexture {
    uint8_t id;
    std::string name;
    int32_t width;
    int32_t height;
    int32_t format;
    int32_t mip_count;
    std::vector<uint8_t> texture_data;
};
```

### Exceptions → std::expected

```csharp
// C#
if (magic != MAGIC)
    throw new InvalidDataException($"Invalid magic: 0x{magic:X2}");
```

```cpp
// C++ (C++23)
if (magic != MAGIC)
    return std::unexpected(fmt::format("Invalid magic: 0x{:02X}", magic));

// Type de retour :
auto parse(std::span<const uint8_t> data) -> std::expected<G4txFile, std::string>;
```

### SIMD

```csharp
// C#
if (Avx2.IsSupported)
{
    var vec = Avx.LoadVector256(ptr);
    var result = Avx2.Xor(vec, key);
    Avx.Store(outPtr, result);
}
```

```cpp
// C++
#ifdef IECODE_HAS_AVX2
#include <immintrin.h>
{
    __m256i vec = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(ptr));
    __m256i result = _mm256_xor_si256(vec, key);
    _mm256_storeu_si256(reinterpret_cast<__m256i*>(out_ptr), result);
}
#endif
```

### Mapping SIMD complet (NativeCrypto.cs)

| C# Intrinsic | C++ Intel Intrinsic |
|---------------|---------------------|
| `Avx.LoadVector256(ptr)` | `_mm256_loadu_si256((__m256i*)ptr)` |
| `Avx.Store(ptr, vec)` | `_mm256_storeu_si256((__m256i*)ptr, vec)` |
| `Avx2.Xor(a, b)` | `_mm256_xor_si256(a, b)` |
| `Avx2.UnpackLow(a, zero)` | `_mm256_unpacklo_epi8(a, zero)` |
| `Avx2.UnpackHigh(a, zero)` | `_mm256_unpackhi_epi8(a, zero)` |
| `Avx2.MultiplyLow(a, b)` | `_mm256_mullo_epi16(a, b)` |
| `Avx2.PackUnsignedSaturate(a, b)` | `_mm256_packus_epi16(a, b)` |
| `Avx2.Permute4x64(v, 0xD8)` | `_mm256_permute4x64_epi64(v, 0xD8)` |
| `Vector256.Create(val)` | `_mm256_set1_epi8(val)` |
| `Vector256<byte>.Zero` | `_mm256_setzero_si256()` |
| `Sse2.Xor(a, b)` | `_mm_xor_si128(a, b)` |
| `Sse2.LoadVector128(ptr)` | `_mm_loadu_si128((__m128i*)ptr)` |

### Async / Parallélisme

```csharp
// C#
await Parallel.ForEachAsync(files, new ParallelOptions { MaxDegreeOfParallelism = 4 },
    async (file, ct) => { await ProcessAsync(file, ct); });
```

```cpp
// C++ — thread pool simple
#include <thread>
#include <future>
#include <vector>

std::vector<std::future<void>> futures;
std::counting_semaphore sem(4); // max parallelism
for (auto& file : files) {
    futures.push_back(std::async(std::launch::async, [&] {
        sem.acquire();
        process(file);
        sem.release();
    }));
}
for (auto& f : futures) f.get();
```

### System.CommandLine → CLI11

```csharp
// C#
var cmd = new Command("extract", "Extract CPK archive");
var cpkArg = new Argument<string>("cpk", "Path to CPK file");
var outputOpt = new Option<string>("--output", "-o");
cmd.AddArgument(cpkArg);
cmd.AddOption(outputOpt);
cmd.SetHandler(async (cpk, output, game, verbose) => {
    await ExtractCommand.ExecuteAsync(cpk, output, game, verbose);
}, cpkArg, outputOpt, gamePathOption, verboseOption);
```

```cpp
// C++
auto* extract = app.add_subcommand("extract", "Extract CPK archive");
std::string cpk_path, output_dir, game_path;
bool verbose = false;
extract->add_option("cpk", cpk_path, "Path to CPK file")->required();
extract->add_option("-o,--output", output_dir, "Output directory")->required();
extract->add_option("-g,--game", game_path, "Game directory");
extract->add_flag("-v,--verbose", verbose, "Verbose output");
extract->callback([&] {
    extract_command(cpk_path, output_dir, game_path, verbose);
});
```

### P/Invoke (LibraryImport) → pas besoin

Les modules Steam/EOS utilisaient `[LibraryImport]` pour charger des DLLs Windows. Sur Ubuntu, ces modules ne sont pas portés. Si besoin futur d'interop native, utiliser `dlopen`/`dlsym` directement.

## Conventions de nommage

| Élément | C# | C++ |
|---------|-----|-----|
| Namespace | `IECODE.Core.Compression` | `iecode::compression` |
| Classe statique | `Lz10Decoder` | namespace functions |
| Méthode publique | `Decompress()` | `decompress()` ou `lz10_decompress()` |
| Constante | `MAGIC` | `MAGIC` ou `kMagic` |
| Champ privé | `_buffer` | `buffer_` |
| Propriété | `DecompressedSize` | `decompressed_size` |
| Fichier | `Lz10Decoder.cs` | `lz10.h` / `lz10.cpp` |
