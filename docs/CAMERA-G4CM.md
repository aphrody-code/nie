# G4CM — les caméras de cutscene, du conteneur à la trajectoire

État mesuré le **2026-09-19** sur le corpus complet : **1 215 fichiers** `.g4cm`, tous décodés et
indexés dans `var/nie.sqlite`.

**Le verrou est levé.** Ce document décrivait un chantier à moitié fait dont la moitié manquante
était la déquantification des échantillons. Elle est désormais **prouvée byte-exact contre
`nie.exe`**, et une seconde panne — muette celle-là — a été trouvée et corrigée dans la foulée :
la section des temps était alignée sur le mauvais granule, ce qui décalait tous les `time_index`
du corpus. Ce qui reste ouvert est nommé en fin de document, et c'est peu.

## Ce qui est acquis

### Le conteneur

Les **1 215 fichiers se ré-encodent byte-exact** (`roundtrip_ok = 1` sur les 1 215 lignes de
`cam_anim`). Décoder, ne rien toucher, ré-encoder rend le fichier à l'octet près. La structure
n'est donc pas en cause dans ce qui suit.

Géométrie des sections, telle que l'applique `nie_formats::g4cm::decode` :

```text
section(i)  = ((counters[i] << counters[11]) + align) * 4
temps       = align_sup(fin de la table de canaux, align * 4)     # 64 octets, pas 16
```

