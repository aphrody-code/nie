# niers documentation index

The repository has one active execution plan: [`../PLAN.md`](../PLAN.md). Technical documents
under `docs/` provide evidence and specifications; they do not define competing priorities.
Superseded plans are preserved in the dated
[`archive/plans/`](archive/plans/2026-09-08/README.md) directory.

---

## 1. Canonical references

| Document | Rôle & Contenu |
| :--- | :--- |
| **[../AGENTS.md](../AGENTS.md)** | **Instructions opérationnelles courtes pour tous les agents** : hiérarchie des sources, architecture, gates Cargo/Bun, sécurité et pièges d'environnement (VFS, FFI, Windows). |
| **[../PLAN.md](../PLAN.md)** | **Only active roadmap and gate ledger.** Architecture ownership, priorities, measured state and durable decisions. |
| **[HOSTS-AND-PORTS.md](HOSTS-AND-PORTS.md)** | **Hôtes, ports et DNS — MESURÉS.** Qui répond quoi sur ce VPS. Fait autorité contre tout plan qui dirait autre chose. |
| **[AUDIT-USAGE-GEMINI-FLASH.md](AUDIT-USAGE-GEMINI-FLASH.md)** | **Analyse des quotas & capacité de travail** : mesure des 307 623 lignes Rust, calcul de l'overhead agy-cli et projection d'autonomie avec Gemini 3.8 Flash (Thinking Low). |

---

## 2. Cartographie Thématique du Dossier `docs/`

### 2.1 Moteur de Jeu & Rendu Graphique
- **[STACK.md](STACK.md)** : Architecture runtime du moteur, intégration Lua 5.2 et boucle principale.
- **[DESIGN.md](DESIGN.md)** & **[DESIGN-UI.md](DESIGN-UI.md)** : Rendu pixel-perfect des écrans Start, Menu et HUD (mesures directes sur les captures de `data/menu/`).
- **[AVATAR.md](AVATAR.md)** : Spécifications complètes de l'éditeur d'avatar (`chara_edit`).
- **[../PLAN.md](../PLAN.md#p3--inacord-product-unification)** : active 3D and Inacord delivery priorities.
- **[BENCHMARKS.md](BENCHMARKS.md)** : Mesures comparatives de performance (Rust vs C++ vs C#).

### 2.2 Reverse Engineering, Binaire & Formats
- **[ATLAS.md](ATLAS.md)** : L'index unique de toutes les surfaces RE (fichiers, crates, docs, digest de la KB, forge, binaires, outils) et la boucle autonome qui vise les 100 %.
- **[FORGE.md](FORGE.md)** : Production de `nie.exe` byte-exact (atteint 74.00% du binaire et 92.24% de `.text`).
- **[RE.md](RE.md)** : Base de connaissances RE, ancrage des fonctions et structures décompilées.
- **[re/README.md](re/README.md)** : Centre canonique des données RE et règle d’audit local → consommateur → Rust → parité.
- **[COMPUTER-USE-RE-TRACE.md](COMPUTER-USE-RE-TRACE.md)** : frontière read-only, provenance, garde-fous et décision de migration `nie-re`/`nie-trace`.
- **[FORMATS.md](FORMATS.md)** & **[VFS.md](VFS.md)** : Spécifications des conteneurs CPK, RDBN, T2B, textures G4TX et VFS (255 308 fichiers indexés).
- **[modele-de-match.md](modele-de-match.md)** : Analyse de la simulation match et calculs de tirs/arrêts.

### 2.3 Applications, Wiki & Production Web
- **[packages/mcp/context/exploitation.md](../packages/mcp/context/exploitation.md)** : production services and operational checks.
- **[MCP.md](MCP.md)** : Architecture du serveur MCP natif pur Rust (`rmcp`), sa sécurité et ses tests.
- **[architecture/](architecture/)** : Ownership and shared-surface contracts for the maintained applications.
- **[../PLAN.md](../PLAN.md)** : Migration status, durable data-source decisions, and the active gate ledger.

---

## 3. Règle d'Exécution & Invariant

1. **Aucun commit aveugle :** Une gate n'est validée que lorsqu'une commande a été jouée et a retourné un compte exact (lignes, liens, bytes, code de retour).
2. **Déploiement live :** Un service déployé n'est achevé que lorsqu'une requête en ligne sur son port/domaine a certifié son statut.
