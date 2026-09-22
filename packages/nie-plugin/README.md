# Module interne de préchargement Bun

Repo-scoped Bun loaders for nie game formats and reverse-engineering resources.

Install `@aphrody/nie` and build the native `nie-ffi` library first. Set `NIE_ROOT` to the
nie checkout; this keeps VFS, Lua and reverse-engineering resource lookup inside that checkout.
The repository's shell hook performs this activation only while the current directory belongs to
the checkout.

```toml
# bunfig.toml
preload = ["nie-plugin/register"]
```

No game data is included in the npm package.
