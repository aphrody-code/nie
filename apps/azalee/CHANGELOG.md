# Changelog Azalee

## 2026-06-01

### Refonte des outils (`/tools`) — mobile-first Material Design 3

**Ce qui a changé** :

- **Preview des 4 outils sur la home** : nouveau `components/home/ToolsPreview.tsx` (section MD3 « Outils interactifs », 4 cartes tonales) inséré dans `app/page.tsx` après les dernières actualités.
- **Assistant Tactique (RagAssistant) retiré** des pages (feature beta) : random-team, my-team, traducteur, comparateur, fiche personnage. Le composant `components/wiki/RagAssistant.tsx` est conservé mais n'est plus importé nulle part.
- **Équipe aléatoire** : filtres complets ajoutés (Genre, Rareté via `RarityBadge`, Série dérivée des pools) en plus d'Élément + Style de jeu, panneau collapsible mobile, UI mobile-first MD3. **Fix hydratation #418** : init déterministe puis shuffle au montage.
- **Traducteur** : recherche tolérante aux fautes (normalisation accents/ponctuation + distance de Levenshtein + multi-mots AND) et plus complète (limites par type relevées, cap 50). Badge discret « résultats approchants » en mode fuzzy.
- **Mon Équipe (Team Builder)** : UI mobile-first MD3 (boutons d'action ronds ≥44px, formation picker, slider de niveau, segmented tabs, roster). Drag&drop / undo / auto-fill / export PNG / partage URL intacts.

**Vérification** : type-check vert, build standalone déployé (`ship-azalee.sh`), smoke test navigateur réel **24/24 PASS** (fuzzy `endo`→Endou, `mark evan`→Mark Evans, `fire tornad`→Fire Tornado).

## 2026-02-06

### Conversion des assets PNG → WebP (`data/images/menu/`)

**Contexte** : Tous les fichiers PNG du répertoire `data/images/menu/` (environ 33 400 fichiers, 1.8 Go) ont été convertis en WebP pour réduire la taille des assets.

**Ce qui a changé** :

- Tous les fichiers `.png` dans `data/images/menu/200_icon/` et `data/images/menu/220_img/` ont été convertis en `.webp` (qualité 80)
- Les fichiers PNG originaux ont été supprimés après conversion réussie
- Les fichiers `.webp` pré-existants (notamment dans `220_img/telop_waza/fr/`) n'ont pas été touchés
- Réduction estimée : ~1.8 Go → ~600 Mo (environ -65%)

**Impact sur le code** :

- **Toutes les références à des images `.png` dans `data/images/menu/` doivent être mises à jour vers `.webp`**
- Cela concerne potentiellement :
  - Les composants React qui utilisent `<Image>` ou `<img>` avec des chemins vers `/menu/`
  - Les fichiers CSS/Tailwind avec `background-image` pointant vers ces assets
  - Les fichiers de données/config qui référencent des chemins d'images (inagle, JSON, etc.)
  - Les scripts de sync/crawl qui génèrent des chemins d'images

**Outil utilisé** : `cwebp -q 80` (package apt `webp`)
