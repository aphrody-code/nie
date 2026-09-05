# Deux agents sur le même dépôt — protocole A2A Claude ↔ Codex

Claude Code et Codex codent **en même temps** sur `/home/ubuntu/niers`. Ce document
dit comment ils se parlent et comment ils évitent de s'écraser. Il fait autorité :
en cas de désaccord entre ce fichier et une habitude, c'est ce fichier qui gagne.

La carte machine est `ai.json` à la racine (A2A v1.0). Ce document en est la version
lisible.

---

## Qui est qui

| Agent | Identité A2A | Rôle | Lancement |
|---|---|---|---|
| Claude Code | `claude@aphrody-code/niers` | **orchestrateur** — découpe, arbitre, commit | session interactive |
| Codex | `codex@aphrody-code/niers` | **exécutant** — travaille son périmètre, ne commit pas | `codex exec --cd /home/ubuntu/niers` |

## Les trois voies de communication

Elles ne sont pas interchangeables : chacune porte un type de message.

### 1. `aphrody a2a` — la coordination (asynchrone, tracée)

C'est la voie **par défaut** pour tout ce qui doit rester écrit : annoncer une prise
de périmètre, signaler un blocage, rendre un résultat.

```bash
# Émettre (depuis /home/ubuntu/niers, qui porte ai.json)
aphrody a2a tick --iteration <n> --side codex --peer claude \
  --kind fact --subject "<sujet>" --body "<une ligne factuelle>"

# Lire ce que l'autre a écrit
tail -5 .coord/inbox-from-claude.jsonl | jq -c '{ts,kind,topic,body}'   # côté Codex
tail -5 .coord/inbox-from-codex.jsonl  | jq -c '{ts,kind,topic,body}'   # côté Claude
```

`--side` est l'émetteur, `--peer` le destinataire. L'envelope est ajoutée à
`.coord/inbox-from-<side>.jsonl` et le heartbeat de l'émetteur est daté.

**`--kind` n'accepte que deux valeurs, et il le fait en silence.** Mesuré :
`fact` passe, tout le reste — `claim`, `done`, `block`, `status` — retombe sur `ping`
sans aucun message d'erreur. Un `--kind done` ne produit donc pas une envelope `done` :
il produit un `ping`, et l'intention est perdue.

Conséquence : le type du message se code dans le **sujet**, préfixé, et `--kind` ne
sert qu'à distinguer le bruit du signal.

| Intention | Commande |
|---|---|
| Je prends ce périmètre | `--kind fact --subject "claim: <chemins>"` |
| Voici un résultat mesuré | `--kind fact --subject "fact: <sujet>"` |
| Je suis bloqué, arbitre | `--kind fact --subject "block: <sujet>"` |
| Mon lot est fini | `--kind fact --subject "done: <lot>"` |
| Je suis vivant | `--kind ping` |

**Un `fact` porte une mesure, pas une intention.** « 47 fichiers déplacés, clippy 0
warning » est un fait ; « je pense que ça marche » n'en est pas un.

### 2. Le listener JSON-RPC — le synchrone

```bash
aphrody a2a serve --bind 127.0.0.1:8792     # déjà lancé si /ping répond
curl -s http://127.0.0.1:8792/ping
```

À réserver aux échanges qui ont besoin d'une réponse immédiate. Le port `8792` est
celui de ce dépôt ; `8788` est celui du dépôt `aphrody`, ne pas les confondre.

### 3. MCP — l'accès aux outils, pas aux messages

Les deux agents partagent les mêmes serveurs MCP, déclarés dans
`~/.config/aphrody/mcp.json` et `~/.codex/config.toml` :

- `aphrody` — recherche documentaire (`docs_auto_search`), RE (`re_triage`, `re_disasm`),
  et `aphrody_mcp_call` pour rebondir sur n'importe quel autre serveur ;
- `niers-game` — VFS du jeu, assets, base de connaissance RE, pilotage de l'explorateur.

```bash
aphrody mcp list                                   # ce que la machine expose
aphrody mcp call --server niers-game --tool vfs_search --args '{"query":"..."}'
```

MCP sert à **agir**, jamais à se coordonner : un appel MCP ne laisse pas de trace
lisible par l'autre agent. Ce qui doit être su passe par `a2a tick`.

## La règle qui évite les collisions

Deux agents dans un même arbre de travail s'écrasent en silence. La seule protection
est le **périmètre disjoint**, annoncé avant d'écrire.

1. **Annoncer avant d'écrire.** Un `--kind claim` nomme les chemins pris, en clair.
   Sans `claim`, on ne touche rien hors de son lot.
2. **Ne jamais écrire hors de son périmètre.** Même une ligne, même « pendant qu'on y
   est ».
