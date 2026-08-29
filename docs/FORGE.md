# La forge — produire `nie.exe` depuis le workspace Rust

> **Objectif du projet, formulé sans ambiguïté :** un moteur de jeu complet en Rust, et une chaîne
> qui **génère** `nie.exe` **identique à l'original au byte près**.
> Le jeu jouable (`docs/PLAN.md`) reste la finalité fonctionnelle ; la forge en est la **mesure**.
> Tant qu'un octet du binaire n'est pas produit par du code du dépôt, ce qu'il contient n'est pas
> compris — juste recopié.

Cible : `nie.exe`, 33 918 464 octets,
`sha256 = b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`,
PE32+ x86-64, 9 sections, MSVC linker 14.44, `ImageBase = 0x140000000`.

---

## 1. Le principe : identique dès le premier jour, conquis de l'intérieur

Une chaîne qui produirait « presque » le binaire ne serait pas vérifiable. Celle-ci l'est, parce
qu'elle sépare deux choses que les projets de portage confondent d'ordinaire :

| | question | réponse |
|---|---|---|
| **Identité** | le fichier produit est-il l'original ? | **oui, toujours** — `sha256` identique, sinon la construction échoue |
| **Provenance** | quelle part de ce fichier le dépôt produit-il vraiment ? | mesurée à l'octet, elle part de ~0 et monte |

Le binaire est découpé en un **recouvrement total** d'unités : chaque octet du fichier appartient à
exactement une unité (en-têtes, fonctions, résidus de code, bourrage `int3`, données, overlay).
La construction concatène les charges utiles de toutes les unités, dans l'ordre — sans jamais
relire le fichier d'origine. Une unité est fournie soit par du **code du dépôt**, soit par le
binaire de référence que possède l'utilisateur (comme un projet de décompilation exige sa ROM).

Conquérir le binaire = déplacer des unités de la seconde colonne vers la première, sans jamais
casser l'identité.

---

## 2. Le plafond que ce dispositif contourne

`nie.exe` est produit par **MSVC 14.44**. Espérer que `rustc` (LLVM) réémette ses octets est
structurellement vain : les deux compilateurs encodent différemment **la même instruction**.

```
mov rax, rcx     MSVC → 48 8b c1      (opcode 8B, registre ← r/m)
                 LLVM → 48 89 c8      (opcode 89, r/m ← registre)
xor eax, eax     MSVC → 33 c0         LLVM → 31 c0
```

C'était le plafond invisible du projet : aucune quantité de portage Rust idiomatique ne produit le
binaire. La forge en sort par **deux voies**, et les deux sont vérifiées au byte près.

### Voie A — assembler soi-même (`nie-asm`)

`crates/forge/nie-asm` est un encodeur x86-64 en dialecte MSVC ; le dépôt commite une **source
assembleur** (`forge/asm/*.s`) que la construction réencode. Les branchements et les opérandes
`[rip …]` sont écrits en adresse absolue et résolus depuis la position réelle du corps — le travail
normal d'un assembleur.

Cet encodeur est **falsifiable** : il applique des règles canoniques, il ne colle pas aux octets. Si
MSVC a choisi une autre forme, le résultat diffère et l'unité est refusée — elle reste recopiée, et
la cause est journalisée. Aucun faux positif n'est possible.

### Voie B — compiler avec le compilateur d'origine (`nie-forge cc`)

**MSVC 14.44 est installé sur la machine de développement** (`cl.exe` 19.44.35228), c'est-à-dire le
toolset qui a lié `nie.exe`. Le binaire peut donc être reproduit par **le compilateur qui l'a
produit**, depuis du code source. Vérifié dès le premier essai, sans ajustement :

```c
unsigned int f(void) { return 0xefec8a0dU; }   /* cl /O2 /GS- /Gy /Zl */
→ b8 0d 8a ec ef c3   = octets exacts de la fonction 0x1411194b0 du jeu
```

Les sources vivent dans `src/decomp/functions/*.c` — l'échafaudage rapatrié d'IECODE, dont le
`CMakeLists.txt` compile déjà ces fichiers **en C** avec un pont vers l'API C++
(cf. `PROVENANCE.md`). Chaque fonction porte l'adresse qu'elle prétend reproduire :

```c
/* @nie 0x14004e9e0 */
float nie_load_f32_14004e9e0(const float *p) { return *p; }
```

`nie-forge cc` compile, extrait le symbole de l'objet COFF, compare byte-à-byte (champs relogés
masqués) et n'enregistre que les correspondances exactes.

