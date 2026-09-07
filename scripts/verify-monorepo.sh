#!/usr/bin/env bash
set -euo pipefail

gate() {
  printf '== %s ==\n' "$1"
  shift
  "$@"
}

gate 'cargo fmt check' cargo fmt --all --check
gate 'cargo check workspace tests' cargo check --workspace --tests
gate 'cargo clippy workspace' cargo clippy --workspace --all-targets -- -D warnings
gate 'cargo test workspace' cargo test --workspace --tests
gate 'bun typecheck' bun run typecheck
gate 'bun test' bun run test
gate 'docs check' bun run docs:check
printf 'verify-monorepo=OK\n'
