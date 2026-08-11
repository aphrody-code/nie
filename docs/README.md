# Documentation de niers

Index unique des documents du dépôt unifié (Rust + C++ + C# + Bun). L'ancien index ne couvrait
que l'arbre C++ et pointait vers des fichiers déplacés ou absents.

## Commencer ici

| Document | Contenu |
|---|---|
| [ARCHITECTURE-POLYGLOTTE.md](ARCHITECTURE-POLYGLOTTE.md) | **La carte** : les quatre arbres, qui fait autorité sur quoi, les ponts, la CLI unique |
| [PORTAGES.md](PORTAGES.md) | Le registre des portages en cours, dans les deux sens, chiffré |
| [PLAN.md](PLAN.md) | Plan maître du projet (piliers, état réel) |
| [FORGE.md](FORGE.md) | Produire `nie.exe` au byte près depuis le workspace Rust |
| [../PROVENANCE.md](../PROVENANCE.md) | D'où vient chaque arbre, ce qui a été écarté à la copie |

## Architecture et plans

| Document | Contenu |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture du moteur Rust |
| [DESIGN.md](DESIGN.md) | Rendu pixel-perfect des écrans START et MENU |
| [STACK.md](STACK.md) | Briques runtime du jeu jouable |
| [RE-STACK.md](RE-STACK.md) | Runbook de l'échafaudage de reverse-engineering |
| [ROADMAP-100.md](ROADMAP-100.md) | Trajectoire vers 100 % de portage |
| [UNIFICATION.md](UNIFICATION.md) | Unification de la boucle de match (logique orpheline) |
| [DEDUP-PLAN.md](DEDUP-PLAN.md) | Déduplication *interne* au Rust, avec ses landmines |
| [INVENTAIRE.md](INVENTAIRE.md) | Inventaire réel RE / extraction / portage |
| [phases.md](phases.md) | Plan par phases du **toolkit C++** (historique, antérieur à l'unification) |

## Formats, données, jeu

| Document | Contenu |
|---|---|
| [format-reference.md](format-reference.md) | Référence des formats de fichiers du jeu |
| [cartographie-data.md](cartographie-data.md) | Cartographie du VFS et des données |
| [game-data/](game-data/) | Familles `cfg.bin` décrites une par une |
| [aphrody.md](aphrody.md) | Dossier de personnage (exemple de données croisées) |
| [jeu-jouable-avancement.md](jeu-jouable-avancement.md) | Avancement de l'axe « jeu jouable » |
| [ENGINE-GUIDE.md](ENGINE-GUIDE.md) | Bonnes pratiques Lua + Rust côté moteur |

## Reverse-engineering de `nie.exe`

| Document | Contenu |
|---|---|
| [nie-inspection.md](nie-inspection.md) | Analyse du PE : sections, RTTI, formats |
| [decomp-integration.md](decomp-integration.md) | Intégrer le pseudo-C décompilé (voie B de la forge) |
| [recherche-modele-match.md](recherche-modele-match.md) | Modèle tir/blocage/but dans `nie.exe` |
| [recherche-modele-match-decompile.md](recherche-modele-match-decompile.md) | Décompilation ciblée du même modèle |
| [nie-rtti-classes.txt](nie-rtti-classes.txt) | Les classes RTTI extraites |
| [dll-exports/](dll-exports/) | Exports des DLL tierces (Steam, EOS, curl) |

## Outillage et exploitation

| Document | Contenu |
|---|---|
| [cli-reference.md](cli-reference.md) | Commandes du toolkit C++ (accessibles via `niers cpp …`) |
| [dependencies.md](dependencies.md) | Dépendances C++ : vcpkg, headers vendorisés |
| [porting-guide.md](porting-guide.md) | Correspondances de types C# ↔ C++ (utile aux deux flux de portage) |
| [cpk-explorer-design.md](cpk-explorer-design.md) | Concept UI de l'explorateur CPK |
| [assets-wasm-avancement.md](assets-wasm-avancement.md) | Vérification adversariale assets/wasm |
| [wgpu-29-migration.md](wgpu-29-migration.md) | Migration wgpu 22 → 29, rendu déterministe |
| [skia-evaluation.md](skia-evaluation.md) | Évaluation de rust-skia pour le rendu |
| [vps.md](vps.md) | Profil VPS et réglages |

Les documents d'usage courant vivent aussi hors de `docs/` : `../CLAUDE.md` (règles de travail),
`../apps/nie-explorer/ROADMAP.md` (app desktop), `../tools/niers-plugin/` (plugin et skills).
