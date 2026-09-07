# PowerShell Universal Autopilot Loop
# Cross-engine & cross-repo background daemon for autonomous agent pairs (Claude Code + Gemini CLI / Antigravity)
# Saves PID to var/run/autopilot.pid, heartbeats to .coord/heartbeat.txt (or var/heartbeat.txt), logs to var/log/autopilot.jsonl

param(
    [int]$Interval = 60,
    [int]$MaxTicks = 0,
    [switch]$Once,
    [string]$PlanPath = ""
)

# 1. Resolve repo root
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Get-Item (Join-Path $scriptPath "..")).FullName
if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
    $repoRoot = (Get-Item (Join-Path $scriptPath "..\..")).FullName
}
Set-Location $repoRoot

$runDir = Join-Path $repoRoot "var/run"
$logDir = Join-Path $repoRoot "var/log"
$coordDir = Join-Path $repoRoot ".coord"
if (-not (Test-Path $coordDir)) {
    $coordDir = Join-Path $repoRoot "var"
}

New-Item -ItemType Directory -Force -Path $runDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $coordDir | Out-Null

# Write current PID
$pidFile = Join-Path $runDir "autopilot.pid"
$MyProcessId = $PID
$MyProcessId | Out-File -FilePath $pidFile -Encoding utf8 -Force

$logFile = Join-Path $logDir "autopilot.jsonl"
$heartbeatFile = Join-Path $coordDir "heartbeat.txt"

# Detect plan file dynamically if not supplied
if (-not $PlanPath -or -not (Test-Path $PlanPath)) {
    $planCandidates = @("docs/PLAN.md", "UNIFIED-PLAN.md", "PLAN.md", "TODO.md", "tasks.md")
    foreach ($cand in $planCandidates) {
        $candidatePath = Join-Path $repoRoot $cand
        if (Test-Path $candidatePath) {
            $PlanPath = $candidatePath
            break
        }
    }
}

Write-Host "=== Universal Autonomous Autopilot Started (PID: $MyProcessId) ==="
Write-Host "Repository : $repoRoot"
Write-Host "Plan File  : $(if ($PlanPath) { $PlanPath } else { 'Direct Prompt / None' })"
Write-Host "Log Target : $logFile"

if ($Once) {
    $MaxTicks = 1
}

$tick = 0

while ($true) {
    $tick++
    if ($MaxTicks -gt 0 -and $tick -gt $MaxTicks) {
        Write-Host "Reached maximum ticks ($MaxTicks). Stopping."
        break
    }

    Write-Host "`n--- Tick $tick (Interval: ${Interval}s) ---"

    # Discover pending task
    $task = "Continuous autonomous maintenance & verification"
    if ($PlanPath -and (Test-Path $PlanPath)) {
        $lines = Get-Content $PlanPath
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if (($trimmed.StartsWith("-") -or $trimmed.StartsWith("*")) -and ($trimmed.Contains("⏳") -or $trimmed.Contains("[ ]"))) {
                $idx = $line.IndexOf("⏳")
                if ($idx -lt 0) { $idx = $line.IndexOf("[ ]") }
                if ($idx -ge 0) {
                    $rawTask = $line.Substring($idx + 3)
                    $task = $rawTask.Replace('`', '').Trim()
                    if ($task.StartsWith("]")) { $task = $task.Substring(1).Trim() }
                    break
                }
            }
        }
    }

    $timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
    Write-Host "Active Task: $task"

    # Write Heartbeat
    "$timestamp - Tick $tick - $task" | Out-File -FilePath $heartbeatFile -Encoding utf8 -Force

    # Detect test commands
    $verifyCmd = "git status"
    if (Test-Path (Join-Path $repoRoot "Cargo.toml")) {
        $verifyCmd = "cargo check --workspace --all-targets && cargo test"
    } elseif (Test-Path (Join-Path $repoRoot "package.json")) {
        $verifyCmd = "bun test"
    } elseif (Test-Path (Join-Path $repoRoot "pyproject.toml")) {
        $verifyCmd = "pytest"
    } elseif (Test-Path (Join-Path $repoRoot "go.mod")) {
        $verifyCmd = "go test ./..."
    }

    # 1. Lead Developer Lane (Claude Code / Antigravity / Agent)
    Write-Host "Executing Lead Developer Lane..."
    $claudeOutput = ""
    try {
        $prompt = "You are an autonomous developer agent operating in full YOLO mode. Implement this task end-to-end: '$task'. Modify files as needed. Verify that '$verifyCmd' passes cleanly. Create a clean atomic git commit. Zero confirmation pauses."
        
        $claudeRes = Start-Job -ScriptBlock {
            param($p, $root)
            Set-Location $root
            if (Get-Command "claude" -ErrorAction SilentlyContinue) {
                claude -p $p --dangerously-skip-permissions
            } elseif (Get-Command "gemini" -ErrorAction SilentlyContinue) {
                gemini --prompt $p
            } else {
                Write-Host "No autonomous CLI found (claude/gemini) on PATH."
            }
        } -ArgumentList $prompt, $repoRoot
        
        $waitRes = Wait-Job $claudeRes -Timeout 300
        $claudeOutput = Receive-Job $claudeRes
        Remove-Job $claudeRes
    }
    catch {
        $claudeOutput = "Err: $_"
    }

    # 2. Independent Auditor Lane (Gemini / Antigravity CLI)
    Write-Host "Executing Independent Auditor Lane..."
    $geminiOutput = ""
    try {
        $auditPrompt = "Perform an independent review of the most recent git commit in this repository ($repoRoot). Check security, architecture, code quality, and potential regressions. Output a concise JSON summary with status 'PASS' or 'FAIL'."
        
        $geminiRes = Start-Job -ScriptBlock {
            param($ap, $root)
            Set-Location $root
            if (Get-Command "gemini" -ErrorAction SilentlyContinue) {
                gemini --prompt $ap
            } elseif (Get-Command "claude" -ErrorAction SilentlyContinue) {
                claude -p $ap --dangerously-skip-permissions
            } else {
                Write-Host "Auditor CLI unavailable."
            }
        } -ArgumentList $auditPrompt, $repoRoot
        
        $waitGemini = Wait-Job $geminiRes -Timeout 300
        $geminiOutput = Receive-Job $geminiRes
        Remove-Job $geminiRes
    }
    catch {
        $geminiOutput = "Err: $_"
    }

    # Log entry
    $logEntry = @{
        ts = $timestamp
        tick = $tick
        task = $task
        lead = "$claudeOutput"
        auditor = "$geminiOutput"
    } | ConvertTo-Json -Compress
    $logEntry | Out-File -FilePath $logFile -Encoding utf8 -Append

    # Mark the task completed in plan if applicable
    if ($PlanPath -and (Test-Path $PlanPath) -and ($task -ne "Continuous autonomous maintenance & verification")) {
        $content = Get-Content $PlanPath
        $newContent = @()
        $marked = $false
        foreach ($line in $content) {
            if ($line -like "*$task*" -and -not $marked) {
                $lineUpdated = $line -replace "⏳", "✅"
                $lineUpdated = $lineUpdated -replace "\[ \]", "[x]"
                $newContent += $lineUpdated
                $marked = $true
                Write-Host "Updated task in $PlanPath."
            } else {
                $newContent += $line
            }
        }
        $newContent | Out-File -FilePath $PlanPath -Encoding utf8 -Force
    }

    if ($Once) { break }
    Start-Sleep -Seconds $Interval
}
