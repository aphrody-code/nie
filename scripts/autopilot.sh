#!/usr/bin/env bash
# scripts/autopilot.sh
# Universal Autopilot — Dual-Agent Infinite Autonomous Grind for aphrody-code/nie (2026 stack)
# Continuous execution loop: Lead Agent + Independent Auditor + Automated Gates.

set -uo pipefail

INTERVAL="${AUTOPILOT_INTERVAL:-60}"
MAX_TICKS=0
ONCE=0
PLAN_FILE=""
DRY_RUN=0

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --interval) INTERVAL="$2"; shift ;;
        --max-ticks) MAX_TICKS="$2"; shift ;;
        --once) ONCE=1 ;;
        --plan) PLAN_FILE="$2"; shift ;;
        --dry-run) DRY_RUN=1 ;;
        *) echo "Unknown parameter passed: $1" >&2; exit 1 ;;
    esac
    shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 1

# Source repository environment (sccache, mold, Steam paths, atlas DB)
if [ -r "scripts/niers-env.sh" ]; then
    # shellcheck disable=SC1091
    . "scripts/niers-env.sh"
fi

mkdir -p var/run var/log .coord
MY_PID=$$
if [ "$DRY_RUN" -eq 0 ]; then
    echo "$MY_PID" > var/run/autopilot.pid
fi

LOG_FILE="var/log/autopilot.jsonl"
HEARTBEAT_FILE=".coord/heartbeat.txt"

# Detect plan file
if [ -z "$PLAN_FILE" ] || [ ! -f "$PLAN_FILE" ]; then
    for cand in "PLAN.md" "docs/PLAN.md" "docs/FORGE.md"; do
        if [ -f "$cand" ]; then
            PLAN_FILE="$cand"
            break
        fi
    done
fi

echo "=== Niers Autonomous Usine Autonome Started (PID: $MY_PID) ==="
echo "Repository : $REPO_ROOT"
echo "Plan File  : ${PLAN_FILE:-'Autonomous Atlas / None'}"
echo "Logging to : $LOG_FILE"

if [ "$ONCE" -eq 1 ]; then
    MAX_TICKS=1
fi

tick=0