**C'est la voie qui monte le plus haut.** L'assembleur reste muet sur le SSE, or `movaps`/`movss`/
`xorps`/`movups` bloquent à eux seuls ~10 Mo de `.text` ; le C les produit naturellement — un
`return *p;` sur un `float` donne `movss xmm0, [rcx] ; ret`. Écrire la sémantique et laisser MSVC
choisir la forme évite d'avoir à réimplémenter un encodeur x86 complet.

---

## 3. Les crates de la chaîne

```
crates/forge/
  nie-pe      modèle byte-exact du PE64 : parsing, ré-émission des en-têtes depuis les
              structures, découpage en unités, réassemblage, COFF (objets rustc/MSVC),
              diff masqué par relocations, checksum
  nie-asm     encodeur x86-64 dialecte MSVC + syntaxe textuelle (source ↔ octets),
              encodage conscient de l'adresse (branchements, [rip …])
  nie-forge   CLI : split · lift · cc · build · verify · report · match · candidates · unit
  nie-re · nie-index · nie-seed · nie-queue · nie-trace   échafaudage de reverse qui alimente la forge

src/decomp/   sources C reproduites, compilées par MSVC 14.44 (voie B)
```

Les autres familles servent la même fin :
`crates/engine/` = le moteur (ce que la forge devra finir par émettre),
`crates/tools/` = outillage, `crates/archive/` = portages conservés en référence, hors build.

## 4. La boucle

```bash
just forge                      # la boucle complète, ci-dessous en détail

nie-forge split                 # nie.exe → recouvrement total (var/forge/cover.json)
nie-forge lift                  # octets → source assembleur (forge/asm/lifted.s) + causes de blocage
nie-forge cc --register         # src/decomp/functions/*.c → MSVC → correspondances byte-exactes
nie-forge build                 # sources + registre → dist/nie.exe, échoue si sha256 diffère
nie-forge verify --reference nie.exe --got dist/nie.exe
nie-forge report                # part réellement produite par le dépôt
nie-forge candidates --no-reloc # corps identiques : quelle implémentation en débloque combien
```

`lift` est l'étape de reverse (elle lit le binaire) ; `build` est l'étape de production (elle ne lit
que la source). Chaque corps relevé est **réencodé et comparé** avant d'entrer dans la source.

---

## 5. État mesuré

Chiffres sortis de l'outil, pas d'une estimation. Le binaire produit est **byte-identique à chaque
étape** — la progression est interne, jamais au prix de l'identité. Régénérer : `nie-forge report`.

