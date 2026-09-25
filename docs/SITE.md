# The site — `nie.aphrody.com`

> **Status (2026-09-25).** The VPS no longer runs NIE: `nie.aphrody.com` is not deployed, and
> NIE converges into Aphrody (`../docs/architecture/APHRODY-CONVERGENCE.md` in the superproject).
> Ports and units below describe the code's defaults, not a live service; deployment facts belong
> to `aphrody-infra`.

Moved out of `README.md` on 2026-09-19: the README is a shop window, and this level of detail
belongs where someone comes looking for it.

## Names

**nie** is the site, served by `crates/tools/nie-site` — Axum 0.8, **100 % Rust**, bound to
`127.0.0.1:8085` behind nginx and TLS. `aphrody.com` and `www.` answer a `308` to it and hold
nothing themselves.

The name **Aphrody** stays with the [`aphrody-code/aphrody-*`](https://github.com/aphrody-code) repositories;
only the *character* keeps it here (`crates/engine/nie-aphrody`, the pet routes, the auras).
`pages::SITE` is the single source for the site's own name, and `SUFFIXE_TITRE` derives from the
same token, so a rename cannot miss one.

## The home page is the game, and it is a placeholder

`/` mounts `crates/engine/nie-wasm` — the ported logic compiled to WebAssembly, driven by the
keyboard, drawn into a canvas.

Be exact about what that is. `nie-wasm` renders a **2D placeholder**, not the game's interface,
because the real menu is built at runtime by the C++ menu manager driving Lua through
`funcLuaMenuCommand`, a loop that is not ported. The page proves that the ported logic runs in a
browser. It does not prove fidelity, and nothing in this repository should claim otherwise — in
code, in documentation, or in a commit message.

## Startup has exactly one gate

A zero-asset loading surface polls `/api/v1/health` until three things hold: the content-backed
VFS is non-empty, both read-only SQLite schemas have opened, and the bundle is available. It then
enters the menu directly.

Video, soundtrack, bitmap-font, WASM decode and secondary-scene preloads are deliberately
**outside** that critical path; media stays available on demand in its catalogue.

## Catalogues, and what the site is not

`/textures`, `/modeles`, `/sons`, `/videos`, `/explorateur` are served with their own metadata,
reachable from `/menu`, and deliberately **absent from the sitemap**.

The site is **neither the wiki nor the file explorer**: the wiki is **Azalée**, the explorer is
**Inacord**. It hosts `apps/nie-web`, the same interface as Inacord, the desktop application.
Both address resources by their **VFS path**, exactly like the game does — no translated slug ever
identifies a file. There is no native mobile package: the installable mobile web entry is never
labelled an APK or IPA, and the browser adapter rejects desktop-only commands explicitly — see the
distribution rules in [`apps/README.md`](../apps/README.md#distribution-rules).

## The origin publishes no identity

Only reproducible results and Inazuma Eleven content covered by the agreement are published. No
personal data, no secret, ever.

The origin does not even name itself: `/healthz` returns measured capabilities, and neither a
service name nor a version. `/.well-known/security.txt` was removed for exactly this reason —
RFC 9116 makes `Contact` mandatory. Before adding a field to a public DTO, ask what it tells a
reader about the machine.

## Every list route paginates, and clips in silence

`PER_PAGE_DEFAUT = 50`, `PER_PAGE_MAX = 200` (`crates/tools/nie-site/src/config.rs`). Asking for
more returns 200 **without an error**, and the response only says so through `pages`/`per_page`.

Two consumers written on 2026-09-12 were already clipped: `menu_text` gave 200 lines of 2 755,
and `/api/v1/lua/scripts?q=chara_edit` 50 scripts of 51 — so an avatar-editor screen replayed
without one of its own. A client MUST read `pages` and fetch the rest; a fixed `per_page` is a bug
waiting for the corpus to grow.

## Deployment

The vhost and the units are owned by aphrody-infra: `../aphrody-infra/nginx/aphrody/aphrody.com.conf`
and `../aphrody-infra/systemd/nie-site.service`, `nie-model-serve.service`. Installing them into
`/etc`, `daemon-reload`, `nginx -t` and `reload` follow the aphrody-infra runbook. The installed
files drift — `diff` against `/etc` and run `ss -ltnp` before changing one.

Host and port map: aphrody-infra `config/service-catalog.json` and `config/nginx-routes.json`
(pointer in [`HOSTS-AND-PORTS.md`](HOSTS-AND-PORTS.md)). It wins over any plan that says otherwise.
