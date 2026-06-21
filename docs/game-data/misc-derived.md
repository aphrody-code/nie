# misc-derived

Famille de dérivés divers extraits autour d'IEVR. Glob couvert : `data/{schema-snapshot,entries,glossary,translations,all-gamedata}/**/*.json`.

10 vrais fichiers JSON (les ~27 autres entrées d'`all-gamedata/` sont des **symlinks** vers `../rg/packages/inagle/src/entries/`, hors `data/` et non comptés ici). Source des chiffres : parsing direct des fichiers (Bun/TS). Aucun fichier de cette famille n'est au format `cfg.bin.json` (pas de `entries → children TEXT_INFO`) : ce sont des dumps de schéma, des scrapes Twitter, un glossaire dérivé, des patch notes traduits, et une base de texte du mode Histoire.

| Fichier | Type | Top | Taille logique |
|---|---|---|---|
| `schema-snapshot/tables.json` | dump schéma SQL (miroir) | `Array(118)` | 118 tables (3 schémas) |
| `schema-snapshot/columns.json` | dump schéma SQL | `Array(1010)` | 1010 colonnes / 93 tables |
| `schema-snapshot/rls-policies.json` | dump RLS | `Array(86)` | 86 tables, 140 policies |
| `entries/twitter-azalee.json` | scrape Twitter | `Array(22)` | 22 tweets |
| `entries/twitter-azalee-full.json` | scrape Twitter (news) | `Array(44)` | 44 entrées (threads + médias + quotes) |
| `entries/twitter-azalee-threads.json` | scrape Twitter (news) | `Array(44)` | 44 entrées (sans quotes) |
| `glossary/azalee-tweets.json` | scrape Twitter | `Array(53)` | 53 tweets |
| `glossary/inazuma-glossary.json` | glossaire dérivé inagle | objet | 10 626 entrées résumées |
| `translations/patch-notes-fr.json` | patch notes traduits | objet | 43 patch notes (HTML FR) |
| `all-gamedata/story_text_database.json` | textes mode Histoire | objet | 25 261 dialogues |

---

## schema-snapshot/ — snapshot du schéma SQLite/Postgres miroir

Trois dumps du schéma de la base miroir (le « mirroir SQLite » consommé par `nie-wiki`/`nie-model-serve`/azalee).

### tables.json — 118 tables

Champs par entrée : `schemaname, tablename, hasindexes, hasrules, hastriggers`.

| schema | nb tables |
|---|---|
| `auth` | 23 |
| `public` | 87 |
| `storage` | 8 |

Les tables **données de jeu** sont préfixées `inagle_` (schema `public`). Tables de jeu notables (extrait) :

`inagle_characters`, `inagle_skills`, `inagle_items`, `inagle_keshins`, `inagle_auras`, `inagle_passives`, `inagle_souls`, `inagle_miximax`, `inagle_awakenings`, `inagle_mode_changes`, `inagle_override_skills`, `inagle_basara`, `inagle_capsules`, `inagle_costumes`, `inagle_coordinators`, `inagle_drops`, `inagle_drops_battles`, `inagle_drops_tables`, `inagle_drops_treasures`, `inagle_exp_table`, `inagle_growth_tables`, `inagle_formations`, `inagle_tactics`, `inagle_teams`, `inagle_opponent_teams`, `inagle_quests`, `inagle_gallery`, `inagle_heroes`, `inagle_stadiums`, `inagle_kizuna_items`, `inagle_nameplates`, `inagle_phase_titles`, `inagle_performances`, `inagle_scene_archives`, `inagle_manager_passives`, `inagle_custom_passives`, `inagle_passive_generation`, `inagle_passive_scaling`, `inagle_chara_menu_resource`, `inagle_chat_emotes`, `inagle_icon_inventory`, `inagle_img_inventory`, `inagle_media_assets`.

Tables **site/CMS** (non-jeu) : `articles`, `article_*`, `chronicles`, `topics`, `tweets`, `patch_notes`, `discord_*`, `patreon_*`, `merch_products`, `newsletter_subscriptions`, `profiles`, `user`, `user_teams`, `team_members`, `wiki_overrides`, etc.

### columns.json — 1010 colonnes (93 tables distinctes)

Champs : `table_name, column_name, data_type, is_nullable, column_default`.

Distribution des `data_type` :

| type | n |
|---|---|
| text | 507 |
| timestamp with time zone | 128 |
| integer | 125 |
| jsonb | 82 |
| uuid | 54 |
| character varying | 48 |
| boolean | 30 |
| ARRAY | 16 |
| bigint | 12 |
| smallint | 3 |
| time without time zone | 2 |
| tsvector / date / numeric | 1 chacun |

Colonnes des tables de jeu clés (extraites) :

- **`inagle_characters`** (53 col) : `chara_id, internal_code, name_fr/en/ja, description_fr/ja/en, rarity, rarity_code, rarity_label, element_id, element, position_id, position, gender, image_url, sheet_data, stats, skills, teams, series, slug, team_id, stat_frappe, stat_controle, stat_technique, stat_pression, stat_physique, stat_agilite, stat_intelligence, stat_total, constellation, constellation_index, zukan_hash, zukan_order, control_type, is_controllable, game_appearances, model_id, stat_lv1_*, hero_type`.
- **`inagle_skills`** (33 col) : `internal_code, name_*, description_*, category_id, element_id, power_min, power_max, tension_cost, image_url, video_url, poster_url, is_hyper, category, evolution_type, foul_rate, growth_type, hash_id, is_eldorado, partner_count, recast_time, tp_cost, skill_effect_bit_flag, tags`.
- **`inagle_items`** (24 col) : `name_*, description_*, category, rarity, image_url, price, internal_code, shops, sell_price, buy_price, shop_names, stat_boost_1, stat_boost_2, boost_type, effect_value`.
- **`inagle_teams`** (19 col) : `internal_code, name_*, emblems, kits, members, country_code, emblem_url, series, region, description_*`.
- **`inagle_keshins`** (15 col) : `name_*, description_*, type, image_url, asset_code, element_id, sub_type`.
- **`inagle_auras`** (12 col) : `name_*, description_*, element_id, sub_type, image_url, asset_code`.
- **`inagle_passives`** (15 col) : `name_*, description_*, type, category, boost_type, stat_boost, effect_value`.
- **`inagle_quests`** (13 col) : `name_*, description_*, type, display_text, phase`.
- **`patch_notes`** (11 col) : `title, date, platform, url, featured_image, content_html, title_fr, content_html_fr`.
- **`tweets`** (13 col) : `text, author_id, author_username, author_name, media, quoted_tweets, metrics, is_thread, tweet_count, raw_tweets`.

### rls-policies.json — 86 tables, 140 policies

Champs : `schema, table, policies` (compte de policies par table). Toutes les lignes ont `policies > 0`. Exemples : `account`=1, `admin_audit_log`=2, `article_comments`=4.

---

## entries/ — scrapes Twitter (compte @Azalee_IE)

Trois scrapes du compte officiel FR **« Azalée 🌸 | Inazuma Eleven FR »** (`@Azalee_IE`). Contenu = annonces/news communautaires FR (équilibrage, patchs, DLC), pas des données de jeu binaires.

### twitter-azalee.json — 22 tweets (tweets unitaires)

Champs : `id, text, createdAt, replyCount, retweetCount, likeCount, conversationId, author{username,name}, authorId, quotedTweet, media`. Auteur unique : `Azalee_IE`. Plage de dates : `Dec 17 2025` → `Jan 30 2026`. Max likes observé : **579**.

### twitter-azalee-full.json — 44 entrées (news agrégées)

Champs : `id, title, createdAt, tweetCount, isThread, content, media, quotedTweets, tweets`. Titres = `News du JJ/MM/AAAA` (ex. « News du 30/01/2026 »). 10 entrées sont des threads (`tweetCount` jusqu'à 5) ; 22 entrées portent des médias (`media[]` = `{type:"photo", url, width, height, previewUrl}`, hôte `pbs.twimg.com`) ; 29 entrées ont des `quotedTweets`.

Exemple de contenu réel (équilibrage « Jeu Violent ») : *« Le joueur subissant un Sprint en Force recevra 50 % de la Tension gagnée par le joueur initiateur… le taux de faute augmentera progressivement à chaque Sprint en Force réussi »* — termes de jeu : **Sprint en Force**, **Tension**, **Affrontement ciblé**, **Zone**, mise à jour **Orion**.

### twitter-azalee-threads.json — 44 entrées

Mêmes 44 entrées que `-full` mais sans le champ `quotedTweets` (champs : `id, title, createdAt, tweetCount, isThread, content, media, tweets`).

### glossary/azalee-tweets.json — 53 tweets

(Rangé sous `glossary/` mais c'est un scrape Twitter.) Champs : `id, text, date, author_username, is_thread, tweet_count, raw_tweets`. Auteur unique `Azalee_IE` ; 11 threads. Annonce notable : *« La mise à jour 5.0.0 d'Inazuma Eleven Victory Road ajoutant le DLC Rising Bond est désormais disponible »* (date `2026-03-31`). Mentionne donc le **DLC Rising Bond** / version **5.0.0**.

---

## glossary/inazuma-glossary.json — glossaire dérivé (résumé inagle)

`_meta` : `{ generatedAt: 2026-06-01, source: "inagle MCP — données IEVR", totalEntries: 10626 }`. Document de synthèse : compte global par famille + listes de noms (souvent capées) + exemples de descriptions.

### terminologie (15 termes, traduction des concepts JP→FR)

| Terme FR | Définition (verbatim, abrégée) |
|---|---|
| Super Technique | Technique spéciale (Hissatsu en JP). Catégories : Tir, Dribble, Bloc, Arrêt, Spécial. |
| Esprit Guerrier | Keshin (化身) — avatar spirituel invoqué par un joueur. Augmente les stats. |
| Totem | Soul (ソウル) — esprit animal qui booste le joueur. |
| Éveil | Awakening — transformation qui débloque de nouvelles capacités. |
| Mode | Mode Change — changement de style de jeu. |
| Miximax | Fusion temporaire avec l'esprit d'un autre joueur. |
| Tension | Jauge d'énergie consommée par les Super Techniques (pas TP, pas mana). |
| Feu (火) | Élément 1 — fort contre Forêt, faible contre Montagne. |
| Forêt (林) | Élément 2 — fort contre Vent, faible contre Feu. |
| Vent (風) | Élément 3 — fort contre Montagne, faible contre Forêt. |
| Montagne (山) | Élément 4 — fort contre Feu, faible contre Vent. |
| Gardien (GK) | Goalkeeper — dernière ligne de défense. |
| Défenseur (DF) | Protège la zone arrière, intercepte les attaques. |
| Milieu (MF) | Midfielder — lien entre défense et attaque. |
| Attaquant (FW) | Forward — marque les buts. |

La roue élémentaire (Feu→Forêt→Vent→Montagne→Feu) et la Tension (≠ TP/mana) sont les faits de gameplay les plus directement exploitables ici.

### comptes par famille

| Famille | total | `noms[]` stockés |
|---|---|---|
| personnages | 5214 | 500 (capé) |
| techniques | 916 | 916 (complet, par catégorie) |
| equipes | 207 | 207 (complet) |
| items | 4153 | 200 (capé) |
| passifs | 128 | 100 (capé) |
| auras | 8 | 8 (complet) |

### techniques.parCategorie — 916 techniques en 4 catégories

`Tir`, `Bloc`, `Dribble`, `Arrêt` (la 5e catégorie « Spécial » de la terminologie n'apparaît pas dans ce dump). Exemples réels par catégorie :
- **Tir** : Excalibur, Big Bang, Gungnir, Supernova, Tornade de feu, Tir Eiffel, Manchot empereur X, Triangle de la mort, Épée d'Odin, Éveil du dragon…
- **Bloc** : Grande muraille, Mur de fer, La Montagne, Séisme, Tacle de la mort, Phalanx, Méga séisme…
- **Dribble** : Super Elastico, Éclair de Pégase, Tourbillon, Sprint éclair, Croix du Sud, Dragster…
- **Arrêt** : Main céleste (V/X/…), Mur de mains, Trou noir, Galatine, Poing de la justice, Bouclier royal…

À noter, quelques **codes internes** non traduits restent dans la liste Tir : `swap_skill_waza_01..09`, `whs03005` (et `whd01480` en Bloc, `whk01615`/`whk01720` en Arrêt) — résidus d'asset_code dans le dump.

### auras (8, type « Aura »)

Boost chrono, Catalyste élémentaire, Défense cuirassée, Désactivation des limiteurs, Fiole d'aura, Passion ardente, Ténacité du gardien, Transformation de lien.

### passifs (exemples de libellés à template)

Libellés paramétrés avec placeholders `[CPASSIVE01]`, `%[C]`, `[C]` (gabarits de génération), ex. :
`ATT & DÉF affrontement (perso) [CPASSIVE01]+ %[C] dans la moitié de terrain adverse`,
`… pour les joueurs du même élément`, `… quand hors Zone`.

### equipes & items (exemples)

- equipes (207) : AI Academy, Alia Academy, Barcelona Orb, Big Bang, Champions d'Orion, Chaos, et de nombreux **clubs scolaires** (Club de handball, judo, kendo, manga, muscu, natation, sumo, surf, tennis…).
- items (4153, échantillon) : **formations** en tête de liste (`3-5-2 Liberté`, `4-3-3 Delta`, `4-4-2 Diamant`, `4-5-1 Équilibré`, `5-4-1 Double Volante`), puis accessoires/cosmétiques (Accessoire Professeur Layton, Afro infranchissable, Ailes jumelles…).

---

## translations/patch-notes-fr.json — 43 patch notes (HTML FR)

Objet clé→`{ title_fr, content_html_fr }`. Clés = `<plateforme>_ver_<version>`.

- **Plateformes** : `xbox`, `ps-steam`, `switch`.
- **Versions** : 1.2.3/1.2.4, 1.3.0→1.3.4, 1.4.0→1.4.2, 1.5.0→1.5.2, 2.0.0→2.0.4, 3.0.0/3.0.1, 3.1.0/3.1.1.
- Titres typiques : « Annonce de la sortie de la version 1.4.2 Xbox Series X｜S », « … PlayStation®5 PlayStation®4 Steam », « Annonce de la version 1.4.0 Release Switch 2 Switch ».
- `content_html_fr` = corps HTML traduit, listes de **corrections de bugs** par mode. Extrait réel (2.0.4) : *« Correction d'un problème qui pouvait provoquer le crash du jeu lors de l'exécution de certaines actions dans le menu Esprits »*, *« dans le mode Histoire … lorsque vous parliez à nouveau à un personnage repérable … menu de l'adversaire »*. Confirme l'existence des modes/menus : **menu Esprits**, **mode Histoire**, **menu de l'adversaire**.

---

## all-gamedata/story_text_database.json — textes du mode Histoire (25 261 dialogues)

Seul vrai JSON d'`all-gamedata/`. `generatedAt: 2026-06-04`. Quatre tableaux : `events`, `mapNpc`, `goals`, `phases`. Textes tri-langues `{ ja, en, fr }`.

| Section | n | contenu |
|---|---|---|
| `events` | 4665 | scènes scriptées, **25 261** dialogues au total |
| `mapNpc` | 32 | PNJ par zone de carte |
| `goals` | 15 | objectifs par chapitre |
| `phases` | 2 | titres de phase / textes système |

### events[] → dialogues[]

`event` = `{ eventId, dialogues[] }`. eventId au format `evNN_NNNNN` (ex. `ev23_01210`).
`dialogue` = `{ dialogueId, hashId, speaker, text }` :
- `dialogueId` ex. `ev23_01210_010_010`
- `hashId` ex. `0x31476243` (hash du texte)
- `speaker` = `{ charaId, names{ja,en,fr} }`, charaId ex. `0XD667272A`
- `text` = `{ ja, en, fr }`

Exemple réel : speaker **Chester Horse Jr** (`0XD667272A`) — ja « さあ　今度は鬼道チームの攻撃だ！ » / en « Team YUTO is going all out, no holds barred! » / fr « L'équipe de YUTO part à l'attaque ! ».

**Locuteurs** : 1022 charaId distincts, 0 dialogue sans speaker. Top locuteurs (par nb de répliques) : Destin (1481), Destin Billows (1385), Mark (755), Arion (638), Cédric (506), entrecoupés de PNJ anonymes étiquetés `NPC (0X…)` (charaId numérique sans nom, ex. `0X6B055AAE`=1192, `0X00000000`=1183).

Répartition des events par préfixe `evNN` (extrait) : `ev70`=591, `ev40`=529, `ev25`=355, `ev23`=336, `ev22`/`ev24`=312, `ev21`=210, `ev07`=117, `ev04`=111, `ev09`=102… (44 préfixes au total).

### mapNpc[] → dialogues[]

`{ zoneId, dialogues[] }`. 32 zones, zoneId au format `wNN[iNNN]` (ex. `w10g201`, `w12i001`, `w10`, `w18`, `s004`, `z01_debug`). Dialogues sans `speaker`/`charaId` ici (juste `{ hashId, text{ja,en,fr} }`). Ex. (zone `w10g201`) : « 忍原先輩とのダンス対決　始めるか？ » / « You ready for the dance battle? » / « T'es prêt pour le battle de danse ? ».

### goals[] — 15 chapitres

`{ chapterId, goals[{hashId, text{ja,en,fr}}] }`. chapterIds : `c01`…`c09` plus `c90`…`c96`. Beaucoup d'objectifs sont déjà traduits FR (ex. c08 « Gagnez des matchs amicaux contre Lawcrest, l'AI Academy et l'Institut des nobles visionnaires », c04 « Négociez une fusion entre les deux clubs / Partez à la poursuite de KAMEO », c03 « Rassemblez des informations au collège NAGUMOHARA »). Certains chapitres `c9x` restent en JP non traduit (ex. c95 « 南雲原中を見て回ろう »).

### phases[] — 2 entrées

`chapterId: "phase_title_text"` (phases vide) et `chapterId: "c01"` (6 phases). Textes système/narratifs, FR souvent encore en JP brut avec balises de formatage `[CR]`, `[CG]`, `[CG2]`, `[C]` (ex. « おつかい用 の１０００円 をもらった！ », « CG2]卵[C]と[CG2]牛乳[C]を買った！ »).
