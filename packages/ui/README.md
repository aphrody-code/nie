# `@rosegriffon/ui` — Design System Rose Griffon

Composants partagés du monorepo `rose-griffon/rg`. Construit sur **shadcn/ui new-york** (Radix + Tailwind v4) avec une couche **Material Design 3** complète (tokens couleur, shape, motion, elevation, typescale) et **4 thèmes unifiés** prêts à l'emploi.

---

## Installation

Déjà câblé dans le monorepo via `workspace:*`. Pour une nouvelle app :

```jsonc
// apps/<app>/package.json
{
	"dependencies": {
		"@rosegriffon/ui": "workspace:*",
	},
}
```

Dans le `globals.css` de l'app :

```css
@import "tailwindcss";
@import "@rosegriffon/ui/styles.css"; /* tokens MD3 + 4 thèmes + utilities Tailwind */
```

Importer les composants :

```tsx
import { Button, Card, Dialog, Sheet } from "@rosegriffon/ui";
// ou par fichier :
import { Button } from "@rosegriffon/ui/button";
```

Importer les hooks :

```tsx
import { useIsMobile, useMediaQuery, useSwipe } from "@rosegriffon/ui";
```

---

## Thèmes (4)

| Classe               | Mode  | Seed               | Usage                     |
| -------------------- | ----- | ------------------ | ------------------------- |
| `theme-roy`          | light | bleu/doré          | personnage Inazuma Roy    |
| `theme-gaelle`       | light | vermillon/orange   | personnage Inazuma Gaelle |
| `theme-azalee-light` | light | `#F89C5A` (orange) | wiki Azalée par défaut    |
| `theme-azalee-dark`  | dark  | `#F89C5A` inversé  | wiki Azalée mode sombre   |

Application :

```tsx
// Static (layout React)
<html className="theme-azalee-light">

// Dynamique (next-themes)
import { ThemeProvider } from "next-themes";

<ThemeProvider attribute="class" themes={["theme-azalee-light", "theme-azalee-dark", "theme-roy", "theme-gaelle"]}>
  {children}
</ThemeProvider>
```

Chaque thème expose 35 tokens MD3 + 24 vars shadcn (pont automatique). Les composants shadcn héritent de la palette MD3 active.

---

## Tokens MD3 disponibles

### Couleurs (utilisables comme utilities Tailwind)

```tsx
<div className="bg-surface text-on-surface">
	<h2 className="text-primary">Titre</h2>
	<p className="text-on-surface-variant">Texte secondaire</p>
	<button className="bg-primary-container text-on-primary-container">Action</button>
	<span className="border border-outline-variant">Border subtle</span>
</div>
```

35 rôles disponibles : `primary`, `on-primary`, `primary-container`, `on-primary-container`, `secondary`, `on-secondary`, `secondary-container`, `on-secondary-container`, `tertiary`, `on-tertiary`, `tertiary-container`, `on-tertiary-container`, `error`, `on-error`, `error-container`, `on-error-container`, `background`, `on-background`, `surface`, `on-surface`, `surface-variant`, `on-surface-variant`, `outline`, `outline-variant`, `scrim`, `shadow`, `inverse-surface`, `inverse-on-surface`, `inverse-primary`, `surface-dim`, `surface-bright`, `surface-container-lowest`, `surface-container-low`, `surface-container`, `surface-container-high`, `surface-container-highest`.

### Shape scale

```tsx
<div className="rounded-(--md-sys-shape-corner-large)">
	rounded-extra-small (4px) · small (8px) · medium (12px) · large (16px) · extra-large (28px) · full
	(9999px)
</div>
```

### Motion

```tsx
<div
	className="transition-all"
	style={{
		transitionDuration: "var(--md-sys-motion-duration-medium2)", // 300ms
		transitionTimingFunction: "var(--md-sys-motion-easing-emphasized)",
	}}
/>
```

- **Durations** : `short1..4` (50/100/150/200), `medium1..4` (250/300/350/400), `long1..4` (450/500/550/600), `extra-long1..4` (700/800/900/1000)
- **Easings** : `standard`, `standard-accelerate`, `standard-decelerate`, `emphasized`, `emphasized-accelerate`, `emphasized-decelerate`

### Elevation

```tsx
<div className="bg-surface-container" style={{ boxShadow: "var(--md-sys-elevation-level2)" }} />
```

Levels 0 à 5 (none / 1dp / 3dp / 6dp / 8dp / 12dp).

