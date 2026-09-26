# Organisation du dépôt

Ce document dit **où va quoi**, et pourquoi. Il prend pour modèle
[`openai/codex`](https://github.com/openai/codex) — un monorepo polyglotte de taille
comparable, dont la structure est publique et lisible — et note explicitement les endroits
où nie s'en écarte, avec la raison. Un écart non justifié ici est un écart à corriger.

La carte des *responsabilités* (qui fait autorité sur quoi, quelles fusions sont interdites)
reste [`ARCHITECTURE.md`](ARCHITECTURE.md). Ce document-ci ne parle que d'**emplacements**.

---

## Les cinq principes retenus de `openai/codex`

Relevés sur l'arbre réel (`api.github.com/repos/openai/codex`, branche `main`) :

1. **Un dossier racine par écosystème, nommé.** `codex-rs/`, `codex-cli/`,
   `sdk/typescript/`, `sdk/python/`, `third_party/<projet>/`. Aucun dossier ne s'appelle
   `src/` à la racine : un monorepo à quatre langages n'a pas *une* source.
2. **Une racine courte, et seulement des fichiers standards.** Chez codex : `README.md`,
   `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE`, `SECURITY.md`, `justfile`,
   `package.json`, les manifestes de build, et des dotfiles de configuration. Pas de README
   secondaire, pas de fragment de build alternatif, pas d'artefact.
3. **Chaque arbre porte son propre `README.md`** (`codex-rs/README.md`), qui explique ce
   qu'il contient et comment on le vérifie.
4. **Les fichiers attendus par GitHub sont présents et remplis** : `.gitattributes`,
   `.github/CODEOWNERS`, gabarits d'issue et de PR, `SECURITY.md`.
5. **La configuration d'écosystème reste à la racine** (`ruff.toml`, `.npmrc`,
   `.prettierrc.toml`, `pnpm-workspace.yaml`) : c'est là que les outils la cherchent, et
   la déplacer par esthétique casse la résolution.

---

## Structure actuelle

Measured 2026-09-25 (`ls -d crates/*/*/ apps/*/ packages/*/`, `git ls-files | cut -d/ -f1 | sort -u`):

```
nie/
├── crates/          Rust — 46 workspace crates + 2 archived     → crates/README.md
│   ├── forge/       (9)  produce nie.exe byte for byte, and the RE that feeds it
│   ├── engine/      (25) the engine
│   ├── tools/       (12) tooling, including the `nie` CLI
│   └── archive/     (2)  outside the workspace, read-only porting reference
├── apps/            Bun/TS — 1 application (nie-web)             → apps/README.md
│                    (the Inacord Tauri app was removed on 2026-09-26)
├── packages/        Bun/TS — 8 package folders                   → packages/README.md
├── python/          Python — the `niepy` package and its tests
├── plugins/         published extensions (Claude Code, Blender)  → plugins/README.md
├── scripts/         scripts and proofs                           → scripts/README.md
├── vendor/          vendored third-party sources (PUC-Rio Lua for `nie-lua`)
├── config/          shared shell configuration
├── deploy/          pointer only: units, vhost and ports moved to ../aphrody-infra on 2026-09-23
├── docs/            the documentation                            → docs/README.md
│   └── legal/       the signed commercial agreement
├── data/  var/  target/  node_modules/     ignored by Git (except tracked fixtures under data/)
└── (root)           README AGENTS CLAUDE GEMINI PLAN CHANGELOG CONTRIBUTING CODE_OF_CONDUCT
                     LICENSE NOTICE SECURITY PROVENANCE LOCAL, justfile, Cargo.toml,
                     package.json, the other manifests and dotfiles
```

Infrastructure (systemd units, nginx vhost, ports, health probes, host transport, DNS) is not
in this repository: [`deploy/README.md`](../deploy/README.md) maps each item to its
aphrody-infra path.

## Où va un fichier nouveau

| Ce que c'est | Où | Pourquoi |
|---|---|---|
| une commande utilisateur | `crates/tools/nie-cli` | `nie` est la **seule** CLI native |
| une bibliothèque TypeScript | `packages/` | pas de `bin` |
| une application TypeScript | `apps/` | a un point d'entrée qu'on lance |
| une recherche qu'on rejouera | `crates/tools/nie-cli` (`nie find`/`grep`) | `rg` en direct ne vaut que pour l'exploration jetable d'une session |
| plus de 2 lignes de Python | un fichier dans `scripts/` | un `python -c` traverse deux couches de quoting |
| une preuve uemu | `scripts/validate_<sujet>.py` | son nom est cité par `forge/registry.json` et `nie-pe` |
| un document | `docs/`, indexé dans `docs/README.md` | ce qui n'y est ni mesurable ni vérifiable n'y a pas sa place |
| une source tierce | `vendor/<projet>/` + une ligne dans `NOTICE` | attribution |
| une unité systemd, un vhost, un port | `../aphrody-infra` (`systemd/`, `nginx/`, `config/service-catalog.json`) | aphrody-infra est l'unique propriétaire de l'infrastructure depuis le 2026-09-23 |
| un artefact de build | nulle part — il est ignoré | |