> **Note 2026-08-15** : la cible ci-dessous (§1, `b1fa04ea3658…`, 33 918 464 o) est
> **byte-identique** au binaire actuellement installé (`nie.exe`/`nie_eacpatched.exe`, `.pdata`
> 1 226 652 o à l'octet près) — rien n'indique donc que les chiffres suivants aient bougé. Mais
> `var/forge/` (état interne de `split`/`lift`) est absent sur ce VPS : `nie-forge report` échoue
> et ces pourcentages ne sont **pas revérifiables ici en l'état**, seulement recopiés du dernier
> run connu (2026-08-10). Restaurer `var/forge/` (archive froide) ou rejouer `just forge` avant de
> les citer comme un résultat frais.
>
> **Vérifié le 2026-08-28, machine Windows** : `var/forge/` y est absent aussi — `nie-forge report`
> rend « recouvrement absent : var/forge\cover.json (lancer `nie-forge split` d'abord) ». Aucune
> des deux machines ne peut donc rejouer la mesure : ces pourcentages sont, à ce jour, la trace
> d'un run de 2026-08-10 sur une cible qui n'a pas changé — pas un résultat reconfirmé. Le binaire
> installé localement porte bien le sha256 `b1fa04ea3658…` et 33 918 464 octets (revérifié le
> 2026-08-28 par `niers info`), donc la cible est la bonne ; c'est l'état interne de la forge qui
> manque, pas le binaire.

Mesure **rejouée et reproduite le 2026-08-30** sur la cible `b1fa04ea3658…` :

```
split   : 225 187 unités · 116 091 fonctions · résidu .text 51 151 o · 0 trou · 0 overlay
lift    : 112 041 corps relevés · 22 098 966 o · ratio 0,9446
build   : dist/nie.exe · 33 918 464 o · sha256 identique ✅ · 0 rejeté
report  : produced = 69,3650 % du fichier · code_rust = 90,3630 % du .text
```

| source | unités | octets |
|---|---:|---:|
| en-têtes PE ré-émis (`nie-pe`) | — | 1 428 592 |
| corps réassemblés (`nie-asm`) | 112 041 | 22 098 966 |

### Le recouvrement vient de deux sources, pas d'une

`.pdata` ne décrit que les fonctions ayant des données de déroulement : 55 351 racines, et
1 828 793 octets de `.text` laissés en résidu — haché par les seules bornes de remplissage, donc
non relevable (une unité pouvait commencer au milieu d'une instruction). `nie-forge split` charge
désormais les **61 076 fonctions feuilles mesurées par `nie_re::recover`** et s'en sert pour
découper ce résidu, qui tombe à **51 151 octets**. Les plages recouvrant une plage `.pdata` sont
écartées : `.pdata` reste la vérité terrain, les feuilles ne comblent que ce qu'elle ignore.

C'est le couplage entre l'échafaudage RE et la forge : le RE ne sert pas seulement à *nommer*, il
sert à *découper*, et sans découpe correcte il n'y a rien à produire.

Attribution **exclusive** : une unité fournie par deux voies n'est comptée qu'une fois, dans
l'ordre même de la construction (en-têtes → assembleur → codegen). `semantic` n'est jamais compté
comme produit : seuls `emitted`, `assembled` et `bytes` valent.

### Ce que chaque élargissement du dialecte a rapporté

La courbe est franchement non linéaire : quelques familles d'instructions portent l'essentiel de
la masse. Des formes de base au dialecte actuel, la part du `.text` est passée de 0,59 % à plus de
**90 %**, par vagues successives — prologues et branchements, `[rip …]`, `r/m`+immédiat, SSE,
`cmovcc` et conversions, `movd`/`movq`, immédiats étendus en signe.

Vague du **2026-08-30**, guidée de bout en bout par le diagnostic chiffré du `lift` (66,09 % →
90,36 % du `.text`) :

| ce qui manquait | unités | octets débloqués |
|---|---:|---:|
| `gs:`/`fs:` — l'accès TLS de Windows x64 (`mov rax, gs:[58h]`) | 2 443 | 3 008 522 |
| décalages vectoriels de groupe (`psrldq`, `pslld`…) | 624 | 719 506 |
| masques de signes vers registre général (`movmskps`) | 294 | 652 872 |
| AVX en VEX (`vpermilps`, `vfmadd231ps`, `vmovaps`) | 541 | 733 000 |
| comparaisons SSE à prédicat (`cmpeqps`) | 531 | 893 556 |
| `rep stos`/`movs`, `prefetch`, `xchg` | 535 | 803 000 |
| formes dédiées de `movq` mémoire | 84 | 238 186 |
| REX.W superflu sur `jmp`/`call` indirects, `lock inc`/`dec` | 4 564 | 411 000 |

Trois de ces entrées ne sont pas des instructions manquantes mais des **bugs d'encodage** que
seule la confrontation aux octets réels pouvait révéler : l'immédiat 16 bits émis sur 4 octets
(`or si, 1D6h`), l'octet SIB omis en adressage absolu, et `ah`/`ch`/`dh`/`bh` encodés comme
`dl`/`sil` faute de pouvoir les distinguer. Aucun n'aurait été trouvé par relecture — c'est la
comparaison byte-à-byte qui les a sortis.

Deux enseignements, l'un et l'autre trouvés par l'outillage :

- **`mov qword ptr [rsp+28h], 0` valait 6,6 Mo à lui seul.** iced classe cet immédiat en
  `Immediate32to64` (étendu en signe), pas `Immediate32` ; l'oubli d'une variante d'énumération
  tenait un quart du `.text` hors du dialecte. Le diagnostic ne l'a révélé qu'après avoir fait
  afficher l'**instruction fautive désassemblée**, et non son seul mnémonique.
- **Une régression a été attrapée par le gate, pas par relecture.** L'ajout du suffixe `.w` (forme
  longue d'immédiat) a d'abord réutilisé par erreur le drapeau `.s` (branchement court) : le rendu
  écrivait `and.w`, le parseur ne savait pas le relire, et la mesure est tombée de 23,40 % à
  14,27 %. C'est la vérification d'**aller-retour textuel** du relevé — parse ∘ render ∘ encode —
  qui a refusé les corps concernés plutôt que de les laisser passer.

### Ce qui bloque encore, par masse

Régénérer la liste : `nie-forge lift`, lignes `blocker`, triées par masse.

```
mov          2 443 corps  3 008 522 o   « mov rax,gs:[58h] »  (segment, adresse absolue moffs)
cmpps          519 corps    866 730 o   « cmpeqps xmm1,[rbx+10h] »
invalide     1 988 corps    467 038 o   (données inline prises pour du code)
vpermilps      331 corps    449 128 o   (AVX)
prefetchnta    159 corps    248 224 o
psrldq         239 corps    193 722 o
encodage:jmp 2 082 corps    142 000 o   orig=[48, ff, e0] · nie-asm=[ff, e0]
encodage:dec   372 corps    155 672 o   préfixe `lock` non ré-émis
```

Les causes `encodage:*` sont les plus instructives : ce sont des corps **entièrement traduits**
dont le ré-encodage diverge de quelques octets — un `jmp rax` que MSVC préfixe d'un REX nul, un
`lock` perdu. Le diagnostic affiche `orig=` contre `nie-asm=` précisément pour ça. Chacune est un
*finding* exploitable, et aucune ne peut passer pour produite.

## 6. Un constat que l'outillage a produit immédiatement

Le registre `forge/registry.json` distingue deux statuts, et cette distinction est le cœur de
l'honnêteté de la mesure :

| statut | preuve | entrées | compté comme produit ? |
|---|---|---:|---|
| `bytes` | `msvc` — MSVC 14.44 a recraché les octets originaux | 7 | **oui** |
| `semantic` | `uemu` — la logique est validée byte-exact contre l'oracle | 27 | **non** |

Les 27 adresses validées par l'oracle uemu, croisées avec la table `.pdata` du binaire livré :

> **27 sur 27 ne sont pas des débuts de fonction de `nie.exe`.**
> Elles tombent *à l'intérieur* de fonctions réelles, avec des décalages non constants
> (`0x2e2a10` est à +0x70 dans la fonction `0x2e29a0`, `0x7faf0` à +0x670, `0x90fa0` à +0x30…).

Cause : la chaîne de reverse travaille sur `nie_eacpatched.exe` (cf. `justfile`, variable `exe`),
un **autre build**. Les validations sémantiques restent vraies *pour ce binaire-là* ; elles ne
peuvent pas compter pour le binaire livré tant qu'elles ne sont pas ré-ancrées.

Le rapport les compte donc en `orphan_entries`, et **jamais** dans les octets produits. C'est
précisément le rôle de la forge : rendre ce genre d'écart impossible à ignorer.

**Travail à faire** : ré-ancrer chaque adresse sur une racine `.pdata` de `nie.exe` (par signature
d'octets plutôt que par adresse), puis renseigner le champ `rust` de chaque entrée.

---

## 7. Les paliers

| palier | définition | état |
|---|---|---|
| **G0 — identité** | le fichier produit est byte-identique à l'original | ✅ tenu, testé sur le vrai binaire |
| **G1 — recouvrement** | chaque octet appartient à une unité nommée, zéro trou | ✅ 225 187 unités, invariant testé |
| **G2 — amorçage** | une part non nulle du binaire est produite par le dépôt | ✅ **69,3650 %** du fichier |
| **G3 — code** | 50 % du `.text` produit par le dépôt | ✅ **90,3630 %** |
| **G4 — sections** | `.rdata`/`.data` produits depuis les structures, pas recopiés | non commencé (découpage encore d'un seul tenant) |
| **G5 — disposition** | la forge calcule ses propres adresses (édition de liens réelle) | non commencé ; jusque-là les champs relogés viennent de la disposition de référence |
| **G6 — total** | 100 % du fichier produit, `nie.exe` reconstructible sans référence | horizon |

G5 est la marche décisive et elle est explicitement devant nous : aujourd'hui, un corps réassemblé
qui contiendrait une adresse absolue serait refusé (`is_self_contained`), et les champs relogés d'un
codegen accepté sont repris de la référence. Rien de tout cela n'est compté comme « produit » à
tort — mais rien n'est non plus prétendu résolu.

---

## 8. Règles de la forge

1. **L'identité prime.** Une modification qui casse `sha256(dist/nie.exe) == référence` est un
   échec de construction, pas un progrès.
2. **Rien n'entre dans la source qui ne se régénère.** Le relevé réencode et compare avant d'écrire.
3. **La provenance ne se gonfle pas.** `semantic` (comportement validé par l'oracle) ne compte pas
   comme octets produits. Seuls `emitted`, `assembled` et `bytes` comptent.
4. **Un écart se publie.** Orphelins, unités refusées, causes de blocage : tout sort dans le rapport.
5. **Rien de dérivé du binaire ne quitte la machine.** `nie.exe`, `var/forge/`, `dist/` **et
   `forge/asm/*.s`** sont hors dépôt. La source assembleur relevée est du matériau dérivé de
   `nie.exe` (séquences d'instructions exactes) : elle tombe sous la même règle que les assets
   © LEVEL-5. Aucune perte — `just forge-lift` la régénère en quelques secondes depuis le `nie.exe`
   de l'utilisateur, et le résultat est déterministe. Ce qui est commité : les **outils**, le
   **registre** (adresses, symboles Rust, preuves) et la **documentation**.
