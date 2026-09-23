# Hosts and ports — owned by aphrody-infra

This repository no longer keeps a host, port or DNS map. Since 2026-09-23 `aphrody-infra`
(`../aphrody-infra`) is the single owner of nie's infrastructure, and its catalog wins over any
plan or document here:

| Question | Source of truth in aphrody-infra |
|---|---|
| Which services run, on which loopback port, with which health probe and unit | `config/service-catalog.json` (`nie-site`, `nie-model-serve`) |
| Which public host and path reaches which service | `config/nginx-routes.json`, `nginx/aphrody/aphrody.com.conf` |
| systemd units | `systemd/nie-site.service`, `systemd/nie-model-serve.service` |
| DNS zones, OVH accounts and API keys | `docs/ops/OVH.md`, `scripts/ops/ovh-dns.ts` |
| Host inventory and addresses | `inventory/` |

What the application itself assumes, and only that:

- `nie-site` listens where its unit passes `--listen` and reaches `nie-model-serve` through
  `--upstream`; neither address is compiled in.
- `nie.aphrody.com` is the only public name of nie. The vhost publishes it as a backend
  (`/api/`, `/cdn/`, bearer-gated `/f` and `/b`, `/health`, `/downloads/inacord/latest.json`);
  `/` answers 404 there, and `cdn.aphrody.com` routes nothing to nie.

Measure before trusting any of it: `ss -ltnp` and `nginx -T` on the host, and `diff` the installed
files against the aphrody-infra sources.