while true; do
    tick=$((tick + 1))
    if [ "$MAX_TICKS" -gt 0 ] && [ "$tick" -gt "$MAX_TICKS" ]; then
        echo "Reached max ticks ($MAX_TICKS). Stopping."
        break
    fi

    echo -e "\n--- Tick $tick (Interval: ${INTERVAL}s) ---"

    # Find pending task
    task="Continuous autonomous maintenance, verification & RE atlas alignment"
    if [ -n "$PLAN_FILE" ] && [ -f "$PLAN_FILE" ]; then
        while IFS= read -r line; do
            trimmed="${line#"${line%%[![:space:]]*}"}"
            trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
            if [[ "$trimmed" == -* || "$trimmed" == \** ]] && [[ "$trimmed" == *"⏳"* || "$trimmed" == *"[ ]"* ]]; then
                if [[ "$line" == *"⏳"* ]]; then
                    task="${line#*⏳}"
                else
                    task="${line#*\[ \]}"
                fi
                task="${task//[\`\r]/}"
                task="${task#"${task%%[![:space:]]*}"}"
                task="${task%"${task##*[![:space:]]}"}"
                if [[ "$task" == \]* ]]; then
                    task="${task#]}"
                    task="${task#"${task%%[![:space:]]*}"}"
                    task="${task%"${task##*[![:space:]]}"}"
                fi
                break
            fi
        done < "$PLAN_FILE" || true
    fi

    timestamp=$(date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S%z")
    echo "Active Task: $task"

    # Write Heartbeat
    if [ "$DRY_RUN" -eq 0 ]; then
        echo "$timestamp - Tick $tick - $task" > "$HEARTBEAT_FILE"
    fi

    # Verification gate
    verify_cmd="cargo nextest run -p nie-pe -p nie-asm && bun run typecheck:scripts && bun run test:scripts"

    # Lead Lane (Agent Autonome)
    echo "Running Lead Lane..."
    lead_output=""
    prompt="You are an autonomous senior engineer operating on aphrody-code/nie in full YOLO mode. Objective: '$task'. Enforce English for code/commits, French for reports. Verify with: $verify_cmd. Zero confirmation pauses."

    if [ "$DRY_RUN" -eq 1 ]; then
        lead_output="Dry run: lead dispatch skipped."
    elif command -v agy >/dev/null 2>&1; then
        (agy -p "$prompt" --dangerously-skip-permissions --model gemini-3.8-flash-low) > /tmp/niers_lead.log 2>&1 &
        lead_pid=$!
        timeout_counter=0
        while kill -0 "$lead_pid" 2>/dev/null; do
            sleep 1
            timeout_counter=$((timeout_counter + 1))
            if [ "$timeout_counter" -ge 300 ]; then
                kill "$lead_pid" 2>/dev/null
                lead_output="Err: Timeout after 300s"
                break
            fi
        done
        if [ -z "$lead_output" ]; then
            lead_output=$(head -c 800 /tmp/niers_lead.log 2>/dev/null | tr -d '"\r\n')
        fi
    elif command -v claude >/dev/null 2>&1; then
        (claude -p "$prompt" --dangerously-skip-permissions) > /tmp/niers_lead.log 2>&1 &
        lead_pid=$!
        timeout_counter=0
        while kill -0 "$lead_pid" 2>/dev/null; do
            sleep 1
            timeout_counter=$((timeout_counter + 1))
            if [ "$timeout_counter" -ge 300 ]; then
                kill "$lead_pid" 2>/dev/null
                lead_output="Err: Timeout after 300s"
                break
            fi
        done
        if [ -z "$lead_output" ]; then
            lead_output=$(head -c 800 /tmp/niers_lead.log 2>/dev/null | tr -d '"\r\n')
        fi
    else
        # Local non-agent verification execution
        echo "Executing automated gate verification directly..."
        if eval "$verify_cmd" > /tmp/niers_verify.log 2>&1; then
            lead_output="Gate verification PASSED"
        else
            lead_output="Gate verification FAILED: $(head -n 5 /tmp/niers_verify.log | tr '\n' ' ')"
        fi
    fi

    # Auditor Lane
    echo "Running Auditor Lane..."
    auditor_output=""
    audit_prompt="Audit the most recent git commit in $REPO_ROOT. Verify zero-warning invariant, memory safety, and cross-platform integrity. Return JSON with status PASS or FAIL."
    if [ "$DRY_RUN" -eq 1 ]; then
        auditor_output="Dry run: audit dispatch skipped."
    elif command -v agy >/dev/null 2>&1; then
        auditor_output=$(agy -p "$audit_prompt" --dangerously-skip-permissions --model gemini-3.8-flash-low 2>&1 | head -c 800 | tr -d '"\r\n')
    elif command -v claude >/dev/null 2>&1; then
        auditor_output=$(claude -p "$audit_prompt" --dangerously-skip-permissions 2>&1 | head -c 800 | tr -d '"\r\n')
    else
        # Local auditor verification
        git status --short > /tmp/niers_git_status.log 2>&1
        auditor_output="Git status checked: $(head -n 3 /tmp/niers_git_status.log | tr '\n' ' ')"
    fi

    # Log entry
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "Dry run: no log entry written."
    elif command -v jq >/dev/null 2>&1; then
        jq -cn \
          --arg ts "$timestamp" \
          --argjson tick "$tick" \
          --arg task "$task" \
          --arg lead "$lead_output" \
          --arg auditor "$auditor_output" \
          '{ts: $ts, tick: $tick, task: $task, lead: $lead, auditor: $auditor}' >> "$LOG_FILE"
    else
        echo "{\"ts\":\"$timestamp\",\"tick\":$tick,\"task\":\"$task\"}" >> "$LOG_FILE"
    fi

    # Mark completed in plan if applicable
    if [ "$DRY_RUN" -eq 0 ] && [ -n "$PLAN_FILE" ] && [ -f "$PLAN_FILE" ] && [ "$task" != "Continuous autonomous maintenance, verification & RE atlas alignment" ]; then
        if command -v python3 >/dev/null 2>&1; then
            python3 -c "
import sys
content = open('$PLAN_FILE', 'r', encoding='utf-8').read()
if '$task' in content:
    content = content.replace('⏳ $task', '✅ $task', 1).replace('[ ] $task', '[x] $task', 1)
    open('$PLAN_FILE', 'w', encoding='utf-8').write(content)
"
        fi
    fi

    if [ "$ONCE" -eq 1 ]; then break; fi
    sleep "$INTERVAL"
done