---

## Ce qui a été fait

| Geste | État |
|---|---|
| `ACCORD_COMMERCIAL_*.pdf` → `docs/legal/` (refs `CLAUDE.md`, `PROVENANCE.md` suivies) | fait |
| `APP_EXPORT_README.md` → `docs/EXPORT-APP.md` | fait |
| `CMakeLists.app_export.txt` → `cmake/` | fait, puis retiré avec la surface CMake (voir [`IECODE-MIGRATION.md`](IECODE-MIGRATION.md)) |
| `happydom.ts` → `packages/nie-plugin/src/` — les deux préchargements de `bunfig.toml` au même endroit | fait |
| `.gitattributes` — fins de ligne, binaires, classement GitHub | ajouté |
| `CHANGELOG.md` — les 11 versions, comptes de commits réels | ajouté |
| `NOTICE` — attributions `third_party/`, marques LEVEL-5 | ajouté |
| `SECURITY.md` — périmètre, signalement, chaîne de signature | ajouté |
| `.github/` — `CODEOWNERS`, gabarit de PR, deux gabarits d'issue | ajouté |
| un `README.md` par arbre — `crates/`, `packages/`, `apps/`, `scripts/`, `deploy/`, `plugins/`, `python/` | ajouté (`third_party/` n'existe plus ; `deploy/README.md` n'est plus qu'un renvoi vers aphrody-infra depuis le 2026-09-23) |
| unités systemd et vhost → `../aphrody-infra` | fait le 2026-09-23 (`deploy/README.md`) |

## Décisions de structure

### Retrait des arbres historiques

Les arbres C++ et C# ont été exportés vers les dépôts historiques dédiés puis retirés de ce
checkout. La correspondance des capacités est tenue dans [`IECODE-MIGRATION.md`](IECODE-MIGRATION.md).

### `crates/nie-wasm/pkg`

1,1 Mo d'artefact `wasm-pack` non suivi, posé sous `crates/` alors que la crate est
`crates/engine/nie-wasm`. Rien ne le lisait ; il se régénère. Absent de l'arbre au 2026-09-25
(`ls crates/nie-wasm/pkg` : introuvable) — le module servi est construit par
`apps/nie-web/scripts/build-wasm.ts` dans `apps/nie-web/public/static/game/`.

### Les noms de `docs/`

Codex écrit `docs/getting-started.md` ; nie écrit le plan canonique racine `PLAN.md`. Le kebab-case minuscule
est la convention la plus répandue, mais renommer 22 documents cités par `CLAUDE.md`,
`AGENTS.md`, les plugins et le code n'apporte que de la cohérence de casse, contre un coût
de rupture réel pour les deux agents et tous les liens existants. **Écart assumé** : la
convention de ce dépôt est MAJUSCULES pour un document, kebab pour un sous-sujet
(`modele-de-match.md`). Elle ne change pas sans une raison meilleure que l'esthétique. Les plans
remplacés utilisent des noms explicites sous `docs/archive/plans/`.

### Le workspace Rust n'est pas déplacé dans `rust/`

Codex isole son workspace dans `codex-rs/` (avec son `Cargo.toml`, son `Cargo.lock`, son
`.cargo/`). Ici, `Cargo.toml` est à la racine. **Écart assumé** : le workspace Rust est
l'arbre principal du projet — c'est lui qui produit le binaire, la CLI et la mesure —, et
la moitié de l'outillage (justfile, CI, `just installer`) le suppose à la racine. Le
déplacer coûterait cher pour un gain de symétrie.

### Les crates ne sont pas plates

Codex range 80 crates à plat sous `codex-rs/`. Nie les range par rôle
(`forge` / `engine` / `tools` / `archive`). **Écart assumé, et documenté dans
`Cargo.toml`** : le rôle décide de ce qui a le droit de dépendre de quoi, et c'est la seule
question structurante ici.

---

## Known contradictions

Listed so they are not "rediscovered" every session; settling one is the user's decision, not a
side effect of tidying.

Both contradictions listed here earlier are settled (checked 2026-09-25):

- **`LICENSE` against `Cargo.toml`** — resolved. `[workspace.package]` now declares
  `license-file = "LICENSE"` and `publish = false`: the commercial agreement RG-L5-VR-2026-001 is
  not an OSI licence, so no crate is published to crates.io. See the stable-release boundary in
  [`CONTRIBUTING.md`](../CONTRIBUTING.md#shipping).
- **Documentation language** — resolved by the naming contract in `AGENTS.md` and `CLAUDE.md`:
  English for everything the machine reads, documentation included; French only for prose
  addressed to the user. Existing French documents are migrated in dedicated batches, never in
  passing.

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `forge_unit` — the physical unit mapping of `nie.exe`
- `function` — functions indexed across the repository
- `coverage` — continuous classification metrics
- `xref` — call-graph topology
- `pdata_func` — authoritative boundaries from PE header

Key binary anchor points:
- `0x140435320` — Core resource manager lookup
- `0x1406d5840` — Core tick / main update loop
