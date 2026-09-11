# Atlas — l'index unique des surfaces RE

Le savoir de ce dépôt vivait en huit endroits sans jointure : une base de connaissance de
19 Go (`var/niers.sqlite`), une arborescence `data/re/` de 4 000 fichiers, une forge
(`forge/asm/lifted.s`, `var/forge/cover.json`, `data/forge/registry.json`), des exports
(`export/`, `data/export*`), 1 063 documents Markdown, 46 crates, 178 outils exécutables et
trois binaires `nie.exe`. Aucun de ces gisements ne savait ce que les autres contenaient.

L'atlas les met dans **une seule base** — `var/nie-atlas.sqlite`, 53 Mo, reconstruite de zéro
en 3 minutes, dont 8 secondes hors digest de la base de connaissance — et en publie un miroir Redis pour que n'importe quel agent ou service
l'interroge sans ouvrir SQLite.

```
niers atlas build      # (re)construit l'index + le miroir redis
niers atlas status     # une ligne mesurée
niers atlas search X   # cherche dans TOUTES les surfaces d'un coup
niers atlas gaps       # la route vers les 100 %, classée
niers atlas next       # le prochain chantier, en JSON, pour la boucle
```

## Ce qui est indexé, et d'où ça vient

| Table | Contenu | Source |
|---|---|---|
| `atlas_artifact` | tout fichier de la chaîne RE/forge : chemin, zone, type, taille, sha256, mtime, lignes, suivi git | marche du dépôt (`crates`, `docs`, `forge`, `data/re`, `data/forge`, `export*`, `scripts`, `python`, `deploy`, `dist`, `refs`) |
| `atlas_crate` + `atlas_crate_dep` | les crates : rang, version, LOC, tests, `unsafe`, `// EXTERN:`/`todo!()`, dépendances | lecture directe des `Cargo.toml` (jamais `cargo metadata` : il prend le verrou du workspace) |
| `atlas_doc`, `atlas_doc_section`, `atlas_doc_ref` | le corpus Markdown, ses sections, et **ce qu'il affirme de la machine** : adresses `0x14…`, `FUN_…`, empreintes sha256, tables de la KB, crates, commandes, chemins | parse des `.md` indexés |
| `atlas_kb_table` | inventaire de la base de connaissance : une ligne par table, avec son compte | `ATTACH … mode=ro` sur `var/niers.sqlite` |
| `atlas_symbol` | les fonctions **nommées** de la KB (nom, adresse, sous-système, confiance) + `ported` | `kb.function WHERE name IS NOT NULL` |
| `atlas_unit` | le découpage du binaire de référence et l'état de production de chaque unité | `var/forge/cover.json`, `forge/asm/lifted.s`, `data/forge/registry.json`, `kb.forge_unit` |
| `atlas_binary` | `nie.exe` (référence), `dist/nie.exe` (produit), `nie_eacpatched.exe` (patché) + identité byte-à-byte | sha256 sur fichier |
| `atlas_tool` | ce qui est exécutable : sous-commandes `niers` (lues sur la définition clap), recettes `just`, scripts | clap + `justfile` + `scripts/` |
| `atlas_metric` | **chaque chiffre mesuré**, avec la commande qui l'a produit | `atlas build`, `scripts/atlas-loop.sh` |
| `atlas_gap` | un écart mesurable par domaine, vers 100 % | dérivé des métriques, jamais inventé |
| `atlas_run` | ce que la boucle autonome a fait, et en combien de temps | `atlas run` |
| `atlas_text` (+ `atlas_fts` si FTS5) | le texte cherchable de tout ce qui précède | rempli à chaque import |

**Règle d'honnêteté du schéma** : `refresh_gaps` ne crée un écart que pour une métrique
**réellement enregistrée**. Une mesure absente ne laisse pas une ligne à zéro — qui se lirait
« rien n'est fait » — elle ne laisse rien.

## Première mesure (2026-09-11, ce VPS)

```
atlas-build files=6743 bytes=1054134948 crates=46 docs=1063 doc_refs=13758 binaries=3
            tools=178 symbols=13845 units=215688 units_lifted=105266 units_exact=7
            kb_tables=52 kb_rows=41297157 gaps=7 redis=14032 ms=189741
```

- **215 688 unités** de recouvrement, dont **105 266 relevées en assembleur** (48,8 %) et
  **7 byte-exactes par voie C** (les 7 entrées `bytes` de `data/forge/registry.json` ; les
  27 entrées `semantic` ne tombent sur aucun début de fonction réel).
- **1 063 documents**, dont **955 (89,8 %) ancrés** sur au moins une référence machine.
- `dist/nie.exe` est **byte-identique** à `nie.exe` (`b1fa04ea3658…`) : le palier G0 tient.
- **52 tables** de la base de connaissance inventoriées, **41 297 157 lignes** au total, dont
  **13 845 fonctions nommées** copiées ici (12,57 % des 108 650 de `kb.coverage`).
- Le miroir Redis écrit **14 032 clés** ; `db4` en compte moins, plusieurs adresses partageant
  un même nom — d'où la clé inverse `atlas:addr:0x…`, qui, elle, ne collisionne pas.

## La route vers les 100 %

`atlas gaps` classe les écarts par `(cible − courant) × poids`. Les poids disent ce que
« 100 % » veut dire pour ce dépôt, dans l'ordre :

