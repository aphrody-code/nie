# Pièges d'API de la stack gelée — vérifiés le 2026-09-05

Ce que le code écrit d'après la mémoire d'un modèle casse à la première compilation ou, pire,
**à l'exécution seulement**. Chaque point ci-dessous a été vérifié contre la documentation
amont ou le registre le jour dit ; les versions sont dans [`dependencies.md`](dependencies.md).

## Next.js 16 (Azalée)

- **`params` et `searchParams` sont des `Promise`** — l'accès synchrone est supprimé.
  `generateMetadata({ params }: { params: Promise<{id:string}> })` puis `await params`.
  Le codemod `next-async-request-api` n'est **pas** couvert par `@next/codemod upgrade`.
- **`generateSitemaps` passe `id` en `Promise<string>`**, et l'index se sert en
  `/produits/sitemap/1.xml` — pas `sitemap.xml/1`. Limite Google : 50 000 URL.
- **`revalidateTag(tag, profile)`** : le second argument `cacheLife` est **requis** en 16
  (`revalidateTag('pages', 'max')`). La forme mono-argument ne compile plus. Nouveautés :
  `updateTag()` (read-your-writes) et `refresh()`. `revalidatePath` est inchangé.
- `cacheLife`/`cacheTag` sont **stabilisés** (plus de préfixe `unstable_`).
- **`experimental.ppr` est supprimé** → `cacheComponents: true`, dont le comportement
  **diffère** du PPR des canaries 15. Sous `cacheComponents`, un `generateStaticParams` qui
  retourne `[]` est désormais une **erreur de build** — l'inverse exact de Next 15.
- **`middleware.ts` → `proxy.ts`**, runtime Node forcé. Turbopack par défaut : une config
  webpack **fait échouer** le build. `next lint`, AMP, `serverRuntimeConfig` supprimés
  (attention si `metadataBase` vient d'une variable d'environnement).
- Sous `'use cache'`, `metadataBase` doit être sérialisable : `url.toString()`, jamais un `URL`.
- JSON-LD : **aucun helper Next**. `<script type="application/ld+json">` dans un Server
  Component, `dangerouslySetInnerHTML`, `JSON.stringify(x).replace(/</g,'\\u003c')` ;
  la doc interdit explicitement `next/script` ici.
- `next/image` : `minimumCacheTTL` passe de 60 s à **4 h**, `qualities` par défaut `[75]`.

## Axum 0.8 (`nie-site`)

- **Les paramètres changent de syntaxe et l'ancienne PANIQUE** au `route()`, elle ne dégrade
  pas : `"/users/:id"` → `"/users/{id}"`, `"/assets/*path"` → `"/assets/{*path}"`.
- Le chemin capturé par un wildcard **n'inclut pas le `/` initial** : `GET /f/data/dx11/a.g4tx`
  donne `"data/dx11/a.g4tx"`. À préfixer et à normaliser (`..`) nous-mêmes pour un chemin VFS.
- `#[async_trait]` n'est plus nécessaire. Ordre des extracteurs : `FromRequestParts`
  (`Path`, `Query`, `State`) d'abord, celui qui consomme le corps (`Json`, `Bytes`) **en dernier**.
- **`axum 0.8.2` est yanked** — ne pas l'épingler.
- `.layer()` empile de bas en haut ; `DefaultBodyLimit::disable()` avant
  `RequestBodyLimitLayer`, sinon la limite de 2 Mio d'axum gagne. Pour un `ServeDir` préfixé :
  `nest_service`, pas `route_service`. Ne pas cumuler `precompressed_*` et `CompressionLayer`.

## Supabase (Azalée)

- **Le default-deny de la RLS n'est pas uniforme.** RLS activée sans policy : un `SELECT`
  rend **200 + `[]`** (filtrage de lignes, aucune erreur) ; un `INSERT` **lève** — `42501`,
  que PostgREST mappe en **403** avec un JWT valide, **401** en anonyme. Un `UPDATE` dont la
  ligne échoue au `USING` est filtré silencieusement, mais une violation du `WITH CHECK` lève.
  Un `GRANT` manquant produit un `42501` **avant toute policy**, avec un hint nommant le GRANT.
