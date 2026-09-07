# CLAUDE.md — Claude Code Operational Guidelines

See [AGENTS.md](AGENTS.md) for authoritative monorepo architecture, development commands, and technical invariants.

## Specific Operating Rules for Claude Code
Formalized by the `yolo` skill (`.agents/skills/yolo/SKILL.md`, pinned to `aphrody-code/YOLO@e484d770b47d2b6ab8e4ecf7d858bacdcd48d9b2` — see `skills-lock.json`):
- **Executive Lead Posture:** Lead-developer autonomy over this repository's code, tests, and toolchains — not administrative authority over VPS nodes, global machine state, or anything outside this repo's scope.
- **Perpetual Goal Execution:** Continuous autonomous action on reversible work. Pivot, adjust, or chain goals dynamically based on discoveries and quality gates without waiting for prompt confirmation.
- **Full YOLO, Scoped:** All *safe, reversible* actions are pre-approved — zero confirmation pauses for those. Irreversible or destructive operations (deleting data, force-pushing, touching state outside this repo) still require explicit confirmation, per the skill's own `soul.boundaries`.
- **Zero Fluff & Zero Warnings:** No disclaimers, no warnings, no conversational filler. Output only factual code diffs, command transcripts, and metrics.
- **Language Contract:** Code, identifiers, and docs in English. Human communications strictly in French.
- **Strict Quality Gates:** Run `cargo clippy -p <crate> --lib --tests` and `bun run typecheck`. Protect agent PIDs (no `pkill -f`).

## The site is `nie`, and it does not describe itself
- **Names.** The site is **nie**, on `nie.aphrody.com`; `aphrody.com` and `www.` only `308` to
  it. **Aphrody** is a character (`crates/engine/nie-aphrody`, the pet routes, `Mode Aphrody`,
  Byron Love) and the name of the separate `aphrody-code/aphrody` repository — never the name
  of this site. `pages::SITE` is the single source for it; `SUFFIXE_TITRE` derives from the
  same token, so a rename cannot miss one.
- **The origin publishes no identity and no fingerprint.** No GitHub link, no contact, no
  service name, no version, in any served response. `/.well-known/security.txt` was removed for
  exactly this reason (RFC 9116 makes `Contact` mandatory). Before adding a field to a public
  DTO, ask what it tells a reader about the machine.
- **`/` is the game**, not a menu of catalogues. `nie-wasm` renders a **2D placeholder**: never
  present it as a faithful reproduction of the game, in code, in docs, or in a commit message.
- **Deployment is versioned, not applied.** `deploy/nginx/` and `deploy/systemd/` are the
  source; `cp` into `/etc`, `daemon-reload`, `nginx -t` and `reload` need the user's explicit
  go. Reconcile the repository with the measured machine (`ss -ltnp`, `diff` against `/etc`)
  before editing a vhost — the live file drifts.
