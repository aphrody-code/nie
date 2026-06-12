# Décompilation ciblée du modèle de résolution de match (IEVR / nie_eacpatched.exe)

Date : 2026-06-10
Suite directe de `docs/recherche-modele-match.md` (qui **localisait** les fonctions ; ce
document les **décompile** via Ghidra headless et évalue leur portabilité vers
`crates/nie-core/src/match_sim.rs`).

Méthode, outils, et pièges sont consignés ci-dessous **avant** les résultats, par discipline
d'honnêteté du repo. Distinction maintenue partout : *décompilé* ≠ *compris* ≠ *portable*.

---

## 0. Méthode et avertissements de fiabilité

- **Outil** : Ghidra 12.0.4, `analyzeHeadless`, Java 21. Décompilation par `DecompInterface`
  via deux postScripts Java (`var/ghidra-scripts/DecompileTargets.java`,
  `DecompileTargets2.java`).
- **Le projet Ghidra « déjà analysé » (`/home/ubuntu/rg/iecode/re/ghidra/proj/nieproj`) est
  VIDE.** Son index interne (`nieproj.rep/idata/~index.dat`) porte `NEXT-ID:0` et le MD5 du
  fichier vide : aucun programme n'y a jamais été importé. Le mode `-readOnly -process` sur lui
  était donc impossible. **Fallback appliqué** (prévu par la consigne) : import jetable de
  `nie_eacpatched.exe` dans `/tmp/niers-ghidra-decompile` (projet `niedecomp`). Le projet
  d'origine n'a **pas** été touché.
