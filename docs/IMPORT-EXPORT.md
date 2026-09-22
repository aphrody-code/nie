# Portable workspace transfer

`workspace-transfer.ts` moves the maintainable workspace layer between checkouts. It is
deliberately independent of the repository's absolute path and never copies game data, ROMs,
build output, caches, credentials or generated `var/` content.

## Export

From the repository root:

```sh
NIE_REPO_ROOT="$PWD" bun scripts/workspace-transfer.ts export \
  --output /tmp/nie-workspace-transfer
```

The default export includes the agent contract, plan, documentation, reusable scripts, deployment
source and root manifests. Pass additional allow-listed roots after the options to make a smaller
transfer, for example `docs scripts deploy`. The command writes every selected file and a
`manifest.json` containing its relative path, byte count and SHA-256 digest.

## Import

Always inspect the manifest first, then run the hash-checked dry run:

```sh
bun scripts/workspace-transfer.ts import \
  --manifest /tmp/nie-workspace-transfer/manifest.json \
  --root "$PWD" --dry-run
bun scripts/workspace-transfer.ts import \
  --manifest /tmp/nie-workspace-transfer/manifest.json \
  --root "$PWD"
```

Import accepts only relative paths under the portable allow-list. It rejects traversal, absolute
paths, generated directories, game assets and secret-like files. Every source is checked against
the manifest before writing. The destination root is selected by `--root` or `NIE_REPO_ROOT`; no
path connecting IECODE and NIE/NIE is embedded in the tool.

This is a source/config transfer, not a release publisher. Run the normal lint, typecheck, tests,
Rust checks and release gates after importing. Do not put copyrighted game dumps in the transfer.
