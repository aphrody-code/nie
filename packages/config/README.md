# @rosegriffon/config

Presets de configuration partagés du monorepo rose-griffon : `tsconfig` (base / bun / nextjs),
preset `oxlint`, preset Tailwind. Consommé en interne via `workspace:*`.

```jsonc
// tsconfig.json
{ "extends": "@rosegriffon/config/tsconfig-bun.json" }
```
