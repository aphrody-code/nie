# Famille `discord`

Scrape communautaire du **serveur Discord « Rose Griffon »** (communauté FR Inazuma Eleven), pas des données internes du jeu. Statut : **archive / veille**, non consommé par les crates. Localisation : `data/discord/**` (gitignoré, stock mort).

- **198 dossiers** `data/discord/discord-<channelId>-<part>/`, chacun contenant exactement **2 fichiers** : `meta.json` (métadonnées) + `index.html` (le contenu réel des messages).
- **198 `meta.json`** = un par segment de salon. Un salon est découpé en « parties » (segments) ; `<part>` va de `0` à `6` (≤ 7 segments/salon).
- **38 salons distincts**, tous du **même serveur** (guild id `1072991720268111892`).
- Période couverte par les dates des segments : **2023-08-31 → 2026-06-10**.
- `index.html` agrégés : **2 618 messages** (`<li>`), **244 auteurs** distincts (`@handle`), ~446 Ko au total.

## `meta.json` — structure commune

Objet plat, **7 champs**, présents dans les 198 fichiers (aucun champ extra hors schéma). Exemple réel (`discord-1073227462500163626-0/meta.json`) :

```json
{
  "id": "discord-1073227462500163626-0",
  "title": "Discussion Discord - #🚨〡annonces [Partie 1]",
  "url": "https://discord.com/channels/1072991720268111892/1073227462500163626/1362403727796863137",
  "date": "2025-04-17",
  "channelName": "🚨〡annonces",
  "category": "Discord",
  "language": "fr"
}
```

| Champ | Type | Présence | Valeurs observées |
|---|---|---|---|
| `id` | String | 198/198 | format `discord-<channelId>-<part>` (part 0..6) |
| `title` | String | 198/198 | toujours préfixé `Discussion Discord - #<salon> [Partie N]` ; **198/198** contiennent `[Partie N]` (N = part+1) |
| `url` | String | 198/198 | `https://discord.com/channels/<guild>/<channel>/<messageId>` |
| `date` | String | 198/198 | date ISO `YYYY-MM-DD` (date du segment) |
| `channelName` | String | 198/198 | nom du salon avec emoji + séparateur `〡` (ex. `🚨〡annonces`) |
| `category` | String | 198/198 | **toujours** `"Discord"` |
| `language` | String | 198/198 | **toujours** `"fr"` |

Valeurs constantes : `category=Discord` (198), `language=fr` (198), guild dans toutes les URL = `1072991720268111892` (198). Channels distincts extraits des URL : 38 (cohérent avec les ids).

## `index.html` — structure commune

HTML minimal : un `<h1>Discussion dans #<salon></h1>` suivi d'une liste `<ul>` de `<li>`. Chaque `<li>` :

```html
<li><strong>@<handle></strong> [<timestamp ISO Z>]: <texte du message></li>
```

Le texte conserve les mentions Discord brutes (`<@&roleId>`, `<@userId>`), les emojis custom (`<:RG_Gaelle_flammes:1228347615888932954>`), spoilers `||…||` et liens (YouTube, Tenor, Twitch). Auteurs représentatifs : `@inazo__`, `@thanatos_emio`, `@tanej_iro`, `@qizuane`, `@mioleen_`, `@algabone`.

## Salons (38) — vraies valeurs

Triés par nombre de segments. `seg` = nb de `meta.json`, `maxPart` = plus grand `<part>`, plage = min..max des dates des segments.

