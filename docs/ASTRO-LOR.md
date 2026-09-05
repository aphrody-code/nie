# Astro Lor — du wiki au jeu

Astro Lor est un **personnage original**. Il n'existe dans aucun fichier de
`nie.exe` ni d'un CPK : tout ce qui le concerne a été produit ici, à partir de son
document de présentation et des planches de référence signées **@Karumina_san**.

Ce document dit ce qui est **fait et mesuré**, puis ce qu'il reste à faire pour
qu'il devienne un personnage du jeu lui-même. Le détail asset par asset vit dans
`astro/manifeste-assets.json`, régénéré par
`uv run scripts/donnees/astro-lor-manifeste.py` — jamais recopié à la main.

---

## 1. Ce qui est fait — le wiki

Fiche complète sur `/chara/astro-lor`, au même niveau que n'importe quel
personnage du jeu.

| Élément | État | Où |
|---|---|---|
| Deux variantes (`base_slug = astro-lor`) | en base | `inagle_characters` |
| 26 super-techniques, quatre catégories | en base | `inagle_skills`, préfixes `ocs/oco/ocd/ock` |
| Esprit guerrier Morphée | en base | `inagle_keshins` |
| Quatre Mixi Max | en base | `inagle_miximax` |
| Biographie en neuf sections | en base | `inagle_characters.wiki_sections` |
| Portraits et neuf planches | fichiers | `apps/azalee/public/oc/astro-lor/` |

Les scripts sont rejouables : `scripts/donnees/astro-lor-oc.py` et
`astro-lor-auras.py` écrivent en `ON CONFLICT DO UPDATE`, et n'ont aucun effet sur
les lignes du jeu.

### Les statistiques ne sont pas inventées

Vérifié en base : dans Victory Road, le bloc de statistiques de niveau 99 ne dépend
que du couple **poste × rareté**. Les 900 gardiens Normal partagent exactement
`133/146/137/164/157/166/150` ; les 19 gardiens Héros,
`207/223/210/242/225/256/223`. Astro porte ces blocs-là. Seul le niveau 1, qui est
la part individuelle, a été choisi — parmi des combinaisons qui existent déjà sur
d'autres gardiens, et cohérentes avec le profil décrit (technique haute, agilité
basse).

Les notes sur 5 du document de présentation ne sont pas des statistiques de jeu :
elles vivent dans la biographie.

### Ce que le fichage a réparé au passage

Trois branches du code étaient mortes pour **tous** les personnages :

- `wiki_sections` était lu par le service et rendu par la fiche, mais la colonne
  n'existait pas — la section encyclopédique ne s'affichait jamais. Créée par
  `supabase/migrations/20260905000000_chara_wiki_sections.sql`, et reportée du
  personnage de base vers la variante que la page consomme.
- Le numéro de maillot était codé en dur à 10.
- Le genre n'avait que deux valeurs, et forçait un pictogramme faux.

---

## 2. Ce qui manque — le jeu

Un personnage du jeu, c'est **six fichiers propres à son code interne**, plus une
**ligne dans neuf tables**. Le reste — corps, uniformes, squelettes, animations —
est partagé et ne le concerne pas.

Le gabarit est mesuré sur un gardien déjà présent (`c02023290`) :

| Rôle | Chemin | Format | Écriture |
|---|---|---|---|
| Maille de la tête | `data/common/chr/_face/<groupe>/<code>/<code>.g4md` | G4MD | **absente** |
| Géométrie de la tête | `data/common/chr/_face/<groupe>/<code>/<code>.g4mg` | G4MG | **absente** |
| Texture de la tête | `data/dx11/chr/_face/<groupe>/<code>/<code>.g4tx` | G4TX | voie C# |
| Icône de portrait | `data/dx11/menu/200_icon/10_icon_chr/face/<code>_l.g4tx` | G4TX | voie C# |
| Banque de voix | `data/common/sound_asset/ja/<code>.acb` | ACB | **absente** |
| Flux audio | `data/common/sound_asset/ja/<code>.awb` | AWB | facultatif |

