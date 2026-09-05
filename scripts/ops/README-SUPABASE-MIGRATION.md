# Supabase Cloud Migration Guide

This directory contains scripts and documentation for migrating `azalee.rosegriffon.fr` from local PostgreSQL to Supabase Cloud.

## Quick Start

### 1. Analyze the migration (dry-run, safe)

```bash
bun run scripts/ops/migrate-to-supabase-cloud.ts --dry-run
```

This will:
- Verify Supabase Cloud project is active
- Inventory local database (schema, size, row counts)
- Test network connectivity (expected to fail)
- Print detailed report

**Output**: Full inventory breakdown, table sizes, categorization of what to migrate

### 2. Review game data to load

```bash
bun run scripts/ops/load-game-data-to-cloud.ts --dry-run
```

This will:
- Read `var/mirror.sqlite` (auto-synced game data)
- Count all 66 inagle_* tables
- Estimate transfer time and bandwidth
- List top tables by row count

**Output**: Data loading plan, timing estimates

### 3. Read the full analysis

```bash
cat docs/MIGRATION-SUPABASE-CLOUD-ANALYSIS.md
```

This document covers:
- Current state inventory (database, users, sessions)
- Three migration options with pros/cons
- Latency impact analysis (⚠️ CRITICAL)
- Recommended phasing and timeline
- Cost breakdown
- Risk mitigation

## Migration Prerequisites

### Secrets Setup

Create `~/.config/niers/supabase.env` with:

```bash
# Supabase Management API token (from https://app.supabase.com/account/tokens)
SUPABASE_ACCESS_TOKEN=<your-access-token>

# Supabase Cloud project database password
SUPABASE_DB_PASSWORD='<password-with-special-chars-in-quotes>'
```

**Security**: Never commit secrets. File should be `0600`.

### Network Prerequisites

- ✅ Supabase Cloud project `aphrody` must be `ACTIVE_HEALTHY`
- ✅ `var/mirror.sqlite` must exist (auto-synced by `nie-miroir.timer`)
- ⚠️ Direct psql connection to Cloud likely blocked (normal)
- ⚠️ Supabase CLI installation may fail (use web console instead)

## Inventory Summary

Run this to see current state:

```bash
sudo -u postgres psql -d rg << 'EOF'
SELECT
  'inagle_game_tables' as category,
  66 as tables,
  '165,244' as rows,
  '110 MB' as size,
  'Regenerable from game files' as note
UNION ALL
SELECT 'inagle_cross_tables', 153, '0', '2.8 MB', 'Unused, ignore'
UNION ALL
SELECT 'auth.users', 1, '1931', '1.7 MB', '⚠️ PERSONAL DATA - GDPR'
UNION ALL
SELECT 'storage+other', 8, '89', '7.2 MB', 'Metadata only';
EOF
```

## Critical Decisions

### 1. Query Optimization (MANDATORY before cloud cutover)

**Current state**: ~800-1000 queries per page load (N+1 pattern)  
**Problem**: At 7ms/query over network = 5.6 seconds ❌

**Must do**:
- Implement SQL JOINs instead of loop queries
- Add batching/GraphQL layer
- Reduce to < 50 queries per page load
- Add caching (Redis, Vercel KV)

**Timeline**: 2-4 weeks

### 2. User Data Handling (GDPR)

**Current**: 1931 user records in `auth.users`  
**Decision**: ❌ Do NOT migrate without explicit user consent

**Options**:
- Option A (Recommended): Keep users on Supabase Cloud auth (not in DB)
- Option B: Re-authenticate users via `auth.signUp()` after migration
- Option C: Get explicit GDPR consent from all users before migration

### 3. Rollback Plan

**Require**:
- [ ] Full backup of current `rg` database
- [ ] DNS at CNAME level (not A record) for instant revert
- [ ] VPS kept online for 2-4 weeks post-migration
- [ ] Runbook for 1-click rollback

## Detailed Steps (not yet executed)

### Phase 1: Preparation (Today)

```bash
# 1. Verify everything is ready
bun run scripts/ops/migrate-to-supabase-cloud.ts --dry-run

# 2. Review analysis document
cat docs/MIGRATION-SUPABASE-CLOUD-ANALYSIS.md

# 3. Create backup of current database
sudo -u postgres pg_dump rg > /tmp/rg_backup_2026-09-05.sql
gzip /tmp/rg_backup_2026-09-05.sql
# Save to safe location outside /tmp
```

### Phase 2: Schema Application (Manual via console)