- **Mode d'analyse : `-noanalysis`.** Choix délibéré : l'auto-analyse complète d'un PE de 31 Mo
  est trop lente/risquée (pression mémoire : swap déjà à 95 %). À la place, le script
  désassemble manuellement chaque cible (`DisassembleCommand` followFlow) puis la décompile.
  **Conséquence honnête** : les signatures sont génériques (`undefined8 param_n`, conventions
  d'appel non inférées, pas de types de données, chaînes non résolues comme symboles). En
  revanche le **flot de contrôle, l'arithmétique et les constantes** — la seule chose qui compte
  pour ces cibles — sont corrects et lisibles. La deuxième passe a été lancée en
  `-readOnly` (aucune écriture au projet).
- **Les adresses hexadécimales de la consigne étaient erronées** (incohérentes avec les vaddr
  décimaux). Les **vaddr décimaux** de `niers.sqlite` font foi ; toutes les conversions ont été
  refaites (cf. tableau §1). Exemple : `5388425120` = `0x1412CD7A0` (la consigne disait
  `0x1414C4B20`, faux).
- **Fichiers `.c` produits** : `var/ghidra-decompile/*.c` (13 fichiers + `_meta/index.txt`).
  Chaque fichier contient en en-tête : adresse demandée vs début réel, signature, xrefs
  entrants, callees sortants, puis le C décompilé.

---

## 1. Tableau récapitulatif des cibles

| Cible (consigne)                      | vaddr décimal | adresse réelle | statut décompilation | fichier |
|---------------------------------------|---------------|----------------|----------------------|---------|
| FocusBtlState::vmethod_1              | 5388425120    | 0x1412CD7A0    | OK (début exact)     | `FocusBtlState_vmethod_1.c` |
| keeper caller 1                       | 5371907520    | 0x14030CDC0    | OK                   | `keeper_caller_1_14030CDC0.c` |
| keeper caller 2                       | 5371908160    | 0x14030D040    | OK                   | `keeper_caller_2_14030D040.c` |
| keeper caller 3                       | 5371910112    | 0x14030D7E0    | OK                   | `keeper_caller_3_14030D7E0.c` |
| keeper caller 4                       | 5371911904    | 0x14030DEE0    | OK                   | `keeper_caller_4_14030DEE0.c` |
| loader fixPkWin{Min,Max}Percentage    | 5372443760    | **adresse FAUSSE** → vraie = 0x140390090 | OK (corrigé) | `loader_fixPkWinPercentage_14038FC70.c` (=`int3`), `loader_pk_params_140390090.c` (vrai) |
| lives::CRand::vmethod_1 (seed)        | 5371513936    | 0x1402ACC50    | OK                   | `CRand_vmethod_1.c` |
| lives::CRand::vmethod_4 (next/bornée) | 5371514048    | 0x1402ACCC0    | OK                   | `CRand_vmethod_4.c` |
| lives::CRand::vmethod_0 (destructeur) | 5371514304    | 0x1402ACDC0    | OK                   | `CRand_vmethod_0.c` |

Fonctions **délégués** décompilées en plus (révélées par les cibles, indispensables pour
comprendre la résolution) :

| Fonction | vaddr | rôle | fichier |
|----------|-------|------|---------|
| genrand brut MT19937   | 0x1402B36C0 | corps PRNG appelé par CRand::vmethod_4 | `CRand_genrand_helper_1402b36c0.c` |
| FocusBtl resolver      | 0x1410729D0 | délégué appelé par FocusBtlState::vmethod_1 | `FocusBtl_resolver_1410729d0.c` |
| keeper cmd callback    | 0x14030DDE0 | callback exécuté à la résolution du tir gardien | `keeper_cmd_callback_14030dde0.c` |

---

## 2. Le PRNG `lives::CRand` = **Mersenne Twister MT19937** (CONFIRMÉ, bit-exact)

C'est le résultat le plus net de cette session. Les trois sources concordent
(`CRand_vmethod_1.c` = seed, `CRand_vmethod_4.c` = next, `CRand_genrand_helper_1402b36c0.c` =
genrand brut).

### 2.1 Preuve par les constantes

| Constante / structure                              | Valeur trouvée | Signification MT19937 |
|----------------------------------------------------|----------------|-----------------------|
| Multiplicateur d'init                              | `0x6C078965` (1812433253) | `mt[i] = 1812433253*(mt[i-1]^(mt[i-1]>>30))+i` |
| Taille d'état                                      | `0x270` = 624 mots u32 | n = 624 |
| Offset de torsion (`m`)                            | index `0x18C/0x18D` rel. | m = 397 |
| MATRIX_A                                           | `0x9908B0DF` | constante de torsion MT |
| UPPER_MASK / LOWER_MASK                            | `0x80000000` / `0x7FFFFFFF` | masques de bit haut/bas |
| Tempering shift u, l                               | `>> 0xB` (11), `>> 0x12` (18) | shifts standard |
| Tempering shift s, t                               | `<< 7`, `<< 0xF` (15) | shifts standard |
| Tempering mask b                                   | `0x9D2C5680` | **standard** (cf. §2.2) |
| Tempering mask c                                   | `0xEFC60000` | **standard** (cf. §2.2) |

Le seed (`vmethod_1`) reproduit **mot pour mot** `init_genrand` :
```c
mt[0] = seed;                                  // stocké à this+0x0c
for (i=1; i<624; i++)
    mt[i] = 1812433253u*(mt[i-1]^(mt[i-1]>>30)) + i;   // à this+0x10..
mti = 624;                                     // this+0x08
```
Le genrand (`vmethod_4` inline ET `0x1402B36C0`) reproduit la torsion 624/397 + le tempering
standard, puis renvoie le mot trempé.

### 2.2 Le piège des masques « non standard » — résolu

La décompilation montre `(y & 0xff3a58ad) << 7` et `(y & 0xffffdf8c) << 15`, masques **qui ne
ressemblent pas** aux standards `0x9d2c5680` / `0xefc60000`. C'est une **réécriture du
compilateur** de `(y << s) & B` en `(y & (B>>s)) << s` (les bits hauts éliminés par le shift
sont « don't care »). Vérifié numériquement sur 7 vecteurs de test :

```
(y & 0xff3a58ad) << 7  ≡ (y << 7)  & 0x9d2c5680   → True
(y & 0xffffdf8c) << 15 ≡ (y << 15) & 0xefc60000   → True
0xff3a58ad & 0x01ffffff == 0x9d2c5680 >> 7        (= 0x13a58ad)
0xffffdf8c & 0x0001ffff == 0xefc60000 >> 15       (= 0x1df8c)
```

Donc B et C sont **les masques MT19937 canoniques**, bit-exact.

### 2.3 Layout mémoire de l'objet `CRand` (struct, taille 0x1398)

`vmethod_0` est le **destructeur** scalaire-deleting MSVC (`if (flags&1) operator_delete(this,
0x1398)`), pas un générateur — la note de `recherche-modele-match.md` §B (« CRand::vmethod_0
appelée depuis le calcul de parade ») est donc **inexacte** : le tirage est `vmethod_4`, pas
`vmethod_0`.

| Offset | Champ |
|--------|-------|
| +0x00  | vftable (`&UNK_1417C32E8`) |
| +0x08  | `mti` (index courant, u32 ; = 624 après seed) |
| +0x0C  | `mt[0..623]` (624 × u32) |
| +0x1390| compteur de tirages (incrémenté à chaque `vmethod_4`) |
| +0x1394| copie du seed |
| mot[0x4E1] depuis this+8 | **masque de tempering `d`** (étape `y>>11 & d`) — voir incertitude |

### 2.4 Génération bornée — méthode de Lemire

`vmethod_4(this, n)` : si `n != 0`, tire un brut `r = genrand()` puis applique
`(uint)((u64)r * range)` avec rejet par seuil `(2^32 mod range)` (`-range % range`) et renvoie
`mulhi(r, range)` — c'est **l'algorithme de Lemire** (multiplication 64 bits, biais ~nul). Si
`n == 0`, renvoie le brut.

### 2.5 Portabilité : **DIRECTE (élevée)**, avec une seule réserve

- Algorithme = MT19937 de référence + bornage Lemire. Portage Rust trivial et **bit-exact pour
  un même seed**, à condition de répliquer aussi l'étape `next(n)` (Lemire) et l'ordre de
  consommation.
- **Seule incertitude pour le bit-exact** : l'étape de tempering `y ^= (y >> 11) & d` utilise un
  masque `d` **stocké dans la struct** (pas un littéral). En MT19937 canonique `d = 0xFFFFFFFF`
  (i.e. `y ^= y>>11`). C'est presque certainement le cas ici, mais la valeur est posée ailleurs
  (constructeur/init, non décompilé). **À vérifier** avant de déclarer un port byte-exact : lire
  la valeur écrite au mot `0x4E1`. Tant que non vérifié : porter avec `d = 0xFFFFFFFF` et
  marquer INCOMPLET.
- **Conséquence pour `match_sim.rs`** : remplacer Splitmix64 (inventé) par MT19937. Mais attention
  (cf. §3-4) : le PRNG n'est *pas* le cœur de la résolution de tir/but — il est généraliste
  (`lives::`, aussi utilisé au rendu). Le porter ne « débloque » pas à lui seul la résolution.

---

## 3. `FocusBtlState::vmethod_1` + son délégué `FUN_1410729D0`

### 3.1 vmethod_1 (0x1412CD7A0) = **OnEnter / activation**, pas la résolution par frame

Décompilé proprement (début exact, 205 o). Ce n'est **pas** la boucle de résolution comme le
supposait `recherche-modele-match.md` §Priorité 1 — c'est l'entrée d'état (one-shot) :

- `FUN_1414f7eb0(1)` puis pose des **bits de flag** à `state+0x10` : toujours `| 2`,
  conditionnellement `| 0xC` si le flag d'équipe `(team+0x1030) & 4`.
- Pose des flags globaux (`+0x1918 |= 1` puis `|= 2`), joue un **effet par ID haché
  `0xD4F6EC81`** (`FUN_1414ec8c0`), écrit `1` à `*(scene+0xACF6)`.
- **Calcule le résultat d'état** : `cVar4 = FUN_1410729d0(1, state+0x2c); state+0x24 = cVar4 ? 0
  : 3;` → `state+0x24` (le `end_counter`/code de sortie connu de la FSM) vaut **0 (succès)** ou
  **3 (échec/abandon)** selon le délégué.

La résolution réelle est **déléguée** à `FUN_1410729D0`.

### 3.2 `FUN_1410729D0` (0x1410729D0) = **dispatch d'événement haché**, pas une formule

Findings majeur et honnête : **la résolution du combat de focus n'est pas une formule
arithmétique inline.** Elle est *event-driven* :

- Garde anti-rejouage : flag `(soccer+0x6a30)+0x29fc+param_1` (indexé par le **type de
  commande** `param_1` ∈ {1..5}).
- **Sélectionne un ID haché selon le type de commande** :

  | `param_1` (commande focus) | ID haché sélectionné |
  |----------------------------|----------------------|
  | 1 ou 2                     | `0x6AD2B143` |
  | 3                          | `0xB98AFD39` |
  | 4                          | `0xDD36D36B` |
  | 5                          | `0xF6954E2D` |
  | autre                      | (no-op) |

- Construit un bloc de paramètres sur la pile (16 slots) contenant notamment `2`, l'ID haché
  `0xFB7527AE`, plusieurs `1`, l'ID `0x04A47B7B`, `3`, et un **`0x3F800000` = 1.0f**, avec le
  hash sélectionné en `uStack_140`.
- Appelle **`FUN_1412C0970(out, &UNK_141753018, 1, &bloc)`** (système d'événements, 0x1412C0970,
  541 o, gameplay) et **recopie 5 octets de résultat** (`{u32; u8}`) dans `state+0x2c`.

Les huit hashes (`0x6AD2B143`, `0xB98AFD39`, `0xDD36D36B`, `0xF6954E2D`, `0xFB7527AE`,
`0x04A47B7B`, `0xD4F6EC81`, `0xF4DBDF21`) **ne résolvent à aucun nom** dans la table
`hash_name` (inagle) — ce sont des CRC32 d'identifiants d'événement/anim/skill non encore
catalogués.

### 3.3 Portabilité : **PARTIELLE → NON pour l'instant**

- vmethod_1 lui-même : portable comme machine d'état (flags `+0x10`, code de sortie `+0x24`
  ∈ {0,3}), MAIS sa valeur de sortie dépend entièrement de `FUN_1410729D0` → `FUN_1412C0970`.
- `FUN_1410729D0` : le « qui gagne » est calculé **dans le système d'événements**
  (`FUN_1412C0970`) à partir d'IDs hachés et d'un `1.0f`. **Tant que `FUN_1412C0970` et les
  tables d'événements hachés ne sont pas décompilés/catalogués, la formule de résolution reste
  inconnue.** Aucune base pour porter une formule type `kc/(kc+ps)`.
- **Implication directe** : la `GOAL_RATE_BASE`/formule de `match_sim.rs` n'a aucun fondement
  binaire confirmé ; le vrai moteur dispatche des événements paramétrés par données.

---

## 4. Les 4 callers `SoccerCalcKeeperSaveComponent` (+ callback)

Les quatre cibles (0x14030CDC0, 0x14030D040, 0x14030D7E0, 0x14030DEE0) et le callback
`FUN_14030DDE0` sont **tous le même patron de plomberie** : *enfiler une commande dans la file
de commandes du match*. Aucun ne contient la formule de parade.

Schéma commun :
- Garde `(_DAT_141fa9500+0x20) != 5` (un état de scène).
- Alloue 2 nœuds via un **allocateur de pool** (vmethod `+0x28` de l'allocateur du match) :
  un nœud « commande » de 0x38 o (vftable `&UNK_1417BD530`) et un nœud « payload » de taille
  variable (0x14 / 0x18 / 0x70 / 0x190 selon la variante).
- Recopie un `ShootSaveData`-like depuis `param_2` (les 5 dwords, ou via `FUN_14030E9D0` pour la
  copie longue ~0x190 o).
- Chaîne le nœud dans la liste (`+0x10` tête, `+0x18` compteur++), pose des mots de **flag/kind** :
  `0xFF00`, sous-codes `0x100/0x10D/0x10F/0x119`, et **kind** `0x140000 / 0x180000 / 0x700000 /
  0x1900000` (4 familles distinctes de commande keeper-save / focus).
- Le callback `FUN_14030DDE0` (posé par caller 2 comme `*(node+0x1b0)`) ré-enfile la commande
  d'exécution (kind `0x1900000`) — c'est le point où, à l'exécution, le composant calculera la
  parade.

**Là où est réellement la formule de parade** : `keeper.rs` a déjà porté le *constructeur* du
`SoccerCalcKeeperSaveComponent` (FUN_14030E5C0/E680/E770) avec ses 5 constantes IEEE-754
(`save_probability ≈ 0.800`, `0x3F4CCCCD`, etc.). Le calcul `evaluate()/update()` (tirage CRand
vs `save_probability`, distance vs `max_dive_dist`) **n'est dans aucune des fonctions
décompilées ici** : il s'exécute quand la commande enfilée par ces callers est *dépilée*. C'est
la **prochaine cible** (méthodes du composant, pas ses enfileurs).

Portabilité : **NON (pas ici)**. Ces fonctions sont du portage de file de commandes (utile pour
la FSM mais pas pour la résolution). Les constantes utiles (kinds, sous-codes) sont listées
ci-dessus.

---

## 5. Loader `fixPkWin*` — adresse corrigée et schéma de réflexion

### 5.1 Correction d'adresse (artefact d'index Ghidra)

L'adresse `5372443760` (0x14038FC70) de la consigne/`recherche-modele-match.md` §D **n'est pas
une fonction** : décompilée, elle donne `swi(3)` = **`int3` de bourrage** dans un *gap* entre
fonctions. C'est exactement le désalignement documenté dans `ARCHITECTURE.md` : l'index Ghidra a
rattaché les chaînes `fixPkWin*` à un `FUN_` placeholder de taille 0. Localisation correcte par
balayage `.text` des références rip-relatives vers les chaînes :

- `"fixPkWinMinPercentage"` → VA `0x141841060`, référencée à `~0x140390EF4`
- `"fixPkWinMaxPercentage"` → VA `0x141840F78`, référencée à `~0x140390F5B`

→ les deux tombent dans la fonction **0x140390090** (4792 o) = le **vrai** loader.

### 5.2 Ce que fait 0x140390090

C'est un **initialiseur de table de réflexion** (idempotent, gardé par un flag `once`). Il
enregistre **0x2B = 43 descripteurs** de 0x38 o chacun à `&DAT_1421257F0`. Chaque descripteur :
`{ ptr_nom_chaîne, offset_dans_struct (u32), taille (4=float/int, 1=bool), getter
FUN_140454300, setter FUN_140454340, type-hash 0xF4DBDF21 }`. Puis il bâtit un index de hash sur
ces 43 entrées.

Donc `fixPkWinMinPercentage` et `fixPkWinMaxPercentage` sont des **champs float** d'une struct
de config « PK params », à des **offsets** assignés par cette table :

| Chaîne (VA)                       | offset struct |
|-----------------------------------|---------------|
| fixPkWinMinPercentage (0x141841060) | **0x9C** |
| fixPkWinMaxPercentage (0x141840F78) | **0xA0** |

(les 41 autres champs couvrent les `pkGkDefenseLine*`, `pkShootHitStop*`, etc. — offsets 0x0C à
0xC0, mêmes accesseurs).

### 5.3 Portabilité : schéma OUI, valeurs NON (data-driven)

La **structure** est portable (binding nom→offset→type), mais les **valeurs numériques** de
`fixPkWinMin/MaxPercentage` ne sont **pas dans le code** : elles sont chargées depuis un cfg.bin
dans cette struct à l'exécution. Pour un port byte-exact des bornes PK, il faut lire le cfg.bin
source (toujours non identifié précisément ; piste : `soccer_game_config_*.cfg.bin`).

---

## 6. Synthèse — 1 ligne par fonction

| Fonction | Décompilée ? | Ce qu'on en comprend | Portable ? |
|----------|--------------|----------------------|------------|
| CRand::vmethod_1 (seed)   | OUI | `init_genrand` MT19937 (mult 0x6C078965, 624 mots) | **OUI** (direct) |
| CRand::vmethod_4 (next)   | OUI | genrand MT19937 + bornage Lemire | **OUI** (réserve : masque `d`) |
| CRand genrand 0x1402B36C0 | OUI | corps torsion 624/397 + tempering standard | **OUI** |
| CRand::vmethod_0          | OUI | destructeur MSVC (taille 0x1398), pas un PRNG | n/a |
| FocusBtlState::vmethod_1  | OUI | OnEnter : flags+0x10, effet 0xD4F6EC81, sortie 0/3 via délégué | partiel (FSM oui, issue non) |
| FocusBtl resolver 1410729D0 | OUI | **dispatch d'événement haché** par type cmd (1..5), pas une formule | **NON** (dépend de 0x1412C0970) |
| keeper caller 1 (CDC0)    | OUI | enfile commande keeper-save (kind 0x140000) | non (plomberie) |
| keeper caller 2 (D040)    | OUI | enfile + pose callback FUN_14030DDE0 (kind via copie longue) | non (plomberie) |
| keeper caller 3 (D7E0)    | OUI | enfile commande (kind 0x700000) | non (plomberie) |
| keeper caller 4 (DEE0)    | OUI | enfile commande (kind 0x180000) | non (plomberie) |
| keeper callback 14030DDE0 | OUI | ré-enfile commande d'exécution (kind 0x1900000) | non (plomberie) |
| loader fixPkWin (adresse consigne) | OUI | `int3` — **fausse adresse** (bourrage) | n/a |
| loader pk-params 140390090 (vrai) | OUI | table réflexion 43 champs ; fixPkWinMin@0x9C, Max@0xA0 (float) | schéma oui / valeurs data |

### L'algorithme du PRNG (réponse directe à la consigne)

**`lives::CRand` = Mersenne Twister MT19937 (32 bits), paramètres canoniques** (mult d'init
`0x6C078965`, MATRIX_A `0x9908B0DF`, n=624, m=397, masques de tempering standard
`0x9D2C5680`/`0xEFC60000` vérifiés bit-exact), avec génération bornée par la **méthode de
Lemire**. Portage Rust direct et bit-exact pour un seed donné, sous réserve de confirmer la
valeur du masque de tempering `d` stocké en struct (quasi certainement `0xFFFFFFFF`).

---

## 7. Prochaines cibles (pour réellement débloquer la résolution)

Priorisées par valeur pour le port :

1. **`FUN_1412C0970`** (0x1412C0970, 541 o, gameplay) — le système d'événements appelé par le
   resolver FocusBtl. C'est *là* que se décide l'issue du combat de focus à partir des IDs
   hachés. Sans lui, la résolution reste une boîte noire.
2. **Méthodes `evaluate()/update()` du `SoccerCalcKeeperSaveComponent`** (à localiser : ce sont
   les vmethods du composant dont `keeper.rs` a déjà le constructeur, PAS les enfileurs
   décompilés ici) — porteuses du tirage CRand vs `save_probability` 0.800.
3. **Cataloguer les 8 hashes** (`0x6AD2B143`, `0xB98AFD39`, `0xDD36D36B`, `0xF6954E2D`,
   `0xFB7527AE`, `0x04A47B7B`, `0xD4F6EC81`, `0xF4DBDF21`) via les listes d'IDs inagle/iecode
   pour nommer les événements focus.
4. **Lire le masque `d`** au mot 0x4E1 de l'objet CRand (constructeur, non décompilé) pour
   verrouiller le bit-exact du PRNG.
5. **Identifier le cfg.bin** chargeant la struct pk-params (offsets 0x9C/0xA0) pour les valeurs
   réelles `fixPkWinMin/MaxPercentage`.

Aucun de ces points n'est résolu ici ; ils sont la suite logique. Ce document ne déclare FAIT
que la **décompilation** des 9 cibles (8 + correction d'1) et l'**identification du PRNG**.

---

## 8. Addendum 2026-06-12 — verdict sur le point 3 (cataloguer les hashes) et forme du dispatcher

Investigation read-only sur `var/niers.sqlite` (vue `.pdata`, binary live) pour préparer la
prochaine vague. Deux faits tranchés, à ne pas re-tenter :

- **Les 4 hashes d'événement primaires ne sont PAS dans la table `hash_name`** (jointure inagle
  hash→nom). Testés `0x6AD2B143` (types focus 1 & 2), `0xB98AFD39` (type 3), `0xDD36D36B`
  (type 4), `0xF6954E2D` (type 5), plus le sous-ID `0xFB7527AE` : zéro correspondance. La table
  `hash_name` couvre les hashes de **noms de fichiers/données** (CRC Level-5 de chaînes d'asset),
  PAS les **IDs d'événement internes du moteur**. => Le point 3 « cataloguer via inagle/iecode »
  est un **cul-de-sac** pour ces IDs : ils ne sont nommables qu'en décompilant la table de
  dispatch de `FUN_1412C0970` (l'inverse-hash d'une chaîne event interne, ou le mapping
  ID→handler câblé en dur). Reclasser le point 3 : non par lookup, mais par décompilation.

- **`FUN_1412C0970` confirmé `gameplay` (confiance 0,8 ; 541 octets)** mais ses arêtes d'appel
  (`n_calls_in`/`n_calls_out`) sont **vides** dans la base : c'est un **dispatcher à appel
  indirect** (vtable/table de fonctions), d'où l'absence d'arêtes statiques et l'échec du nommage
  par graphe. Le résolveur appelant `FUN_1410729D0` est classé `menu` (confiance 0,14, faible).

- **Layout de la struct d'événement** construite par le résolveur avant dispatch (relu depuis
  `var/ghidra-decompile/FocusBtl_resolver_1410729d0.c`), passée en 4ᵉ arg à
  `FUN_1412C0970(out, &UNK_141753018, 1, &event)` : 16 slots de 20 octets zéro-initialisés, puis
  `[0]=2`, `[+4]=0xFB7527AE` (sous-ID constant), `[+16]=hash event-type`, `[+20]=2`,
  `[+...]=1` (plusieurs flags), `[...]=0x04A47B7B`, `[...]=3`, `[...]=0x3F800000` (= `1.0f`).
  Le résultat renvoyé est `{u32, u8}` (2 champs) recopié dans la sortie de l'appelant.

**Prochaine action concrète** (vague RE dédiée, hors fragment) : décompiler `FUN_1412C0970`
(0x1412C0970) en Ghidra headless pour récupérer (a) sa table de dispatch ID→handler, (b) le rôle
de `UNK_141753018` (1ᵉʳ arg, probable contexte/registre d'événements), (c) le sens des 2 champs
de retour `{u32, u8}` — vraisemblablement `{résultat_hashé, succès/booléen}`. C'est le verrou
restant entre `match_sim` nominal et la résolution de focus fidèle au moteur.
