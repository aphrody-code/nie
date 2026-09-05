# AGENTS.md — contexte commun à tous les agents de `niers`

Ce dépôt est travaillé par **plusieurs agents à la fois** (Claude Code, Codex, et ce qui
viendra). Ce fichier est le contexte que **tout** agent lit en premier, quel que soit son
moteur. Il tient sur un écran : le détail est ailleurs, et dit où.

| Pour | Lire |
|---|---|
| Les règles complètes du dépôt | `CLAUDE.md` — vaut pour **tous** les agents, pas seulement Claude |
| Le protocole de coexistence | `docs/A2A-CODEX.md` |
| La carte machine (A2A v1.0) | `ai.json` à la racine |

Communiquer en **français**.

---

## 1. Se parler

```bash
# Emettre (depuis la racine, qui porte ai.json)
aphrody a2a tick --iteration <n> --side <moi> --peer <lui> --kind fact \
  --subject "<type>: <sujet>" --body "<fait mesure>"

# Lire ce que l'autre a ecrit
tail -5 .coord/inbox-from-<lui>.jsonl | jq -c '{ts,topic,body}'
```

- **`--kind` n'accepte que `fact` et `ping`.** Mesuré : `claim`, `done`, `block`, `status`
  retombent sur `ping` **en silence**, l'intention est perdue. Le type se code donc dans le
  sujet : `claim:`, `done:`, `block:`, `goal:`.
- Le listener JSON-RPC de ce dépôt est `127.0.0.1:8792` (`aphrody a2a serve`).
  **`8788` est celui du dépôt `aphrody`** — ne pas confondre.
- MCP partagés : `aphrody` (docs, RE) et `niers-game` (VFS, assets, KB). MCP sert à **agir**,
  jamais à se coordonner : un appel MCP ne laisse aucune trace lisible par l'autre agent.

## 2. Ne pas s'écraser

1. **Annoncer son périmètre avant d'écrire** (`claim:`), et n'écrire rien en dehors.
2. **Fichiers d'arbitrage réservés à Claude** : `CLAUDE.md`, `AGENTS.md`, `.gitignore`,
   `justfile`, manifestes racine, `docs/`. Besoin d'un changement ? Envoyer un `block:`.
3. **Un seul auteur de commits.** Les autres agents laissent l'arbre modifié et rendent un
   `done:` avec la liste des fichiers et la mesure de vérification.
4. **Rien de destructif ni de production sans accord** : pas de `rm -rf`, pas de
   `git reset --hard`, pas de redémarrage de service, pas d'écriture hors du dépôt.
   **`pkill -f` est interdit** — il tue les sessions d'agent. Cibler un PID.

La boucle autonome (`scripts/a2a-loop.sh <claude|codex>`) fait un tour : lire le dernier
`goal:` du pair, l'exécuter, rendre un `done:`, puis **fixer au pair le `goal:` suivant**.
Seul un sujet préfixé `goal:` vaut ordre de travail.

## 3. Vérifier — et ce qui ment

Le portail est **clippy**, jamais un build complet.

```bash
cargo clippy -p <crate> --lib --tests     # 0 warning exige
bun run typecheck                          # cote TS
```

- **`cargo build --workspace --all-targets` sature le disque** (92 % plein). Ne jamais le lancer.
- **Une suite qui affiche « 0 passed » n'est pas verte** : elle n'a pas tourné.
- **Une feature éteinte transforme un test en faux vert** — ou en erreur de compilation.
  `nie-formats` n'active que `std` et `lua` ; `nie-data` n'active pas `serde`. Un test qui
  utilise un item gaté **sans** `[[test]] required-features` casse le portail (E0433) au lieu
  de sauter. Vérifié ici sur 24 tests de `nie-data`.
- **Une garde de test qui teste un chemin en dur au lieu de `NIE_GAME_DIR` se skippe
  toujours**, en silence, et la suite s'annonce verte sans rien exécuter.
- **`dotnet` est ABSENT de ce VPS** : `csharp/` ne se compile ni ne se teste ici. Un lot C#
  ne peut être que **relu** — le dire, ne jamais l'annoncer vérifié.