Codes retenus, dans un espace de noms qui ne peut pas entrer en collision avec les
codes extraits du binaire : **`c99019010`** (Inazuma Eleven, groupe `01_IE1`) et
**`c99019020`** (Victory Road, groupe `11_VICTORY`). Les douze groupes de
`data/common/chr/_face/` sont relevés par `niers vfs ls`, pas supposés.

Tables où il doit être déclaré, toutes repérées dans le VFS avec leur chemin
versionné : `chara_base`, `chara_param`, `chara_model`, `chara_parts`,
`chara_scale`, `chara_motion`, `chara_face`, `chara_name_tag`, `chara_costume`.

État mesuré du manifeste : **12 assets — 0 présents, 2 sources prêtes, 10 à
produire**, et 9 planches de référence disponibles.

---

## 3. Les verrous, dans l'ordre où ils bloquent

### V1 — Réencoder un `cfg.bin` fidèlement · bloquant

C'est le verrou décisif, et il précède tout le reste.

Le **patch en place** existe déjà et fonctionne : `nie_formats::t2b_patch` et
`nie_formats::rdbn_patch` réécrivent une variable sans déplacer un octet — toute
variable T2B occupe exactement 4 octets, donc un entier, un flottant ou l'offset
d'une chaîne s'écrivent sur place, et `patch_verifie` relit derrière. C'est ce
qui rend le modding à taille constante possible aujourd'hui.

Il **ne suffit pas ici** : ajouter un personnage, c'est ajouter une ligne, donc
changer la taille du fichier. Il faut réencoder, et le réencodage n'est pas fidèle.

#### Ce que l'écart vaut, mesuré

`cargo run -p nie-formats --example t2b_roundtrip --release -- --vfs chara_`

Sur les 152 `.cfg.bin` dont le nom porte `chara_` : **0 octet-identique**, 10 de
même taille mais au contenu différent, 142 de taille différente, et un écart cumulé
de **−65 398 octets** — le réencodage **rogne**.

#### La première cause est trouvée

Le plus petit cas divergent, `chara_cloth_change_1.00.29.cfg.bin`, fait 48 octets,
en perd exactement **16**, et diverge à l'**offset 32** : ses 32 premiers octets
sont déjà rendus à l'identique. Il ne manque que les 16 derniers.

Ces 16 octets sont un **pied de page**, relevé sur tout le corpus par
`cargo run -p nie-formats --example cfgbin_pied --release` :

```
70 798 fichiers T2B — 100 % portent la chaîne « t2b » dans leurs 16 derniers octets
×57 824   01 74 32 62 FE 01 01 00 01 00 FF FF FF FF FF FF
×12 974   01 74 32 62 FE 01 00 00 01 00 FF FF FF FF FF FF
```

Quinze octets sur seize sont **constants sur 70 798 fichiers**. Un seul varie, à
l'offset 6, entre `0x00` et `0x01`. `encode_t2b` s'arrête après la table de clés et
n'écrit rien de tout cela.

#### Pourquoi les tests ne le voyaient pas

`encode_t2b_round_trip_sur_le_vrai_jeu` passe à 498/498, et son équivalent RDBN à
16/16. Ces tests comparent l'**arbre relu par notre propre décodeur**, lequel
n'ouvre jamais le pied. Un arbre qui survit ne dit rien de ce que le jeu accepte :
c'est un vert qui mesure notre cohérence interne, pas la conformité.

#### Suite

1. Déterminer ce que vaut l'octet 6 — corréler ses deux valeurs avec le contenu
   (présence d'une table de clés, de chaînes, nombre d'entrées).
2. Écrire le pied dans `encode_t2b`, et remesurer : le fichier de 48 octets doit
   devenir octet-identique.
3. Reprendre le corpus et traiter la cause suivante, s'il en reste.

Preuve d'arrêt : `t2b_roundtrip --vfs chara_` rend **152/152 octet-identiques**.

### V2 — Écrire un modèle · bloquant

