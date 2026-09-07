#!/usr/bin/env bash
# Bash Universal Autopilot Loop
# Cross-engine & cross-repo background daemon for autonomous agent pairs (Claude Code + Gemini CLI / Antigravity)
# Saves PID to var/run/autopilot.pid, heartbeats to .coord/heartbeat.txt (or var/heartbeat.txt), logs to var/log/autopilot.jsonl

INTERVAL=60
MAX_TICKS=0
ONCE=0
PLAN_FILE=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --interval) INTERVAL="$2"; shift ;;
        --max-ticks) MAX_TICKS="$2"; shift ;;
        --once) ONCE=1 ;;
        --plan) PLAN_FILE="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

# Resolve repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ ! -d "$REPO_ROOT/.git" ]; then
    REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
cd "$REPO_ROOT" || exit 1

# Setup run, log, and coord dirs
mkdir -p var/run var/log
COORD_DIR=".coord"
if [ ! -d "$COORD_DIR" ]; then
    COORD_DIR="var"
fi
mkdir -p "$COORD_DIR"

# Save PID
MY_PID=$$
echo "$MY_PID" > var/run/autopilot.pid

LOG_FILE="var/log/autopilot.jsonl"
HEARTBEAT_FILE="$COORD_DIR/heartbeat.txt"

# Detect plan file if not specified
if [ -z "$PLAN_FILE" ] || [ ! -f "$PLAN_FILE" ]; then
    for cand in "docs/PLAN.md" "UNIFIED-PLAN.md" "PLAN.md" "TODO.md" "tasks.md"; do
        if [ -f "$cand" ]; then
            PLAN_FILE="$cand"
            break
        fi
    done
fi

echo "=== Universal Autonomous Autopilot Started (PID: $MY_PID) ==="
echo "Repository : $REPO_ROOT"
echo "Plan File  : ${PLAN_FILE:-'Direct Prompt / None'}"
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
    task="Continuous autonomous maintenance & verification"
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
    echo "$timestamp - Tick $tick - $task" > "$HEARTBEAT_FILE"

    # Dynamic verify command
    verify_cmd="git status"
    if [ -f "Cargo.toml" ]; then
        verify_cmd="cargo check --workspace --all-targets && cargo test"
    elif [ -f "package.json" ]; then
        verify_cmd="bun test"
    elif [ -f "pyproject.toml" ]; then
        verify_cmd="pytest"
    elif [ -f "go.mod" ]; then
        verify_cmd="go test ./..."
    fi

    # Lead Lane (Claude / Antigravity / Agent)
    echo "Running Lead Lane..."
    lead_output=""
    prompt="You are an autonomous developer agent operating in full YOLO mode. Implement this task: '$task'. Modify files as needed. Verify with '$verify_cmd'. Commit cleanly. Zero confirmation pauses."

    if command -v claude >/dev/null 2>&1; then
        (claude -p "$prompt" --dangerously-skip-permissions) > /tmp/yolo_lead.log 2>&1 &
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
            lead_output=$(head -c 800 /tmp/yolo_lead.log 2>/dev/null | tr -d '"\r\n')
        fi
    elif command -v gemini >/dev/null 2>&1; then
        lead_output=$(gemini --prompt "$prompt" 2>&1 | head -c 800 | tr -d '"\r\n')
    fi

    # Auditor Lane (Gemini / Antigravity)
    echo "Running Auditor Lane..."
    auditor_output=""
    audit_prompt="Audit the most recent git commit in $REPO_ROOT. Verify security, code hygiene, and cross-platform compatibility. Return JSON with status PASS or FAIL."
    if command -v gemini >/dev/null 2>&1; then
        auditor_output=$(gemini --prompt "$audit_prompt" 2>&1 | head -c 800 | tr -d '"\r\n')
    elif command -v claude >/dev/null 2>&1; then
        auditor_output=$(claude -p "$audit_prompt" --dangerously-skip-permissions 2>&1 | head -c 800 | tr -d '"\r\n')
    fi

    # Log entry
    if command -v jq >/dev/null 2>&1; then
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
    if [ -n "$PLAN_FILE" ] && [ -f "$PLAN_FILE" ] && [ "$task" != "Continuous autonomous maintenance & verification" ]; then
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
