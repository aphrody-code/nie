# Banc d'essai inter-langages

Mesures des hot paths du dépôt dans les implémentations qui coexistent. Objectif : décider par
le chiffre, pas par préférence. Harnais : `crates/tools/nie-bench` (Rust), `bench/cpp`,
`bench/cs`.

## Protocole

Identique dans les trois harnais : mêmes données (`xorshift64*`, graine `0x2545F4914F6CDD1D`,
ou un blob CRILAYLA réel extrait d'un CPK), 3 tours de chauffe, 7 mesures, **médiane**.
Rust `--release`, C++ `/O2 /arch:AVX2`, C# `Release` + TieredPGO. Machine : Windows 11, x86-64.

```bash
cargo build --release -p nie-bench
pwsh bench/cpp/build.ps1                      # MSVC seul, sans vcpkg
dotnet build bench/cs/Bench.csproj -c Release

target/release/nie-bench sample --cpk data/packs/<un>.cpk   # produit bench/data/sample.crilayla
target/release/nie-bench crc32 --mib 64
bench/cpp/bench.exe crc32-slice8 64
bench/cs/bin/Release/net10.0/nie-bench-cs.exe crilayla bench/data/sample.crilayla 500
```

## Résultats

| Noyau | Rust | C++ | C# | Écart |
|---|---|---|---|---|
| **CRC32** (slicing-by-8, 64 Mio) | 2 400 Mio/s | **3 070 Mio/s** | 600 Mio/s¹ | C++ ×1,28 sur Rust |
| **CRILAYLA** (blob réel 14,6 Kio → 28,9 Kio) | 528 Mio/s | 546 Mio/s | **795 Mio/s** | C# ×1,45 sur C++ |
| **G4TX → PNG** (2640×1200, BC7) | **659 ms** | n/a² | 7 169 ms | Rust ×10,9 sur C# |
| **Qualité G4TX → PNG** | référence | n/a² | **identique** | 100 % des pixels, PSNR ∞ |

¹ `Crc32.cs` est en table simple octet-par-octet, pas en slicing — c'est l'algorithme qui est
mesuré, pas le langage. ² L'encodage PNG C++ passe par DirectXTex, qui exige vcpkg (absent).

### Ce que les mesures disent vraiment

**L'algorithme pèse plus lourd que le langage.** Le CRC32 Rust est passé de 605 à 2 400 Mio/s
(**×4**) en remplaçant le calcul bit-à-bit par du slicing-by-8 — sans changer de langage. L'écart
de langage sur le même algorithme est de ×1,28. Conclusion : chercher le langage gagnant avant
d'avoir égalisé les algorithmes mène à la mauvaise décision.

**Aucun langage ne gagne partout.** C++ mène sur la boucle table-driven pure ; C# mène sur la
décompression LZ (implémentation `unsafe` à pointeurs, héritée de CriFsLib) ; Rust écrase sur le
**pipeline complet** — décodage BC7 + encodage PNG — qui est ce que l'utilisateur exécute
réellement.

**La qualité de conversion est identique.** Rust et C# produisent exactement les mêmes pixels sur
`story01_00.g4tx` (2640×1200, BC7 → RGBA8) : écart max 0 sur les quatre canaux. Seule la taille du
PNG diffère (C# 3,90 Mio contre 4,01 Mio, soit 2,9 % de moins) — c'est le réglage de l'encodeur
zlib, pas le décodeur. Le C# paie cette compression 10,9× plus cher en temps.

**`target-cpu=native` dégrade le CRC32 Rust** (2 400 → 1 830 Mio/s) : LLVM tente une
vectorisation contre-productive sur une chaîne de dépendances. Ne pas l'activer globalement.

## Décisions

1. **Rust reste le langage principal.** Il gagne sur le seul axe qui mesure un travail complet, et
   il est le seul à cumuler byte-exact, wasm et sécurité mémoire.
2. **On porte des algorithmes, pas des langages.** Chaque écart mesuré est d'abord un écart
   d'implémentation ; le porter coûte quelques dizaines de lignes contre des milliers.
3. **Chantiers ouverts, chiffrés** :
   - CRILAYLA Rust : porter l'approche du C# (+50 % attendu sur l'extraction, hot path du VFS) ;
   - `Crc32.cs` : slicing-by-8 (×4 attendu) si l'outillage C# reste sur ce chemin ;
   - `src/crypto/crc32.cpp` : passer de by-4 à by-8 (+70 % mesuré) tant que le C++ l'utilise ;
   - encodage PNG Rust : viser la taille du C# sans en payer le temps (niveau de compression).
