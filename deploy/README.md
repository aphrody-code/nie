# `deploy/` — moved to aphrody-infra

Since 2026-09-23 this repository carries no infrastructure. `aphrody-infra` (`../aphrody-infra`)
is the single owner of what runs nie:

| What | Where in aphrody-infra |
|---|---|
| systemd units | `systemd/nie-site.service`, `systemd/nie-model-serve.service` |
| nginx vhost (`nie.aphrody.com`) | `nginx/aphrody/aphrody.com.conf` |
| ports, health probes, routes | `config/service-catalog.json`, `config/nginx-routes.json` |
| host transport (workstation/origin/host sync) | `scripts/nie/sync-main.ts` |
| DNS, OVH accounts | `docs/ops/OVH.md`, `scripts/ops/ovh-dns.ts` |

nie keeps the application code, the build and the verification. `scripts/deploy-target.ts` and
`scripts/release-all.ts` install and compare units and vhost from
`${APHRODY_INFRA_ROOT:-../aphrody-infra}`.
