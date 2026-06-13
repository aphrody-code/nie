# Explorateur /cpk — concept UI (Material 3 / Google Drive, virtualisé)

Cible : transformer `/cpk` en **vrai file manager** façon Google Drive, en **Material 3 / M3
Expressive**, capable de tenir les **250 800 fichiers** du VFS. Valeurs M3 sourcées depuis
`m3.material.io` (recherche 2026-06-13). Tokens M3 déjà présents dans azalee.

## Choix techniques

- **Arbre de navigation** : **react-arborist** (MIT, v3.10.4) — virtualisé (react-window), donc
  tient 250k nœuds. Lazy par dossier via **données contrôlées + `onToggle` → `/api/cpk?path=`**
  (les enfants d'un nœud sont fetchés à l'ouverture ; `childrenAccessor` renvoie `[]`/`null` tant
  que non chargé). Apporte drag-drop, multi-sélection, rename inline, clavier, recherche.
- **Rejeté** : `react-file-manager` (Saifullah-dev, MIT) — pas de virtualisation/lazy, charge tout
  le tableau `files` → freeze sur 250k. `rc-tree` (loadData lazy natif + virtual) = repli si
  arborist pose souci, mais arbre plus nu.
- **Viewers** : on **garde** `CpkFilePreview` (texture/modèle/audio/vidéo décodés in-browser wasm
  + routes serveur) comme panneau de détail.

## Layout — canonical M3 *list-detail* + *supporting pane*

`m3.material.io` cite explicitement « file browser + open folder » comme cas du **list-detail**.
Trois zones, adaptatives par window-size-class :

| Breakpoint | Largeur | Panneaux | Navigation |
|---|---|---|---|
| Compact | <600dp | 1 (liste **ou** détail, back en mode détail) | barre de nav en bas |
| Medium | 600–839 | 1–2 | modal nav rail étendu |
| Expanded | 840–1199 | **2** (arbre + liste/détail) | nav rail standard visible |
| Large/XL | 1200+ | **3** (arbre + liste + panneau détails) | nav rail standard |

- **Colonne gauche** (arbre dossiers) = **expanded navigation rail** M3 Expressive (le navigation
  drawer est déprécié/absorbé) — fond `surface container`.
- **Zone centrale** = liste/grille du dossier courant.
- **Colonne droite** = **supporting pane** (~1/3) = détails + preview du fichier sélectionné.
- L'état « sélectionné » dans la liste ne s'affiche qu'en mode 2-panes.

## Liste vs grille (toggle dans la top app bar)

**List item** (M3 specs/lists) : cible interactive 48dp ; label pad gauche 16dp ; leading 16dp ;
trailing pad droite 24dp ; hauteurs 1/2/3 lignes ≈ **56/72/88dp** (align top dès ≥88dp).
- Leading : icône typée (24dp) ou thumbnail (image/vidéo ~40dp).
- Content : nom (label) + taille·date (supporting text).
- Trailing : menu ⋮, ou checkbox en multi-sélection.

**Grille** (M3 specs/cards) : tuile = **elevated card**, fond `surface container low`, **corner
radius 12dp**, padding 16dp, gap ≤8dp. Thumbnail en haut, label + date dessous.

Toggle liste/grille = **segmented buttons** (ou icon buttons) en trailing de la top app bar.

## Barre supérieure & sélection

- **Search app bar** M3 Expressive : recherche globale (champ interne `surface container highest`),
  trailing = toggle vue + tri ; ouvre un search view modal.
- Top app bar : container `surface` au repos → `surface container` au scroll ; titre `on surface` ;
  icônes `on surface variant`.
- **Multi-sélection** : swap la top app bar vers une **floating toolbar** M3 Expressive (compteur +
  actions : Télécharger, Copier chemin, Déplacer…). Ne pas coexister avec une nav bar.

## Interactions — state layers (opacités EXACTES)

| État | Opacité state layer |
|---|---|
| Hover | **8 %** (0.08) |
| Focus / Press | **10 %** (0.10) |
| Drag | **16 %** (0.16) |
| Disabled | 38 % sur le contenu |

Couleur du state layer = couleur « on » du container. Pendant un drag, élever l'élément (+4/+5).
Menu contextuel (clic droit) = **M3 Menu** (fond `surface container`, items = list items 48dp).
Breadcrumb : pas un composant M3 nommé → text buttons en row (ou filter chips).

## Couleur & élévation (rôles M3)

| Zone | Token |
|---|---|
| Fond contenu | `surface` |
| Nav rail / panneau latéral | `surface container` |
| Tuiles grille (elevated) | `surface container low` |
| Menu | `surface container` (élévation +2) |
| **Fichier sélectionné** | container `primary container` / texte `on primary container` |
| Dividers | `outline variant` |

