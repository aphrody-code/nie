# Recherche RE pilotée par Grok — synthèse actionnable pour niers

Document de recherche produit en interrogeant Grok (xAI, modèle `grok-4.3`) de façon
itérative, puis en vérifiant chaque affirmation critique contre le code réel de niers
(`crates/nie-re/`), la `Cargo.lock` et l'index sparse de crates.io. Les versions de
crates citées par Grok ont été recoupées ; les hallucinations sont signalées.

Date : 2026-06-04. Outil : `mcp__bxc__bxc_grok_chat` indisponible (team xAI sans crédit) ;
accès réel obtenu via la session OIDC `~/.grok/auth.json` (rafraîchie) → API `api.x.ai`
directe avec le bearer OIDC (team avec scope `api:access`).

---

## Recommandations immédiates pour niers

Classées par rapport gain/effort sur notre frontière actuelle (88,20 % de couverture).

1. **Levier `.pdata` (découverte de fonctions) — à tempérer.** Mineur en gain net.
   Le ratio 94 748 entrées `.pdata` vs 59 991 fonctions Ghidra **ne** signifie **pas**
   ~35 k fonctions manquantes. La majorité de l'écart = **fragments chaînés**
   (`UNW_FLAG_CHAININFO`) qui pointent **dans** une fonction parente, pas de nouveaux
   débuts. Après résolution du chaînage + dédup, le **net réellement nouveau** attendu
   est de l'ordre de **300 à 1 200 débuts** (estimation Grok, plausible : Ghidra
   consomme déjà `.pdata` agressivement). De plus `.pdata` **sous-compte** les fonctions
   feuilles (pas d'unwind info → pas d'entrée). Conclusion : implémenter le parse `.pdata`
   reste utile (récupère des fonctions atteintes uniquement par indirection mais qui ont
   de l'unwind info) mais **ne pas en attendre un saut de couverture** ; c'est un
   complément de précision, pas le levier majeur.

2. **Levier vtable depuis RTTI (indirection) — LE meilleur ROI immédiat.** C'est la
   reco convergente de Grok et de l'ARCHITECTURE. Nous avons déjà 1 234 COL localisés
   (`rtti.rs` calcule `col_vaddr` par classe). Algorithme à coût quasi nul, haute
   précision, presque zéro faux positif :
   - balayer `.rdata` par pas de 8 octets ; chaque `u64` égal à un `col_vaddr` connu
     marque une vtable qui **commence 8 octets après** (le pointeur COL est en
     `[vtable-8]`) ;
   - lire les slots `u64` consécutifs (chacun = VA absolue d'une méthode virtuelle dans
     `.text`) jusqu'à la condition d'arrêt (cible hors `.text`) ;
   - chaque slot → **arête de haute précision** « cette fonction appartient au
     sous-système de cette classe ». Cela cible directement le résidu ~11,8 % atteint
     uniquement par vtable. **À faire en premier.**

3. **Propagation de labels : passer à un Label Spreading pondéré.** Reco la plus
   rentable côté ML selon Grok : edges typés et pondérés (direct = 1.0, indirect/vtable
   = 0.4–0.6, RTTI-confirmé = 2.0–3.0), normalisation symétrique
   `Ŝ = D^{-1/2} W D^{-1/2}`, amortissement par degré `1/log(deg+2)` contre les hubs
   (alloc/string utils), seeds **épinglés**, seuil de proba ≥ 0.75. Estimé +4–5 pts de
   couverture avec meilleure précision. Aucune dépendance lourde requise.

4. **Combiner 2 + 3 :** les arêtes vtable (haute confiance) injectées dans le graphe avec
   poids RTTI fort, puis re-spreading, devraient connecter une grande part des îlots
   indirects et faire monter la couverture au-delà de 90 %.

5. **Crates : rester sur `goblin 0.10.7` + `iced-x86 1.21.0`** (déjà en place, ce sont
   les dernières versions). Parser `.pdata`/UNWIND_INFO **à la main** depuis les octets de
   section (goblin n'expose pas l'exception directory de haut niveau). Évaluer `pelite`
   uniquement si l'ergonomie unwind le justifie (cf. §1 ci-dessous, à vérifier).

---

## Sujet 1 — Découverte de fonctions via `.pdata` / `RUNTIME_FUNCTION`

### Faits binaires (confirmés)

- `RUNTIME_FUNCTION` = **12 octets**, 3 × `u32` RVA :
  `BeginAddress`, `EndAddress` (exclusif), `UnwindInfoAddress`.
- Vit dans l'**Exception Directory** = `IMAGE_DIRECTORY_ENTRY_EXCEPTION` (**index 3** des
  data directories de l'optional header).
- Table **triée par `BeginAddress` croissant** (le loader/unwinder l'exige).

### Layout `UNWIND_INFO` (offsets exacts, à `UnwindInfoAddress`)

```
octet 0 : Version (bits 0-2) | Flags (bits 3-7)   → flags = byte0 >> 3
octet 1 : SizeOfProlog
octet 2 : CountOfUnwindCodes
octet 3 : FrameRegister (bits 0-3) | FrameOffset (bits 4-7)
octet 4 : UnwindCode[CountOfUnwindCodes]  (2 octets chacun)
puis, données de queue (alignées 4 octets) :
  - si UNW_FLAG_CHAININFO (0x4) : un RUNTIME_FUNCTION (12 octets)
  - sinon si EHANDLER/UHANDLER : ExceptionHandler (u32 RVA) + données spécifiques langage
```

`UNW_FLAG_CHAININFO = 0x4` est dans le **nibble haut** du 1er octet (après `>> 3`).

### Offset du RUNTIME_FUNCTION chaîné (formule confirmée par Grok)

```
offset_queue = 4 + ((CountOfUnwindCodes + 1) & !1) * 2
```

Le tableau d'UnwindCode est arrondi à un nombre **pair** de slots (alignement 4 octets)
avant la queue. Quand `CHAININFO` est posé, le `RUNTIME_FUNCTION` parent (12 octets) est
**exactement** à `UnwindInfoAddress + offset_queue`.

### Pièges (à traiter, sinon sur-comptage massif)

1. **Chaînage (`CHAININFO`)** : l'entrée décrit un **fragment** d'une fonction parente,
   pas un nouveau début. Suivre la chaîne (potentiellement plusieurs niveaux) jusqu'au
   `RUNTIME_FUNCTION` **primaire** (flags sans CHAININFO) et ne garder que **son**
   `BeginAddress`.
2. **Fonctions non contiguës** : plusieurs `RUNTIME_FUNCTION` pour une seule fonction
   logique (blocs froids séparés) → coalescer via le chaînage.
3. **Fonctions feuilles sans unwind info** : **aucune** entrée `.pdata`. Donc `.pdata`
   **sous-compte** les feuilles. → Le gap 94k/60k est dominé par des fragments, pas par
   35 k vraies fonctions.

### Crates Rust (vérifié contre crates.io, 2026-06)

| Crate | Dernière version (réelle) | Exception/unwind |
|---|---|---|
| `goblin` | **0.10.7** (déjà utilisée par niers) | Pas de parseur `RUNTIME_FUNCTION` de haut niveau ; lire le data directory soi-même + slicer la section |
| `object` | **0.39.1** | `object::read::pe` ; pas d'itérateur `.pdata` first-class non plus |
| `pelite` | **0.10.0** | Le plus orienté unwind selon Grok (types `ExceptionData`/`RuntimeFunction`), MIT — **À VÉRIFIER** : Grok a explicitement hésité sur l'existence d'une API `unwind_info()` native |
| `exe` | **0.5.7** | Minimal, à éviter |

> **Hallucination corrigée** : Grok avait d'abord estimé `object` en « 0.36.x » — la
> version réelle est **0.39.1**. Il a aussi affirmé sans certitude que pelite expose
> `pe64::Exception::functions()` et des types `ExceptionData` ; **non vérifié** contre la
> source pelite (non vendorée localement). À confirmer avant d'ajouter la dépendance.

### Reco niers pour `.pdata`

Rester sur **goblin** (déjà en place pour `PE::parse` dans `rtti.rs`/`disasm.rs`) et
parser `.pdata` manuellement : lire le data directory index 3
(`pe.header.optional_header` → `data_directories`), localiser la section, itérer les
entrées de 12 octets, lire le 1er octet d'`UNWIND_INFO`, suivre `CHAININFO` via la
formule ci-dessus, collecter le `BeginAddress` primaire, dédupliquer (`BTreeSet<u32>`),
puis **unir** avec l'ensemble de fonctions existant. Ne pas ajouter pelite tant que le
parse manuel (≈30 lignes) suffit.

### Algorithme (pseudocode validé)

```rust
fn collect_true_function_starts(pe, bytes) -> BTreeSet<u32> {
    let mut starts = BTreeSet::new();
    for rt in runtime_functions(pe) {            // 12 octets chacun, depuis data dir 3
        starts.insert(resolve_primary_begin(pe, bytes, rt));
    }
    starts                                       // puis union avec le set Ghidra
}

fn resolve_primary_begin(pe, bytes, mut rt) -> u32 {
    loop {
        let ui = rt.unwind_info_address;
        let flags = read_u8(bytes, rva_to_off(ui)) >> 3;
        if flags & 0x4 == 0 { return rt.begin_address; }     // primaire
        let count = read_u8(bytes, rva_to_off(ui) + 2);
        let off = 4 + (((count as usize + 1) & !1) * 2);
        rt = read_runtime_function(bytes, rva_to_off(ui) + off); // chaîné
    }
}
```

---

## Sujet 2 — Meilleures crates Rust pour le RE x86-64 (2026)

### PE : goblin vs object vs pelite

- **goblin 0.10.7** : expose les data directories via
  `pe.header.optional_header.data_directories` ; **pas** de parseur `RUNTIME_FUNCTION`
  prêt à l'emploi → on lit RVA/size et on slice. C'est exactement ce que fait déjà niers
  (`rtti.rs` lit `.rdata` à la main). MIT/Apache.
- **object 0.39.1** : accès sections/symboles plus riche mais pas d'itérateur `.pdata`
  first-class ; pas de raison de migrer pour notre usage.
- **pelite 0.10.0** : présenté comme le plus ergonomique pour l'unwind (MIT). **À
  vérifier** (cf. Sujet 1).

**Reco : conserver goblin** + parse `.pdata` manuel ; pelite seulement si l'API unwind
native est confirmée et fait gagner du temps. Contrainte non-GPL respectée (tous MIT/Apache).

### iced-x86 1.21.0 (méthodes vérifiées contre `crates/nie-re/src/disasm.rs`)

- **Décodage de masse** : réutiliser un seul `Instruction` + `Decoder::decode_out`. Nos
  ~5,8 M instructions en ~0,4 s sont déjà dans la zone haute perf ; gains supplémentaires
  uniquement par décodage parallèle de régions disjointes ou en sautant les zones data.
- **Cibles `call`/`jmp` rel32 directes** : `insn.near_branch64()` (renvoie la VA
  absolue). **Déjà utilisé** par niers (`disasm.rs:116,190,481`).
- **`flow_control()` → enum `FlowControl`** (`Call`, `UnconditionalBranch`,
  `ConditionalBranch`, `Return`, `IndirectCall`, `IndirectBranch`…). **Déjà utilisé.**
- **LEA RIP-relatif vers `.rdata`** (références de pointeurs de fonctions / chargements
  de vtable) — **pas encore utilisé**, c'est la prochaine étape :
  `insn.op_kind(0) == OpKind::Memory && insn.memory_base() == Register::RIP`, puis
  `insn.memory_displacement64()` donne la cible absolue ; `insn.is_ip_rel_memory_operand()`
  comme garde. **À vérifier** la signature exacte de `is_ip_rel_memory_operand` (avec ou
  sans index d'opérande) contre la doc 1.21.

### Autres crates 2026

- `yaxpeax-x86` : existe, plus lent, API différente — non retenu.
- `zydis` (bindings) : ajoute une dépendance C — non retenu.
- Pas de crate Rust de « control-flow recovery » de niveau production non-GPL à adopter ;
  on construit le graphe sur `FlowControl` + notre propre logique (déjà le cas).

---

## Sujet 3 — Résolution des appels indirects / vtables (analyse statique pure Rust)

### Layout vtable MSVC x64 (confirmé)

- À **`vtable - 8`** : un `u64` pointant vers le `_RTTICompleteObjectLocator` (COL) de la
  classe. La vtable elle-même = tableau de `u64` (VA absolues de méthodes) à partir de
  `vtable`.
- **Énumération depuis nos COL** (nous avons déjà `col_vaddr` par classe dans `rtti.rs`) :
  balayer `.rdata` par pas de 8 ; chaque `u64 == col_vaddr` connu → la vtable commence à
  `+8`. Lire les slots tant que la cible est dans `.text` (condition d'arrêt principale ;
  arrêt secondaire : cible dans `.rdata` = COL/TypeDescriptor suivant).
- Chaque slot → mapping `function_va → classe` (via vtable → COL → classe), haute
  précision, quasi zéro faux positif.

### Références de pointeurs de fonctions (`lea reg, [rip+disp]`)

Quand la cible d'un `lea` tombe sur un début de fonction connu = prise de pointeur
(callback, construction de vtable, jump table). **Dédup vs slots vtable** : si la cible du
`lea` est déjà dans une vtable énumérée → ignorer ; sinon = callback/délégué autonome.

### VSA légère (appels indirects non-vtable)

Réaliste en Rust pur sans moteur lourd : **propagation de constantes intra-procédurale**
avec un domaine abstrait minuscule `{ Unknown, VtableBase(u64) }`. Suivre `reg` et
`[reg+petit_offset]` quand la valeur est une base de vtable connue ; résoudre
`call qword [rax + slot*8]` quand `rax` provient d'un chargement de vtable prouvé.
≈200–300 lignes, couvre la majorité des `call [rcx+offset]` vtable-based. Au-delà
(inter-procédural, phi) = rendements fortement décroissants.

### Tables de saut (switch MSVC)

Motif : `lea rax,[rip+table]` / `movsxd rcx,[...]` / `add rax,rcx` / `jmp qword [rax]`,
ou `jmp qword [reg*8 + disp]` avec `disp` dans `.rdata`. Lire la table comme `u64`
(absolu) ou `u32` (image-relative) jusqu'à une valeur non-code. Ajoute des arêtes
intra-procédurales + découvre du code. Bon marché, haute précision.

### Priorité (reco unique de plus haute précision / plus faible effort)

**Énumérer les vtables depuis les COL connus → assigner chaque fonction-slot au
sous-système de la classe.** On a déjà les 1 234 COL ; le scan est trivial et stable ;
cible directement le résidu ~11,8 % indirect. À faire avant les `lea`, la VSA légère et
les jump tables. Références d'implémentation : write-ups MSVC RTTI (Igor Skochinsky, Rolf
Rolles), logique vtable de Ghidra/IDA.

> Note de vérification : niers (`rtti.rs`) calcule déjà `col_vaddr` (VA du COL) et lit
> `.rdata` brut — toute l'entrée nécessaire à cet algorithme est disponible. Le scan
> doit utiliser des **VA absolues** (`image_base + rdata_vaddr + offset`), cohérent avec
> le calcul `col_vaddr` existant.

---

## Sujet 4 — Propagation de labels / ML semi-supervisé sur le call-graph

### Label Spreading > Label Propagation

Plus robuste aux arêtes bruitées (indirect/vtable). Règle de mise à jour :

```
F^(t+1) = α · Ŝ · F^(t) + (1-α) · Y        avec Ŝ = D^{-1/2} W D^{-1/2}
```

`Y` = matrice one-hot des seeds (épinglés), `α ≈ 0.85–0.95`, arrêt sur
`‖F^(t+1)-F^(t)‖_F < ε` ou < 50 itérations.

### Pondération d'arêtes (le changement le plus rentable)

- call direct : 1.0
- vtable/indirect : 0.4–0.6
- arête confirmée RTTI : 2.0–3.0 (or)
- call count (si dispo) : × `min(1, log(count+1)/3)`
- normaliser après pondération.

### Features par ROI (du meilleur au marginal)

1. Distribution des labels voisins (histogramme 12-dim — quasi gratuit)
2. n-grams de strings référencées (mots-clés sous-systèmes, strings d'erreur) — très discriminant
3. Set d'API importées (Win32 + CRT) — fort pour render/network/audio
4. Degré in/out + degré des voisins (log) — détecte les hubs
5. Taille fonction + nb de basic blocks
6. Classe/namespace RTTI — prior fort
7. 2-grams de mnémoniques / histogrammes d'octets — marginal une fois 1-6 en place

### Modèles

À 60k nœuds / 3k labels : **Label Spreading pondéré + amortissement de degré** d'abord,
puis éventuellement un **GBDT** (gradient boosting) sur features structurelles + probas de
spreading + strings/API (meilleure étape suivante). **GNN (GraphSAGE/RGCN) : pas rentable
ici** (3k labels = trop peu, fragile, un GBDT bien réglé égale ou bat un petit GNN avec
bien moins de complexité).

### Anti-dérive (hubs)

Épingler les seeds ; **amortir par degré** `1/log(deg+2)` (très efficace contre
alloc/string utils) ; **seuil de proba** ≥ 0.75–0.85 (laisser non-labellisé sinon) ;
réduire l'influence des nœuds à haute entropie ; optionnel : spreading en 2 phases
(bas/moyen degré d'abord, puis hubs avec seuils stricts).

### Prochaine étape concrète

1. Label Spreading pondéré (normalisation symétrique) + poids par type d'arête +
   amortissement de degré + seeds épinglés → vise 92–93 %.
2. Extraire features (12-dim soft labels + degré + indicateurs strings/API) ; entraîner un
   petit GBDT (LightGBM offline en Python acceptable) sur les 3 112 seeds ; corriger la
   sortie de spreading ou ajouter 1–2k pseudo-labels haute confiance et re-spreader.
3. GraphSAGE seulement après convergence (probablement inutile).

### Crates (à utiliser avec prudence)

- `petgraph` 0.6 (graphe)
- `nalgebra` 0.33 + `nalgebra-sparse` (algèbre creuse ; itération écrite à la main)
- `linfa` 0.7 (régression logistique baseline uniquement ; immature pour GBDT)
- `smartcore` (plus léger, plus faible sur les arbres)
- réalité : pour un GBDT sérieux, **étape Python offline** (LightGBM/XGBoost) + charger les
  prédictions. **Versions à vérifier sur crates.io** (Grok n'a pas confirmé `linfa 0.7` /
  `petgraph 0.6` comme actuelles).

---

## Sujet 5 — Contraintes `wasm32-unknown-unknown`

### Ce qui casse silencieusement

- `std::fs::*`, `std::net::*` : erreurs dures.
- `std::time::{Instant, SystemTime}` : `Instant::now()`/`SystemTime` inexistants sous wasm
  (mais `Duration` OK).
- `std::thread::*` : pas de threads sauf `+atomics,+bulk-memory` + mémoire partagée
  (expérimental).
- Randomness : `getrandom`/`rand` échouent au runtime sauf feature `js` (ou
  `register_custom_getrandom!`).

Abstraction : `web-time` (ou `wasmtimer`) pour le temps monotone sous wasm ; feature-gate
le temps/random derrière un `cfg(feature = "wasm")`.

### no_std + alloc

- `alloc` fournit : `Vec`, `String`, `Box`, `Rc`/`Arc`, `BTreeMap`/`BTreeSet`, `VecDeque`,
  `BinaryHeap`.
- **`HashMap`/`HashSet` sont dans `std`** (à cause de `RandomState`), **pas** dans `alloc`.
  → utiliser **`hashbrown`** (0.15+, feature `alloc`) dans `nie-core`/`nie-data`/`nie-formats`,
  ou `indexmap` (no_std) si l'ordre d'insertion importe.

### Perf décodage binaire sous wasm

- Le coût dominant des parsers (CRILAYLA/@UTF) = **bounds checks** sur `&[u8]`.
  `get_unchecked` + `debug_assert!` dans les boucles chaudes (mesurer).
- `memory.grow` coûteux → **pré-allouer** les gros `Vec` une fois.
- SIMD128 (`core::arch::wasm32`) stable ; pour les boucles copy/match de décompression
  LZ-like (CRILAYLA), gain typique **1,4–2×** sur gros fichiers à longs matches. Gater
  derrière `target_feature = "simd128"`. Post-traiter avec `wasm-opt -O3 --enable-simd`.

### wasm-bindgen vs raw (nie-wasm → Next.js)

- `wasm-bindgen` 0.2.100+ ; `wasm-pack build --target web` (ES modules) pour la conso en
  bibliothèque depuis Next.js (préférer `--target web` à `bundler`).
- **Gros `Vec<u8>` → JS** : `Uint8Array::from(slice)` **copie** côté JS. Pour les sorties
  CRILAYLA de plusieurs Mio, garder le buffer décodé **dans** le wasm et exposer
  pointeur+longueur + une méthode `copy_to_js` explicite, ou une vue `js_sys::Uint8Array`
  sur la mémoire wasm (zéro-copie).

### Déterminisme jeu (sim soccer)

- `f32`/`f64` : déterministes entre runs wasm (même toolchain) mais **pas bit-à-bit
  identiques à x86-64 natif** (contraction FMA, arrondi LLVM, `libm` vs hardware).
- Reco parité natif/wasm : **fixed-point / entier** pour la sim (crate `fixed`), ou
  isoler les floats derrière un trait forçant `libm` sur les deux cibles. Ne jamais
  dépendre de l'ordre d'itération de `HashMap` ni d'`Instant` pour la logique de jeu.

### Crates (à épingler, vérifier sur crates.io)

`hashbrown` (0.15+), `getrandom` (feature `js`), `wasm-bindgen` (0.2.100+),
`web-time`, `fixed`, outil `wasm-pack`. **Versions exactes non recoupées par Grok** —
vérifier avant épinglage.

---

## Vérifications & incertitudes (transparence)

- **Versions crates recoupées contre l'index sparse crates.io (2026-06)** : `object 0.39.1`,
  `goblin 0.10.7`, `pelite 0.10.0`, `exe 0.5.7`, `iced-x86 1.21.0`. Grok avait halluciné
  `object 0.36.x` (faux).
- **Méthodes iced-x86** (`near_branch64`, `flow_control`, `FlowControl::*`, `OpKind`)
  confirmées présentes dans `crates/nie-re/src/disasm.rs`. `memory_displacement64`,
  `is_ip_rel_memory_operand`, `memory_base()` non encore utilisées → **vérifier les
  signatures exactes** (notamment l'argument d'index d'opérande) contre la doc 1.21 avant
  usage.
- **pelite API unwind** (`Exception::functions()`, types `ExceptionData`/`RuntimeFunction`,
  méthode `unwind_info()`) : affirmée par Grok **avec hésitation explicite**, **non
  vérifiée** contre la source pelite. Ne pas dépendre dessus sans contrôle.
- **Estimation net `.pdata`** (300–1200 nouveaux débuts) = heuristique Grok, plausible
  mais non mesurée ; à confirmer empiriquement en implémentant le parse.
- **Versions ML/graphe** (`linfa 0.7`, `petgraph 0.6`, `nalgebra 0.33`, `hashbrown 0.15`,
  `wasm-bindgen 0.2.100`) données par Grok **sans recoupement** → vérifier sur crates.io
  au moment de l'ajout.
