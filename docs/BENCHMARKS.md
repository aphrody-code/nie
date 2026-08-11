# Banc d'essai inter-langages

Mesures des hot paths du dépôt dans les implémentations qui coexistent. Objectif : décider par
le chiffre, pas par préférence. Harnais : `crates/tools/nie-bench` (Rust), `bench/cpp`,
`bench/cs`.

## Conditions de mesure

**Machine au repos, sinon rien.** Deux biais mesurés, tous deux supérieurs aux écarts qu'on
cherche à observer :

- une compilation concurrente (vcpkg) fait tomber le même binaire de 820 à 692 Mio/s (−16 %) ;
- un **serveur de dev Vite oublié en arrière-plan** (`bun run dev` de `nie-explorer`,
  17,5 h de CPU accumulées) faussait toutes les séries. Vérifier avant de mesurer :
  `Get-Process bun, node, MSBuild, VBCSCompiler`, puis `dotnet build-server shutdown`.

`bench/run-all.ps1` ne détecte pas la charge — c'est à l'opérateur de faire le vide.

## Chaînes de build à préparer

| Chaîne | Commande | Notes |
|---|---|---|
| Rust | `cargo build --release --workspace` | 18 binaires |
| C++ (banc seul) | `pwsh bench/cpp/build.ps1` | MSVC seul, pas de vcpkg |
| C++ (toolkit complet) | `just cpp-bootstrap` puis `just cpp-build` | vcpkg compile ~30 ports (openssl, assimp, bgfx, bullet3 : comptez l'heure) |
| C# JIT | `dotnet build bench/cs/Bench.csproj -c Release` | |
| C# NativeAOT | `dotnet publish … -r win-x64 -p:PublishAot=true` | exige `vswhere.exe` **dans le PATH** et un environnement `vcvars64` chargé, sinon ILC compose une ligne de commande de linker invalide (MSB3073, code 123) |

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

Campagne du 2026-08-11, `bench/run-all.ps1`, **machine au repos** et les quatre chaînes
construites (Rust release, C++ Release, C# JIT et NativeAOT).

| Noyau | Rust | C++ | C# JIT | C# AOT |
|---|---|---|---|---|
| **CRC32** (slicing-by-8, 64 Mio) | 2 312 Mio/s | **2 943 Mio/s**³ | 606¹ | 600¹ |
| **CRILAYLA** (blob réel 14,6 Kio → 28,9 Kio) | 626 Mio/s | 553 Mio/s | **817 Mio/s** | 711 Mio/s |
| **G4TX → PNG** (2640×1200, BC7) | **659 ms** | n/a² | 7 169 ms | — |
| **Qualité G4TX → PNG** | référence | n/a² | **identique** (100 % des pixels, PSNR ∞) | — |

¹ `Crc32.cs` est en table simple octet-par-octet, pas en slicing — c'est l'algorithme qui est
mesuré, pas le langage. ² L'encodage PNG C++ passe par DirectXTex ; le chemin existe mais
n'a pas de commande équivalente à `niers decode` pour être chronométré de bout en bout.
³ Chiffre du **toolkit** (`src/crypto/crc32.cpp`), passé de slicing-by-4 à by-8 : 1 783 →
2 943 Mio/s, +65 %, checksum inchangé, 490 tests GTest verts. Le harnais atteint 3 165 avec
la même boucle : les 7 % d'écart sont les flags (`/arch:AVX2` contre l'unity build `/O2`).

**Gagnant par noyau** : C++ sur le hachage table-driven (×1,40 sur Rust), C# sur la
décompression LZ (×1,31 sur Rust, ×1,48 sur C++), Rust sur le pipeline complet (×10,9 sur C#).

### NativeAOT n'accélère pas le calcul

`iecode.exe` publié en NativeAOT : 31,7 Mo, autonome, démarre sans runtime .NET installé. Sur les
deux noyaux mesurés, il est **au niveau du JIT ou en dessous** (CRILAYLA : AOT 588 Mio/s contre
JIT 692 sur machine chargée, soit −15 %). Attendu : le JIT à compilation étagée profile le code
réel et ré-optimise, ce que l'AOT ne peut pas faire. L'AOT reste le bon choix pour le **démarrage**
(pas de JIT à l'amorce) et la **distribution** (un seul fichier), pas pour le débit.

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
   - CRILAYLA Rust : reste ×1,41 derrière le C#, dont l'écart tient au lecteur de bits (le C#
     garde l'octet courant en registre, le Rust le relit du tampon à chaque groupe) et au
     déroulage des trois premiers octets de copie. La copie longue, elle, est déjà réglée ;
   - `Crc32.cs` : slicing-by-8 (×4 attendu) si l'outillage C# reste sur ce chemin ;
   - ~~`src/crypto/crc32.cpp` en by-8~~ — **fait**, +65 % ;
   - encodage PNG Rust : viser la taille du C# sans en payer le temps (niveau de compression).
