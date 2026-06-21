# official-jp-scrape

Scrapes des sites web **officiels** Level-5 autour d'*Inazuma Eleven: Victory Road* (IEVR) et de la franchise.
Glob : `data/{inazuma.jp,inazuma-cross.jp,level5.co.jp,google-scraped}/**/*.json` — **1067 fichiers JSON**.

C'est du **stock d'archive web**, non consommé par les crates. Le contenu est presque entièrement de la
**métadonnée éditoriale** (titres de news, dates, URLs, plateformes), pas des tables de données de jeu.
Le vrai « contenu de jeu » qu'on en tire = noms de DLC, modes, plateformes, versions de patch, personnages
de collab. Les fichiers `google-scraped/` sont **hors-sujet** (recon web technique, pas du jeu).

| Source | Fichiers JSON | Nature |
|---|---|---|
| `inazuma.jp` | 1048 | site officiel IEVR : 938 `meta.json` (news/topics multilingues) + 110 JSON patchnote |
| `inazuma-cross.jp` | 4 | jeu mobile *Inazuma Eleven Cross* : 1 `content.json` riche + 3 `meta.json` portail |
| `level5.co.jp` | 10 | blog développeur LEVEL-5 (`meta.json` avec extrait de texte) |
| `google-scraped` | 5 | recon HTTP de pages Google (`bxc-recon-v1`) — **sans rapport avec le jeu** |

Aucun fichier `cfg.bin.json` (texte du jeu) n'est présent dans cette famille — uniquement des scrapes web.

---

## 1. `inazuma.jp/victory-road/**/meta.json` — news/topics IEVR (935 fichiers)

Une entrée = une page de news scrappée, dupliquée par langue. **9 langues** sous
`victory-road/<lang>/topics/<id>/meta.json` : `ja, en, fr, de, es, it, pt-br, zh-cn, zh-tw`.

| langue | fichiers | champ `locale` présent ? |
|---|---|---|
| ja | 134 | oui |
| en, de, es, it, pt-br, zh-cn, zh-tw | 100 chacun | oui |
| fr | 101 | **non** sur 100 (incohérence du crawler : `locale` absent), oui sur 1 |

`category` vaut **`General`** pour les 935 ; `thumbnail` est toujours `null`. **155 ids de page distincts**.
Plage de dates (ja) : **2023.11.10 → 2026.3.6**.

### Schéma d'une entrée

```json
{
  "id": "251222",
  "title": "無料大型アップデート「ギャラクシー・イナダンDLC」配信開始！",
  "date": "2025.12.22",
  "url": "https://www.inazuma.jp/victory-road/topics/251222/",
  "locale": "ja",
  "category": "General",
  "thumbnail": null
}
```

Champs : `id` (slug, souvent date `AAMMJJ` ou `ver_x_y_z`, parfois ID YouTube `…?rel=0`), `title`,
`date` (`AAAA.M.J`), `url`, `locale`/`language`, `category`, `thumbnail`. Les locales non-ja reprennent
le **titre anglais** (pas de traduction par langue) ; seul `ja` a le japonais.

### DLC majeurs (« Free Major Update ») — vrai contenu de jeu

| id | date | nom EN | nom JA |
|---|---|---|---|
| `251222` | 2025.12.22 | Galaxy & LBX DLC | ギャラクシー・イナダンDLC |
| `260128` | 2026.1.28 | Ares & Fabled Seed DLC (2e) | アレス・バサラシードDLC |
| `260225` | 2026.2.25 | Orion & Lumen DLC (3e) | オリオン・ルミナスDLC |
| `UgGQzjT…` | 2026.3.27 | The Rising Bond DLC (PV) | キズナビッグウェイブDLC |

### Modes & features cités (pages-sommaire, titres = liste de sections)

- Page `story` (ja) : `「ストーリーモード」「クロニクルモード」「対戦」「キズナステーション」「キャラクター」「スペシャル情報」「商品情報」`
  → modes **Story / Chronicle / Competition (対戦) / Kizuna Station / Characters**.
