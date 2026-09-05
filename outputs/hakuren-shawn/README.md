# Dossier Hakuren / Alpin — Shawn Froste

Extraction locale effectuée avec `niers` le 5 septembre 2026. Les fichiers
sont des copies brutes du VFS, sans conversion ni renommage du contenu.

## Personnage ciblé

- Fiche Azalée : `shawn-froste-0x2DEC08C2`
- Identifiant : `0x2DEC08C2`
- Code interne vérifié : `c05024700`
- Noms : Shawn Froste / 吹雪 士郎
- Donnée de jeu : ancien entraîneur d'Alpin ; cette variante appartient à
  Inazuma Japon Évolution.

`assets/character/` contient le couple de modèle du visage (`.g4md` et
`.g4mg`), ses deux textures `.g4tx`, puis les conteneurs de voix JP `.acb` et
`.awb`.

## Variantes Shawn Froste — identifiants triés

Le nom seul est ambigu : le jeu contient **17** entrées. Elles sont rangées
ci-dessous par continuité, puis par `charaId` (identité de données), plutôt
que par hash ou ordre de recherche. Une même ressource de modèle peut servir
plusieurs fiches ; cela ne rend pas leurs statistiques ou techniques
interchangeables.

| Continuité | Identité de données | Variante (`charaParamId`) | Poste | Rareté | Modèle |
| --- | --- | --- | --- | --- | --- |
| Inazuma Eleven 2 | `0x0B617925` | `0xA2957757` | DF | Normal | `c02023290` |
| Inazuma Eleven 2 | `0x0B617925` | `0x8AB17EED` | DF | Normal | `c02023290` |
| Inazuma Eleven 2 | `0x950A7013` | `0x3CFE7E61` | FW | Normal | `c11902360` |
| Inazuma Eleven 2 | `0x13B82253` | `0xBA4C2C21` | FW | Normal | `c02023380` |
| Inazuma Eleven 2 | `0x13B82253` | `0x0B8A439A` | FW | Normal | `c02023380` |
| Inazuma Eleven 2 | `0x13B82253` | `0xA9C5C501` | FW | Normal | `c02023380` |
| Inazuma Eleven 2 | `0x13B82253` | `0xA5AAAB6B` | FW | Normal | `c02023380` |
| Inazuma Eleven 2 | `0x13B82253` | `0xE4A9DA7F` | FW | Normal | `c02023380` |
| Inazuma Eleven 2 | `0x13B82253` | `0x04F417C5` | FW | Normal | `c02023380` |
| Inazuma Eleven 2 | `0x13B82253` | `0x2D3CA337` | FW | Héros | `c02023380` |
| Inazuma Eleven 2 | `0x13B82253` | `0x36D8C89C` | FW | BASARA | `c02023380` |
| Inazuma Eleven 2 | `0x94203E9C` | `0x3DD430EE` | FW | Normal | `c02023370` |
| Inazuma Eleven 2 | `0x94203E9C` | `0xEBBD5BFF` | FW | Normal | `c02023370` |
| Inazuma Eleven 2 | `0x94203E9C` | `0x15F03954` | FW | Normal | `c02023370` |
| Chrono Stone | `0x841806B0` | `0x2DEC08C2` | FW | Normal | `c05024700` |
| Chrono Stone | `0xAD2F5DC6` | `0x04DB53B4` | DF | Normal | `c11908200` |
| Ares | `0xF761961B` | `0x5E959869` | FW | Normal | `c07090010` |

La variante extraite dans ce dossier est précisément `0x2DEC08C2` (Chrono
Stone), et non l'une des variantes d'Inazuma Eleven 2, Ares ou Miximax.

Les portraits Zukan correspondants sont dans
[`zukan-profiles/`](zukan-profiles/), avec leur association vers les IDs IEVR
dans [`zukan-profiles/manifest.json`](zukan-profiles/manifest.json). Les sept
profils officiels couvrent les dix-sept variantes IEVR : la carte IE2 liée à
Aiden correspond à `0x3CFE7E61` / `c11902360`, par description exacte.

## Techniques liées à cette variante

| Code | Nom français | Texture FR extraite |
| --- | --- | --- |
| `rhd10050` | Vol enroulé | non indexée dans le VFS |
| `whs00440` | Blizzard éternel | oui |
| `whd00240` | Patinoire | oui |
| `whs00600` | Loup légendaire | oui |
| `whs03400` | Feu glacé | oui |
| `who00750` | Cercle arctique | oui |
| `whd00550` | Ange des neiges | oui |

Les fichiers présents dans `assets/skills/` sont les textures de télop FR
réelles. `rhd10050` a bien été résolu dans la base, mais `niers vfs waza`
ne retourne aucun fichier associé ; aucun substitut n'a été inventé.

## Référence officielle Zukan

Le script [`../download-zukan-reference.ts`](../download-zukan-reference.ts)
cible ce même code `c05024700`. Son résultat existant dans
`../zukan-reference/c05024700/` contient 16 vues officielles vérifiées :
8 portraits (750×422) et 8 silhouettes (750×750), chacune avec URL source et
SHA-256 dans son manifeste. Il n'a pas été relancé afin de préserver ce relevé
daté ; il complète les assets VFS, sans les remplacer.

## Équipe Alpin

- Fiche Azalée : `0xCA377CE6`
- Nom JP/EN : 白恋中 / Alpine
- Emblème Victory Road : `em110018` (grand et petit format extraits dans
  `assets/team/`).
- Kits déclarés par le jeu : `0x2DC4AD97` (Victory Road), `0x620E735A`
  (Galaxy / GO), `0x1ED7F450` (Inazuma Eleven 1–3) et `0x638CAE24`
  (Ares / Orion).

Les CRC de modèles d'uniforme sont conservés sur la fiche Azalée. Le
manifeste local de résolution ne contient pas de correspondance pour ces CRC,
donc aucun uniforme arbitraire n'a été extrait.

## Textes et décor

Les textes de profil et de techniques viennent du miroir de jeu via
`niers wiki`. Les deux sources Fandom indiquent la continuité classique
d'Alpin et l'équipe Victory Road ; la page Victory Road situe ses matchs au
Soccer Garden d'Odaiba. Le miroir IEVR ne fournit toutefois aucune clé entre
Alpin (`0xCA377CE6`) et un des 81 visuels de stade : le décor reste donc
explicitement **non résolu**, plutôt que d'être associé à une image sans
preuve.

## Vérification

Les originaux ont été vérifiés avec `niers vfs stat` avant extraction. Le
format des fichiers extraits est contrôlable avec :

```powershell
niers format outputs/hakuren-shawn/assets
```
