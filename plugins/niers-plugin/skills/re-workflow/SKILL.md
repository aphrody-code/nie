---
name: re-workflow
description: La boucle de reverse-engineering du dépôt niers, pilotée par l'atlas — l'index unique de toutes les surfaces RE (fichiers, crates, docs, base de connaissance de 19 Go, unités de forge, binaires, outils). À déclencher dès qu'il s'agit de chercher quelque chose dans le dépôt RE, de savoir où en est la reconstruction de `nie.exe`, de choisir le prochain chantier, ou quand l'utilisateur dit « atlas », « où en est-on », « quoi faire ensuite », « couverture », « forge », « 100 % ».
---

# niers — la boucle de reverse-engineering

Le dépôt reconstruit `nie.exe` (Inazuma Eleven: Victory Road, PE x86-64) et prouve sa
compréhension en le **reproduisant octet pour octet**. Le reverse-engineering est le moyen ;
la mesure est le juge.

## Règle n° 1 — interroger l'atlas AVANT de fouiller l'arbre

Tout ce que le dépôt sait vit dans **une** base, `var/nie-atlas.sqlite` (miroir Redis `db4`) :

```bash
niers atlas search <terme>   # docs + symboles + outils + fichiers + crates, en une requête
niers atlas status           # une ligne mesurée
niers atlas gaps             # la route vers les 100 %, classée
niers atlas next             # le prochain chantier, en JSON
niers atlas docs --orphans   # les documents qui n'ancrent rien sur la machine
niers atlas dupes            # les fichiers strictement identiques à plusieurs chemins
just atlas                   # (re)construire l'index (~3 min à froid, 8 s sans le digest KB)
```

Un `rg` à la racine dépasse 60 s ; l'atlas répond en millisecondes et couvre des surfaces qu'un
`grep` ne voit pas (le digest de la base de connaissance, les unités de forge, les outils).
Ne fouiller l'arbre à la main que si l'atlas n'a rien — et, dans ce cas, `niers find` /
`niers grep` (moteur ripgrep) plutôt que les binaires système.

## Règle n° 2 — le prochain chantier se lit, il ne s'invente pas

`niers atlas gaps` classe chaque écart par `(cible − courant) × poids`. Les poids disent ce que
« 100 % » veut dire ici, dans l'ordre : identité du binaire 10, part produite 9, preuves uemu 7,
`.text` 6, fonctions classées 6, fonctions nommées 5, unités relevées 5, unités byte-exactes 4,
symboles portés 3, documents ancrés 2.

La boucle autonome enchaîne tout cela :

```bash
bash scripts/atlas-loop.sh              # un tick : mesurer → indexer → classer → agir → re-mesurer
bash scripts/atlas-loop.sh --no-act     # mesurer et indexer seulement
bash scripts/atlas-loop.sh --ticks 5
ATLAS_PROOFS=1 bash scripts/atlas-loop.sh   # rejoue aussi les preuves uemu (lent)
```

Elle agit **une fois par tick**, de façon bornée et réversible, à l'intérieur du dépôt : jamais
de `push`, de suppression, de service, de `/etc`, ni de `pkill` ; garde-disque à 2 Gio et
`timeout` sur chaque action.

## Règle n° 3 — aucune mesure sans sa commande

Un chiffre n'entre dans l'index qu'accompagné de la commande qui l'a produit :

```bash
niers atlas metric proofs.ok 12 --total 47 --source 'bash scripts/proofs.sh' --refresh
```

Et un écart n'existe que si sa métrique a réellement été mesurée : `refresh_gaps` ne crée
**aucune** ligne pour une mesure absente, plutôt qu'un zéro qui se lirait « rien n'est fait ».
Corollaire : ne jamais recopier un chiffre d'un document — le régénérer.

## Les trois oracles, par ordre de force

1. **L'identité de la forge** — `just forge` ; `nie-forge build` échoue si
   `sha256(dist/nie.exe)` diffère de la référence. Ne jamais « réparer » ce test.
