# @rosegriffon/auth

Logique d'authentification et gardes de sécurité partagés.

## Contenu

- **Bridge Profil :** Réconciliation entre les IDs d'utilisateurs `Better Auth` et les profils `Supabase`.
- **RBAC :** Helpers pour vérifier les rôles (`isAdmin`, `isStaff`).
- **Garde Serveur :** `createAdminGuard` pour sécuriser les routes et Server Actions.

## Utilisation

```typescript
import { resolveProfile } from "@rosegriffon/auth";

// Dans un Server Action
const user = await requireAuth();
const profile = await resolveProfile(supabase, user);
```

## Architecture

- Le package dépend de `better-auth` pour la gestion des sessions.
- Il utilise `@rosegriffon/db` pour la lecture des profils et des comptes liés (Discord, etc.).
