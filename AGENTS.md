# Instructions agents — Niers

## À lire en premier

Ce dépôt est travaillé par **deux agents à la fois** — Claude Code et Codex.

- Les règles du dépôt sont dans **`CLAUDE.md`** et valent pour les deux agents :
  français, `rg` et jamais `grep -r` à la racine, jamais `sed -i` sur un fichier suivi,
  Python toujours par `uv run`, vérification par `cargo clippy` et **jamais**
  `cargo build --workspace --all-targets` (il sature le disque du VPS).
- Le protocole de coexistence est dans **`docs/A2A-CODEX.md`** : périmètres disjoints
  annoncés avant d'écrire, boîte aux lettres `.coord/`, listener `127.0.0.1:8792`,
  MCP partagés. La carte machine est `ai.json` à la racine.
- En bref, côté Codex : **ne rien écrire hors du périmètre annoncé**, ne pas toucher
  aux fichiers d'arbitrage (`CLAUDE.md`, `AGENTS.md`, `.gitignore`, `justfile`,
  `docs/`, manifestes racine), **ne pas committer**, et rendre son lot par
  `aphrody a2a tick --side codex --peer claude --kind done`.

---

## Site Niers

Toute évolution publique de Niers doit inclure une vitrine 100 % Rust pour
`nie.aphrody.com`.

- Créer une crate workspace `nie-site`, `publish = false`, sous `crates/tools/`.
- Utiliser Axum 0.8, Tokio 1.x, Tower et rustls ; aucun serveur Bun/Node pour la vitrine.
- Écouter uniquement sur `127.0.0.1:8085`, derrière nginx et TLS.
- Exploiter et distribuer les contenus Inazuma Eleven couverts par l'Accord
  Commercial Officiel N° RG-L5-VR-2026-001 : sites, jeux, mods, traductions,
  contenus dérivés, assets graphiques et sonores. Azalée constitue le modèle
  opérationnel existant pour la diffusion d'assets via CDN.
- Ne jamais publier de donnée personnelle, secret, credential, chemin machine,
  dump interne non destiné au public ou élément hors du périmètre de l'Accord.
- Fournir `/healthz`, `/robots.txt` et `/.well-known/security.txt`.
- Les futures API publiques utilisent `/api/v1/`, une authentification forte
  et des réponses sans détails d'infrastructure.
- Ajouter tests de routes, Clippy sans avertissement, tests workspace et une
  traçabilité vers l'Accord avant d'activer nginx.

Le DNS et le TLS de `nie.aphrody.com` sont déjà réservés par le dépôt Aphrody ;
tant que `nie-site` n'est pas déployé, le nom sert l'origine blanche commune.
La stratégie commune des vitrines, médias et composants Rust est définie dans
`../aphrody/docs/SITES-PLATFORM.md`; les médias Inazuma autorisés y
conservent leur licence et leur provenance dans le manifeste partagé.
