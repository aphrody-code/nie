# `@nie/plugin` — repository Bun preloads

Workspace-only package (`private`), never published. It holds the two files `bunfig.toml`
preloads for every `bun` command run from the repository root:

| File | Preloaded by | Role |
| --- | --- | --- |
| `src/register.ts` | `preload` and `[test].preload` | `Bun.plugin` loaders: `.g4tx` → PNG bytes, `.cfg.bin` / `.objbin` / `.g4pkm` / `.lip` / `.p3lip` / `.mev` / `.mevbin` / `.g4md` → decoded JSON, plus the `nie:re/*` namespace for the bundler |
| `src/happydom.ts` | `[test].preload` | happy-dom DOM globals for UI tests, with Bun's native `fetch` family restored |

`src/index.ts` re-exports the `@aphrody/nie` API and adds `loadRe` / `loadLuaScript` for
`data/re/*.json` and `data/lua_scripts/*`.

**Registering needs no native library.** The loaders import `@aphrody/nie` on the first game
file they decode, and `@aphrody/nie` itself opens `iecode` on its first native call. Without the
library, `bun run typecheck`, `docs:check`, `lint` and every test that imports no game file run
normally; importing a `.g4tx` fails with `NativeLibraryError`, which names the build command
(`bun run build:ffi`, or the windows-gnu recipe on a Windows host without MSVC).

`NIE_ROOT` overrides the checkout root used for `data/re` and `data/lua_scripts`; by default it is
three levels above `src/`. For the bundler, the plugin is the default export of `register.ts`:

```ts
await Bun.build({ entrypoints, plugins: [(await import("@nie/plugin/register")).default] });
```

No game data ships with this package: `data/` is gitignored.
