# Absorber `iecode` C# dans niers

But : que `csharp/` (230 fichiers, 46 922 lignes) devienne redondant, puis supprimable, en portant
ses capacités en Rust **avec un gain mesurable**, pas à l'identique.

Document de reprise : il porte l'inventaire déjà fait, ce qui est acquis, et l'ordre à suivre.
Rien ici ne demande de refaire l'analyse.

---

## Ce qui est déjà acquis

`crates/engine/nie-viola` porte les quatre opérations de modding en Rust natif, validées sur le
jeu réel (`cargo run -p nie-viola --example valider_reel --release`) :

| | Preuve sur le jeu réel |
|---|---|
| `cpk_list.cfg.bin` | 255 308 entrées, enveloppe AES, décodé → réencodé → relu à l'identique |
| dump | 9 788 fichiers octet pour octet contre la lecture VFS, 0 échec |
| reprise de dump | 2ᵉ passage : 0 réécriture |
| pack | entrée basculée hors paquet, taille inscrite |
| merge au champ | deux mods éditant des champs différents d'un même `.cfg.bin` survivent tous les deux |
| crypto Criware | aller-retour exact sur un `.cpk`, par tranches |

Gains réels sur les trois implémentations amont (Viola C#, port C++ du dépôt, `ievr_toolbox` Rust) :
ordonnancement des paquets par volume décroissant, mappage mémoire au lieu d'un déchiffrement vers
un dossier temporaire, sommaire indexé une fois par paquet, reprise au paquet près, saut des
fichiers déjà à la bonne taille, et surtout **fusion au champ** — impossible sans comprendre les
formats.

L'onglet **Viola** de `nie-explorer` appelle ce crate en process (aucun binaire externe).

---

## Le constat qui change la stratégie

**La suite de tests C# protège beaucoup moins qu'elle n'en a l'air.** Sur 220 cas, **114 gardes de
saut silencieux** (`if (!Has…) return;`) dépendent de 9 racines codées en dur hors dépôt
(`/home/ubuntu/niers/data`, `/tmp/s`, `/tmp/g4pkm-extract`) et de fichiers `re/lua/raw`,
`re/lua/unluac.jar`, `re/menu/hash-dictionary.json` — or `git ls-files re` est **vide**. Sur une
machine Windows, `just cs-test` passe au vert **sans exécuter** la majorité des cas fichiers-réels.

Douze des 22 fichiers de test ont déjà un équivalent Rust au moins aussi fort (objbin, mevbin,
depot_resolver, token_store, cfgbin, bytecode Lua, menu_host, g4mg/g4md, g4pkm_motion, dxbc).

---

## À sauver avant tout retrait — irréversible

Vérifié absent de `crates/` par grep. À réimplanter en tests Rust **avant** de toucher à `csharp/`.

1. **20 paires (nom, hash) réelles** — `Level5HashTests.cs`, extraites de
   `cmd_tag_config_2.00.17.00.cfg.bin`, `soccer20_12_tactics_information.objbin`,
   `menu_group_capture_config.cfg.bin`. Aucun hit sur `CB189152`/`B1D0C26E`/`E07BCBBC`.
   Rust n'a que des vecteurs CRC32 génériques.
2. **Identifiants de scénario Lua** — `2492438505`, `536044352`, `1654568798`, cmdIds `711242136`
   et `532421851`, et le nom `general_win`. Seul `292844459` existe côté Rust.
3. **Valeurs de fixtures G4PK** — `s28g001b.g4sk` = 3 344 octets, hash `0x940E596D` ; les 192
   octets réels de `mainmenu90_02_2.g4mg` (indices `[0,1,2,0,2,3]` à `0x80`).
4. **Mesures de layout G4PKM** — `_cursor01` (−40, 40, 80, 80), `_pos_scl_base01` (1873, −39),
   échelles 0.65/0.9, hiérarchie parent, les 20 bones nommés de `title00_09`.

**`Resources/EACLauncher.zip`** (~2 Mio) est embarqué dans l'assembly, **gitignoré**, non
reconstructible depuis le dépôt, sans hôte Rust. Le sortir vers un artefact adressable est la
seule action qui rende `csharp/` retirable sans perte. Ce n'est **pas** le même sujet que
`niers mem patch-eac`.

---

## Capacités réellement absentes en Rust

À porter (aucun substitut aujourd'hui) :

- **`CfgBinTypesGenerator`** — génère `.d.ts` + `index/verify.json` depuis les `cfg.bin`. Seul pont
  automatique cfg.bin → TypeScript du dépôt. 0 hit sur `export interface` dans `crates/`.
- **`DiskBudget`** — garde-fou d'espace disque (`--max-disk 30G`). Le seul analogue est un exemple
  (`dump_packs.rs`) à réserve fixe, avec `statvfs` Unix-only donc inopérant ici.
- **`DumpPresets`** — catalogue de presets nommés (`inagle-azalee`…). C'est une **donnée** à
  porter, pas seulement du code. `nie-viola` n'a qu'un filtre glob libre.
- **`HostProfile`**, **`FxbinParser`** sémantique (techniques/passes), **`G4maParser::ParseMotionNames`**,
  **`CdnMediaTypes` + ETag**, **`G4pk::DetectSubFormat`/`ExtractFiles`**.
- **Magics manquants de `nie_formats::detect`** : G4PKM, G4MT, G4MA, G4RA, ADX, `\x1bLua`, objb,
  PXCL, **XFSA**, **XPCK** (ces deux-là : 0 hit dans tout `crates/`), plus le footer T2B.

**Divergence numérique à trancher** — `AdxInfo/ComputeCoefficients` : `cri_audio.rs:214-217` rend
`(7298, −3535)` à `highpass = 0` là où le C# calcule `(8192, −4096)`. L'un des deux est faux ;
ce n'est pas une question de portage mais de correction.

---

## Les six appelants réels du C#

Tout le reste est documentaire. **Aucun couplage CI** (`.github/workflows/ci.yml` n'appelle que
cargo), **aucun couplage Bun**.

1. `crates/tools/nie-cli/src/delegate.rs:41-52,109-124,127` + `main.rs` (`Cmd::Cs`, dispatch)
2. `justfile:158,197-201,225,231,237` (`cs-build`, `cs-test`, remontés en `-` non bloquant)
3. `scripts/sync-gamedata.ts:29,34,48,54` — **seul appelant fonctionnel hors CLI**, et non câblé
   dans `package.json`
4. `bench/cs/` — mesure Rust **contre** C# ; sa valeur vient de la présence du C#
5. `IECODE.sln`, `global.json`, `NuGet.config` — dont `bench/cs` hérite
6. `.gitignore:83-85` (EACLauncher.zip)

---

## Ordre de travail

1. **Réimplanter les quatre vérités terrain** ci-dessus en tests Rust. Seul point irréversible.
2. **Statuer sur `EACLauncher.zip`** : le sortir de l'assembly vers un artefact adressable.
3. **Exposer sous `niers` ce que Rust sait déjà faire mais que la CLI cache** — c'est la doctrine
   « niers est la seule CLI », violée aujourd'hui :
   - ~~`niers viola dump|pack|merge|crypto`~~ → **fait** : les quatre sous-commandes appellent
     `nie-viola` en process, vérifiées sur le jeu réel (dump filtré + reprise, aller-retour
     crypto involutif, merge à deux mods, pack sur les 255 308 entrées en enveloppe AES).
   - `niers steam list|download|sync` → `nie-steam` (complet, **non exposé** ; il faut lancer un
     second binaire aujourd'hui)
   - `niers info --json` — peut agréger ce que le C# ne sait pas voir : sha256 du binaire, part
     produite par la forge, couverture RE
4. **Porter les capacités sans substitut** (§ précédent), en commençant par `DumpPresets` et
   `DiskBudget` : ce sont les deux verrous de `scripts/sync-gamedata.ts`.
5. **Réécrire `scripts/sync-gamedata.ts` sur `niers`** — supprime l'unique dépendance d'exécution
   au .NET, et le `dotnet build` implicite au premier lancement.
6. **Retirer `Cmd::Cs`**, `delegate::cs`, `iecode_dll`, `iecode_cli_candidates`, la ligne `cs=` de
   `status()` et son test.
7. **Retirer** `justfile:158,197-201` et les trois `-just cs-*` des agrégats.
8. **Trancher `bench/cs`** : soit figer les colonnes `csharp`/`csharp-aot` dans
   `docs/BENCHMARKS.md` avant retrait, soit le garder comme dernier consommateur de `IECODE.Core`
   (auquel cas `global.json` et `NuGet.config` doivent survivre). Ne pas trancher, c'est perdre la
   preuve chiffrée qui justifie le portage.
9. **Re-viser les ancres documentaires** : `docs/DESIGN.md:561` cite `G4pkmLayoutTests.cs` comme
   preuve → viser `g4pkm.rs` ; `plugins/niers-plugin/agents/port-scout.md:43` fait grepper
   `csharp/` → retirer ; `ARCHITECTURE.md`, `SKILL.md`, `CLAUDE.md` passent de quatre
   implémentations à trois.

`IECODE.sln` et les `.csproj` ne bloquent qu'après (6) et (8).

---

## Mesurer l'avancement

La doctrine est déjà écrite en tête de `delegate.rs` : « chaque portage retire une délégation,
l'écart se mesure ». Ce qui manque est la mesure — ajouter à `niers backends` le **décompte des
commandes encore déléguées** rend l'absorption chiffrable, comme la forge chiffre le binaire.

État de départ : `niers` expose 24 variantes, `IECODE.CLI` en enregistre 38.
