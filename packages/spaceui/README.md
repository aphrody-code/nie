# @aphrody/spaceui

Public SpaceUI integration for Inacord. It preserves the SpaceUI primitive API
and maps its semantic styling roles to the measured NIE/Aphrody tokens. It does
not define an independent application palette.

## Usage

```tsx
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@aphrody/spaceui";
import "@aphrody/spaceui/styles.css";
```

The zero-JavaScript download hub can import the smaller static stylesheet:

```css
@import "@aphrody/spaceui/tokens.css";
@import "@aphrody/spaceui/homepage.css";
```

Exports:

- `@aphrody/spaceui`: SpaceUI primitives and Inacord compatibility facades.
- `@aphrody/spaceui/tokens`: typed token values.
- `@aphrody/spaceui/tokens.css`: runtime NIE/Inacord and SpaceUI semantic variables.
- `@aphrody/spaceui/theme.css`: Tailwind v4 theme registration.
- `@aphrody/spaceui/styles.css`: token and Tailwind theme entrypoint.
- `@aphrody/spaceui/homepage.css`: minimal static homepage classes.

## Provenance

Vendored integration source: `aphrody-code/spaceui` commit
`d9983febdf20ca9eb47e7ebd21d5598a8b5d3e36`, forked from
`spacedriveapp/spaceui` under the MIT license. See `NOTICE` and `LICENSE`.