| Salon (`channelName`) | channelId | segments | maxPart | dates min..max |
|---|---|---|---|---|
| 🚨〡annonces | 1073227462500163626 | 7 | 6 | 2025-04-17..2026-06-02 |
| 📚〡fanfic | 1136680167440388186 | 7 | 6 | 2025-03-17..2026-06-06 |
| 🎽〡cosplay | 1084588816741965974 | 7 | 6 | 2026-01-02..2026-05-30 |
| ☁〡inazuma-eleven-victory-road | 1143241903576457236 | 7 | 6 | 2026-05-29..2026-06-09 |
| 👟〡inazuma-eleven-ares-orion | 1084589437398298634 | 7 | 6 | 2026-03-14..2026-03-20 |
| 🎥〡fanarts-video | 1184584014221279422 | 7 | 6 | 2024-04-13..2026-02-23 |
| 🗨〡général-artistes | 1139545392044838992 | 7 | 6 | 2026-03-26..2026-06-09 |
| 🎈〡questions | 1136022956619866176 | 7 | 6 | 2025-09-17..2026-03-29 |
| ⚽〡inazuma-eleven-go | 1084589390107525150 | 7 | 6 | 2026-01-03..2026-06-04 |
| 📎〡partage-fan-art | 1089144554491498606 | 7 | 6 | 2025-10-18..2026-04-01 |
| 💭〡général-lore | 1145376747362209853 | 7 | 6 | 2023-12-01..2025-11-22 |
| 🎥〡direct | 1210545319226507284 | 7 | 6 | 2025-09-25..2026-06-01 |
| 💬〡général | 1135528098146816010 | 7 | 6 | 2026-06-04..2026-06-08 |
| ✖️〡inazuma-eleven-cross | 1513861771021127770 | 7 | 6 | 2026-06-10..2026-06-10 |
| 🎨〡vos-fanarts | 1084588796403777617 | 7 | 6 | 2026-03-14..2026-06-02 |
| 🕵〡présentations | 1135658700913266890 | 6 | 5 | 2024-12-12..2026-06-05 |
| ⚡〡général-compétitif | 1219206368800538666 | 6 | 5 | 2024-05-24..2026-04-25 |
| no-micro | 1137830675131666462 | 6 | 5 | 2026-03-11..2026-04-17 |
| 🎤〡Général 3 | 1135535140936896584 | 6 | 5 | 2025-11-20..2026-03-19 |
| 🔙〡vos-équipes | 1089144418063351838 | 6 | 5 | 2025-11-08..2026-01-21 |
| 🎭〡original-character | 1136681561908060202 | 6 | 5 | 2026-01-27..2026-06-08 |
| 🤖〡bots | 1135698156835852369 | 6 | 5 | 2026-03-23..2026-05-01 |
| 🤪〡memes-inazuma | 1140743411901661275 | 6 | 5 | 2025-11-20..2026-06-06 |
| ⚡〡inazuma-eleven | 1084589365067522179 | 6 | 5 | 2025-12-02..2026-06-05 |
| 🎤〡Général 2 | 1135535130690207925 | 6 | 5 | 2026-03-06..2026-06-04 |
| 📷〡médias | 1135660042025193472 | 6 | 5 | 2026-06-03..2026-06-09 |
| 🎮〡mods-ie | 1089219911861158010 | 6 | 5 | 2024-09-29..2026-05-30 |
| 🎤〡Général 1 | 1135532784480423986 | 5 | 4 | 2026-03-12..2026-05-05 |
| 🧐〡sondages | 1135716082972381234 | 4 | 3 | 2024-04-03..2025-11-02 |
| 🌸〡𝓐𝔃𝓪𝓵𝓮́𝓮 | 1349528692086276148 | 4 | 3 | 2025-12-02..2026-06-09 |
| 🤝〡partenaires | 1147904933736239214 | 1 | 0 | 2024-02-25 |
| 🎀〡rôles | 1349589953721401355 | 1 | 0 | 2025-04-21 |
| Animations | 1146878445645742141 | 1 | 0 | 2023-08-31 |
| 📣〡informations-compétitif | 1417803937309786142 | 1 | 0 | 2025-09-17 |
| 🌹〡accueil | 1386665739519529091 | 1 | 0 | 2025-06-25 |
| 👯〡mudae | 1135528396869337158 | 1 | 0 | 2026-06-09 |
| 💤〡AFK | 1135992269971918929 | 1 | 0 | 2024-07-06 |
| 🌹〡rose-griffon | 1144899358463098910 | 1 | 0 | 2023-12-01 |

## Contenu réel (extraits, `index.html`)

Les salons « jeu » discutent des titres de la licence (Victory Road, Go, Ares/Orion, Cross), des directs/VOD de la chaîne **Rose Griffon**, de la communauté (fanarts, cosplay, fanfic, lore, OC, équipes compétitives). Ce ne sont **pas** des données de jeu (pas de tables de skills/items/personnages) : c'est de la conversation.

Exemples bruts :

- `🚨〡annonces` (2025-03-26, `@inazo__`) : « Nouvelle vidéo disponible sur la chaine de Rose Griffon : la suite d'Inazuma Eleven Go Deluxe … https://www.youtube.com/watch?v=NO4olM5ZyKE »
- `🚨〡annonces` (2025-04-09, `@inazo__`) : pré-event « Kickoff Radio » + « Inazuma Eleven V Heroes Showcase ».
- `☁〡inazuma-eleven-victory-road` (`@mioleen_`, `@qizuane`, `@algabone`) : débats sur la jouabilité/difficulté de Victory Road (« le jeu aura une jouabilité infinie », « la licence fait une chute… »).

## Notes pour le portage

- Aucune valeur exploitable pour le moteur niers : pas d'IDs/hashes de jeu, pas de libellés `cfg.bin`/TEXT_INFO. Les seuls identifiants sont des **snowflakes Discord** (guild/channel/message/role/emoji).
- Réutilisable seulement comme **corpus FR communautaire** (veille produit, sentiment joueurs) — hors périmètre des crates.
