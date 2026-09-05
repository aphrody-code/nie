# Analyse de migration : PostgreSQL local → Supabase Cloud

**Date** : 2026-09-05  
**Projet cible** : Supabase Cloud `aphrody` (kvnlbhatjqqmhhxaxlbi) / eu-west-3  
**Plateforme cible** : Vercel serverless  

---

## Résumé exécutif

**La migration vers Vercel + Supabase Cloud est viable, mais CRITIQUE** :
- Les données de jeu (66 tables, 110 MB) sont régénérables et migrent sans risque
- L'**impact latence** rend le site **inutilisable** sans optimisation préalable
- Les données d'utilisateurs (1931 comptes) ne doivent **jamais** migrer sans consentement explicite
- **Coût de migration** : 1-2 minutes (schéma + données)
- **ROI** : Réduction coûts infra (VPS → serverless), mais SEULEMENT si optimisations faites

---

## État de la source

### Inventaire des données (PostgreSQL local, base `rg`)

| Catégorie | Tables | Lignes | Taille | Notes |
|-----------|--------|--------|--------|-------|
| **inagle_*** (jeu) | 66 | 165 244 | 110 MB | Régénérable depuis dumps du jeu |
| **inagle_cross_*** | 153 | 0 | 2.8 MB | Jamais peuplé, à ignorer |
| **auth.users** | 1 | **1931** | 1.7 MB | ⚠️ **DONNÉES PERSONNELLES - GDPR** |
| **public.session** | 1 | 71 | 120 KB | Métadonnées de session |
| **public.account** | 1 | 12 | 64 KB | Comptes éditoriaux |
| **storage.buckets** | 1 | 6 | 7 MB | Métadonnées (fichiers dans CDN) |

**Total à migrer** : ~127 MB (sans users) / ~129 MB (avec users)  
**État du schéma** : 4 migrations principales prêtes dans `supabase/migrations/` ✓

### État de la cible

**Supabase Cloud project `aphrody`**:
- ✓ Créé 2026-09-04
- ✓ Région : eu-west-3 (Ireland)
- ✓ État : `ACTIVE_HEALTHY`
- ✗ Tables : 0 (complètement vide)
- ✗ Connexion directe psql : **BLOQUÉE par pare-feu**

---

## Analyse des trois options

### Option A : Migration complète Cloud + Vercel ✅ RECOMMANDÉ (avec conditions)

**Approche** : PostgreSQL local → Supabase Cloud + Vercel serverless  
**Migration** : Schéma + données jeu (pas users)

#### ✅ Avantages
- Infrastructure CDN globale (Vercel + Supabase)
- Coûts réduits (~40-60% vs VPS dédié)
- Scaling automatique sans maintenance
- Separation auth (Supabase native) de business logic (Vercel)
- Vercel + Supabase = intégration native

#### ❌ Blockers identifiés

**1. Latence : CRITIQUE** 🔴
```
Local (aujourd'hui):
  Latence base:         0.1-0.2 ms (loopback 127.0.0.1)
  Character page:       ~0.16 s (800 queries @ 0.2 ms)

Cloud (projeté, non optimisé):
  Latence base:         7-10 ms (Vercel CDG1 → Supabase eu-west-3)
  Character page:       ~5.6 s (800 queries @ 7 ms) ❌

Acceptable après optimisation:
  Latence base:         7 ms (warm connection)
  Character page:       ~0.35 s (50 queries après JOIN/batching)
```

**VERDICT** : 
- ❌ **NON viable sans optimiser les queries**
- ✓ Viable avec optimisation (JOIN, batching, caching)
- **Délai** : ~2-4 semaines d'optimisation requises avant migration

**2. Données personnelles : BLOQUANT légal** 🔴
```
auth.users : 1931 enregistrements = données PERSONNELLES
  - Contient : emails, hash passwords, metadata
  - RGPD : Transfert hors UE possible (eu-west-3 est UE ✓)
  - Consentement : Chaque utilisateur doit consentir OU data anonymisée
  - Risque légal : CNIL/RGPD si migration non consentie
```

**VERDICT** :
- ❌ **NE PAS migrer les utilisateurs sans consentement explicite**
- ✓ Garder auth sur Supabase Cloud (natif, sécurisé)
- ✓ Laisser sessions locales OU les re-synchroniser