Hiérarchie imbriquée : `surface` → `surface container low` → `surface container` →
`…high` → `…highest`. Élévation : différence tonale d'abord ; cards = +1, menus = +2, dialogs = +3.

## Spécifique Drive (reconnaissable, **non** canon Google)

Icônes typées par format, densité liste compacte, preview inline dans le panneau de détails,
breadcrumb de chemin : présents dans Drive mais **non documentés** sur les sources Google — à
implémenter au jugé, cohérents avec les tokens ci-dessus.

## Plan d'implémentation (priorisé)

1. ✓ **FAIT** — `react-arborist` installé ; `CpkTree` virtualisé + lazy `onToggle` → `/api/cpk`
   (`lib/cpk/tree.ts` : nœuds lazy, sentinelle `__loading__`, `fetchChildren`/`setChildren`).
2. ✓ **FAIT** — `CpkExplorer` 2-panes list-detail ; nav rail `surface container`, détail `surface` ;
   page `/cpk` rend l'explorateur (deep-link `/cpk/<path>` → preview + sync URL `history`).
3. ✓ **FAIT** (partiel) — sélection `primary container` / `on primary container` ; hover state-layer
   `on-surface/8 %`. (Focus 10 % / drag 16 % : à compléter.)
5. ✓ **FAIT** — `CpkFilePreview` branché dans le panneau détail (viewers wasm natifs).
7. ✓ **FAIT** — icônes typées par extension + breadcrumb text-buttons + **auto-reveal** de l'arbre
   vers le fichier deep-linké (`TreeApi.scrollTo`/`open`/`select`).
4. ✓ **FAIT** — toggle **liste/grille** (segmented) ; vue grille = elevated cards 12dp
   `surface container low` + thumbnails ; `CpkFolderView` (tri nom/type, « afficher plus »).
6. ✓ **FAIT** — **search app bar** (recherche GLOBALE serveur `searchFiles`/`/api/cpk?q` sur les
   250 800 fichiers) + **floating toolbar M3** de multi-sélection (arborist `onSelect`).
8. ✓ **FAIT** — **onglets** de dossiers (cosmic-files) ; **tri** nom/type (filebrowser).

### ✓ FAIT — robustesse & binaires opaques

- **Binaires non-cfg.bin** (`.bin`/`.objbin`/`.fxbin`/`.mevbin`, ~83k fichiers) : le viewer config
  retombe sur un **aperçu hexadécimal** au lieu du cul-de-sac « Décodage indisponible ».
- **Service `nie-model-serve`** : `Restart=always` (reprenait pas sur exit propre — le cache CPK
  en RAM saturait, exit 0 à ~14,7 G) + budget cache abaissé à **8 GiB** (drop-in `memory.conf`).
  Sans ça, tout fichier **non caché par le CDN** renvoyait 502 (« indisponible peu importe le format »).

Sources : m3.material.io — window-size-classes, canonical-examples/list-detail, components/{lists,
cards,navigation-rail,top-app-bar,toolbars}/specs, foundations/interaction/states/state-layers,
styles/{color/roles,elevation}.

## Références file-manager externes (patterns à reprendre)

| Projet | Stack / licence | Ce qu'on en retient |
|---|---|---|
| **COSMIC Files** (pop-os) | Rust / libcosmic·iced — **GPLv3** (patterns seulement, pas de code) | **Onglets** (plusieurs dossiers ouverts), sidebar + breadcrumb, toggle liste/grille, multi-sélection + actions par lot, menu contextuel, drag-drop, recherche+preview. → ajouter les **onglets** au plan. |
| **Filebrowser** | Go + Vue, Material Design — **Apache-2.0** (réutilisable) | Valide notre archi : **abstraction VFS** (`/api/cpk`), **routing par content-type** (`CpkFilePreview` par `previewKind`), **liens partageables** (déjà via routes `/cpk/<path>`), **tri** (à ajouter), preview multi-format. |
| **Bun File I/O** | `Bun.file()` lazy, `.stream()`, Blob `.slice()` | **Streaming + HTTP Range** pour gros fichiers → a motivé le **support Range / 206** côté `nie-model-serve` (ci-dessous). Côté azalee (Bun) : `Bun.file().stream()` pour tout service local. |

### ✓ FAIT — HTTP Range (seek audio/vidéo)

`nie-model-serve` honore désormais `Range: bytes=…` sur `/audio` et `/video` : **206 Partial
Content** + `Content-Range` + `Accept-Ranges: bytes` (corps déjà décodé en mémoire → slice
immédiat). Vérifié de bout en bout via le CDN. Débloque le **scrub de la timeline** vidéo/audio
(avant : 200 complet, pas de seek).

### Ajouts au plan

8. **Onglets** de dossiers (COSMIC).
9. **Tri** (nom / taille / date / type) + **liens partageables** explicites (Filebrowser).
10. Service de fichiers local éventuel côté azalee : `Bun.file().stream()` + Range.
