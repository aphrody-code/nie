# Éditeur mémoire live — `nie-edit`

> Instrument de **reverse-engineering bidirectionnel** : lit **et écrit** la mémoire du vrai `nie.exe`
> Windows natif (Steam) pour *valider au réel* les structures reversées — change une valeur, observe
> l'effet, confirme l'offset. Pilote ses localisateurs depuis le **dump mémoire** exploité dans
> [`dump-exploitation.md`](./dump-exploitation.md). Jeu **possédé**, en local, hors-ligne.

Crate `nie-trace` (binaire `nie-edit`, à côté de `nie-mem`). Cross-compilé depuis WSL
(`cargo build -p nie-trace --bin nie-edit --target x86_64-pc-windows-gnu`) puis lancé via l'interop
WSL→Windows. Compile aussi sous Linux (backend Wine `process_vm_writev`).

## Pourquoi écrire la mémoire ?

`nie-mem` ne fait que **lire** (valide les offsets statiques). `nie-edit` ferme la boucle : poser une
valeur connue à une adresse résolue puis observer le jeu **prouve** la sémantique d'un offset bien
mieux qu'une lecture passive. C'est la suite directe du but de `nie-trace` (« lire la mémoire vivante
pour valider les structures C++ reversées ») — désormais en lecture **et** écriture.

## Architecture