### Typescale (15 rôles M3)

```tsx
<h1 className="type-display-large">57px · weight 400</h1>
<h2 className="type-headline-medium">28px · weight 400</h2>
<p className="type-body-large">16px · letter-spacing 0.5px</p>
<span className="type-label-small">11px · weight 500</span>
```

### State layer

```tsx
<button className="state-layer bg-primary-container">
	Hover/focus/press overlay automatique (8% / 12% / 12%)
</button>
```

---

## Composants (55+)

### Foundations

`Button` · `Card` · `Badge` · `Separator` · `Skeleton` · `Spinner`

### Forms

`Input` · `Textarea` · `Label` · `Checkbox` · `RadioGroup` · `Switch` · `Slider` · `Select` · `InputOTP` · `Form` · `Field` · `InputGroup` · `ButtonGroup`

### Navigation

`Tabs` · `Pagination` · `PaginationControls` · `Breadcrumb` · `NavigationMenu` · `Menubar` · `Sidebar`

### Overlays

`Dialog` · `AlertDialog` · `Sheet` · `Drawer` · `Popover` · `HoverCard` · `Tooltip` · `DropdownMenu` · `ContextMenu` · `ResponsiveDialog`

### Data

`Table` · `Avatar` · `Calendar` · `Chart` · `Command`

### Feedback

`Alert` · `Toaster` (sonner + next-themes) · `Progress`

### Layout

`Accordion` · `Collapsible` · `ScrollArea` · `AspectRatio` · `Resizable` · `Carousel` · `Empty` · `Item` · `Kbd`

### Hooks

`useIsMobile` · `useMediaQuery` · `useSwipe`

Tous les composants suivent le pattern moderne shadcn :

- Function components (pas `forwardRef`)
- `data-slot` attribute pour styling global ciblé
- Focus-visible cohérent : `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden`
- `React.ComponentProps<typeof X>` pour types

---

## Accessibility

- **Touch targets** ≥ 44px (Button, Checkbox, RadioGroup, Slider thumb)
- **Focus visible** systématique avec ring 3px coloré
- **ARIA** : `role="alert"` + `aria-live="polite"` sur Alert ; `aria-current="page"` sur Pagination active ; `sr-only` pour labels invisibles ; Radix gère focus trap + escape sur Dialog/Sheet/Drawer
- **`prefers-reduced-motion`** : à respecter manuellement dans les apps consommatrices (utiliser `motion-safe:` / `motion-reduce:` variants Tailwind)

---

## Tailwind v4 idioms

- `@import "tailwindcss"` (pas `@tailwind base/components/utilities`)
- Config inline via `@theme inline` (pas de `tailwind.config.ts`)
- `outline-hidden` (pas `outline-none` v3)
- `shrink-*` / `grow-*` (pas `flex-shrink-*` / `flex-grow-*`)
- `bg-linear-to-r` (pas `bg-gradient-to-r`)
- `size-X` quand height = width
- CSS vars en `bg-(--var)` (pas `bg-[--var]`)
- Container queries `@container` natives (pas de plugin)

---

## Migration depuis copies locales d'apps

Les apps `website` et `azalee` ont des copies locales de certains composants UI. Pour migrer vers `@rosegriffon/ui` :

1. Supprimer `apps/<app>/src/components/ui/<comp>.tsx`
2. Remplacer `import { Comp } from "@/components/ui/comp"` par `import { Comp } from "@rosegriffon/ui"`
3. Vérifier le rendu (les composants `@rosegriffon/ui` peuvent avoir une API légèrement différente — voir audit `docs/ui-audit-2026-05-17.md`)

---

## Audits

- `docs/ui-audit-2026-05-17.md` — audit composants UI (avant modernisation)
- `docs/typescript-audit-2026-05-17.md` — audit TS du package

---

## Stack

- **Radix UI** primitives (a11y headless)
- **Tailwind CSS v4.3** (utilities + tokens MD3)
- **class-variance-authority** (variants typés)
- **clsx** + **tailwind-merge** via `cn()` helper
- **lucide-react** (icônes)
- **sonner** + **next-themes** (toaster theming-aware)
- **vaul** (drawer iOS-like)
- **embla-carousel-react** (carousel)
- **react-day-picker** (calendar)
- **react-hook-form** (form)
- **recharts** (chart)
- **input-otp** (OTP input)
- **react-resizable-panels** (resizable)
