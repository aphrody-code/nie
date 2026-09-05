<!--
Rapatrié depuis aphrody-code/shenron le 2026-09-05, branche
`feat/completer-metadonnees-episodes-films` — le fichier n'est PAS sur `main`, ce qui explique
qu'un premier passage l'ait déclaré introuvable. Chercher un fichier dans un dépôt GitHub
suppose de balayer les branches : `gh api .../contents/<chemin>?ref=<branche>` pour chacune,
l'arbre récursif de HEAD ne montrant que la branche par défaut.

Le document décrit la chaîne SVG de shenron. Ce dépôt-ci produit aujourd'hui ses icônes
autrement — `crates/engine/nie-aphrody/src/assets.rs`, en Rust, depuis l'atlas du pet — donc
les deux approches coexistent plutôt qu'elles ne se remplacent : celle-ci vaut pour un dessin
vectoriel conçu comme tel, celle de la crate pour tout ce qui dérive du sprite.
-->

# Pipeline SVG — dépendances, chaîne de production, recette d'un nouveau dessin

Ce que le dépôt utilise réellement pour produire une image vectorielle : les
dépendances installées, les bibliothèques de géométrie et les composants qui les
consomment, la chaîne complète de la planche de référence au favicon déployé, et
une exécution de bout en bout sur une image d'exemple.

Doctrine du dessin : [`plugins/dragon-ball/skills/toriyama-svg/SKILL.md`](../plugins/dragon-ball/skills/toriyama-svg/SKILL.md).
Ce document-ci est l'inventaire, pas la méthode.

## 1. Dépendances

### Rastérisation et mesure

| Rôle | Outil | Où | Version mesurée |
|---|---|---|---|
| SVG → PNG/WebP/ICO, redimensionnement, composition, métadonnées | `sharp` | **`package.json` racine** (jamais dans `apps/site`) | 0.35.4, libvips 8.18.6 |
| Masque, k-means, HSL/OKLCH, profil de silhouette, épaisseur du trait | Pillow + numpy | système (`apt install python3-pil python3-numpy`) | Pillow 12.1.1, numpy 2.3.5 |
| Dessin raster côté bot (runtime Discord) | `@aphrody/canvas` | `apps/bot` | ^0.1.99 |
| Rendu d'image sociale (OG) | `next/og` (`ImageResponse`) | `apps/site` | Next 16 canary |

`sharp` vit dans le `node_modules` **racine** : l'installer depuis `apps/site`
dé-hoiste `next` et casse `deploy-site.ts` (cf. [`pieges.md`](pieges.md)).

### Ce qui n'est pas installé, et pourquoi

`inkscape`, `rsvg-convert`, `potrace`, `imagemagick`, `node-canvas`,
`scikit-learn`, `svgo`, aucune bibliothèque de favicons.

- La rastérisation est couverte par `sharp` seul, y compris l'ICO multi-tailles
  — un ICO n'est qu'un en-tête de 6 octets, une entrée de 16 octets par image et
  les PNG bout à bout : quinze lignes dans `genere-icones.ts`.
- `potrace` est volontairement absent : **on ne vectorise pas une planche**,
  c'est du décalque.
- `pip` et `ensurepip` n'existent pas sur ce VPS ; toute dépendance Python passe
  par `apt`, d'où le k-means écrit à la main.

### Bibliothèques de géométrie (le vrai « moteur » SVG)

Aucune dépendance : le vecteur est produit par des fonctions TypeScript qui
émettent des chaînes de `path`.

| Fichier | Contenu | Consommateurs |
|---|---|---|
| [`apps/site/src/lib/kinto-un.ts`](../apps/site/src/lib/kinto-un.ts) | `arcs`, `volute`, `corpsNuage`, `svgIllustration`, `svgIcone`, `svgMonochrome`, `KINTO_UN_COULEURS` | `KintoUn.tsx`, `genere-kinto-un.ts`, `genere-icones.ts`, `opengraph-image.tsx`, `couverture.ts` |
| [`apps/site/src/lib/couverture.ts`](../apps/site/src/lib/couverture.ts) | `anneauxCadre`, `bancNuage`, `etoilePath`, `anneauPastille`, `svgBancNuage` (importe `arcs`/`volute` de `kinto-un`) | `MotifsCouverture.tsx`, `genere-motifs-couverture.ts` |
| [`apps/site/src/lib/icones.ts`](../apps/site/src/lib/icones.ts) | `GEOMETRIES` — **76 glyphes** maison, `BOITE_ICONE` 24, `TRAIT_ICONE` 2, `svgIcone(nom)` | `Glyphe.tsx`, `rend-icones.ts` |
| [`plugins/dragon-ball/skills/toriyama-svg/scripts/geometrie.ts`](../plugins/dragon-ball/skills/toriyama-svg/scripts/geometrie.ts) | primitives à copier pour un **nouveau** sujet : `arcs`, `volute`, `meche`, `planDombre`, `trait`, `miroir`, `svg` | modèle, pas importé |

