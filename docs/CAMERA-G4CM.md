# G4CM — les caméras de cutscene, et ce qui bloque encore

État mesuré le **2026-09-19** sur le corpus complet : **1 215 fichiers** `.g4cm`, tous décodés et
indexés dans `var/niers.sqlite`.

Ce document existe parce que le chantier est **à moitié fait** et que la moitié manquante est
précise. Le conteneur est entièrement maîtrisé ; l'encodage des échantillons ne l'est pas. Sans
lui, il n'y a ni hauteur de caméra, ni champ de vision, ni roulis — donc aucun plan reconstituable.

## Ce qui est acquis

### Le conteneur

Les **1 215 fichiers se ré-encodent byte-exact** (`roundtrip_ok = 1` sur les 1 215 lignes de
`cam_anim`). Décoder, ne rien toucher, ré-encoder rend le fichier à l'octet près. La structure
n'est donc pas en cause dans ce qui suit.

Géométrie des sections, telle que l'applique `nie_formats::g4cm::decode` :

```text
section(i) = ((counters[i] << counters[11]) + align) * 4
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

## Ce qui bloque

### Les échantillons sont quantifiés

Sur `ev60_00340`, **aucun** canal n'est en `f32` : position, visée, champ de vision et roulis sont
tous en 16 bits. `Track::Raw16` expose les mots bruts parce que ni `f16` ni `i16` ne rendent de
valeurs cohérentes avec les canaux `f32` du même fichier.

Une déquantification `u16 / 65535 × échelle` produit des trajectoires **lisses et plausibles**
(`posY` 0,069 → 2,086 ; `posZ` 1,837 → 6,073), l'oracle de lissage — l'énergie des différences
secondes, normalisée par l'amplitude — tranchant nettement contre l'interprétation signée
(0,002 contre 0,23). C'est une indication, pas un lecteur : il manque le rattachement du barème
aux canaux.

### Le bloc `params`, encadré mais pas résolu

Gabarit vérifié sur **1 215 fichiers sur 1 215**, sans exception :

```text
  f32 1.0             (0x3F800000)  — toujours, en tête
  <charge utile>      suite de f32 positifs, longueur VARIABLE
  <un mot>            paraît minuscule lu en f32 (3,2e-07, 3,5e-12) : ce n'est pas un flottant
  f32 0.021596527     (0x3CB0EB33)  — exactement UNE fois par fichier
  zéros               bourrage jusqu'à la table de noms
```

Délimiter le bloc par **ces deux repères**, jamais par sa longueur en octets.

## Deux hypothèses réfutées — ne pas les refaire

**« Un `f32` d'échelle par canal. »** Faux. Mais attention au motif de rejet, car le premier
retenu était lui aussi mauvais :

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

## La voie d'entrée pour la suite

Le dispatch est **piloté par table**. À `0x141A5E12C` s'enchaînent sept magics contigus :

```text
  G4MT  G4MA  G4TP  G4CM  G4VS  G4LA  G4BA
   0     1     2     3     4     5     6
```

`G4CM` y est à l'**index 3**. Le tableau de handlers parallèle est ce qu'il faut remonter : c'est
le chargeur, et c'est lui qui porte la maths de déquantification.

Ce qui a été éliminé en chemin : `CCameraAnimeCtrl` (vtable `0x141A63B08`) porte **6 méthodes
réelles** et 15 souches par défaut partagées (`0x14004D760`). Sa plus grosse méthode
(`0x140574DB0`, 1 287 octets, étendue chaînée) ne contient **aucune** conversion flottante, et
aucun de ses dix appelés directs non plus. Le contrôleur n'est donc pas le bon fil : il consomme
des valeurs déjà décodées.

## Reproduire les mesures

```sh
# Peupler l'index caméra (tables cam_* de var/niers.sqlite)
cargo run -p nie-camera --bin nie-cam -- index \
    --db var/niers.sqlite \
    --game-dir <racine-du-jeu> \
    --exe dist/nie.exe
nie-cam stats --db var/niers.sqlite

# Plages réelles par genre, sur les seuls canaux décodés
sqlite3 var/niers.sqlite "
  SELECT kind, COUNT(*), ROUND(MIN(v_min),2), ROUND(MAX(v_max),2)
  FROM cam_anim_channel
  WHERE encoding='f32' AND ABS(v_min)<1e4 AND ABS(v_max)<1e4
  GROUP BY kind ORDER BY kind;"

# Recensement des encodages
sqlite3 var/niers.sqlite "SELECT * FROM v_cam_channel_stats;"
```

L'index pèse **1 215 animations, 39 424 canaux, 4 936 objets**. `--samples` ajoute chaque
keyframe (des millions de lignes) : utile pour l'analyse statistique, inutile pour l'inventaire.

Les tables `cam_anim`, `cam_anim_channel`, `cam_anim_object`, `cam_anim_sample` et
`cam_re_symbol` **existaient depuis un chantier antérieur mais étaient vides** ; elles ne le sont
plus, sauf `cam_anim_sample` (peuplée seulement avec `--samples`) et `cam_re_symbol`, qui attend
les adresses que le désassemblage produira.

## Pourquoi cela compte

`nie-formats` porte déjà l'assemblage des modèles de cut-in — depuis le 2026-09-19, la famille
`chr/_waza/` est débloquée, son G4MD vivant dans le `.g4pkm`. Le rendu 3D et l'encodage vidéo
existent. **La caméra est la seule pièce manquante entre les assets et une séquence rendue** :
sans elle il n'y a pas de plan, seulement un modèle.
