# @rosegriffon/db

Package database partagé pour l'écosystème Rose Griffon.

## Contenu

- **Types Supabase :** Source de vérité générée via `bun run types:gen`.
- **Clients Clients/Serveur :** Helpers pour instancier le client Supabase selon l'environnement (Next.js SSR, Browser, Service Role).
- **Storage :** Utilitaires pour la gestion des assets sur Supabase Storage.
- **Services :** Logique métier transverse (ex: agrégation de statistiques dashboard).

## Utilisation

```typescript
import { createSupabaseServiceClient } from "@rosegriffon/db/service";

const supabase = createSupabaseServiceClient();
const { data } = await supabase.from("profiles").select("*");
```

## Scripts

- `types:gen` : Régénère `src/types.gen.ts` depuis la base PostgreSQL **locale**
  (`scripts/types-gen.ts` → générateur pg-meta sur `127.0.0.1:8813`, celui-là même
  qu'appelait `supabase gen types typescript` avant la bascule self-host). Le
  fichier produit est commité ; toute retouche à la main est effacée au prochain
  passage, donc une correction de type se fait en base puis par régénération.
- `type-check` : Vérifie la validité des types du package.
- `test` : Lance les tests unitaires (`bun test`).