Règle qui tient tout : **une seule source de géométrie par sujet**, consommée à
la fois par le composant, le générateur de fichiers et le script d'icônes.
Sinon l'icône et l'illustration divergent au premier ajustement.

## 2. Interface — ce qui consomme du SVG

| Composant | Ce qu'il rend | Particularité |
|---|---|---|
| [`KintoUn.tsx`](../apps/site/src/components/KintoUn.tsx) | le nuage, variantes `illustration` (1200 × 648) et `icone` (512 carré) | SVG pur, 0 JS, server-safe ; préfixes d'id `kt-*`/`kti-*` pour que deux nuages ne se volent pas leur `clipPath` |
| [`icones/Glyphe.tsx`](../apps/site/src/components/icones/Glyphe.tsx) | les 76 glyphes maison | API calquée sur `lucide-react` (`size`, `strokeWidth`, `color`, `ref`), `aria-hidden` par défaut ; **83 fichiers** l'utilisent contre 34 encore sur `lucide-react` |
| [`DragonBall.tsx`](../apps/site/src/components/DragonBall.tsx) | la boule de cristal | dégradé à 10 arrêts, foyer mesuré à (−0,30 ; −0,39) R sur la couverture du tome 1 |
| [`MotifsCouverture.tsx`](../apps/site/src/components/MotifsCouverture.tsx) | étoile, cadre, pastille, banc de nuages | **mixte assumé** : SVG pour la forme, `box-shadow`/`radial-gradient` pour les couronnes (évite des ids dupliqués sur une grille), fichier statique répété pour la frise |
| [`home/KintoUnVolant.tsx`](../apps/site/src/components/home/KintoUnVolant.tsx) | le nuage animé de l'accueil | trois transformations sur trois nœuds imbriqués (défilement / survol / clic) |
| [`app/opengraph-image.tsx`](../apps/site/src/app/opengraph-image.tsx) | l'image sociale 1200 × 630 | `next/og` + `svgIllustration()` en data-URI |

Fichiers vectoriels versionnés — **5 seulement**, tous générés sauf le dernier :

```
apps/site/public/dbz/kinto-un.svg            illustration 1200 × 648
apps/site/public/dbz/kinto-un-icone.svg      icône carrée 512
apps/site/public/dbz/marque/banc-nuage.svg   tuile répétable
apps/site/public/safari-pinned-tab.svg       silhouette monochrome
deploy/filebrowser/branding/img/logo.svg     tiers (Filebrowser)
```

Un SVG n'est jamais édité à la main : on modifie la bibliothèque et on rejoue le
générateur.

## 3. La chaîne complète

```
   planche de référence            (corpus local ou curl avec UA navigateur)
        │
        │  python3 mesurer.py --teinte/--sombre/--boite
        ▼
   mesures.json + masque.png + decoupe.png      ← À REGARDER, pas seulement à lire
        │
        │  rédaction
        ▼
   docs/<sujet>-analyse-visuelle.md             ← tableau « décision → mesure »
        │
        │  écriture de la géométrie
        ▼
   apps/site/src/lib/<sujet>.ts                 ← SOURCE UNIQUE
        │
        ├── bun scripts/genere-<sujet>.ts       → public/**.svg
        │        │
        │        └── bun scripts/genere-icones.ts  → favicon.ico, PNG 16→512,
        │                                            apple-touch, maskable,
        │                                            mstile, logo bot
        ├── <Composant>.tsx                     → rendu serveur, 0 JS
        │
        └── bun rendu.ts <svg> --compare ref    → planches de contrôle /tmp
                 │
                 ▼
            bun run lint && bun run type-check → commit → deploy-site.sh
```

Scripts, par rôle :

| Script | Rôle |
|---|---|
| `plugins/.../scripts/mesurer.py` | mesure (Python) |
| `plugins/.../scripts/rendu.ts` | planches de contrôle multi-tailles + comparaison (Bun) |
| `plugins/.../scripts/icones.ts` | jeu de favicons générique (modèle) |
| `apps/site/scripts/genere-kinto-un.ts` | écrit les 3 SVG du nuage, `--rendu` pour les PNG de contrôle |
| `apps/site/scripts/genere-motifs-couverture.ts` | écrit la tuile `banc-nuage.svg` |
| `apps/site/scripts/genere-icones.ts` | rastérise le jeu complet, site **et** bot |
| `apps/site/scripts/rend-icones.ts` | planche de contact des 76 glyphes à 16/24/32 px, zoom ×6 |

## 4. Exécution d'exemple, bout en bout

Fait le 2026-09-05 sur `apps/bot/assets/ext/db_manga_volumes/82.jpg`
(couverture du tome 1, 1000 × 1500, RGB), boule de cristal du logo.

### Temps Python — mesurer

