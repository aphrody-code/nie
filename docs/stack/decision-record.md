# ADR — deux sites, trois noms, une interface partagée, une plateforme Rust

- **Date :** 2026-09-05
- **Décision :** tranchée et **gelée**
- **Arbitre :** Claude, orchestrateur du dépôt `niers`, sur demande explicite de
  l'utilisateur ; débat A2A avec Codex (`env-fa1cdc42`, `env-b002ca32`) ; consignes
  utilisateur du même jour sur les noms, le domaine et les directions artistiques
- **Périmètre :** documentation dans `niers` ; le code suit dans [`/PLAN.md`](../../PLAN.md)

## Contexte

`azalee.rosegriffon.fr` est une seule application Next.js qui mêle deux métiers sans public
ni profil de charge communs : un **wiki éditorial** (fiches, articles, lu par des visiteurs et
des moteurs) et un **atelier d'outils** (250 800 fichiers du jeu, 53 126 textures, 6 236
modèles, sons, cinématiques, éditeur d'avatar) adossé au décodeur Rust `nie-model-serve` et
aux 111 Go du VPS. **MESURÉ** en production le 2026-09-05 : une page d'atelier répond en
392 ms (`/textures`) là où le wiki répond en 30 ms (`/`).

Trois exigences de l'utilisateur tranchent l'architecture : le wiki tourne sur **Vercel en
full serverless** ; le site d'outils **partage tout le code de l'explorateur** ; les deux sites
ont **deux directions artistiques** — celle de Rose Griffon pour le wiki, celle du vrai jeu
pour le site d'outils. La deuxième interdit toute réécriture d'interface : l'explorateur est
une SPA React/Vite de **158 fichiers TS/TSX MESURÉS**, dont **34** seulement importent
`@tauri-apps` ; sa façade vers le natif est un fichier unique, `src/lib/api.ts` (630 lignes).

## Décision

### Les noms

