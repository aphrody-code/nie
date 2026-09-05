# Sécurité et prérequis d'exposition

**Source de mesure :** audit compagnon `niers/docs/SECURITE-BASCULE.md`, commit
`4f53936`, contrôles effectués le 2026-09-05. Ce document ne contient aucun
secret et ne lance aucune correction d'infrastructure.

## Verdict

L'exposition existe déjà en self-host. Elle n'est pas créée par Vercel, mais
une nouvelle cible web, Tauri ou mobile ne doit pas l'étendre. Les corrections
doivent précéder toute bascule publique et sont indépendantes du choix
Leptos/Axum.

| Gravité | Fait MESURÉ | Conséquence |
| --- | --- | --- |
| Critique | RPC `rg_liberer_profil_discord` appelable anonymement; il peut supprimer un profil précréé et sa ligne `auth.users` | intégrité et comptes |
| Critique | `anon` a `INSERT/UPDATE/DELETE/TRUNCATE` sur 129 tables; RLS est la seule barrière | écriture de masse si une policy est faible |
| Critique | `SUPABASE_JWT_SECRET` présent en clair dans un fichier d'environnement; il permet de forger `service_role`/bypass RLS | compromission totale si le secret fuit |
| Critique | SSH accepte root par mot de passe (`PermitRootLogin yes`, `PasswordAuthentication yes`) | prise de contrôle brute-force |
| Élevé | `GET /rest/v1/discord_members` anonyme : 2 105 lignes nominatives, dont identifiant Discord, pseudo, avatar et rôles | fuite de données personnelles |
| Élevé | `nie-model-serve` : 0 auth, 0 rate-limit, 5,65 Gio RSS et une route GLB mesurée en 504 après 30 s | déni de service et saturation mémoire |
| Élevé | `limit_req_zone` existe dans nginx mais aucun `limit_req`/`limit_conn` ne l'applique | garde-fou inerte |
| Élevé | `NEXT_PUBLIC_SUPABASE_URL` pointe l'origine Azalée; 17 fichiers l'utilisent | 404 silencieuses si l'origine devient Vercel |
| Moyen | updater desktop appelle GitHub sans auth | quota partagé et 404 intermittents sur Vercel |

La traversée de chemin dans `nie-model-serve` a été **infirmée** par trois
contrôles; son risque réel est l'épuisement de ressources, pas une lecture
arbitraire. Cette nuance ne réduit pas la priorité du rate-limit et du budget
mémoire.

## Preuves reproductibles archivées par l'audit

L'audit a utilisé des sondes inoffensives :

```text
GET  /rest/v1/discord_members?limit=1  -> HTTP 206, Content-Range 0-0/2105
POST /rest/v1/rpc/rg_liberer_profil_discord avec p_discord_id="" -> HTTP 200
GET  /model-chr/c02023700.glb -> HTTP 504 en 30,017 s
```

La chaîne vide dans le RPC mesure uniquement l'accessibilité et ne supprime
rien. Elle ne justifie pas de tester un identifiant réel en production.

## Ordre de remédiation

Ces actions sont **à exécuter avec approbation opérationnelle**; aucune n'a été
appliquée par l'audit :

1. révoquer l'exécution `anon` des RPC d'écriture et les grants d'écriture
   inutiles;
2. retirer/réduire `discord_members` et `settings` de l'accès anonyme;
3. planifier la rotation atomique de `SUPABASE_JWT_SECRET` et des services qui
   le valident;
4. fermer l'authentification SSH root par mot de passe après avoir vérifié une
   session par clé;
5. appliquer `limit_req` et `limit_conn` au vhost `nie-model-serve`, ajouter
   un budget de temps coopératif et aligner le cache sous `MemoryMax`;
6. authentifier l'appel GitHub de l'updater avec un token fine-grained à
   permissions minimales;
7. pointer `NEXT_PUBLIC_SUPABASE_URL` vers l'origine Supabase dédiée, régler
   CORS, et tester les 17 consommateurs;
8. vérifier les ports publics et les vhosts avant chaque exposition.

## Règles pour les nouvelles cibles

- `nie-site` est le seul point d'accès SQL/Storage/Realtime pour les clients;
- Auth JWT/JWKS et rôles minimaux côté API; jamais de service-role dans React,
  Tauri, WASM, Android ou iOS;
- Tauri : capabilities minimales, CSP stricte et stockage sécurisé des tokens;
- mobile : certificats/origines HTTPS explicites, cache offline chiffré ou
  minimisé, déconnexion et rotation testées;
- Steam : le jeu doit pouvoir jouer hors réseau pour le cœur, tandis que les
  services Steam facultatifs échouent proprement sans bloquer le match;
- journaux sans JWT, mot de passe, identifiant Discord complet ou payload
  personnel.