2. **uemu** — `just preuves` émule sous Unicorn la fonction RÉELLE du binaire et compare le
   portage bit à bit. C'est ce que Rust ne sait pas produire seul.
3. **Les golden `nie-data`** — une famille n'est portée que si elle recalcule le dump du jeu
   bit pour bit sur son corpus entier.

Tout ce qui n'est pas validable est marqué incomplet, jamais « fait ».

## Vérifier que le serveur MCP dit vrai

`cargo test -p nie-mcp --test re_real` interroge le **vrai** serveur sur stdio (`re_coverage`,
`re_query`, `re_function` par adresse **et** par nom, `cli_atlas status`/`gaps`) puis corrobore
ses réponses contre la table `.pdata` du binaire de référence, lue indépendamment par `nie-pe`.
Le test est *data-gated* : sans `var/niers.sqlite` ni `nie.exe`, il dit ce qu'il saute et passe.

**Mesure du 2026-09-11 — à connaître avant de citer la base** : sur 400 fonctions nommées,
**43,00 % seulement** commencent sur une vraie racine `.pdata` de `nie.exe` (172/400 ; 163 de
plus tombent à l'intérieur d'un corps). Le binaire de référence a **55 351** racines `.pdata`,
la base en a indexé **50 674** : elle décrit un **autre build** (`binary.sha256 = 4c2b91fb…`,
31 468 032 o) que la cible (`b1fa04ea…`, 33 918 464 o). D'où l'écart `re.anchoring` dans
`niers atlas gaps` : ré-ancrer la base est le préalable à toute citation de ses adresses.

Attention au format des réponses : `re_query` rend les colonnes d'adresse en **chaînes
hexadécimales** (`"0x140452820"`), pas en nombres.

## La chaîne, et qui possède quoi

```
Ghidra → nie-re / nie-index → nie-trace → nie-computer-use
                 ↓
            var/niers.sqlite (19 Go)  →  digest dans l'atlas
```

- `nie-re` : PE, `.pdata`, RTTI, vtables, désassemblage iced-x86, base de connaissance.
- `nie-index` : le schéma de la base **et** l'atlas (`atlas.rs` / `atlas.sql`).
- `nie-pe` / `nie-asm` / `nie-forge` : découpage byte-exact, encodeur x86-64, production.
- `nie-trace` : lectures bornées du processus vivant. `nie-computer-use` : frontière typée.

## Pièges mesurés — les répéter coûte des heures

- L'index Ghidra est **désaligné** : `.pdata` est la vérité terrain (3,7 % seulement des `FUN_`
  de Ghidra tombent sur un vrai début de fonction). Toujours passer par `just re-rebuild`,
  jamais par les CLI brutes — `disasm` avant `rtti` rend un résultat incomplet **sans erreur**.
- Les racines `.pdata` ne sont pas un nombre unique : **50 674** dans la base (build indexé),
  **55 351** dans `nie.exe` (référence). Citer le binaire avec le chiffre, toujours.
- `kb.forge_unit` est **vide** : le vrai découpage est `var/forge/cover.json` (215 688 unités).
- Le registre vivant est `data/forge/registry.json`, pas le défaut CLI `forge/registry.json`.
- `target/release/nie-forge` peut être antérieur au format de `cover.json`
  (`unknown variant 'inline_data'`) : prendre le plus récent de `release`/`debug`.
- La porte de qualité est `cargo clippy --all-targets`, **jamais**
  `cargo build --workspace --all-targets` : le disque du VPS est à 91 %.
- `pixel-perfect` n'est pas acquis, et `byte-exact` qualifie les **données**, jamais les pixels.

## Références

`docs/ATLAS.md` (l'index et la boucle) · `docs/RE.md` (la base de connaissance) ·
`docs/FORGE.md` (les paliers G0→G6) · `PLAN.md` (le plan, mené par les écarts mesurés).