## 4. Les pièges qui coûtent le plus cher

**Git ne descend jamais dans un répertoire exclu.** `!data/oc/` seul ne ramène rien si
`data/` est ignoré. Il faut ré-inclure le parent, ré-exclure son contenu direct, puis
ré-inclure la cible — et écrire `.agents/**`, jamais `.agents/`, quand on veut ré-inclure
dedans. Vérifier chaque cas par `git check-ignore -v <fichier>`, jamais au raisonnement.

**Un `.gitignore` ne s'applique plus à un fichier déjà suivi.** Un fichier d'instructions
peut donc « exister » chez vous et être absent d'un clone frais, sans le moindre signal.
C'est ce qui a fait disparaître `AGENTS.md`, les sous-agents du plugin `niers` et les README
des OC. Tout le markdown du dépôt est désormais versionné, sans liste d'exceptions.

**Un chemin machine en dur court-circuite la résolution du jeu.** Aucun chemin de machine
n'est compilé dans un binaire : `nie_formats::vfs::resolve_game_dir()` côté Rust,
`dansLeDepot()` côté TS, `TestDataPaths`/`ResolveDefaultGamePath()` côté C#. Chercher le
helper existant avant d'en écrire un.

**Un chemin VFS cité de mémoire est presque toujours faux** — les fichiers du jeu portent un
numéro de version (`chara_base_1.03.98.00.cfg.bin`). Le résoudre par `niers vfs find` avant
de l'écrire. C'est la mesure qui tranche une revue de code, dans un sens comme dans l'autre.

**`sed -i` échoue en silence des deux côtés** : motif absent → 0 remplacement, exit 0,
fichier intact ; motif trop fréquent → trop de remplacements, exit 0. Éditer avec un vrai
outil d'édition. Même logique pour Python : `uv run` toujours, et **un fichier** au-delà de
deux lignes (le shell mange `$(…)` et les backslashes avant Python).

**`rg`, jamais `grep -r` à la racine** : `grep` descend dans `node_modules` et part en
timeout à 60 s, quand `rg` répond en 0,06 s.

## 5. Ce qui casse la production

Cette machine porte **18 services** et un état partagé. Avant de déplacer ou de renommer,
chercher qui pointe dessus **hors du dépôt** :

- `/etc/systemd/system/nie-miroir.service` cible en dur
  `scripts/donnees/miroir-inagle.sh`, son timer est actif, et son `ExecStartPost` redémarre
  `nie-model-serve`. Le renommer casse la rotation nocturne. Le réparer demande un
  `daemon-reload`, donc l'accord de l'utilisateur.
- Un démon externe commit périodiquement sous `chore(sync): checkpoint <horodatage>`. Il ne
  distingue pas les auteurs et **peut capter un lot à mi-course**. Relire `git log` avant de
  conclure qu'un commit est le sien.

## 6. Contrainte produit — vitrine `nie.aphrody.com`

Toute évolution publique de Niers passe par une crate `nie-site` **100 % Rust**,
`publish = false`, sous `crates/tools/` : Axum 0.8, Tokio 1.x, Tower, rustls ; aucun serveur
Bun/Node. Écoute **uniquement** sur `127.0.0.1:8085`, derrière nginx et TLS. Fournir
`/healthz`, `/robots.txt`, `/.well-known/security.txt` ; API futures sous `/api/v1/`,
authentifiées, sans détail d'infrastructure. Tests de routes + clippy sans avertissement
avant d'activer nginx.

Les contenus Inazuma Eleven sont exploitables au titre de l'Accord Commercial Officiel
N° RG-L5-VR-2026-001 (sites, jeux, mods, traductions, dérivés, assets). **Jamais** de donnée
personnelle, de secret, de credential, de chemin machine ni de dump hors périmètre.

Le DNS et le TLS sont réservés par le dépôt Aphrody ; la stratégie commune des vitrines vit
dans `../aphrody/docs/SITES-PLATFORM.md`.
