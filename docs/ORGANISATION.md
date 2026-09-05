# Organisation du dépôt

Ce document dit **où va quoi**, et pourquoi. Il prend pour modèle
[`openai/codex`](https://github.com/openai/codex) — un monorepo polyglotte de taille
comparable, dont la structure est publique et lisible — et note explicitement les endroits
où niers s'en écarte, avec la raison. Un écart non justifié ici est un écart à corriger.

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

```
niers/
├── crates/          Rust — 36 crates compilées + 2 archivées   → crates/README.md
│   ├── forge/       produire nie.exe au byte près, et le reverse qui l'alimente
│   ├── engine/      le moteur
│   ├── tools/       l'outillage, dont la CLI `niers`
│   └── archive/     hors build, référence en lecture seule
├── src/             C++ — le toolkit iecode (voir « Lots restants »)
├── csharp/          C# — IECODE.Core / IECODE.CLI / IECODE.Core.Tests → csharp/README.md
├── python/          Python — le paquet `niepy` et ses tests
├── packages/        Bun/TS — 19 bibliothèques                   → packages/README.md
├── apps/            Bun/TS — 10 applications                    → apps/README.md
├── plugins/         extensions publiées (Claude Code, Blender)
├── scripts/         scripts et preuves                          → scripts/README.md
├── supabase/        les migrations SQL du wiki
├── deploy/          les unités systemd
├── cmake/           modules CMake, overlay-ports vcpkg
├── third_party/     sources tierces vendorisées (header-only)
├── bench/           bancs d'essai inter-langages
├── docs/            la documentation                            → docs/README.md
│   └── legal/       l'accord commercial signé
├── data/  var/  refs/  target/  node_modules/     ignorés par Git
└── (racine)         README AGENTS CHANGELOG LICENSE NOTICE SECURITY PROVENANCE CLAUDE
                     justfile Cargo.toml package.json + les manifestes et dotfiles
```

## Où va un fichier nouveau

| Ce que c'est | Où | Pourquoi |
|---|---|---|
| une commande utilisateur | `crates/tools/nie-cli` | `niers` est la **seule** CLI ; le C++ et le .NET s'atteignent par `niers cpp` / `niers cs` |
| une bibliothèque TypeScript | `packages/` | pas de `bin` |
| une application TypeScript | `apps/` | a un point d'entrée qu'on lance |
| une recherche qu'on rejouera | `crates/tools/nie-cli` (`niers find`/`grep`) | `rg` en direct ne vaut que pour l'exploration jetable d'une session |
| plus de 2 lignes de Python | un fichier dans `scripts/` | un `python -c` traverse deux couches de quoting |
| une preuve uemu | `scripts/validate_<sujet>.py` | son nom est cité par `forge/registry.json` et `nie-pe` |
| un document | `docs/`, indexé dans `docs/README.md` | ce qui n'y est ni mesurable ni vérifiable n'y a pas sa place |
| une source tierce | `third_party/<projet>/` + une ligne dans `NOTICE` | attribution |
| un artefact de build | nulle part — il est ignoré | |

---

## Ce qui a été fait

| Geste | État |
|---|---|
| `ACCORD_COMMERCIAL_*.pdf` → `docs/legal/` (refs `CLAUDE.md`, `PROVENANCE.md` suivies) | fait |
| `APP_EXPORT_README.md` → `docs/EXPORT-APP.md` | fait |
| `CMakeLists.app_export.txt` → `cmake/` | fait |
| `happydom.ts` → `packages/nie-plugin/src/` — les deux préchargements de `bunfig.toml` au même endroit | fait |
| `.gitattributes` — fins de ligne, binaires, classement GitHub | ajouté |
| `CHANGELOG.md` — les 11 versions, comptes de commits réels | ajouté |
| `NOTICE` — attributions `third_party/`, marques LEVEL-5 | ajouté |
| `SECURITY.md` — périmètre, signalement, chaîne de signature | ajouté |
| `.github/` — `CODEOWNERS`, gabarit de PR, deux gabarits d'issue | ajouté |
| un `README.md` par arbre — `crates/`, `packages/`, `apps/`, `csharp/`, `scripts/`, `deploy/`, `plugins/`, `cmake/`, `third_party/` (9 ; `docs/`, `python/`, `supabase/` en avaient déjà un) | ajouté |

## Lots restants, et ce qui les bloque

### 1. `src/` → `cpp/` — le seul écart de fond avec codex

`src/` à la racine d'un monorepo à quatre langages est un nom qui ment : il ne contient que
le toolkit C++ `iecode`. Codex n'a pas de `src/` racine, il a `codex-rs/` et `codex-cli/`.

**Bloqué, pas abandonné.** Ce dépôt est travaillé par deux agents en parallèle
([`A2A-CODEX.md`](A2A-CODEX.md)) et `src/**` est actuellement pris en exclusivité. Un
renommage pendant une édition en cours écrase du travail.

Le lot est **prêt à jouer** dès libération :

```bash
scripts/renommer-src-en-cpp.sh
```

Le script refuse de démarrer tant qu'un fichier de `src/` n'est pas commité (c'est
exactement la garde qui protège le travail de l'autre agent), fait le `git mv`, réécrit
les seuls motifs propres à l'arbre C++ — `src/decomp`, `src/include`, `src/cli`,
`src/tests`, `src/nie_rs`… jamais un `packages/*/src/` ni un `crates/*/src/` —, puis
**liste** ce qui cite encore `src/` sans correspondre à un motif connu, à relire à la
main. Il est idempotent : rejoué, il constate que `cpp/` existe et sort.

Le `GLOB_RECURSE` de `src/CMakeLists.txt` et les `list(FILTER … EXCLUDE REGEX ".*/src/<nom>/.*")`
qui l'accompagnent citent `src/` littéralement : ils doivent être repris dans le même
commit, sinon plusieurs `main()` se retrouvent dans `iecode_core`.

### 2. Le commentaire orphelin de `src/CMakeLists.txt:23`

Il pointe `CMakeLists.app_export.txt` à la racine, qui vit désormais dans `cmake/`. C'est un
commentaire, rien ne casse — mais la référence est fausse. Même blocage que ci-dessus.

### 3. `crates/nie-wasm/pkg`

1,1 Mo d'artefact `wasm-pack` non suivi, posé sous `crates/` alors que la crate est
`crates/engine/nie-wasm`. Rien ne le lit ; il se régénère. À supprimer, avec l'accord de
l'utilisateur puisque c'est une suppression.

### 4. Les noms de `docs/`

Codex écrit `docs/getting-started.md` ; niers écrit `docs/PLAN.md`. Le kebab-case minuscule
est la convention la plus répandue, mais renommer 22 documents cités par `CLAUDE.md`,
`AGENTS.md`, les plugins et le code n'apporte que de la cohérence de casse, contre un coût
de rupture réel pour les deux agents et tous les liens existants. **Écart assumé** : la
convention de ce dépôt est MAJUSCULES pour un document, kebab pour un sous-sujet
(`modele-de-match.md`). Elle ne change pas sans une raison meilleure que l'esthétique.

### 5. Le workspace Rust n'est pas déplacé dans `rust/`

Codex isole son workspace dans `codex-rs/` (avec son `Cargo.toml`, son `Cargo.lock`, son
`.cargo/`). Ici, `Cargo.toml` est à la racine. **Écart assumé** : le workspace Rust est
l'arbre principal du projet — c'est lui qui produit le binaire, la CLI et la mesure —, et
la moitié de l'outillage (justfile, CI, `just installer`) le suppose à la racine. Le
déplacer coûterait cher pour un gain de symétrie.

### 6. Les crates ne sont pas plates

Codex range 80 crates à plat sous `codex-rs/`. Niers les range par rôle
(`forge` / `engine` / `tools` / `archive`). **Écart assumé, et documenté dans
`Cargo.toml`** : le rôle décide de ce qui a le droit de dépendre de quoi, et c'est la seule
question structurante ici.

---

## Contradictions connues, non tranchées

Elles sont listées pour ne pas être « redécouvertes » à chaque session ; les trancher est
une décision de l'utilisateur, pas un effet de bord d'un rangement.

- **`LICENSE` contre `Cargo.toml`.** Le fichier `LICENSE` est le texte de l'accord
  commercial RG-L5-VR-2026-001 ; `[workspace.package]` déclare `license = "MIT"`. Les deux
  ne peuvent pas être vrais à la fois pour un paquet publié.
- **`README.md` est en anglais**, tout le reste de la documentation est en français. C'est
  délibéré pour la page d'accueil GitHub, mais aucune règle écrite ne dit où s'arrête
  l'anglais. Les fichiers ajoutés ici (`SECURITY.md`, gabarits) suivent le français, langue
  du dépôt.