| Couche | Élément | Rôle |
|---|---|---|
| Primitives | `nie_trace::{write, write_exact, write_u8/u16/u32/i32/u64/f32}` | écriture live (dispatch Windows/Wine) |
| Primitives | `win_memory::write` | `VirtualProtectEx`(RW) → `WriteProcessMemory` → restaure protection → `FlushInstructionCache` |
| Primitives | `read_u8/u16/i32/f32` + `resolve_chain(base, &[offsets])` | lecture typée + chaîne de pointeurs façon Cheat-Engine |
| AOB | `nie_trace::aob::Pattern` | motif à **masque** (`44 8B ?? 10`) + `disp8`/`disp32`/`rip_target` (décodage d'opérande) |
| AOB | `scan_regions_masked` | scan live à wildcards (le scan natif `scan_regions` reste exact-match) |
| Catalogue | `nie_trace::catalog` | table figée des localisateurs dérivés du dump (`Entry`, `Ty`, `Kind`, `Category`) |
| CLI | `nie-edit` | `list`/`info`/`slide`/`resolve`/`get`/`set`/`get-va`/`set-va`/`ptr`/`watch`/`scan`/`patch`/`nop` |

## Le catalogue (dérivé du dump)

**25 entrées**, chacune mappe un concept d'`nie.exe` vers la façon de le retrouver dans le process
vivant : signature AOB (à scanner), RVA validée au dump, et — selon le concept — un offset de champ
décodé ou une chaîne de pointeurs. Trois natures (`Kind`) :

- **`Toggle`** — site de **code** que le trainer d'origine patche (comportement on/off). `nie-edit` le
  *résout* et le *vérifie* contre la RVA du dump ; il **ne réimplémente pas** l'injection de code
  propriétaire. Modifier le code se fait à la main via `patch`/`nop` (primitives RE génériques).
- **`StructField`** — scalaire dans un objet : résolu par `base d'objet + offset` ou chaîne de
  pointeurs (`--base 0xADDR`). Ex. **tension** : l'AOB `8B 80 58 10 00 00` décode littéralement
  `mov eax,[rax+0x1058]` → la valeur vit à `entity+0x1058`. **rank** : `[singleton+0x69A0]+0x5C`.
- **`Value`** — scalaire directement lisible une fois l'adresse résolue.

**Discipline anti-devinette** : `rva = None` pour les entrées dont l'AOB **n'a pas été retrouvé au
dump** (hors-match) — `rank`, `unlimited-spirits`, `passive-value`, `special-move-type`. On ne pose
jamais une adresse supposée. Les ambiguïtés sont notées (ex. `free-buy-shop` : `hits_nie=2`,
`hits_other=24` → site à confirmer). La table figée est testée (chaque motif parse, RVAs dans l'image,
`StructField` a toujours un localisateur).

Catégories : `player` (3), `match` (8 : tension, rank, chrono, cooldowns, gels), `shop` (3),
`spirit` (7), `passive` (4). Source de vérité : `crates/forge/nie-trace/src/catalog.rs` (ne pas dupliquer
les RVAs ici — `nie-edit list` / `nie-edit info <id>` les imprime).

## Flux de travail RE

```
# 1. ASLR : base de chargement live + slide
nie-edit slide
#   nie.exe @ 0x7FF7E0C30000  →  slide ASLR 0x7FF6A0C30000

# 2. Vérifier la carte AOB→RVA du dump contre le process VIVANT (auto-check ✓/drift)
nie-edit resolve --all
#   tension  0x7FF7E1AC014D  rva 0xE9014D  ✓ = dump
#   ...      X ✓   Y drift   Z introuvable

# 3. Lire une valeur (champ d'objet → fournir la base de l'objet)
nie-edit get tension --base 0x<entity>
nie-edit ptr 0x<singleton> +0x69A0 +0x5C :i32      # rang, chaîne de pointeurs

# 4. Écrire — exige --force (sinon DRY-RUN)
nie-edit set tension 4000 --base 0x<entity> --force
nie-edit set-va nie.exe+0xE9014D :u32 1234 --force

# 5. Observer en direct (détection de changement)
nie-edit watch tension --base 0x<entity> --interval 250

# 6. Bas niveau (RE)
nie-edit scan '8B 80 ?? 10 00 00' --limit 5         # AOB à masque dans le process
nie-edit patch 0x<va> '90 90' --save orig.bin --force  # patch + sauvegarde d'origine
```

## Sûreté

- **Écritures gardées** : `set`/`set-va`/`patch`/`nop` exigent `--force` ; sans lui, *dry-run* qui
  n'imprime que ce qui serait écrit. `patch`/`nop` peuvent sauvegarder les octets d'origine
  (`--save FICHIER`) pour restauration manuelle.
- **Protection de page** : `win_memory::write` déverrouille la page (`VirtualProtectEx`), écrit, puis
  **restaure** la protection d'origine et vide le cache d'instructions. `GetLastError` est capturé
  **avant** la restauration (qui l'écraserait).
- Écrire dans un process actif peut le déstabiliser — instrument de RE, pas de production.

## Tests & couverture

La couverture du crate `nie-trace` est portée à **~98 % de lignes** (`cargo llvm-cov`, vs 28 % avant).
Astuce clé : sous Linux, `process_vm_readv`/`writev` opèrent sur le **propre process du test** (`mm`
partagé), donc les *chemins de succès* lecture/écriture/scan/chaîne sont exercés au réel sans `nie.exe`
lancé (`tests/self_mem.rs`). Les binaires `nie-edit`/`nie-mem` pilotent `run()` via `--pid <self>` +
des marqueurs AOB implantés dans l'image de test. La logique de verdict est isolée en pur
(`classify_rva` → `Match`/`Drift`/`New`) et testée directement.

Les rares lignes non couvertes sont **irréductibles sur cet hôte** : `main()` (le harnais de test le
remplace), le parse de l'en-tête PE `SizeOfImage` de `module_range` (ne s'exécute qu'avec un PE
chargé sous Wine), et une branche défensive sans entrée correspondante. `--module` (ajouté sur
`slide`/`resolve`/`scan`) permet de cibler n'importe quel module, pas seulement `nie.exe`.

## Lien avec le reste

Complète [`dump-exploitation.md`](./dump-exploitation.md) (le dump *offline* d'où viennent les
localisateurs) et le flux `nie-mem` (lecture seule). La résolution AOB live + l'auto-check des RVAs
sert aussi à **mesurer la dérive de build** (vtable/hook live ≠ `var/niers.sqlite`) sur n'importe
quel build du jeu, sans re-dumper.