```
Step 1: Log into Supabase console
  → https://app.supabase.com/projects/kvnlbhatjqqmhhxaxlbi

Step 2: Open SQL Editor

Step 3: For each file in supabase/migrations/ (in order):
  1. Read file content
  2. Copy-paste into SQL Editor
  3. Execute

Or: If supabase CLI becomes available:
  supabase db push --project-ref aphrody
```

Expected result: 66 tables + 5 views + 39 indexes

Verify:
```sql
-- Should return 66
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'inagle_%'
AND table_name NOT LIKE 'inagle_cross_%';
```

### Phase 3: Data Loading

```bash
# 1. Review what will load
bun run scripts/ops/load-game-data-to-cloud.ts --dry-run

# 2. [When ready] Execute actual load
# bun run scripts/ops/load-game-data-to-cloud.ts --load
# (This would require cloud connectivity)
```

Expected result: 165,277 rows loaded

Verify:
```sql
-- Should return similar counts as local
SELECT 'inagle_characters' as table_name, COUNT(*) as rows
FROM inagle_characters;
```

### Phase 4: Application Deploy

```bash
# 1. Update apps/azalee/.env.production
#    DATABASE_URL="postgresql://postgres:***@kvnlbhatjqqmhhxaxlbi.supabase.co:5432/postgres"
#    (Don't commit, use Vercel secrets instead)

# 2. Deploy to Vercel
#    (Handled by CI/CD, or manual: `vercel deploy --prod`)

# 3. Monitor
#    - Vercel logs: https://vercel.com/projects
#    - Supabase logs: https://app.supabase.com/.../logs
#    - Error tracking: Sentry, if configured
```

### Phase 5: DNS Cutover

```bash
# Current setup (in CloudFlare or wherever DNS hosted):
#   azalee.rosegriffon.fr CNAME → <current-vps-ip>
#
# After migration:
#   azalee.rosegriffon.fr CNAME → azalee.vercel.app
#
# (Or A record directly to Vercel IP, but CNAME is safer for failover)
```

DNS propagation: ~2-10 minutes (some ISPs cache 24h)

### Phase 6: Rollback (if needed within first 30 days)

```bash
# Instant rollback:
1. Revert DNS: azalee.rosegriffon.fr → old VPS IP
2. Restart VPS services: systemctl restart azalee
3. Restore database if needed: psql rg < /tmp/rg_backup_2026-09-05.sql

# Time to recover: ~5-10 minutes
# Data loss risk: Only new records since cutover (1-2 days)
```

## Monitoring Commands

### Check Supabase Cloud project status

```bash
source ~/.config/niers/supabase.env
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/kvnlbhatjqqmhhxaxlbi | jq '.status, .region'
```

### Monitor local → cloud data sync

```bash
# Local game data
sudo -u postgres psql -d rg -c "SELECT COUNT(*) FROM inagle_characters;"

# Cloud (requires connectivity)
# psql postgresql://postgres:pass@kvnlbhatjqqmhhxaxlbi.supabase.co:5432/postgres -c \
#   "SELECT COUNT(*) FROM inagle_characters;"
```

### Check migration scripts status

```bash
# Last migration run
ls -lh scripts/ops/migrate-*.ts

# Check for error logs
find /tmp -name "*migrate*.log" -mtime -1
```

## Estimated Timeline

| Phase | Task | Time | Blocker |
|-------|------|------|---------|
| 1 | Query optimization | 2-4 weeks | **CRITICAL** |
| 2 | Schema setup (Cloud) | 1 day | Manual |
| 3 | Data load | 1 day | Connectivity |
| 4 | App deploy (Vercel) | 1 day | Code ready |
| 5 | DNS cutover | 1 day | Testing |
| 6 | Monitoring (1 week) | 1 week | ✓ |

**Total: 4-7 weeks before safe cutover**

## Costs

### Before migration (current)
- VPS: ~$200/month
- Total: $200/month

### After migration (estimated)
- Vercel: ~$25/month
- Supabase Cloud: ~$100-150/month
- Bandwidth overage: ~$5-10/month
- Total: $130-185/month

**Savings: $15-70/month (7-35%)**  
**ROI payback: ~3-6 months**

---

## Support & Questions

- 📖 Full analysis: `docs/MIGRATION-SUPABASE-CLOUD-ANALYSIS.md`
- 🔧 Migration script: `scripts/ops/migrate-to-supabase-cloud.ts`
- 📊 Data plan: `scripts/ops/load-game-data-to-cloud.ts`
- 🆘 On error: Check `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in secrets