- Perf, chiffres du bench amont : `TO <role>` sur la policy 170 ms → < 0,1 ms ;
  **`(select auth.uid())`** au lieu de `auth.uid()` (initPlan mis en cache par statement)
  179 ms → 9 ms, et 178 **s** → 12 ms sur une fonction `security definer` ; index sur la
  colonne filtrée 171 ms → < 0,1 ms. Lint `0003_auth_rls_initplan`.
- Les policies permissives se combinent en **OU** : une seule `using (true)` annule toutes
  les autres pour ce type de commande (lint `0024`). `as restrictive` pour durcir.
- Les vues sont `security definer` par défaut, donc **contournent la RLS** — PG ≥ 15 :
  `with (security_invoker = true)`. La RLS ne s'applique pas aux fonctions : `GRANT EXECUTE`.
- `auth.uid()` vaut `null` hors session : `USING (auth.uid() = user_id)` échoue en silence.
- Clés : `anon`/`service_role` sont désormais dites **legacy** (valides « jusqu'à fin 2026 »,
  seule date documentée), remplacées par `sb_publishable_…` / `sb_secret_…`. Les `sb_*` ne
  passent **que** par l'en-tête `apikey`, jamais en `Authorization: Bearer` — ce qui casse
  `pg_net` et les Database Webhooks. Une secret key envoyée depuis un navigateur rend 401.
- Toute app qui vérifie les JWT contre le **secret symétrique legacy** casse à la rotation
  vers les signing keys asymétriques (ES256, JWKS sur `/auth/v1/.well-known/jwks.json`).
- Doctrine serveur à jour : **`getClaims()`** pour protéger une page, jamais `getSession()`
  côté serveur ; `@supabase/ssr` n'expose plus que `getAll`/`setAll`.

## better-auth (Azalée)

- `nextCookies()` doit être le **dernier** plugin. Session serveur :
  `auth.api.getSession({ headers: await headers() })`.
- Next ≥ 16 : garde dans **`proxy.ts`**. La présence d'un cookie **n'est pas** une
  authentification — garde optimiste au proxy, vérification réelle dans la page.
- Vérification de permission côté serveur : **`auth.api.userHasPermission(...)`**
  (il n'existe pas de `auth.api.hasPermission`). `authClient.admin.checkRolePermission()`
  est **purement local** : bon pour masquer un bouton, jamais comme garde.
- `basePath` est **écrasé** si `baseURL` contient déjà un chemin (`https://site/api/auth`).
- `session.cookieCache` **retarde la révocation** : un ban ou un changement de rôle n'est pas
  visible avant expiration. Pour de la modération : `maxAge` court + revalidation DB sur les
  actions sensibles.

## rusqlite — le lien daté qui bascule la nuit

`var/mirror.sqlite` est un lien symbolique rebasculé par le timer `nie-miroir`. `open(2)`
**résout le lien une fois** : rebasculer le lien n'a **aucun effet** sur une connexion déjà
ouverte, qui continue de lire l'ancien inode indéfiniment, **sans la moindre erreur**. Base
figée, zéro signal — le mode d'échec le plus cher de cette stack.

Aggravant : les `-wal`/`-shm` sont dérivés du **chemin**, pas du descripteur, et les verrous
POSIX sont liés à l'inode — donc **aucune exclusion mutuelle** entre l'ancien lecteur et le
nouvel écrivain (`sqlite.org/howtocorrupt.html` §2.5/2.6). Un `close(2)` ailleurs dans le
processus annule silencieusement les verrous POSIX de **tous** les descripteurs du processus.

Parades, par ordre : rouvrir la connexion à chaque bascule (la seule correcte) ; détecter par
`(st_dev, st_ino)` de `fs::metadata(<lien>)` comparé à l'ouverture ; `Connection::backup` vers
un fichier à soi — également la seule façon correcte de copier une base WAL. **Jamais**
`?immutable=1` sur un lien rebasculé : on cumule absence de verrous et absence de détection.

## Non vérifié — dit tel quel plutôt que deviné

Profils `cacheLife` au-delà de `max`/`hours`/`days` ; échappement des accolades littérales
dans un motif de route axum ; version exacte de rustls verrouillée par sqlx 0.9 ; date de
coupure fine des clés Supabase legacy ; effet des signing keys sur `auth.jwt()` côté SQL ;
existence du helper `getSessionCookie` en better-auth 1.7.x ; ruptures éventuelles sur
`{% match %}` / whitespace / `render_into` en askama (aucune mention dans les notes 0.13→0.16,
ce qui n'est pas une preuve d'absence).