G4MD et G4MG se **lisent** — le skinning est validé byte-exact, l'extraction de
poses et d'animations aussi. Rien ne les **écrit**.

Deux voies, à trancher sur mesure et non par principe :
- ouvrir l'écriture G4MD/G4MG dans `nie-formats`, en s'appuyant sur les lectures
  déjà validées ;
- ou réutiliser une tête existante et ne remplacer que la texture — beaucoup moins
  cher, et suffisant pour un premier passage en jeu.

La seconde voie est la bonne première étape : elle permet de valider V1, V3 et V4
sans dépendre de V2.

### V3 — Encoder une texture · non bloquant

Le décodage BC7 est validé. L'encodage existe côté C# et côté C++ ; la conversion
C++ est la moins bonne des trois et ne doit pas être étendue. Passer par
`niers cs` pour les textures et les icônes.

Les deux icônes de portrait sont déjà prêtes en 512×512
(`apps/azalee/public/oc/astro-lor/face-og.webp`, `face-go.webp`).

### V4 — Injecter dans le VFS · non bloquant

Le cycle existe : `niers mod init` → `add` → `set` → `validate` → `install`.
`install` part toujours du `cpk_list` vanilla sauvegardé, et refuse au-delà de 64
entrées déjà *loose*. `uninstall` relit et compare les octets après restauration.

---

## 4. Le plan

Chaque étape se termine par une preuve, et aucune ne commence avant que la
précédente ait la sienne.

| # | Étape | Preuve d'arrêt |
|---|---|---|
| 1 | Aller-retour byte-exact sur les neuf tables `chara_*` | `sha256` identique, neuf fois |
| 2 | Ajouter une ligne à `chara_base` et relire par le **jeu** | le jeu démarre et lit la table |
| 3 | Icônes de portrait en G4TX | `niers vfs cat` les redécode, l'icône s'affiche en menu |
| 4 | Tête empruntée + texture propre | Astro apparaît, reconnaissable |
| 5 | Déclarer poste, élément, statistiques (`chara_param`) | il est sélectionnable et joue |
| 6 | Techniques : relier les 26 aux tables de waza | elles se déclenchent en match |
| 7 | Tête propre (V2) | modèle produit par le dépôt, chargé par le jeu |
| 8 | Voix | facultatif ; un personnage muet reste jouable |

L'étape 2 est le vrai jalon : c'est elle qui prouve que le dépôt sait **écrire**
une donnée que le jeu accepte. Tout ce qui est en amont est du wiki, tout ce qui
est en aval n'est que du volume.

---

## 5. Ce qu'il ne faut pas conclure trop vite

- **Un chemin VFS cité de mémoire est presque toujours faux** : les fichiers du
  jeu portent un numéro de version. Viser le dossier, vérifier par
  `niers vfs find` avant d'écrire un chemin dans du code ou un test.
- **Un fichier relu correctement par le dépôt n'est pas un fichier valide** : seul
  le lancement du jeu tranche.
- **Le wiki n'est pas le jeu.** Astro a une fiche complète et ne joue pas. Les
  deux affirmations sont vraies en même temps, et il faut les tenir ensemble.

## Références

- Manifeste d'assets : `astro/manifeste-assets.json`
- Générateur : `scripts/donnees/astro-lor-manifeste.py`
- Données du wiki : `scripts/donnees/astro-lor-oc.py`, `astro-lor-auras.py`
- Migration : `supabase/migrations/20260905000000_chara_wiki_sections.sql`
- Diagnostic de réencodage : `cargo run -p nie-formats --example t2b_roundtrip`
  (un fichier, ou `--vfs <motif>` pour tout le corpus)
- Relevé du pied T2B : `cargo run -p nie-formats --example cfgbin_pied`
- Patch en place : `nie_formats::t2b_patch`, `nie_formats::rdbn_patch`
- Modding LEVEL-5 en Rust natif : crate `nie-viola`, commande `niers viola`
- Modding : `niers mod`, et la section « Modding » de `CLAUDE.md`
- Éditeur d'avatar : `docs/AVATAR.md`
