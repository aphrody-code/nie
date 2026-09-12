# Hosts, ports and DNS — measured, 2026-09-07

The one place that says what answers what. Every line was measured on this VPS with
`ss -ltnp`, `dig` and `curl`, not copied from a plan. When this file and a plan disagree, this
file is right and the plan is stale.

## The map

| Host | nginx sends to | Service | Repository |
|---|---|---|---|
| `nie.aphrody.com` | `127.0.0.1:8085` | `nie-site` — **the site**, the game at `/` | `niers` |
| `aphrody.com`, `www.aphrody.com` | — | `308` to `https://nie.aphrody.com` | `niers` |
| `inacord.aphrody.com` | — | `308` to `https://nie.aphrody.com/inacord` (merged 2026-09-12); `/downloads/*` and `/api/*` `308` to the same path on `nie.`; updater manifest still served locally | `niers` |
| `api.aphrody.com` | `127.0.0.1:8085` | `nie-site`, API only (`404` elsewhere), `noindex` | `niers` |
| `cdn.aphrody.com` | `127.0.0.1:8790` | `nie-model-serve` — decoding on demand, rate-limited | `niers` |
| `mcp.aphrody.com` | `127.0.0.1:8808` | MCP server (`401` without a token is correct) | `niers` |
| `bxc.aphrody.com` | `127.0.0.1:8084` | `bxc-site` — own file, `conf.d/bxc.aphrody.com.conf` | `bxc` |
| `downloads.`, `bot.`, `admin.`, `n2b.` | `127.0.0.1:8084` | `bxc-site` | `bxc` |

## `:8083` is dead, and the rollback that named it never existed

`aphrody-site.service` is **`inactive`** and **`disabled`**. Nothing listens on `127.0.0.1:8083`.

Several documents still offered « repoint the vhost at `:8083`, `aphrody-site` is never
stopped » as the rollback for the `nie-site` switchover. That was already false on 2026-09-05
and it is false now: there is no service to fall back to, and repointing there returns `502`.

**The real rollback is `git revert` on `deploy/nginx/aphrody.com.conf`, then `nginx -t` and a
reload.** The file is versioned precisely so that the previous state is recoverable; the
machine's own copy is not a backup.

## DNS — eleven names, and exactly eleven

The eleven hosts all resolve to **`51.77.147.152`**, this VPS. `aphrody.com` and
`n2b.aphrody.com` are `A` records; the nine others are `CNAME` to `aphrody.com`. The certificate
`letsencrypt/live/aphrody.com` covers those eleven and no more. Nothing to issue.

**The three sets now match**, which is the property to preserve:

```text
DNS (A/CNAME)  ==  nginx server_name  ==  certificate SAN  ==  11 hosts
```

A twelfth name used to break it: `ftp.aphrody.com`, a `CNAME` left by OVH at domain creation. It
resolved to this VPS with no vhost, no certificate coverage, no FTP listener and not one mention
in any repository — a name that points at your machine without being served is a surface, not a
service. It was **deleted on 2026-09-07**. Restoring it is one `POST`:
`CNAME` / `ftp` / `aphrody.com.` / `ttl 0`.

### Credentials — three OVH accounts, do not confuse them

Full zone contents, record ids and the procedures are in [`docs/OVH.md`](OVH.md).

| File | Section / variables | Zones it can see |
|---|---|---|
| `/home/ubuntu/.bash_secrets` | `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY` | **`aphrody.com`**, `rpbey.fr` |
| `/home/ubuntu/.ovh.conf` | `[ovh-eu]` | `rosegriffon.fr` only |
| `/home/ubuntu/.config/ovh/dbfr.conf`, `/etc/letsencrypt/ovh-dbfr.ini` | `[ovh-eu]`, `dns_ovh_*` | `dragonballfr.com` only |

Reaching for `~/.ovh.conf` to manage `aphrody.com` gives a **404 on the zone**, not a permission
error — which reads like "the zone does not exist" and sends you looking in the wrong place. The
`aphrody.com` credentials are the ones in `.bash_secrets`.

Email is hosted at OVH and is **not** ours to tidy: four `MX`, the `SPF` record (published as
`TXT`, verified with `dig`), two DKIM `CNAME`, `_dmarc` and the autodiscover `SRV`. Touching them
breaks mail silently.

## Ports that are not facades

`3003`/`3004` are the blue/green Azalée hosts, `8788`–`8805` are bxc workers, `9222` is a bxc
CDP server. They are behind other vhosts or bound to the VPN interface, and none of them belongs
to the `aphrody.com` family.

Leftover `nie-site` processes on ephemeral ports (`127.0.0.1:20921`, `33451`, …) are integration
tests that were not reaped. They are harmless and are **not** the service; the service is the one
on `8085`. Never kill by name — identify the PID.

## Checking this file is still true

```bash
ss -ltnp | grep -E ':(8083|8084|8085|8790|8808)\b'
systemctl is-active nie-site bxc-site nie-model-serve aphrody-site
for h in aphrody.com www api mcp downloads cdn bot admin bxc nie n2b; do
    fqdn=$([ "$h" = aphrody.com ] && echo aphrody.com || echo "$h.aphrody.com")
    printf '%-24s %s\n' "$fqdn" "$(curl -sI --max-time 8 "https://$fqdn/" | head -1)"
done
```