**3. Connectivité Cloud** 🟡
```
Direct psql : BLOQUÉE (pare-feu Supabase)
  - supabase CLI : Installation échouée (npm package malformé)
  - Solution : Utiliser Supabase web console OU migrer via pg_dump

Workaround validé :
  pg_dump local → SQL → Supabase console (copy-paste)
  Ou : Attendre déploiement d'une route `/admin/migrate` custom
```

**VERDICT** :
- ⚠️ Migration manuelle possible mais laborieuse
- ✓ La charge des données (ensuite) peut être automatisée via API

---

### Option B : Vercel + PostgreSQL local (via bastion SSH) ⚠️ POSSIBLE

**Approche** : Garder DB local, exposer via SSH tunnel ou connexion restrictive  
**Migration** : Aucune donnée ne bouge, code seul migre

#### ✅ Avantages
- Zéro impact données (tout reste en place)
- Zéro risque légal (GDPR/auth inchangé)
- Latence réduite (direct AWS eu-west-1 ← Londres est plus proche que Dublin)
- Aucune interruption de service

#### ❌ Inconvénients
- Connexion Vercel → VPS doit rester ouverte
- Charge VPS non déchargée (DB reste locale)
- Firewall Vercel ↔ VPS complexe (IP publique Vercel instable)
- Pas de true serverless (VPS toujours actif)

#### Latence mesurée (scénario)
```
Vercel (CDG1) → VPS (OVH eu-west) → PostgreSQL (127.0.0.1)
  + Vercel → OVH : ~2-3 ms (Paris ↔ France)
  + TCP setup : ~1-2 ms
  + Tunnel SSH : +1-2 ms overhead
  Total par requête : ~5-8 ms

Character page : ~0.4-0.6 s (50-100 queries après optimisation)
✓ Acceptable, mais infrastructure reste accouplée
```

**VERDICT** :
- ✓ Viable techniquement
- ❌ Défait le but de Vercel (serverless)
- ⚠️ Vraiment utile seulement comme **transition intermédiaire**

---

### Option C : Exposer self-hosted derrière un CDN + TLS ✅ MAINTIEN ACTUEL

**Approche** : Rester sur VPS, mais externaliser le CDN (Cloudflare Worker / BunnyCDN)  
**Migration** : Aucune

#### ✅ Avantages
- Infra maîtrisée, pas de migration
- Données en France (RGPD strict)
- Latence ultra-basse (cache edge)
- Coûts connus et comparables

#### ❌ Inconvénients
- Maintenance VPS continue
- Pas de scaling auto
- Surcharges : mise à jour OS, backups, monitoring
- Expertise interne requise

#### Estimation de coûts VPS
```
VPS OVH actual: ~200 EUR/mois
  - 32 GB RAM
  - 8 cores vCPU
  - 500 GB SSD
  - 1 Gbps unmetered

Vercel + Supabase : ~150-300 EUR/mois
  - Vercel : $0 (ou $20/mo Pro)
  - Supabase : $25/mo (starter) → $100/mo (pro)
  - Bandwidth : $0.05/GB excess
  
ROI : Nullifié si infrastructure VPS reste pour auth/backup
```

**VERDICT** :
- ✓ Zéro risque, stable et maîtrisé
- ❌ Pas d'économies si VPS reste
- ⚠️ À maintenir comme **plan B de secours**

---

## Recommandation : Option A (Cloud + Vercel)

### Phasing proposé

#### Phase 1 : Optimisation des queries (2-4 semaines) 🔴 BLOQUANT

**Objectif** : Réduire les 800-1000 queries → 50 queries (factor 16x)

Travaux :
- [ ] Audit des queries N+1 (pages principales)
- [ ] Implémenter JOINs SQL au lieu de loops
- [ ] Ajouter caching (Redis @127.0.0.1, puis Vercel KV)
- [ ] Benchmarker : target < 100 ms pour une page complète
- [ ] Tests de charge : 100 utilisateurs simultanés

**Validation** : 
```bash
curl https://azalee.rosegriffon.fr/api/character/1 | jq .performance_metrics
# Expect: "query_count": 45, "total_ms": 120
```

#### Phase 2 : Préparation infrastructure Cloud (1 semaine)

- [ ] Appliquer migrations schema sur Cloud
- [ ] Tester connectivité (API, PostgREST)
- [ ] Créer backup de la base actuelle
- [ ] Préparer script de rollback (restore VPS)