```bash
cp apps/bot/assets/ext/db_manga_volumes/82.jpg /tmp/exemple-svg/tome1.jpg
python3 plugins/dragon-ball/skills/toriyama-svg/scripts/mesurer.py \
  /tmp/exemple-svg/tome1.jpg --boite 394 115 495 216 --teinte 20 60 --sat 0.25 \
  --k 5 --sortie /tmp/exemple-svg/mesures
```

Sortie (`mesures.json`, `masque.png`, `decoupe.png`) :

| Grandeur | Valeur |
|---|---|
| Boîte | 101 × 101 px, **ratio 1,00** (le disque est bien circulaire) |
| Pixels pleins | 8 771 — **86,0 %** de la boîte, soit π/4 = 78,5 % plus le débord du cerne |
| Part de l'image | 0,58 % |

Palette k-means, k = 5 :

| Part | HEX | HSL |
|---|---|---|
| 39,4 % | `#F3A13A` | 33,3° 88,6 % 59,1 % |
| 29,9 % | `#FABF66` | 36,2° 93,3 % 69,0 % |
| 13,3 % | `#FBE2A4` | 42,8° 91,8 % 81,3 % |
| 9,3 % | `#DA2823` | 1,6° 72,2 % 49,7 % |
| 8,1 % | `#FCF012` | 56,9° 97,2 % 52,9 % |

**Contrôle de vraisemblance, appliqué.** Les trois premières lignes racontent le
dégradé ambre attendu — teinte qui monte de 33° à 43° en allant vers la lumière,
saturation qui ne bouge pas (88 → 93 %). Les deux dernières, non : le rouge est
l'étoile, le jaune vif est le fond du logo de couverture happé par le masque. On
les écarte, on ne les peint pas. Le tableau « décision → mesure » doit dire
lesquelles ont servi.

Même piège au temps suivant :

```bash
python3 .../mesurer.py /tmp/exemple-svg/tome1.jpg --boite 394 115 495 216 --sombre --json
# → trait.epaisseur_pct_largeur_forme = 19,05 %
```

19 % n'est pas une épaisseur d'encre — le trait de contour tient entre 0,7 % et
0,9 %. Le masque sombre a attrapé **l'étoile pleine**, pas le cerne. Une mesure
qui contredit l'ordre de grandeur connu accuse la segmentation, jamais le sujet :
il faut resserrer la boîte sur un arc de cerne, ou mesurer sur une planche au
trait plutôt que sur une couverture en couleur.

### Temps Bun — regarder

```bash
bun plugins/dragon-ball/skills/toriyama-svg/scripts/rendu.ts \
  apps/site/public/dbz/kinto-un.svg --tailles 512 128 64 32 16 --sortie /tmp/exemple-svg/rendu
# viewBox 1200×676 — ratio 1.775
# /tmp/exemple-svg/rendu/planche-{clair,sombre}.png
```

Puis **ouvrir les planches**. Sur celle-ci : la silhouette et les aplats tiennent
jusqu'à 32 px, les volutes intérieures se ferment dès 64 px et deviennent du
bruit à 32 — ce que corrige `genere-icones.ts` en rendant les tailles < 64 px
depuis `svgIcone({ volutes: false })`. Le contrôle n'était pas décoratif : c'est
lui qui a produit cette variante.

## 5. Créer une nouvelle image

1. **Sourcer.** Corpus local d'abord (`apps/bot/assets/manga/DB/{regular,fullcolor}/`,
   `apps/site/public/wiki/databooks/`, MCP `dragonball` pour localiser la planche).
   Hiérarchie : manga au trait pour la FORME, manga couleur pour la COULEUR,
   anime en dernier recours. Fandom banni. Travailler dans `/tmp/<sujet>/`.
2. **Mesurer.** `mesurer.py` sur au moins **deux** sources ; sans `mesures.json`,
   le dessin vient de la mémoire quelle que soit l'allure du code.
3. **Consigner** dans `docs/<sujet>-analyse-visuelle.md` : sources retenues *et*
   écartées avec la raison, puis le tableau « décision → mesure d'origine ».
4. **Dessiner** dans `apps/site/src/lib/<sujet>.ts` en copiant les primitives de
   `geometrie.ts` : poser les creux, bomber entre eux, l'ombre découpée par la
   silhouette, l'épaisseur en pourcentage de la largeur.
5. **Générer** avec `apps/site/scripts/genere-<sujet>.ts` (calqué sur
   `genere-kinto-un.ts` : `Bun.write` des SVG, `--rendu` pour les PNG).
6. **Regarder** avec `rendu.ts --compare`, sur fond clair et sombre.
7. **Décliner** si l'asset sert d'icône : variante carrée dessinée à part, pas un
   downscale.
8. **Livrer** : SVG + document + générateur dans le dépôt ; références, masques
   et rendus restent dans `/tmp`. `bun run lint && bun run type-check`, commit
   d'une ligne, `bash scripts/deploy-site.sh` si l'asset est servi.
