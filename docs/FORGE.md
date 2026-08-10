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
binaire. La forge le contourne en **assemblant elle-même** — `crates/forge/nie-asm` est un encodeur
x86-64 en dialecte MSVC, et le dépôt commite une **source assembleur** (`forge/asm/*.s`) que la
construction réencode. Les octets sont produits par du code du dépôt, à partir d'une source lisible
et modifiable.

Cet encodeur est **falsifiable** : il applique des règles canoniques, il ne colle pas aux octets.
Si MSVC a choisi une autre forme, le résultat diffère et l'unité est refusée — elle reste recopiée,
et la cause est journalisée. Aucun faux positif n'est possible.

---

## 3. Les crates de la chaîne

```
crates/forge/
  nie-pe      modèle byte-exact du PE64 : parsing, ré-émission des en-têtes depuis les
              structures, découpage en unités, réassemblage, COFF (objets rustc), diff, checksum
  nie-asm     encodeur x86-64 dialecte MSVC + syntaxe textuelle (source ↔ octets)
  nie-forge   CLI : split · lift · build · verify · report · match · candidates · unit
  nie-re · nie-index · nie-seed · nie-queue · nie-trace   échafaudage de reverse qui alimente la forge
```

Les autres familles servent la même fin :
`crates/engine/` = le moteur (ce que la forge devra finir par émettre),
`crates/tools/` = outillage, `crates/archive/` = portages conservés en référence, hors build.

## 4. La boucle

```bash
nie-forge split                 # nie.exe → recouvrement total (var/forge/cover.json)
nie-forge lift                  # octets → source assembleur commitée (forge/asm/lifted.s)
nie-forge build                 # source + registre → dist/nie.exe, échoue si sha256 diffère
nie-forge verify --reference nie.exe --got dist/nie.exe
nie-forge report                # part réellement produite par le dépôt
nie-forge candidates --no-reloc # corps identiques : quelle implémentation en débloque combien
```

`lift` est l'étape de reverse (elle lit le binaire) ; `build` est l'étape de production (elle ne lit
que la source). Chaque corps relevé est **réencodé et comparé** avant d'entrer dans la source.

---

## 5. État mesuré (2026-08-10)

Chiffres sortis de l'outil, pas d'une estimation.

```
split   : 219 427 unités · 55 351 fonctions .pdata · 46 870 fragments chaînés rattachés
          24 453 814 o de code · 8 315 392 o de données · 0 trou · 0 overlay
lift    : 111 124 corps examinés → 21 419 régénérables (143 483 o), source de 916 Ko
build   : dist/nie.exe · 33 918 464 o · sha256 identique ✅ · 21 420 unités produites par le dépôt
report  : produced = 0,4249 % du fichier · code_rust = 0,5868 % du .text
```

Décomposition de ce qui est **réellement produit** :

| source | unités | octets | nature |
|---|---:|---:|---|
| en-têtes PE ré-émis | 1 | 624 | recalculés depuis les structures par `nie-pe` |
| corps réassemblés | 21 419 | 143 483 | `nie-asm` depuis `forge/asm/lifted.s` |
| codegen rustc coïncidant | 0 | 0 | voie ouverte, aucune fonction encore conforme |
| **total** | **21 420** | **144 107** | **0,4249 %** |

Le reste (33 774 357 o) vient de la référence, et c'est dit tel quel.

### Ce qui bloque le relevé, par masse (la liste de courses)

```
push    43 042 corps  20 131 787 o     sub    9 753   1 395 654 o
mov      8 834 corps     702 251 o     test   4 634     588 784 o
cmp      4 474 corps     330 936 o     lea    5 312     221 818 o
movzx    3 037 corps     192 551 o     movss  1 110     180 250 o
```

Lecture : `push` est la première instruction non supportée de 43 042 corps — les prologues. La
progression est donc **pilotée par la donnée** : chaque instruction ajoutée à `nie-asm` a un gain
chiffré d'avance, et le gain est revérifié à la construction suivante.

---

## 6. Un constat que l'outillage a produit immédiatement

Le registre `forge/registry.json` reprend les **27 adresses** validées byte-exact par l'oracle uemu
(`scripts/validate_re.py`, suite 43/43). Croisées avec la table `.pdata` du binaire livré :

> **27 sur 27 ne sont pas des débuts de fonction de `nie.exe`.**
> Elles tombent *à l'intérieur* de fonctions réelles, avec des décalages non constants
> (`0x2e2a10` est à +0x70 dans la fonction `0x2e29a0`, `0x7faf0` à +0x670, `0x90fa0` à +0x30…).

Cause : la chaîne de reverse travaille sur `nie_eacpatched.exe` (cf. `justfile`, variable `exe`), un
**autre build** — la même dérive que celle déjà constatée sur les vtables du dump mémoire
(`docs/PLAN.md` §5). Les validations sémantiques restent valides *pour ce binaire-là* ; elles ne
peuvent pas encore compter pour le binaire livré tant qu'elles ne sont pas ré-ancrées.

Le rapport les compte donc en `orphan_entries = 27`, et **jamais** dans les octets produits. C'est
précisément le rôle de la forge : rendre ce genre d'écart impossible à ignorer.

**Travail à faire** : ré-ancrer chaque adresse sur une racine `.pdata` de `nie.exe` (par signature
d'octets plutôt que par adresse), puis renseigner le champ `rust` de chaque entrée.

---

## 7. Les paliers

| palier | définition | état |
|---|---|---|
| **G0 — identité** | le fichier produit est byte-identique à l'original | ✅ tenu, testé sur le vrai binaire |
| **G1 — recouvrement** | chaque octet appartient à une unité nommée, zéro trou | ✅ 219 427 unités, invariant testé |
| **G2 — amorçage** | une part non nulle du binaire est produite par le dépôt | ✅ 0,4249 % |
| **G3 — code** | 50 % du `.text` produit par le dépôt | en cours — piloté par les blocages ci-dessus |
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