Les treize compteurs vivent à `0x20`. Deux relations tiennent sur les quatre fichiers vérifiés à
la main : `counters[0]` est le nombre de clips (= d'objets), et `counters[4]` vaut exactement la
moitié du nombre de canaux.

### La timeline

| Fichier | Clips | Images | Durée à 60 i/s | Clips contigus |
|---|---:|---|---:|---|
| `ev60_00310` | 5 | 1000 → 1356 | 5,95 s | non |
| `ev60_00340` | 5 | 1000 → 1464 | 7,75 s | **oui** |
| `ev60_00900` | 4 | 1000 → 1496 | 8,28 s | non |
| `ev60_01250` | 6 | 1000 → 1468 | 7,82 s | non |

`Clip.tail` vaut `(0, 60, 0, 0, 0, 0, 0, 0)` sur **les 20 clips des 4 fichiers**, et tous
démarrent à l'image **1000**. Cohérent avec une cadence de 60 i/s — mais quatre fichiers ne font
pas une preuve, et rien n'est recoupé sur `nie.exe` : ne pas écrire `60` en dur sans cette
vérification.

**La contiguïté n'est pas la règle.** Un seul des quatre enchaîne ses clips bord à bord ; un
lecteur qui suppose une timeline continue sautera des images.

### Les valeurs réelles

Le corpus porte une population `f32` — donc déjà décodée — qui sert de **vérité terrain** :

| Genre | Canaux `f32` | Plage réelle |
|---|---:|---|
| `posX` | 87 | −947 → 3 707 |
| `posY` | 33 | −49 → 8 162 |
| `posZ` | 1 328 | −3 009 → 9 092 |
| `refX` | 76 | −1 179 → 3 030 |
| `refY` | 29 | −152 → 6 447 |
| `refZ` | 1 360 | −3 006 → 6 455 |

Soit un domaine d'environ **±10 000**, et non les ±50 qu'annonçait la doc du module. Une poignée
de canaux rendent des valeurs aberrantes (4 sur 1 332 pour `posZ`, 2 sur 1 362 pour `refZ`) :
c'est une marge de bruit, pas une invalidation.

**`fov` et `roll` n'ont aucun canal `f32` dans tout le corpus.** Ils n'ont donc pas d'oracle et
demanderont une autre voie que la comparaison de distributions.

## La déquantification — résolue et prouvée

Les flux 16 bits sont des composantes **normalisées**, remises à l'échelle par une entrée d'une
table de `f32` que le canal désigne lui-même.

```text
  mode 2, taille 2  ->  0x140507220  :  (f32)(u16)x * (1/65535) * échelle
  mode 3, taille 2  ->  0x1405075F0  :  (f32)(i16)x * (1/32767) * échelle
```

Le jeu choisit le décodeur dans une table en `.rdata` (`0x1419814C0`) indexée
`mode * 5 + declared_size.0`. Les constantes sont à `0x141A6836C` et `0x141A68374`.

`scripts/validate_g4_component_decode.py` valide les deux fonctions **byte-exact sur 280 514
cas** sous Unicorn — balayage complet du domaine 16 bits, toutes les tailles qui franchissent une
frontière de chemin, les échelles réellement mesurées plus zéro, un subnormal et `f32::MAX`.

### Ce que l'oracle a donné et que l'inférence n'aurait pas trouvé

Chaque décodeur a **trois chemins, et ils ne multiplient pas dans le même ordre** :

| Chemin | Instructions | Ordre |
|---|---|---|
| bloc de 16, voies 0..11 | `mulps xmm4` puis `xmm6` | `(x × échelle) × inv` |
| bloc de 16, voies **12..15** | `mulps xmm5` | `x × (échelle × inv)` |
| 4-wide et queue scalaire | `mulss xmm2` puis `xmm3` | `(x × inv) × échelle` |

`xmm5` porte le produit pré-calculé une fois au prologue. Sur 74 904 couples (échelle, valeur),
**45,7 % rendent trois résultats `f32` différents** selon l'ordre. Que les voies 12 à 15 de
chaque bloc de 16 soient calculées par une autre expression que les voies 0 à 11 est un artefact
du compilateur : invisible dans un dump d'octets, fatal à un aller-retour byte-exact.

La preuve porte son **témoin négatif** : les trois simplifications à ordre unique sont rejouées
et doivent toutes ÉCHOUER (24/64, 5/64 et 14/64 voies fausses). Sans lui, la validation
confirmerait une formule que n'importe quelle écriture naïve satisferait.

### Le champ qui empêchait de rattacher le barème

`Channel::index: u16` était documenté « index du canal dans l'objet ». Ce n'est pas une valeur :
`nie.exe` lit les deux octets indépendamment, pour des usages sans rapport.

```asm
0x1405AAF26  movzx r8d, byte [rbx+6]
0x1405AAF3B  movss xmm2, [r15 + r8*4]    ; octet 6 = index dans une TABLE DE f32
0x1405AAF5A  movzx ecx, byte [rbx+7]
0x1405AAF71  shl   rcx, 4                ; octet 7 = index de CIBLE (entrées de 16 octets)
0x1405AAF85  add   rbx, 0x14             ; et reconfirme CHANNEL_ENTRY_LEN = 20
```

Le `u16` combiné ne signifiait rien. Scindé en `scale_index` / `target_index`.

### Que la table d'échelles soit le bloc `params` — tranché sur les données

Le désassemblage montre `[r15 + r8*4]` mais `r15` est chargé hors de la boucle. Deux invariants
le décident, sur les 1 215 fichiers, **sans une exception** :

| Invariant | Mesure |
|---|---|
| un canal `f32` désigne une échelle valant exactement `1.0` | **2 920 / 2 920** |
| une valeur déquantifiée reste dans `±échelle` | **33 743 / 33 743** |

Si la table vivait ailleurs, rien n'expliquerait que 2 920 indices tombent tous sur `1.0`.

La lecture de l'octet 6 est en outre confirmée par un **second** appelant, indépendant du premier :
`0x1405AB1AF-0x1405AB1C1` fait `movzx r8d, byte [rbx+6]` puis `movss xmm2, [rbp + r8*4]`, avec
`rbp` en base de table là où l'autre avait `r15`. Deux sites, même indexation.

## La panne muette : l'alignement de la section des temps

`decode` plaçait la table de temps partagée à `(fin des canaux + 15) & !15`. Le vrai granule est
**`align * 4`, soit 64 octets** — toute la géométrie du conteneur s'exprime en dwords
(`section(i) = ((compteur[i] << shift) + align) * 4`) et le pas d'alignement suit la même unité.
Aligner sur 16 plaçait la table jusqu'à **48 octets trop tôt**, décalant *tous* les `time_index`.

**Pourquoi personne ne l'avait vu.** La panne est invisible aux deux endroits où l'on regarde :
le ré-encodage restait **1 215/1 215 byte-exact** (les octets déplacés tombaient dans
`gap_channels_times`, réécrit verbatim), et une table décalée s'interpole sans erreur — elle rend
simplement une position de caméra plausible et fausse. Seul un invariant « les temps de keyframes
croissent » l'attrape.

| Mesure | Avant | Après |
|---|---|---|
| tables de temps croissantes | — | **27 930 / 27 930** |
| fichiers avec au moins une table cassée | **714** | **0** |
| ré-encodage byte-exact | 1 215 / 1 215 | 1 215 / 1 215 |

**Quatre hypothèses mesurées et réfutées avant la bonne** : un décalage d'éléments constant
(714 fichiers n'en admettent aucun), un décalage égal au nombre de zéros de tête (corrige 460),
la base tirée d'un des 13 compteurs (5 fichiers), la table calée par sa fin (129). L'indice
décisif : **6 664 des 7 124 canaux cassés avaient un `time_index` égal au `time_index + count`
d'un autre canal** — un chaînage de segments, donc des index justes et une base fausse.

*Piège de méthode à retenir* : les premières sondes lisaient `anim.times`, que `decode` tronque à
`max(time_index + count)`. Tout décalage positif sortait du tableau et se comptait comme « cassé ».
Relire depuis le fichier brut a transformé « 714 impossibles » en « 1 215 résolubles, toujours à
un multiple de 64 ».

## Deux hypothèses réfutées — ne pas les refaire

**« Un `f32` d'échelle par canal. »** Faux — mais **la moitié de l'intuition était juste**, et
c'est instructif. Il y a bien une table de `f32` d'échelles, et chaque canal y désigne une
entrée : ce que l'hypothèse ratait, c'est qu'il n'y a **pas une entrée par canal**. Plusieurs
canaux partagent la même échelle, et c'est l'octet 6 du canal qui dit laquelle. Chercher une
correspondance par LONGUEUR ne pouvait donc pas aboutir, quelle qu'ait été la finesse de la
mesure — il fallait lire l'indexation dans le code.

Attention au motif de rejet, car le premier retenu était lui aussi mauvais :

- *Mauvais motif* — « le rapport octets/canaux vaut 4,00 · 3,60 · 3,50 · 3,00, donc ce n'est pas
  par canal ». Ce rapport ne mesure **rien du contenu** : la longueur du bloc est une conséquence
  de la mise en page (il court jusqu'à `section(10)`) et tout ce qui suit la charge utile est du
  bourrage. Comparer une longueur bourrée à un compte d'éléments ne peut rien conclure.
- *Bon motif* — une fois la charge utile délimitée par ses deux repères et mesurée sur les 1 215
  fichiers, sa longueur ne se concentre ni sur le nombre de canaux ni sur celui des objets.

La piste reste tentante parce que sur `ev60_00340` les vingt premières valeurs s'alignent sur les
vingt premiers canaux avec des échelles crédibles. **C'est une coïncidence de ce fichier.**

**« Le chargeur compare le magic `G4CM`. »** Faux. Le motif `47 34 43 4D` n'apparaît qu'**une
seule fois** dans les 33,9 Mo du binaire, et cette occurrence est la chaîne en `.rdata`, qui ne
reçoit **aucune référence RIP-relative**. Le jeu ne teste jamais ce magic en immédiat.

## Ce qui reste ouvert

Trois points, tous nommés et aucun deviné.

**1. L'unité de `fov` et de `roll`.** Ils se déquantifient sans difficulté, dans des plages de
l'ordre de `−0,37` à `0,80`, qui ne sont ni des degrés ni des radians. **Aucun canal `f32` de ces
deux genres n'existe dans les 1 215 fichiers**, donc il n'y a pas d'oracle par comparaison de
distributions.

*La voie du « setter » de propriété est RÉFUTÉE — ne pas la reprendre.* L'idée était d'émuler la
fonction que le jeu appelle en `0x1405AAF82`, choisie par `kind − 0x10` dans une table de tables.
Mesuré : `r14` vaut `0x141981BD0`, qui porte **deux** sous-tables (`0x141981A90` et `0x141981B30`,
sélectionnées par `r10 & 1`). Dans les deux, seules les entrées **0 à 5** sont peuplées ; les
entrées **6 à 15 — celles qui couvriraient `posX`…`roll` — sont NULL**. Les deux seuls appelants
de l'échantillonneur qui appliquent `sub eax, 0x10` (`0x1405AAF4A` et `0x1405AB1D1`) pointent la
même table. Les `kind` d'un `.g4cm` ne transitent donc **pas** par ce dispatch : les y envoyer
sauterait sur un pointeur nul. Cette boucle est une boucle sœur, sur un autre type de cible — la
structure de canal de 20 octets est partagée entre conteneurs G4.

Ce qui reste : les 13 autres appelants de `0x140506B00`, dont aucun n'applique `sub eax, 0x10`,
et le contrôleur de caméra, qui consomme vraisemblablement le tableau déjà décodé.

En attendant, `nie_camera::anim::EtatEchantillonne` garde le `fov_deg` par défaut et expose la
valeur brute à côté — **aucun code ne convertit au jugé**, et un test tombe si quelqu'un s'y
essaie.

**2. Le décodeur `mode = 1`.** `0x140506D00`, non désassemblé, concerne **2 761 canaux**
(2 748 en taille 1, 13 en taille 2). `Channel::quant()` les rend `Quant::Inconnu` et
`Channel::decoded()` rend `None` plutôt qu'une valeur plausible.

**3. La cadence.** `Clip.tail[1]` vaut 60 sur les 20 clips des 4 fichiers vérifiés à la main, ce
qui est cohérent avec 60 i/s — mais quatre fichiers ne font pas une preuve et rien n'est recoupé
sur `nie.exe`. Tout consommateur doit traiter 60 comme une **hypothèse nommée**, pas comme un
fait.

### Ce qui a été éliminé en chemin

Le dispatch des conteneurs G4 est piloté par table : à `0x141A5E12C` s'enchaînent sept magics
contigus (`G4MT G4MA G4TP G4CM G4VS G4LA G4BA`), `G4CM` à l'index 3. Mais **le chargeur n'était
pas le bon fil** — la déquantification a été trouvée en remontant depuis les *constantes de
normalisation*, pas depuis le chargeur.

`CCameraAnimeCtrl` (vtable `0x141A63B08`) porte 6 méthodes réelles et 15 souches par défaut
partagées (`0x14004D760`). Sa plus grosse méthode (`0x140574DB0`, 1 287 octets, étendue chaînée)
ne contient **aucune** conversion flottante, ni aucun de ses dix appelés directs. Le contrôleur
consomme des valeurs déjà décodées.

## Reproduire les mesures

```sh
# Peupler l'index caméra (tables cam_* de var/nie.sqlite)
cargo run -p nie-camera --bin nie-cam -- index \
    --db var/nie.sqlite \
    --game-dir <racine-du-jeu> \
    --exe dist/nie.exe
nie-cam stats --db var/nie.sqlite

# Plages réelles par genre, sur les seuls canaux décodés
sqlite3 var/nie.sqlite "
  SELECT kind, COUNT(*), ROUND(MIN(v_min),2), ROUND(MAX(v_max),2)
  FROM cam_anim_channel
  WHERE encoding='f32' AND ABS(v_min)<1e4 AND ABS(v_max)<1e4
  GROUP BY kind ORDER BY kind;"

# Recensement des encodages
sqlite3 var/nie.sqlite "SELECT * FROM v_cam_channel_stats;"

# Les trois invariants du barème et de l'alignement, sur le corpus entier
cargo run -p nie-formats --release --example g4cm_scale_census -- var/tmp/allcams

# La preuve byte-exact des deux décodeurs contre nie.exe
just preuves g4_component
```

L'index pèse **1 215 animations, 39 424 canaux, 4 936 objets**. `--samples` ajoute chaque
keyframe (des millions de lignes) : utile pour l'analyse statistique, inutile pour l'inventaire.

Les tables `cam_anim`, `cam_anim_channel`, `cam_anim_object`, `cam_anim_sample` et
`cam_re_symbol` **existaient depuis un chantier antérieur mais étaient vides** ; elles ne le sont
plus, sauf `cam_anim_sample` (peuplée seulement avec `--samples`) et `cam_re_symbol`, qui attend
les adresses que le désassemblage produira.

## Où en est la chaîne

`nie_camera::anim::CameraTrack` échantillonne une animation vers un `CameraState` à une frame
fractionnaire : maintien aux bornes, interpolation linéaire entre clés, et **identité bit à bit**
sur une frame de clé exacte. Les clips n'étant pas contigus, aucun code ne suppose de timeline
continue.

Reste, en aval : le pont `CameraState` → rastériseur (les matrices existent des deux côtés, il
n'y a pas de dépendance à créer), la déformation LBS comme bibliothèque, et l'orchestrateur de
séquence. La caméra n'est plus la pièce manquante.
