# Instructions @rose-griffon/db

## Architecture

- Le package est divisé en entrées spécifiques (`/browser`, `/server`, `/service`) pour éviter d'importer des dépendances Node.js (ex: `next/headers`) dans le bundle client.
- **NE JAMAIS** importer `@rose-griffon/db/service` ou `@rose-griffon/db/server` dans un composant client.

## Maintenance des types

1. Assurez-vous d'avoir le CLI Supabase installé localement.
2. Lancez `bun run types:gen` pour mettre à jour `src/types.gen.ts`.
3. Vérifiez les regressions avec `bun run type-check`.

## Storage

- Utilisez toujours `getAssetUrl(path)` pour construire les URLs d'images. Cela permet de basculer facilement entre les buckets ou d'ajouter un CDN ultérieurement.