- Page `competition` : `「対戦」「キャラクター」「ムービー」「スペシャル情報」「商品情報」`.
- Page `cross-save` : Cross-Save, saisie de gift code (あいことば), FAQ, guideline tournois.
- Page `guideline` : guidelines vidéo/image + « Streamer Kit ».

### Jalons éditoriaux notables (EN)

| id | date | titre |
|---|---|---|
| `251111` | 2025.11.11 | Early Access kickoff (JST) |
| `251114_02` | 2025.11.14 | Sortie mondiale le 13 nov. 2025 (GMT) |
| `251120` | 2025.11.20 | 500 000 copies vendues |
| `260113_01` | 2026.1.13 | 800 000 copies vendues |
| `251024` | 2025.10.24 | Toggle des noms japonais |
| `251203` | 2025.12.8 | Plafonds de passifs d'équipe (Manager/Coordinator) |
| `nagumohara-select` | 2025.5.30 | MAJ pages « Characters » |
| `20260212` | 2026.2.12 | Prix « 2025 Xbox Excellence Awards » |

---

## 2. `inazuma.jp/.../patchnote/**` — notes de version (110 fichiers JSON)

Sous `victory-road/<ja|en>/patchnote/<platform>/` avec `platform ∈ {ps-steam, switch, xbox}` :
- `index.json` : objet indexé `"0".."n"` listant les versions (`{id,url,title,date}`).
- `<ver>/data.json` : métadonnée d'une note → `{id, title, date, url, platform[], featured_image}`.

**Pas de texte de patch** (changements de gameplay) : uniquement titre/date/plateforme. `featured_image` = `null`.

| index | entrées |
|---|---|
| ja ps-steam / xbox / switch | 20 / 19 / 11 |
| en ps-steam / xbox / switch | 19 / 19 / 11 |

**29 versions distinctes** (`ver_1_2_3` … `ver_6_0_1`) :
`1_2_3, 1_2_4, 1_3_0…1_3_4, 1_4_0…1_4_2, 1_5_0…1_5_2, 2_0_0…2_0_4, 3_0_0/3_0_1, 3_1_0/3_1_1, 4_0_0/4_0_1, 5_0_0/5_0_1/5_0_2, 6_0_0/6_0_1`.

Tags `platform` (occurrences) : `ps4`=40, `ps5`=40, `steam`=40, `xbox`=40, `switch`=24.
Convention de numérotation observée : `x.y.0` = build **Nintendo Switch 2 / Switch**, `x.y.1` = build **PS5/PS4/Steam(/Xbox)**.

---

## 3. `inazuma.jp/re/**/meta.json` — portail « Inazuma Eleven RE » (3 fichiers)

Portails du remake annoncé, un par langue (`ja, en, fr`). Schéma : `{id, title, date, url, category, language}`
(`language` au lieu de `locale`). `category` = `RE Remake`, `date` = `2026-06-10`, `url` = `https://www.inazuma.jp/re/…`.

---

## 4. `inazuma-cross.jp/content.json` — jeu mobile *Inazuma Eleven Cross* (1 fichier riche)

`$schema: "inazuma-cross-crawl-v1"`, crawlé le 2026-06-05 par « bxc mirror (Bun-native browser engine) ».
**Seul fichier de la famille avec du vrai contenu de jeu structuré.** Sections : `site, status, spec,
introduction, protagonist, news, rewards, samuraiBlue2026, movies, links, images`.

### Fiche du jeu (`spec` / `status`)

| champ | valeur |
|---|---|
| titre | イナズマイレブン クロス (Inazuma Eleven Cross / イナイレクロス) |
| genre | 育成シミュレーション (raising/management sim) |
| plateformes | iOS / Android |
| modèle | Free-to-play + achats intégrés (アイテム課金型) |
| sortie | 2026/6/9 (火) — phase `pre-registration` (事前登録受付中) |
| dev | LEVEL5 Inc. + Aiming Inc. |
| copyright | ©LEVEL5 Inc. ©Aiming Inc. |
| store ID | Google Play `jp.co.level5.inazumacross`, App Store `id6756994116` |

