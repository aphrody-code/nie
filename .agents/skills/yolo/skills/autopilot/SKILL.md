---
name: autopilot
description: "Launch the universal autopilot loop — dual-agent autonomous background daemon (Lead Developer + Independent Auditor) piloting any repository infinitely with zero human in the loop. Dispatches scripts/autopilot.ps1 or scripts/autopilot.sh in the background, continuously ingesting tasks from the project's plan, executing implementations and verification gates, logging NDJSON, and maintaining heartbeats."
license: MIT
metadata:
  version: "3.1.0"
  category: "Autonomous Orchestration"
---

# Universal Autopilot — Dual-Agent Infinite Execution Loop

Mode `/goal` permanent : objectif persistant, zéro confirmation, le loop ne s'arrête jamais seul.

The autopilot is a background loop that pilots any repository end-to-end. Two autonomous lanes run concurrently every tick:

- **Lead Developer Lane** (Claude Code / Antigravity / Gemini CLI): Picks the highest-leverage actionable item from the detected roadmap or plan file (`docs/PLAN.md`, `PLAN.md`, `TODO.md`), implements the change, runs automated validation gates, and commits cleanly.
- **Independent Auditor Lane**: Audits the recent commit, checks against quality/security anti-patterns, evaluates cross-platform stability, and produces a strict JSON verification report.

The loop keeps running until killed via PID (`kill $(cat var/run/autopilot.pid)` or PowerShell `Stop-Process`).

## How to Launch

The daemon provides full Bash and PowerShell 7+ parity across Linux, macOS, and Windows.

```powershell
# Windows PowerShell (7+)
pwsh scripts/autopilot.ps1                              # infinite loop
pwsh scripts/autopilot.ps1 -Once                        # single tick (test/debug)
pwsh scripts/autopilot.ps1 -Interval 30 -MaxTicks 50    # custom interval and tick bound
```

```bash
# Linux / macOS
bash scripts/autopilot.sh                               # infinite loop
bash scripts/autopilot.sh --once                        # single tick
bash scripts/autopilot.sh --interval 30 --max-ticks 50  # bounded
```

## Running as Background Daemon

```powershell
# Windows background launch
Start-Process pwsh -ArgumentList '-NoProfile','-File','scripts/autopilot.ps1' -WindowStyle Hidden
"Autopilot started, PID: $(Get-Content var/run/autopilot.pid)"
Get-Content var/log/autopilot.jsonl -Wait
```

```bash
# Linux / macOS background launch
nohup bash scripts/autopilot.sh > /dev/null 2>&1 &
echo "Autopilot started, PID: $(cat var/run/autopilot.pid)"
tail -f var/log/autopilot.jsonl
```

## Outputs

| Path | Description |
|---|---|
| `var/log/autopilot.jsonl` | Append-only NDJSON recording timestamp, tick index, active task, and outputs from both lanes. |
| `var/run/autopilot.pid` | PID of the background loop process. |
| `.coord/heartbeat.txt` | ISO-8601 heartbeat timestamp and current task for A2A peers. |

## Stop Conditions

- **Windows**: `Stop-Process -Id (Get-Content var/run/autopilot.pid)`
- **Unix**: `kill $(cat var/run/autopilot.pid)`