- **Azalée** — le wiki, `azalee.rosegriffon.fr`. Nom, domaine et design inchangés.
- **Aphrody** — le site d'outils et d'assets, **`aphrody.com`** et `www.aphrody.com`.
- **Inacord** — l'application de bureau et mobile, ex `nie-explorer` : `apps/inacord`,
  `productName: "Inacord"`, fenêtre titrée `Inacord`. L'identifiant Tauri
  `dev.niers.explorer`, le dossier `%APPDATA%\dev.niers.explorer\` et les deux URL de
  l'updater (`azalee.rosegriffon.fr/tools/niers/latest.json`, GitHub `aphrody-code/nie`)
  **ne changent pas** : c'est ce qui permet aux 0.5.x installés de se mettre à jour.
- **nie** — le jeu : le moteur Rust, ses hôtes natif, headless et WASM, et le préfixe des
  crates. La CLI reste `niers`.
- **`packages/inacord-ui`** — l'interface partagée par Inacord et Aphrody ; **Aphrody est
  Inacord dans le navigateur**. `packages/asset-source` en est le contrat d'accès aux données.

### La propriété

Seule **Azalée** appartient à Rose Griffon. **Aphrody, Inacord et nie sont des projets
`aphrody-dev`, hors Rose Griffon.** Conséquences gelées : pas de marque ni de mention Rose
Griffon sur `aphrody.com` ou dans Inacord ; pas de paquet `@rosegriffon/*` dans
`packages/inacord-ui`, `apps/nie-web`, `apps/inacord` (MESURÉ au départ : 13 fichiers, 23
imports, 19 mentions — les types et helpers utiles passent dans `packages/asset-source` ou
`nie-catalog`) ; pas de compte ni de SSO Rose Griffon ; l'updater d'Inacord vise d'abord
`aphrody.com/downloads/inacord/latest.json` (servi par `nie-site` avec la même logique
GitHub), la route `azalee.rosegriffon.fr/tools/niers/latest.json` survivant en redirection
pour les 0.5.x déjà installés. La base légale d'exploitation des assets LEVEL-5 hors Rose
Griffon est **à confirmer par l'utilisateur** ; ce dossier ne la présume pas.

### Les deux directions artistiques

- **Azalée = Rose Griffon.** Le thème M3 existant (`apps/azalee/app/globals.css`, 109
  tokens `--md-sys-color-*`, primaire `#f2a93b` clair / `#ffc66c` sombre) est la DA ; rien
  n'y touche cette semaine au-delà du poids des pages.
- **Aphrody et Inacord = le vrai jeu.** Le thème est **extrait des données du jeu**, jamais
  inventé : la palette de texte `common/font/font_color.cfg.bin` (70 couleurs `FONT_COLOR`,
  déjà portée dans `nie-data::font_color`), les textures de menu servies par `nie-model-serve`
  (cadres, fonds, boutons), les atlas d'icônes déjà exploités par `sprites.css` et
  `data/re/menu-icon-atlases.txt`, et la fonte du jeu (`font_def.g4tx` + métriques) pour les
  titres. Il vit dans `packages/inacord-ui/src/theme/` ; les couleurs y sont **générées** par
  une commande `niers` depuis le fichier du jeu, avec leur nom d'origine. Ce que l'extraction
  ne fournit pas (corps de texte, espacements) est **ESTIMÉ** et dit tel quel. Une seule
  interface, **deux coquilles du même jeu** : le site reprend le **menu principal**,
  l'application reprend **InaCord**, l'application de messagerie du téléphone du mode histoire.
- **La référence d'Aphrody est le menu principal du jeu** (`mainmenu01`), capture ver. 7.1.2 de
  2 497 × 1 414 fournie par l'utilisateur le 2026-09-05 et conservée hors dépôt dans
  `data/design/aphrody-ui-ref-mainmenu-7.1.2.png` (© LEVEL-5, jamais commitée). C'est
  l'écran que `docs/DESIGN.md` décompose déjà (31 objbin, textures du groupe B dans le VFS).
  La coquille d'Aphrody en reprend la grammaire : bandeau haut (logo, notification,
  version), deux panneaux latéraux illustrés, une rangée de **tuiles en parallélogramme** à
  fond photo teinté cyan et icône blanche, une bande bleue de titre, une seconde rangée de
  trois tuiles, des badges en bas. Palette **MESURÉE** sur la capture (ImageMagick, 12
  couleurs) : blanc `#FDFEFE` (60 % des pixels), cyans `#D9EFED` `#A4E4F7` `#46B9F2`, bleus
  `#5BA2E3` `#2F69C7` `#295B9F`, marine `#293D60`, jaune `#F6E028`, orange `#D55025`.
  Ces valeurs cadrent le thème ; les couleurs **finales** viennent des fichiers du jeu.
- **La référence d'Inacord est InaCord** (イナコード), l'application de messagerie du
  téléphone dans le mode histoire — c'est de là que vient le nom. Référence officielle
  fournie par l'utilisateur : `inazuma.jp/victory-road/assets/img/story/story-system/img_photography_01.webp`
  (1 280 × 720, archivée hors dépôt dans `data/design/inazuma-jp-story-photography-01.webp`).
  Grammaire : cadre de téléphone, panneaux sombres, colonne de salons à gauche, fil de
  messages avec avatars ronds, accent turquoise, motif hexagonal en fond, barre d'onglets du
  menu principal au-dessus. Palette **MESURÉE** (ImageMagick, 8 couleurs) : `#323544`
  `#374D5B` `#44484F` (panneaux), `#4FAECC` (accent), `#1E67C5` `#07346E` (bleus),
  `#A8CFD2` (clair), `#7B8F6B`. Les écrans d'InaCord existent dans le VFS du jeu : leurs
  textures et leur palette `FONT_COLOR` priment sur ces valeurs de cadrage.

### Le wiki — Vercel + Supabase Cloud

- `apps/azalee` reste **Next.js 16** (canary 16.3.0-canary.37 du catalogue Bun), déployé sur
  **Vercel**, runtime **Node**. ISR horaire sur les fiches détail, `dynamicParams = true`,
  `POST /api/ops/revalidate/wiki` protégé par `AZALEE_REVALIDATE_SECRET`.
- **Supabase Cloud `kvnlbhatjqqmhhxaxlbi` (eu-west-3) est la seule source de données.** Le
  wiki ne lit plus jamais un fichier : ni `var/mirror.sqlite`, ni `/home/ubuntu/...`, ni
  `process.cwd()`. Le Proxy PostgREST de `lib/supabase/server.ts` disparaît du chemin métier.
- Les tables `inagle_*` sont lisibles anonymement sous RLS par la policy `lecture_publique`
  (commit `84d4a54`). Aucune écriture anonyme. `auth.users` (1 931 lignes) **n'est pas
  migrée** : les comptes se recréent, la réinscription vaut consentement.
- Ce qui lit un fichier ou un service local (`bun:sqlite` : 41 fichiers, `node:fs` : 44,
  `/home/ubuntu` : 15, `/rest/v1|/realtime/v1|/storage/v1` : 19 — **MESURÉ** sur
  `apps/azalee` + `packages/azalee`) **part chez Aphrody** ou vise l'origine Supabase
  dédiée ; rien n'est « corrigé sur place ».

### Aphrody — `nie-site` + `nie-web`

- `crates/tools/nie-site` : **Axum 0.8**, Tokio 1.53, Tower 0.5, `tower-http` 0.6,
  `askama` 0.14, `moka` 0.12, `blake3`, `rusqlite` 0.37 ; `publish = false`, écoute
  **uniquement** `127.0.0.1:8085`, nginx termine le TLS. Il **sert** le bundle `nie-web`,
  **lit** les trois gisements du VPS en lecture seule, et **proxifie** `nie-model-serve`
  (`127.0.0.1:8790`) en lui ajoutant ce qu'il n'a pas : limite de débit, budget de temps,
  budget mémoire, cache.
- **`aphrody.com` aujourd'hui** (MESURÉ) : DNS déjà sur ce VPS, certificat Let's Encrypt
  déjà émis, `aphrody-site` (:8083, dépôt `aphrody`) y rend une page de 265 octets au corps
  vide et un `/healthz`. La bascule est une modification du vhost nginx : `aphrody.com` et
  `www.aphrody.com` vers `:8085`, **les autres hôtes du bloc** (`api.`, `downloads.`, `cdn.`,
  `bot.`, `admin.`, `mcp.`, `bxc.`, `n2b.`) **restent sur `:8083`**. `nie.aphrody.com`
  redirige en 308 vers `aphrody.com`. L'en-tête `Content-Security-Policy: default-src 'none'`
  qu'nginx ajoute aujourd'hui **doit être retiré de ce vhost** : les CSP s'additionnent et la
  plus stricte gagne — `nie-site` pose la sienne.
- `apps/nie-web` : hôte Vite de `packages/inacord-ui` avec `web-source.ts`.
  `apps/inacord` : hôte Tauri de la même UI avec `desktop-source.ts` (`api.ts` renommé).
  Les conventions d'URL viennent de `packages/nie-catalog/src/jeu.ts` (757 lignes, déjà
  testé contre `main.rs`), pas d'une réécriture.

### Le moteur et les clients natifs — inchangés cette semaine

- `wgpu 29.0.3` + `winit 0.30.13` gelés ; le bump `wgpu 30.0.1` est un lot ultérieur,
  compilé et validé par goldens D3D12/Vulkan/Metal/WASM.
- Tauri 2 reste l'enveloppe d'Inacord, desktop aujourd'hui, mobile plus tard.
- Mobile natif du jeu et adaptateur Steam : **hors semaine**, spécifications gelées dans
  [game-platforms.md](game-platforms.md).

## Alternatives rejetées

| Alternative | Raison du rejet |
|---|---|
| **Wiki self-host VPS** (décision de Codex dans `rg/docs/decision-archi-donnees-azalee.md`) | vise l'inverse de la cible ; couple le rendu web à un fichier SQLite local — cause directe du faux vert du 2026-09-05 |
| **`nie.rosegriffon.fr`** pour le site d'outils | deux marques, deux DA : Rose Griffon est la communauté et son wiki, Aphrody est l'univers du jeu ; le SSO par cookie parent est sans objet, Aphrody ne porte pas de comptes cette semaine |
| **`nie.aphrody.com`** | un sous-domaine pour le produit principal du domaine ; le placeholder d'`aphrody-site` sur `aphrody.com` ne contient rien |
| **Socle `aphrody-web`** du dépôt `aphrody` (tokens et squelette communs aux vitrines) | la DA d'Aphrody est celle du jeu, pas une charte commune ; `SITES-PLATFORM.md` du dépôt `aphrody` est à amender par son propriétaire |
| **Leptos 0.8** pour `nie-site` | seconde pile d'UI à côté de React : 0 ligne partagée avec Inacord ; mainteneur unique et maintenance « légère » (issue #4707) ; 37 975 lignes TS/TSX à porter pour l'égaler |
| **Dioxus 0.7** | même défaut de partage ; plan B seulement si le produit devient Rust-first partout |
| **SQLx + PostgreSQL** dans `nie-site` | un saut réseau pour des données que `var/mirror.sqlite` sert localement ; Inacord lit déjà ces fichiers : même source ⇒ mêmes réponses |
| **Drizzle dual-runtime `bun-sqlite`/`node-sqlite`** (Codex) | fige le SQLite local comme dépendance de production ; la partie utile — remplacer 494 lignes d'émulation PostgREST — est reprise côté Postgres |
| **Actix** | débit brut supérieur sur benchmark synthétique, mais hors continuité Tokio/Tower et hors `best-stack-2026` |
| **Absorber `nie-model-serve` dans `nie-site`** | 7 956 lignes écrites à la main (ni Axum ni tokio) ; le réécrire n'apporte rien que le proxy durci n'apporte déjà |
| **Changer l'identifiant Tauri** avec le nom Inacord | nouveau dossier de données, updater NSIS/MSI qui installe à côté au lieu de mettre à jour |
| **Une DA « Aphrody » ou « Inacord » inventée, hors du jeu** | la consigne est le vrai jeu : le site reprend le menu principal, l'application reprend InaCord ; une interface, deux coquilles, aucune couleur dessinée de mémoire |
| **Migrer `auth.users`** | données personnelles ; aucune base légale documentée |
| **Bevy / ECS, Tauri pour le jeu, SQLite distant** | inchangé : incompatibles avec le byte-exact, le rendu natif, ou le serverless |

## Ce que le débat a établi (et qui a survécu)

- **Le faux vert.** Un build vert, 70/70 pages, `/chara` 200 en 87 ms et 136 921 octets —
  et **0 lien** dedans. Deux causes en une journée : RLS sans policy (PostgREST rend 200 et
  un tableau vide) puis `SUPABASE_INTERNAL_URL` testé avant `NEXT_PUBLIC_SUPABASE_URL` par
  `pickUrl()`. Leçon gravée dans [verification.md](verification.md) : compter, pas croire.
- **Le N+1** de `chara/[id]/page.tsx` (599 requêtes `inagle_skills`) est corrigé par
  `cf11153` : 245 techniques → 2 requêtes, 10 tests, 954 assertions, deux backends.
- **La bascule a réussi sans miroir** : gate du 2026-09-05, comptes dans
  [README.md](README.md#état-mesuré-au-gel-2026-09-05-vps).
- **La sécurité** est indépendante de la bascule et la précède ; ordre dans
  [security.md](security.md).

## Historique Vercel vérifié

`abcfb69f` (prerender `/_global-error` en échec sous Bun), `3c01c323` (Node 24 introuvable),
`6fe2a626` (website Vercel, Azalée VPS), `2cf27f1c` (Vercel retiré), `9594ba0d` (failover).
Ces échecs venaient d'un runtime Bun et d'une base en `127.0.0.1` ; aucun ne tient avec le
runtime Node et Supabase Cloud. Ils justifiaient la séparation wiki/outils, pas le renoncement.

## Risques et déclencheurs de révision

1. **Auto-update d'Inacord** : une redirection qui attraperait `/tools/*` couperait la mise à
   jour de toutes les installations. `app/tools/niers/latest.json/route.ts` reste au wiki, et
   les 308 sont posés par préfixe explicite, jamais par regex. Le renommage `niers → Inacord`
   du `productName` doit être **vérifié sur une installation 0.5.9 réelle** (Windows) avant
   publication : l'installeur doit mettre à jour, pas installer à côté.
2. **`supabase-compat.inc`** : realtime et storage servis sous le domaine du wiki cassent sur
   Vercel **sans erreur de build**. Origine Supabase dédiée, CORS explicite, 19 consommateurs
   à tester un par un.
3. **Vercel ↔ eu-west-3** : aucune latence mesurée avant le premier déploiement preview ; si
   la fiche perso dépasse 800 ms au p95, la bascule DNS attend.
4. **Le vhost `aphrody.com`** porte dix hôtes dans un seul bloc `server` : la découpe doit
   laisser `api.`, `downloads.`, `cdn.`, `bot.`, `admin.`, `mcp.`, `bxc.`, `n2b.` sur `:8083`,
   et retirer la CSP nginx du seul bloc Aphrody. Une faute ici coupe les services du dépôt
   `aphrody`. Test : `nginx -t`, puis un `curl` par hôte avant et après.
5. **Exposer `nie-model-serve` nu** : jamais ; `nie-site` est obligatoire devant.
6. **Deux agents, deux dépôts** : Codex dans `rg`, Claude dans `niers`, plus un démon qui
   commit des checkpoints. Un lot peut être capté à mi-course ; relire `git log`.
7. **La DA du jeu** est une extraction, pas un dessin : ce que les fichiers ne donnent pas
   (corps de texte, espacements, comportement responsive) reste **ESTIMÉ** et se corrige sur
   capture réelle, jamais de mémoire (règle « ne rien halluciner du jeu »).

## Amendements

### A1 — 2026-09-05 : Aphrody, Inacord et nie fonctionnent sans `inagle`

**Décision.** Aucun des trois produits `aphrody-dev` ne dépend d'`inagle`, ni de son paquet
(`@rosegriffon/inagle`, propriété Rose Griffon) ni de ses tables `inagle_*`. `inagle` reste
la chaîne de publication d'**Azalée** et rien d'autre. Corollaire de la séparation
`aphrody-dev` : une dépendance de données est une dépendance tout court.

**Coût mesuré le 2026-09-05.**

*Code — déjà acquis.* Inacord déclare `@rosegriffon/inagle` dans son `package.json` mais ne
l'importe **0 fois** ; son `src-tauri` ne dépend que de crates `nie-*` ; les 37 crates du
moteur n'y font aucune référence de code. Retirer la déclaration suffit (J4, avec les 20
imports `@rosegriffon/azalee` et les 3 `@rosegriffon/ui`).

*Données — cinq requêtes.* `nie-model-serve`, que `nie-site` proxifie, lit réellement le
miroir pour assembler les modèles :

| Table lue | Lignes | Requêtes | Module `nie-data` équivalent |
|---|---:|---:|---|
| `inagle_characters` | 6 168 | 1 | `chara_base.rs` |
| `inagle_teams` | 208 | 1 | `team.rs` |
| `inagle_uniforms` | 627 | 1 | `uniform.rs` |
| `inagle_event_subtitles` | 2 093 | 2 | `event_subtitle.rs` |

`nie-play` lit la même table de sous-titres. `nie-formats`, `nie-data`, `nie-save` et
`nie-explore` ne la lisent **pas** : leurs occurrences d'`inagle_*` sont des commentaires.
Les quatre familles étant déjà décodées par `nie-data`, l'indépendance ne demande aucun
parseur nouveau — seulement de brancher ces cinq requêtes sur la source Rust, dans un
gisement propre à `aphrody-dev` (par exemple `var/game.sqlite`, produit par un `niers push`).

**Ce qui reste chez Azalée, et n'est pas repris :** les 153 tables `inagle_cross_*`
(*Inazuma Eleven Cross*, jeu mobile distinct, sans décodeur Rust) et les 2 575 lignes de
publication (`cli-push.ts`, `push-categories.ts`). Aucun des trois produits n'en a besoin.

**Gate.** `rg -n 'inagle_' crates/tools/nie-model-serve/src crates/engine/nie-play/src
--glob '*.rs' | grep -v '^\S*:[0-9]*: *//'` → **0** ; `rg '@rosegriffon/'
apps/inacord/package.json packages/inacord-ui apps/nie-web` → **0**. Lot à planifier ; il
n'est **pas** dans la semaine J1–J7, et `nie-site` ne doit pas créer de nouvelle lecture
d'`inagle_*` en attendant.

### A2 — 2026-09-05 : `nie` gère nativement SQL et possède le workflow des tables `inagle_*`

**Correction d'A1.** A1 traitait les tables `inagle_*` comme une dépendance à Rose Griffon.
C'est faux : `inagle_` est un **préfixe de table**, pas un lien au paquet. Les tables sont
un schéma de données de jeu, légitime et à conserver sous ce nom (13 crates, le wiki, le
miroir et l'installeur d'Inacord s'y adossent ; renommer casserait tout pour rien).

**Décision.** `nie` acquiert une **couche SQL native** — SQLite et PostgreSQL — et reprend
**tout le workflow** des tables `inagle_*` que le paquet Bun assurait : lire les données de
jeu, normaliser, publier, vérifier. `inagle` cesse d'être le producteur ; il devient
l'ancêtre dont on garde le schéma et les leçons. Aphrody, Inacord et nie fonctionnent alors
sans le paquet, tout en lisant et écrivant les mêmes tables.

**Ce qui est porté, mesuré le 2026-09-05.**

| Élément | Aujourd'hui (TypeScript) | Cible (Rust) |
|---|---|---|
| Abstraction de base | `DataAdapter`, 2 impls : `SupabaseAdapter`, `PostgresAdapter` | un trait à 2 impls : SQLite (`rusqlite` 0.37, déjà au lock) et PostgreSQL (`sqlx` 0.8, `postgres` + `runtime-tokio` + `tls-rustls` + `macros`) |
| Transport vers le Cloud | `@supabase/supabase-js`, donc **PostgREST en HTTP** | SQL direct via `sqlx` — une couche réseau **supprimée**, pas reproduite |
| Workflow | 18 fonctions `import*` / `export*`, 2 575 l. (`cli-push.ts` + `push-categories.ts`) : `importCharacters` 164 l., `importSkills` 129, `importItems` 106, `importAuras` 100, `importGrowthTables` 66, `importDrops` 51… | une commande `niers push`, un module par famille, alimenté par `nie-data` (déjà byte-exact, 130 goldens) |
| Idempotence | `ON CONFLICT` par `id`, `delete + reinsert` pour les tables curatées | identique, en transactions explicites |
| Migrations | `supabase/migrations/*.sql` | inchangées : le SQL reste la source de vérité du schéma |

**Où ça vit.** Une crate `crates/tools/nie-db` (le trait, les deux back-ends, les migrations
rejouables), exposée par **une seule commande utilisateur, `niers push`** — la doctrine « `niers`
est la seule CLI » interdit un binaire de plus. `nie-data` n'y touche pas : elle reste le
lecteur typé, sans `tokio` ni client SQL.

**Ce que ça n'est pas.** Ce n'est pas une contradiction de l'ADR, qui rejette `sqlx` pour
`nie-site` : ce dernier **lit** des fichiers locaux, où `rusqlite` est plus direct ; `nie-db`
**écrit** vers un Postgres distant, où `sqlx` est le bon outil. Deux métiers, deux clients,
la même règle — le client suit la distance à la donnée.

**Ce qui n'est pas repris tout de suite.** Les 153 tables `inagle_cross_*` (*Inazuma Eleven
Cross*, jeu mobile) n'ont aucun décodeur Rust : leur alimentation reste au paquet Bun jusqu'à
ce que quelqu'un décide de porter ce domaine. Le scraping zukan (navigateur headless `bxc`)
et l'étage RAG restent également TypeScript ; ils ne bloquent ni Aphrody, ni Inacord, ni nie.

**Gate.** `niers push --dry-run` annonce, table par table, le nombre de lignes qu'il écrirait ;
un `niers push` réel suivi d'un comptage rend **le même total qu'aujourd'hui**, table par
table, écart **0** — la migration se prouve par égalité avec l'existant, jamais par « ça
tourne ». Puis `rg -n 'inagle_' crates/tools/nie-model-serve/src crates/engine/nie-play/src`
hors commentaires → les requêtes visent le gisement produit par `niers push`.

**Ordonnancement.** Lot **hors semaine J1–J7**. Contrainte immédiate maintenue : `nie-site`
ne crée aucune nouvelle lecture d'`inagle_*` en attendant, et le miroir nocturne reste la
source jusqu'à ce que `niers push` ait prouvé l'égalité.

---

Toute modification de la stack s'écrit ici, datée, avec sa mesure et son alternative
rejetée — et ne modifie aucun autre fichier du dossier.
