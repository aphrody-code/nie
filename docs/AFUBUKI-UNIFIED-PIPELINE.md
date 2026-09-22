# Pipeline unifiée Afubuki — VFS, Zukan, Mixi-Max et rendu

## Périmètre

Afubuki réunit les références officielles disponibles de Byron Love/Aphrodi/Terumi
Afuro et Shawn Froste/Shirou/Atsuya Fubuki. Les assets officiels restent la source
de vérité : `data/ref/afubuki/meta/manifest.json` décrit le chemin VFS, la taille,
le type et l'empreinte. Les références fan-art et les moments où les personnages
sont ensemble sont des références visuelles séparées ; elles ne remplacent jamais
un asset VFS.

## Chaîne de preuve

```text
API/VFS + cfg.bin + Lua/C++ evidence
              |
              v
nie-data (BASARA/Mixi-Max, stats, text) + nie-zukan (joins/ranking)
              |
              v
nie-ocgen (chara_edit/T2B) + nie-formats (G4MD/G4MG/G4TX)
              |
              v
nie-render3d / nie img (GLB, PNG, composites, pixel metrics)
              |
              v
var/afubuki/unified/ (dérivé, jamais réinjecté dans data/ref)
```

## Autorité par famille

| Famille | Autorité | Règle anti-régression |
|---|---|---|
| VFS, modèles, textures, sons, vidéos | `data/ref/afubuki/meta/manifest.json` | taille + SHA-256 ; aucune source écrasée |
| Mixi-Max/BASARA | `nie-data::basara` + `basara-profile.json` | conserver les listes et les plages `[offset,count]` |
| Zukan | `nie-zukan` | joindre par hash/CRC confirmé ; ne jamais inventer un personnage |
| Avatar `chara_edit` | `nie-data` + `nie-ocgen` | relecture T2B identique avant toute écriture dérivée |
| Rendu 2D | `nie img`, `nie-aphrody` pixel tools | PNG dérivé, comparaison pixel séparée |
| Rendu 3D | `nie-render3d`, `nie render` | GLB/PNG dérivé, source G4MD/G4MG intacte |
| C++/Lua/nie.exe | RE et scripts locaux | preuve classée `observed`, `inferred` ou `unknown` |

## Exécution

```powershell
# Audit lecture seule : manifeste, fichiers, tailles, SHA-256, variantes, SEO
bun run scripts/afubuki-unified-pipeline.ts

# Même audit avec rendus dérivés autorisés dans var/afubuki/unified/
bun run scripts/afubuki-unified-pipeline.ts -- --render

# Validation OC/Mixi-Max/chara_edit
cargo run -p nie-cli -- oc validate afubuki --data data

# Parseur BASARA/Mixi-Max
cargo test -p nie-data --test basara_golden

# Pipeline chara_edit OC
cargo run -p nie-ocgen -- morphologies
cargo run -p nie-ocgen -- slots
```

Le script UV `scripts/donnees/afubuki-oc.py` génère le SQL de métadonnées,
mais son résultat doit être relu et approuvé avant toute insertion distante.
Les commandes de rendu utilisent uniquement des sorties dérivées. L’absence d’un
VFS complet, d’une ligne Zukan ou d’un asset fan-art ne doit pas être transformée
en donnée officielle.

## État actuel et limites

- Le corpus Afubuki extrait comprend 74 entrées de manifeste et les variantes
  Byron/Fubuki documentées dans `complete-profile.json`.
- La structure BASARA est parsée et testée, mais un hash d’asset Mixi-Max dédié
  n’est pas revendiqué sans résolution VFS.
- Les fan-arts ne sont pas mélangés aux textures officielles : ils servent de
  références dans un futur dossier `data/ref/afubuki/fan-art/` avec provenance,
  licence et empreinte obligatoires.
- Un rendu réussi ne prouve pas un chargement par `nie.exe` ; le chargement réel
  reste un gate séparé avec VFS et build de jeu correspondants.
