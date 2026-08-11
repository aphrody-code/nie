# Intégration du Code Décompilé : Objectif `nie.rs`

> [!IMPORTANT]
> **NOUVEL OBJECTIF STRICT (2026) :** L'objectif ultime et exclusif de ce pipeline est de **convertir l'intégralité du binaire `nie.exe` et de ses DLLs en un projet Rust natif et sécurisé (`nie.rs`)**. L'approche historique consistant à compiler le pseudo-C brut avec des wrappers C++ est obsolète.

## Vision Architecturale : De l'Assembleur au Rust

Le code de `nie.exe` (compilé à l'origine en C++) ne doit plus être exécuté via des bridges instables en pseudo-C. Le pipeline moderne de Reverse Engineering Machine Learning (ML-RE) est conçu pour accomplir la translation suivante :

`nie.exe (x86-64)` ➔ `Ghidra (pseudo-C)` ➔ `AST (tree-sitter-c)` ➔ `Modèle ML (Transformers)` ➔ `nie.rs (Safe Rust)`

### Pourquoi Rust (`nie.rs`) ?
1. **Sécurité Mémoire :** Le pseudo-C généré par Ghidra est rempli de pointeurs bruts et d'arithmétique dangereuse. Rust permet d'imposer des contraintes de sécurité strictes une fois le code sémantiquement compris.
2. **Interopérabilité WebAssembly (WASM) :** Rust compile nativement et parfaitement vers `wasm32-unknown-unknown`, ce qui est le but final de notre application web.
3. **Ecosystème :** L'écosystème Rust (Cargo, Bindgen, Serde) est infiniment plus adapté pour reconstruire un moteur de jeu complexe de manière modulaire que des scripts CMake tentant de lier du code Ghidra brut.

## Le Nouveau Pipeline ML-RE

### 1. Extraction et Analyse Binaire (La Sonde)
Outils : `LIEF`, `pefile`, `angr`, `capstone`
- Extraction automatique des RTTI (Run-Time Type Information) pour récupérer tous les noms de classes (namespaces `game::` et `lives::`).
- Génération des Control Flow Graphs (CFG) via `angr` pour comprendre la logique des blocs assembleurs.

### 2. Décompilation Intermédiaire
Outils : `Ghidra` piloté par `pyghidra`
- Ghidra est utilisé *uniquement* comme moteur de translation x86 -> pseudo-C (Intermediate Representation).
- L'export de Ghidra (`decomp/functions/*.c`) est traité comme un jeu de données (dataset), **pas** comme du code source à compiler.

### 3. Translation Pseudo-C vers Rust (Le Distillateur)
Outils : `tree-sitter-c`, `transformers` (LLMs / CodeBERT), `networkx`
C'est ici qu'intervient la véritable innovation :
1. Le script ML parse les fichiers `.c` avec `tree-sitter-c` pour extraire l'AST.
2. Un réseau de neurones lit l'AST et les métadonnées de graphe (`networkx`).
3. Le modèle IA génère du code Rust idiomatique (remplacement des pointeurs par des références/Box/Rc, identification des structures).
4. Le code Rust généré est placé dans le crate `nie.rs`.

## Workflow Opérationnel

### Étape 1 : Exportation du Dataset Pseudo-C
Lancer le pipeline Ghidra en mode headless pour générer la matière première :
```powershell
./scripts/import_nie.ps1 -NiePath "C:\...\nie.exe"
```
Les fichiers atterrissent dans `decomp/functions/`. Ils ne sont plus compilés par CMake.

### Étape 2 : Lancement de l'Agent de Transpilation
L'agent d'Intelligence Artificielle parcourt le dossier `decomp/functions/`, identifie les classes (grâce au RTTI), et génère les équivalents Rust dans `src/Winclean.MlCore/nie_rs/`.
```powershell
cd src/Winclean.MlCore
uv run python -m winclean_ml.agents.transpiler_agent
```

### Étape 3 : Validation (Audit)
Le code généré dans `nie.rs` est compilé avec `cargo check`. Si des erreurs de typage surviennent, l'erreur est renvoyée au modèle ML (Agentic Loop) qui tente de corriger sa traduction en ajustant les durées de vie (lifetimes) ou les types de données.

## Patterns de Translation Typiques (Ghidra -> Rust)

| Pseudo-C (Ghidra) | Objectif Rust (`nie.rs`) |
|--------------------|--------------------------|
| `*(int *)(param_1 + 0x10)` | `self.count` (struct field access) |
| `undefined4 *puVar2` | `let pu_var2: &mut [u32]` |
| `FUN_14023a5b0(param_1)` | `impl PlayerData { fn adjust_skills(&mut self) }` |
| `byte` / `undefined1` | `u8` |
| `ulonglong` / `undefined8`| `u64` ou `usize` (selon le contexte pointeur) |

## Base de connaissances (Structs connues)

L'Agent ML doit être nourri avec les structures exactes pour réussir la translation en Rust :

```rust
// Objectif de translation pour PlayerData
#[repr(C, packed)]
pub struct PlayerData {
    pub player_id: u32,
    pub name_hash: u32,
    pub stats: [i16; 8], // kick, guard, catch, body, control, speed, stamina, luck
    pub position: u8,
    pub element: u8,
    pub rarity: u8,
    pub level: u8,
    pub passive_skill_ids: [u32; 5],
}
```

*Remarque : Ce document annule et remplace toutes les instructions précédentes concernant l'écriture manuelle de wrappers `extern "C"` et la compilation via CMake des fichiers issus de Ghidra.*