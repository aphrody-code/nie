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