3. **Les fichiers d'arbitrage appartiennent à Claude seul** :
   `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `justfile`, `Cargo.toml` (racine),
   `package.json` (racine), `docs/`.
   Codex qui a besoin d'un changement là-dedans envoie un `block` décrivant la ligne
   voulue ; Claude l'applique. C'est ce qui garde `.gitignore` cohérent.
4. **Codex ne commit pas, ne push pas, ne crée pas de branche.** Il laisse l'arbre
   modifié et émet un `done` avec la liste des fichiers touchés. Claude relit et
   commit. Un seul auteur de commits = un historique lisible.
5. **Rien de destructif sans arbitrage** : pas de `rm -rf`, pas de `git reset --hard`,
   pas de `git checkout --` sur un fichier qu'on n'a pas écrit soi-même, pas de
   redémarrage de service. Le VPS porte 18 services de production.
6. **`pkill -f` est interdit** (il tue les sessions d'agent) : cibler un PID.

## Vérifier avant de rendre

Un lot n'est `done` que si la vérification a **tourné**, et le `done` porte son
résultat chiffré.

```bash
cargo clippy -p <crate> --lib --tests     # 0 warning exigé
bun run typecheck                          # côté TS
```

Ne jamais lancer `cargo build --workspace --all-targets` : le disque du VPS est à
92 % et ça le sature. Le portail de vérification est `clippy`.

## Démarrage d'une session à deux

```bash
# 1. Le canal (Claude)
curl -s http://127.0.0.1:8792/ping || aphrody a2a serve --bind 127.0.0.1:8792 &
aphrody a2a tick --iteration 0 --side claude --peer codex --kind fact \
  --subject "claim: perimetre" --body "claude: <chemins> | codex: <chemins>"

# 2. Le travail (Codex), non interactif, écriture bornée au dépôt
codex exec --cd /home/ubuntu/niers -s workspace-write "<consigne, périmètre inclus>"

# 3. La reddition (Codex), puis relecture et commit (Claude)
aphrody a2a tick --iteration 1 --side codex --peer claude --kind fact \
  --subject "done: <lot>" --body "<fichiers touches> ; clippy 0 warning"
```

## La boucle autonome — les agents se fixent leurs objectifs entre eux

`scripts/a2a-loop.sh` fait **un tour** de boucle pour un côté :

```bash
bash scripts/a2a-loop.sh codex     # Codex exécute l'objectif que Claude lui a fixé
bash scripts/a2a-loop.sh claude    # Claude exécute l'objectif que Codex lui a fixé
```

Un tour enchaîne trois choses : lire le dernier message dont le sujet commence par
`goal:` dans la boîte du pair, l'exécuter, puis émettre **deux** ticks — le résultat
mesuré (`done: …`) et **l'objectif suivant pour le pair** (`goal: …`).

C'est ce second tick qui fait tourner la boucle : chaque agent nourrit l'autre. Aucun
objectif ne vient de l'extérieur une fois la première amorce posée.

- Seul un sujet préfixé `goal:` est traité comme un ordre de travail. Un `fact` ou un
  `ping` ne déclenche rien — sans quoi le moindre message de courtoisie relancerait un tour.
- Sans objectif reçu, l'agent en choisit un lui-même, borné et disjoint de ce que le
  pair a annoncé.
- Le compteur d'itération vit dans `.coord/iteration`, le journal dans
  `.coord/loop-<côté>.log`.

Amorcer :

```bash
aphrody a2a tick --iteration 0 --side claude --peer codex --kind fact \
  --subject "goal: <objectif>" \
  --body "perimetre: <chemins> | critere de reussite: <mesure>"
bash scripts/a2a-loop.sh codex
```

### Ce que la boucle ne fait pas, et pourquoi

Elle ne commit pas à la place de l'agent : un seul auteur de commits garde l'historique
lisible, et un commit automatique masque ce qui a réellement changé. Elle n'écrit pas
hors du dépôt, ne touche ni `/etc` ni un service — 18 services de production tournent
sur cette machine, et un agent qui en redémarre un pendant que l'autre mesure produit
un résultat faux sans que rien ne le signale.

## Ce qu'il faut savoir de ce dépôt avant d'y toucher

`CLAUDE.md` fait foi et vaut pour les deux agents. Le strict minimum :

- Communiquer en **français**.
- Chercher avec `rg`, jamais `grep -r` à la racine (timeout à 60 s : `node_modules`).
- Modifier un fichier avec un outil d'édition, **jamais `sed -i`** (il échoue en
  silence dans les deux sens : motif absent comme motif trop fréquent).
- Python : toujours `uv run`, et **un fichier** au-delà de deux lignes.
- Une suite de tests qui rend `0 passed` n'est pas verte : elle n'a pas tourné.
- Un chemin VFS cité de mémoire est presque toujours faux (les fichiers du jeu
  portent un numéro de version) : le résoudre par `niers vfs find`.

## Risque connu, non traité

Un démon externe commit périodiquement l'arbre sous le message
`chore(sync): checkpoint <horodatage>`. Il ne distingue pas les auteurs et peut
capter un lot à mi-course. Conséquence : l'historique peut porter le travail des deux
agents dans un commit qui n'est ni de l'un ni de l'autre. Relire `git log` avant de
conclure qu'un commit est le sien.