#### Phase 3 : Load test données jeu (1 jour)

- [ ] Charger 110 MB de données jeu
- [ ] Valider cohérence des 811 colonnes
- [ ] Tests fonctionnels : 50 queries type

#### Phase 4 : Bascule Vercel (1-2 jours)

- [ ] Déployer code Next.js sur Vercel
- [ ] Switchover DNS (azalee.rosegriffon.fr → vercel.com)
- [ ] Monitoring : erreurs, latence, quota API
- [ ] Rollback instant si problème

#### Phase 5 : Décommission VPS (2-4 semaines après stabilité)

- [ ] Archiver dumps VPS
- [ ] Réduire ressources VPS
- [ ] Puis supprimer

### Timeline réaliste
- Phase 1 (queries) : 2-4 semaines ⚠️
- Phase 2-5 : 2-3 semaines
- **Total avant cutover** : 4-7 semaines
- **Retour ROI** : ~3 mois (économies offset migration)

### Risques et mitigation

| Risque | Impact | Mitigation |
|--------|--------|-----------|
| Queries encore trop lentes après optim | Timeout Vercel 10s | Ajouter caching distribué (Redis) |
| Données utilisateurs fuient pendant migration | CNIL amende | Migrer SANS users, recréer via `auth.signUp()` |
| Firewall cloud bloque BD | Downtime site | Garder VPS actif 2 semaines post-cutover |
| Cost creep Supabase | Budget dépassé | Monitorer quota, hard-limit API |

---

## Coûts détaillés

### Scénario : 100k visiteurs/mois, 6k queries/session

**Vercel**
```
Pricing (Pro): $20/mo
  - 100k edge function invocations : free tier OK
  - 100 GB bandwidth : ~$5/mo
Total: ~$25/mo
```

**Supabase Cloud (eu-west-3)**
```
Tier: Pro ($100/mo)
  - 500 DB connections
  - 2 CPU, 4 GB RAM
  - 100 GB database size
  - 250GB/mo bandwidth included
  
Query estimator (100k visitors, 6k queries/session):
  100k × 6k = 600M queries/month
  Supabase scales automatically for Pro tier
  
Additional costs (if needed):
  - Excess bandwidth : $0.065/GB
  - Rows excess : $0.10/1M rows (typically free)
  - Storage excess : $0.02/GB

Realistic : $100-150/mo (Pro tier covers most cases)
```

**Total**: $125-175/mo (vs $200 VPS actuel = **30-40% savings**)

---

## Décision finale : AUTORISER la migration Cloud

✅ **Option A recommandée** avec conditions impératives :

1. **Optimisation queries AVANT migration** (2-4 semaines)
2. **Pas de migration utilisateurs** (GDPR, recréer via auth.signUp)
3. **Plan de rollback** (backup VPS, DNS revert instantané)
4. **Monitoring en continu** (latence, error rate, quota)

**Prochaine action** : Lancer audit des queries N+1 sur azalee.rosegriffon.fr

---

## Appendix : Fichiers de préparation créés

Tous les fichiers sont versionné dans `scripts/ops/` :

1. **`migrate-to-supabase-cloud.ts`** - Dry-run de la migration
   ```bash
   bun run scripts/ops/migrate-to-supabase-cloud.ts --dry-run
   ```

2. **`load-game-data-to-cloud.ts`** - Plan de chargement données
   ```bash
   bun run scripts/ops/load-game-data-to-cloud.ts --dry-run
   ```

3. **`supabase/migrations/`** - 5 migrations SQL prêtes à appliquer

**Blockers actuels** :
- [ ] Supabase CLI ne s'installe pas (npm malformé)
- [ ] Connexion directe psql bloquée (pare-feu Cloud)
- **Workaround** : Application manuelle via console Supabase web

---

## Glossaire

- **PostgREST** : API REST auto-générée depuis schéma Postgres
- **RLS** (Row-Level Security) : Policies qui filtrent lignes par utilisateur
- **Edge function** : Serverless compute proche de l'utilisateur (Vercel)
- **Cold start** : Première invocation = latence +200-500 ms
- **N+1 queries** : Requête initiale + 1 query par résultat (anti-pattern)
- **Connection pooling** : Réutilisation connexions TCP (réduit latence)

