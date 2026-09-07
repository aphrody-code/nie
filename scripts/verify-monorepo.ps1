Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Gate([string]$Name, [scriptblock]$Command) {
    Write-Host "== $Name =="
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Invoke-Gate 'cargo fmt check' { cargo fmt --all --check }
Invoke-Gate 'cargo check workspace tests' { cargo check --workspace --tests }
Invoke-Gate 'cargo clippy workspace' { cargo clippy --workspace --all-targets -- -D warnings }
Invoke-Gate 'cargo test workspace' { cargo test --workspace --tests }
Invoke-Gate 'bun typecheck' { bun run typecheck }
Invoke-Gate 'bun test' { bun run test }
Invoke-Gate 'docs check' { bun run docs:check }

Write-Host 'verify-monorepo=OK'