| Domaine | Métrique | Poids | Action |
|---|---|---|---|
| `forge.identity` | `dist/nie.exe` byte-identique | 10 | `just forge` |
| `forge.produced` | part du binaire réellement produite par le dépôt | 9 | `just forge` |
| `proofs.uemu` | preuves uemu au vert (l'oracle byte-exact) | 7 | `just preuves` |
| `forge.code` | part du `.text` produite | 6 | `nie-forge lift` |
| `re.classified` | fonctions classées | 6 | `just re-rebuild` |
| `re.named` | fonctions nommées | 5 | `niers propagate`, `niers seed-ui` |
| `forge.lifted` | unités relevées en assembleur | 5 | `nie-forge lift` |
| `forge.units` | unités dont la source C redonne les octets | 4 | `just forge-cc` |
| `port.symbols` | symboles cités par une source Rust | 3 | `niers atlas link` |
| `docs.anchored` | documents ancrés sur la machine | 2 | `niers atlas docs --orphans` |

`port.symbols` est une **borne basse assumée** : un nom cité en commentaire compte, une
réimplémentation anonyme ne compte pas.

## La boucle autonome

```
bash scripts/atlas-loop.sh            # un tick : mesure -> index -> classe -> agit -> re-mesure
bash scripts/atlas-loop.sh --ticks 5
bash scripts/atlas-loop.sh --no-act   # mesure et index seuls
ATLAS_PROOFS=1 bash scripts/atlas-loop.sh   # rejoue aussi les 47 preuves uemu (lent)
```

Un tick :

1. **mesure** `nie-forge report --json` (produced, code_rust), l'identité `dist/nie.exe` ↔
   `nie.exe`, et — sur demande — les preuves uemu ;
2. **indexe** tout le dépôt (`niers atlas build`) et pousse le miroir Redis ;
3. **classe** les écarts et prend le mieux placé (`niers atlas next`) ;
4. **agit** une fois, dans une action bornée et réversible :
   `forge.*` → `nie-forge build` + `verify` ; `re.*` → `niers propagate` ;
   `proofs.uemu` → `scripts/proofs.sh` ; `docs.anchored` → liste les documents orphelins ;
   tout le reste → journalise « décision humaine ou agent », sans rien toucher ;
5. **re-mesure** et écrit le tout dans `atlas_run` + `var/atlas-loop.ndjson`.

Bornes tenues par le script : aucun `push`, aucune suppression, aucun service, rien hors du
dépôt, aucun `pkill` (les PID d'agents vivent sur cette machine), et un **garde-disque** —
les étapes qui écrivent (lift 105 Mio, build 34 Mio) sont sautées sous
`ATLAS_MIN_FREE_MIB` (2 Gio par défaut), le disque du VPS tenant 91 % plein.

Pour une cadence horaire, la ligne cron **n'est pas installée** (changer ce qui tourne sur
l'hôte reste sous la main de l'utilisateur) :

```cron
23 * * * * cd /home/ubuntu/niers && bash scripts/atlas-loop.sh --no-act >> var/atlas-loop.log 2>&1
```

## Le miroir Redis

`db4` — `db0` porte la frontière BFS et le bot, `db1` les vecteurs RAG, `db3` le cache
CPK/textures (cf. [RE.md](RE.md)).

| Clé | Contenu |
|---|---|
| `atlas:status` | le statut complet, en JSON |
| `atlas:gaps`, `atlas:gap:<domaine>` | les écarts classés |
| `atlas:sym:<nom>` | `0x…` — résolution nom → adresse en O(1) (dernier gagnant si le nom se répète) |
| `atlas:addr:0x<hex>` | le nom à cette adresse — sans collision possible |
| `atlas:tool:<type>:<nom>` | `chemin\trésumé` |
| `atlas:generated_at` | horodatage epoch |

```bash
redis-cli -n 4 get atlas:status | jq
redis-cli -n 4 get atlas:sym:CMenuAttachLocator
```

## Pièges mesurés en construisant l'atlas (2026-09-11)

- **`kb.forge_unit` est VIDE** (0 ligne) : `nie-forge kb` n'a jamais écrit dans la base
  courante. La source réelle du découpage est `var/forge/cover.json` (39 Mo, 215 688 unités) —
  l'atlas la lit directement, et ne se fie pas à la table.
- **Le registre a deux chemins** : la CLI écrit par défaut dans `forge/registry.json`
  (supprimé du dépôt), alors que le fichier vivant est `data/forge/registry.json`. L'atlas
  essaie les deux, dans cet ordre de réalité.
- **`INSERT … SELECT … ON CONFLICT` ne parse pas sans `WHERE true`** en SQLite : sans la
  clause, `ON` se lit comme une jointure et l'erreur est `near "DO": syntax error`.
- **`pragma_table_info` n'accepte pas un nom qualifié** (`kb.forge_unit`) sur tous les
  builds SQLite ; l'atlas lit le DDL dans `kb.sqlite_master`.
- **Deux copies du corpus amont** : `refs/iecode-re/` et `data/re/50-source/upstream-iecode/`
  sont byte-identiques document par document (`niers atlas dupes` les compte). Décider
  laquelle fait autorité est un chantier ouvert, pas un bug de l'index.
- Le binaire `target/release/nie-forge` peut être **antérieur au format de `cover.json`**
  (`unknown variant 'inline_data'`) ; la boucle prend le plus récent des deux
  (`target/release` vs `target/debug`) plutôt que d'échouer sur un binaire périmé.

## Rapport aux bases existantes

L'atlas **ne remplace pas** `var/niers.sqlite` : il en publie l'inventaire et la partie
interrogeable (les 13 653 noms), et pointe vers elle pour le reste (xrefs, chaînes,
constantes, 2,6 M d'échantillons de keyframes caméra). Le schéma vit dans la même crate que
celui de la base de connaissance — `crates/forge/nie-index/src/atlas.sql` à côté de
`schema.sql` — parce que c'est la crate qui possède déjà « l'index ».
