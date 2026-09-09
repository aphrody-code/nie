# @rosegriffon/inagle-cross

API de données pour **Inazuma Eleven Cross** (`jp.co.level5.inazumacross`) — jeu mobile
Unity IL2CPP, **distinct** from Inazuma Eleven: Victory Road (the Rust IEVR engine,
Level-5 / CPK). Sortie le 9/6/2026, APK récupéré et rétro-conçu statiquement.

## Contenu (Phase 0 — figé)

- `data/masterdata-schema.json` — **153 tables** masterdata, **1215 colonnes typées**
  (références FK + héritage résolus), extraites du dump IL2CPP (Unity 6000.0.62f1).
- `data/enums.json` — **214 énumérations** du jeu avec leurs valeurs
  (`CharacterElement` = Wind/Forest/Fire/Mountain, `CharacterPosition` = FW/MF/DF/GK, …).
- `<racine>/supabase/migrations/20260610000000_inagle_cross_core.sql` — DDL des 153 tables
  `public.inagle_cross_*` (id + colonnes promues + `data jsonb` + RLS « Public Read »),
  généré depuis le schéma. Le fichier vivait ici **en double, identique au byte** ; le
  schéma SQL du dépôt n'a qu'un seul foyer, à la racine, d'où il est rejoué en entier.
- `src/` — types (`CrossSchema`, `CrossTable`, …) + `crossTableName()`.

The `inagle_cross_` prefix is owned by the Cross schema and is not part of the IEVR mirror.

> **Note Phase 0** : ce dossier est de la **préparation** (schéma/DDL/types figés), pas
> encore un workspace member — le `package.json` est volontairement différé en Phase 1 pour
> ne pas régénérer `bun.lock` (v1, CI Bun 1.3.14) avec le Bun 1.4 local (écrit v2, illisible
> by CI). The package is intentionally isolated from the IEVR workspace and has no dependency
> on the removed Victory Road TypeScript pipeline.

## Statut

| | |
|---|---|
| Schéma masterdata | ✅ 153 tables / 1215 colonnes typées |
| Énumérations | ✅ 214 |
| Catalogue Addressables | ✅ 25 328 objects (see `data/cross/`) |
| Audio (voix) | ✅ 305 WAV décodés (CRI HCA) |
| **Valeurs masterdata** | ⛔ **Phase 1** — servies par le serveur du jeu derrière anti-triche (HTTP 426). Déblocage = capture runtime Android arm64. |

## Phase 1 (à venir)

Once `{AssetBaseUri}` / `masterDataHost` are resolved (runtime capture):
`parsers/` (bundles Unity / TSV masterdata) → `entries-cross/*.json` (JSON normalisé)
→ `push/` via a dedicated Cross importer (idempotent upsert) → `public.inagle_cross_*`.

## Localisation

Le jeu n'expose que **en / ja / zh-Hant** (pas de français) : l'UI FR d'azalée est traduite,
non extraite.