### Histoire & protagoniste

- Trame (`introduction.storyJa`) : l'équipe Inazuma Japan embarque sur le paquebot *Inazuma Big Ferry*
  pour le **FFI (Football Frontier International)** ; le coach démissionne et nomme le héros nouvel entraîneur.
- Protagoniste : **汐沢 陽 / しおさわ よう / Yo Shiosawa** — analyste tactique qui épaule les joueurs et
  cherche son petit frère disparu.

### Collab `samuraiBlue2026` (équipe nationale Japon)

Période `6/14(日) 11:00 〜 6/30(火) 4:59`. Personnages limités (techniques inspirées du Yatagarasu) :

| pos | nom JA | nom FR | techniques |
|---|---|---|---|
| MF | 円堂 守 | Mark Evans | サムライショット, サムライフェイント |
| MF | 鬼道 有人 | Jude Sharp | サムライペンギン2号, ブルーサイクロン |

### Autres champs

- `news` : 4 entrées (`{date, titleJa, titleFr, url, tag}`), tags `公開`/`開催`.
- `movies.youtube` : 5 IDs (`fpiqLTzmEtU` PV pré-enregistrement, `EJF5WOK0JDc` teaser, +3).
- `rewards` : récompenses de pré-enregistrement (système 達成 « objectif atteint »), 4 bannières images.
- `links` : 14 liens officiels (X `@inazuma_cross`, Google Play, App Store, CoroCoro title 1177, lien vers IEVR…).
- `images` : keyVisual, firstView, logo, systemScreenshots, samuraiBlueBanner.

### Portails `inazuma-cross.jp/<lang>/meta.json` (3)

`{id, title, date, url, category:"Cross Mobile", language}` pour `ja/en/fr`.

---

## 5. `level5.co.jp/blog/**/meta.json` — blog développeur LEVEL-5 (10 fichiers)

Blog « 5つ星工房日記 / Five-Star Workshop Devlog ». Schéma enrichi :
`{id, title, date, url, locale, category:"LEVEL-5 Developer Blog", content_text_snippet}`
(le **seul** type avec un extrait de texte d'article, ~500 car.).

2 articles, dupliqués par langue/alias (`250303`, `latest`, `blog`, `en`) sur `ja/en/zh-cn/zh-tw` :

| locale | id | date | titre |
|---|---|---|---|
| ja | 250303 | 2025.3.3 | 来たぞ！最終段階‼ |
| en | 250303 | 2025.3.3 | Here We Go! The Final Stretch‼ |
| zh-cn | 250303 | 2025.3.3 | 最终阶段，全力冲刺！！ |
| zh-tw | 250303 | 2025.3.3 | 最終階段，全力衝刺！！ |
| ja | blog/latest | 2025.12.28 | AIをめぐる騒動について |
| en | en/latest | 2025.12.28 | On the Recent AI Controversy |

Extrait (`250303`, EN) : annonce que LEVEL-5 sortira **3 titres majeurs en 2025** ; le devlog vise à
partager régulièrement l'avancement du développement (signé Akihiro Hino, CEO). Extrait (`latest`, EN) :
prise de position du CEO sur la controverse autour de l'IA dans le développement de jeux.

---

## 6. `google-scraped/*.json` — recon web (5 fichiers, HORS-SUJET)

`$schema: "bxc-recon-v1"` : captures HTTP de pages de recherche Google sur des sujets **techniques**
(`rust programming`, `artificial intelligence`, `multi agent systems`, `webassembly development`,
`google design 3`). Champs : `{url, finalUrl, httpStatus, bytes, gotoMs, profile, headers, frameworks,
assets, cssSelectors}`. **Aucun rapport avec le jeu** — c'est de l'outillage de crawl, à ignorer pour
le contenu de jeu.
