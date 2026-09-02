/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests du parseur des sondages EasyPoll.
 *
 * AUCUNE FIXTURE INVENTÉE. Les encarts ci-dessous sont extraits tels quels de la
 * base de production (salon 🧐〡sondages, 1135716082972381234) par :
 *
 *   psql "$DATABASE_URL" -At -c "select embeds->0->'footer'->>'text',
 *          embeds->0->>'description' from discord_messages where …"
 *
 * Un parseur validé sur des exemples fabriqués ne prouve rien : c'est justement
 * la réalité du corpus (trois ères d'écriture, deux langues, un emoji de vote
 * suivi d'un second emoji dans le libellé, quatre choix homonymes) qui casse les
 * parseurs naïfs.
 *
 * CE QUE CES TESTS NE FONT PAS : aucune connexion Postgres, aucun appel réseau,
 * aucun accès Storage. Seules les fonctions PURES sont couvertes ;
 * `runDiscordPollsImport` se valide par `--dry` puis par les COUNT réels.
 */

import { describe, expect, test } from "bun:test";
import {
	appliquerVotesDepuisReactions,
	chapoUtilisable,
	choisirVisuel,
	FIN_ERE_REACTIONS,
	type MessageHumainAvecMedia,
	type MessageSondage,
	parseEasyPollEmbed,
	parseSondageNatif,
	type ReactionBrute,
	type SondageExtrait,
} from "./discord-polls.js";

interface Encart {
	message_id: string;
	channel_id: string;
	guild_id: string;
	author_id: string;
	author_username: string | null;
	author_is_bot: boolean;
	type: number;
	created_at: string;
	content: string;
	color: number | null;
	footer: string;
	reactions: ReactionBrute[];
	description: string;
}

const ENCARTS: Record<string, Encart> = {
	"489f97c9": {
		message_id: "1135933400918806529",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2023-08-01T13:53:47.401Z",
		content: "Premier sondage pour mieux vous connaître, vous et votre rapport à la license ! ⚡",
		color: 16393766,
		footer: "Poll ID: 489f97c9",
		reactions: [{"emoji":{"id":null,"name":"🥸"},"count":32},{"emoji":{"id":null,"name":"🤠"},"count":41},{"emoji":{"id":null,"name":"🤓"},"count":3},{"emoji":{"id":null,"name":"😙"},"count":3}],
		description: `**Question**
Quand avez-vous connu Inazuma Eleven (toute plateform confondue) ?

**Choices**
🥸   Dans ses débuts (avant 2010)
🤠   Avant 2015
🤓   Avant 2020
😙   Après 2020

**Final Result**
🥸 ▓▓▓▓░░░░░░ [32 • 42%]
🤠 ▓▓▓▓▓░░░░░ [41 • 53%]
🤓 ░░░░░░░░░░ [2 • 3%]
😙 ░░░░░░░░░░ [2 • 3%]
77 users voted

**Settings**
:alarm_clock: Poll already ended (<t:1691157228:R>)
:one: allowed choice

:lock: No other votes allowed`,
	},
	"3c67262a": {
		message_id: "1153403062568886401",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2023-09-18T18:51:59.309Z",
		content: "La semaine dernière il n'y a pas eu de sondage d'émotes de serveur, donc cette semaine vous allez  pouvoir choisir **DEUX** personnages pour 2 émotes qui exprimeront tout les deux le rire : 😂 😆 🤣  (les expressions précises seront décidées selon les personnages gagnants) ! Cette fois vu qu'il y a plus de choix, vous avez le droit à **QUATRE** votes et on récoltera les résultats le **samedi soir 18h** !",
		color: 65535,
		footer: "Poll ID: 3c67262a",
		reactions: [{"emoji":{"id":null,"name":"🍏"},"count":46},{"emoji":{"id":null,"name":"🌹"},"count":13},{"emoji":{"id":null,"name":"💚"},"count":12},{"emoji":{"id":null,"name":"😈"},"count":55},{"emoji":{"id":null,"name":"🦅"},"count":12},{"emoji":{"id":null,"name":"😃"},"count":9},{"emoji":{"id":null,"name":"👺"},"count":24},{"emoji":{"id":null,"name":"🐯"},"count":11},{"emoji":{"id":null,"name":"🇮🇹"},"count":34},{"emoji":{"id":null,"name":"🐰"},"count":36}],
		description: `**Question**
Quels personnages souhaitez-vous voir incarner l'une de ces émotes (expression du rire t'as compris) : 🤣  / 😆  / 😂  ?

**Choices**
🍏  Jordan/Midorikawa
🌹  Sue/Rika
💚  Jade/Midori
😈  Aitor/Kariya
🦅  Erik/Ichinose
😃 Bobby/Domon
👺  Nishiki Ryoma
🐯  Austin/Toramaru
🇮🇹  Paolo/Fidio
🐰  Fey Rune

**Settings**
:three: allowed choices`,
	},
	"7fc282db": {
		message_id: "1152230776860053575",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2023-09-15T13:13:44.616Z",
		content: "<@&1136286992620064778>",
		color: 65535,
		footer: "Poll ID: 7fc282db",
		reactions: [{"emoji":{"id":null,"name":"🇦"},"count":21},{"emoji":{"id":null,"name":"🇧"},"count":6},{"emoji":{"id":null,"name":"🇨"},"count":5},{"emoji":{"id":null,"name":"🇩"},"count":26}],
		description: `**Question**
Heyo ! Une semaine est passée depuis Nimona (c’était ça le film donc) et je me sens d’attaque pour un deuxième film demain soir 20h ! Je vous laisse encore une fois le choix du genre (et je ne dirais pas le nom du film encore une fois, faudra me faire confiance)
Je vais changer un peu les genres pour cette fois (pour pas que on regarde que des films d’animation mdr) !

**Choices**
🇦 Horreur
🇧 Drame
🇨 Thriller
🇩 Action

**Settings**
:four: allowed choices`,
	},
	"7835ac27": {
		message_id: "1155245778051276920",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2023-09-23T20:54:16.916Z",
		content: "<@&1152301427243352104>",
		color: 65535,
		footer: "Poll ID: 7835ac27",
		reactions: [{"emoji":{"id":null,"name":"🇦"},"count":19},{"emoji":{"id":null,"name":"🇧"},"count":3},{"emoji":{"id":null,"name":"🇨"},"count":3},{"emoji":{"id":null,"name":"🇩"},"count":5}],
		description: `**Question**
Bonsoir ! Week-end prochain, cinéma (soyez là svp) ! Je vous laisse choisir le genre encore une fois (et je ne dirais pas le nom du film encore une fois mais faites moi confiance, je connais QUE des bangers)

**Choices**
🇦 Horreur
🇧 Horreur
🇨 Horreur
🇩 Horreur

**Settings**
:one: allowed choice`,
	},
	"17ee14d2": {
		message_id: "1158389658380668948",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2023-10-02T13:06:56.397Z",
		content: "<@&1136286992620064778>",
		color: 65535,
		footer: "Poll ID: 17ee14d2",
		reactions: [{"emoji":{"id":null,"name":"🇦"},"count":7},{"emoji":{"id":null,"name":"🇧"},"count":8},{"emoji":{"id":null,"name":"🇨"},"count":19},{"emoji":{"id":null,"name":"🇩"},"count":44}],
		description: `**Question**
Bonjour ! Pour le watchalong IE (Mercredi et Vendredi, je rappelle), quelle tranche horaire irait pour vous ?

**Choices**
🇦 16-17h
🇧 17h-18h
🇨 18h-19h
🇩 20h-21h

**Settings**
:infinity: Unlimited choices`,
	},
	"cc5449c8": {
		message_id: "1159505402610855966",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2023-10-05T15:00:30.551Z",
		content: "Vous avez précédemment élu Jordan/Midorikawa <:RG_jordan_laugh:1159441978224807999>  et Aitor/Kariya <:RG_aitor_joy:1159441949917458512>  pour les émotes de rire ! Maintenant il va falloir pour la première fois voter pour un personnage qui incarnera un meme ! Vous avez droit à 3 votes ! Fin des votes mardi soir prochain 20h ! Pour rappel, ce n'est PAS un sondage de popularité, choisissez selon si vous visualisez bien le perso sur le meme/ l'expression proposée !",
		color: 65535,
		footer: "Poll ID: cc5449c8",
		reactions: [{"emoji":{"id":null,"name":"🔎"},"count":32},{"emoji":{"id":null,"name":"📘"},"count":8},{"emoji":{"id":null,"name":"👽"},"count":10},{"emoji":{"id":null,"name":"👓"},"count":42},{"emoji":{"id":null,"name":"🐧"},"count":25},{"emoji":{"id":null,"name":"🍌"},"count":13},{"emoji":{"id":null,"name":"🥝"},"count":4},{"emoji":{"id":null,"name":"✨"},"count":33}],
		description: `**Question**
Quel personnage verriez-vous voir incarner le meme "Smart" ci-dessus ?

**Choices**
🔎  Keenan/Minaho
📘   Valentin/Hiura
👽   Ruger/Ryugel
👓  Willy/Megane
🐧  Jude/Kidou
🍌  Caleb/Fudou
🥝  Jack/Kabeyama
✨  Gamma

**Settings**
:three: allowed choices`,
	},
	"4cabbaaf": {
		message_id: "1139494207510302761",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2023-08-11T09:43:09.849Z",
		content: "",
		color: 65535,
		footer: "Poll ID: 4cabbaaf",
		reactions: [{"emoji":{"id":"1089594869623832636","name":"IE_TerryLike"},"count":18},{"emoji":{"id":"1089276549120925717","name":"Hey2"},"count":37},{"emoji":{"id":null,"name":"🤷"},"count":44}],
		description: `**Question**
Rapide sondage pour de futurs émotes sur le serveur : quel style préférez-vous ? <@&1136286992620064778>

**Choices**
<:IE_TerryLike:1089594869623832636>  Style chibi
<:Hey2:1089276549120925717>  Normal
🤷  Peu importe/les 2

**Settings**
:one: allowed choice`,
	},
	"a453e8bb": {
		message_id: "1239241596889858170",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2024-05-12T15:43:40.694Z",
		content: "NB : Le joueur étant humain (résultats du premier sondage), les couleurs non réalistes seront adaptées pas de panique !",
		color: 16393766,
		footer: "Poll ID: a453e8bb",
		reactions: [{"emoji":{"id":null,"name":"👍🏻"},"count":18},{"emoji":{"id":null,"name":"👍🏽"},"count":66},{"emoji":{"id":null,"name":"👍🏿"},"count":24},{"emoji":{"id":null,"name":"⚪"},"count":11},{"emoji":{"id":null,"name":"🔵"},"count":13},{"emoji":{"id":null,"name":"🟢"},"count":2},{"emoji":{"id":null,"name":"🟠"},"count":7},{"emoji":{"id":null,"name":"🟣"},"count":10},{"emoji":{"id":null,"name":"🔴"},"count":3},{"emoji":{"id":null,"name":"🇯"},"count":14},{"emoji":{"id":null,"name":"🇰"},"count":7},{"emoji":{"id":null,"name":"🟡"},"count":4}],
		description: `**Question**
04 - De quelle couleur de peau sera notre joueur ?

**Choices**
👍🏻  Clair
👍🏽  midtone
👍🏿  foncé
⚪  blanc
🔵  bleu
🟢  vert
🟠  orange
🟣  violet
🔴  rouge
🇯 🩷 rose
🇰 🩶 gris
🟡  jaune

**Final Result**
👍🏻 ▓░░░░░░░░░ [17 • 10%]
👍🏽 ▓▓▓▓░░░░░░ [65 • 39%]
👍🏿 ▓░░░░░░░░░ [23 • 14%]
⚪ ▓░░░░░░░░░ [10 • 6%]
🔵 ▓░░░░░░░░░ [12 • 7%]
🟢 ░░░░░░░░░░ [1 • 1%]
🟠 ░░░░░░░░░░ [6 • 4%]
🟣 ▓░░░░░░░░░ [9 • 5%]
🔴 ░░░░░░░░░░ [2 • 1%]
🇯 ▓░░░░░░░░░ [13 • 8%]
🇰 ░░░░░░░░░░ [6 • 4%]
🟡 ░░░░░░░░░░ [3 • 2%]
97 users voted

**Settings**
:alarm_clock: Poll already ended (<t:1715615022:R>)
:four: allowed choices

:lock: No other votes allowed`,
	},
	"bb1f3c28": {
		message_id: "1241084079210762281",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2024-05-17T17:45:02.711Z",
		content: "",
		color: 16393766,
		footer: "Poll ID: bb1f3c28",
		reactions: [{"emoji":{"id":null,"name":"⚡"},"count":43}],
		description: `**Question**
09 - Quel sera le pouvoir/l'élément de notre joueur ? Réagissez au sondage si vous souhaitez participer au tirage au sort pour décider de cette caractéristique ! ⚡

**Choices**
⚡ Je veux choisir le pouvoir !

**Final Result**
⚡ ▓▓▓▓▓▓▓▓▓▓ [42 • 100%]
42 users voted

**Settings**
:alarm_clock: Poll already ended (<t:1716054303:R>)
:one: allowed choice

:lock: No other votes allowed`,
	},
	"b99e9c66": {
		message_id: "1277729811846139934",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 0,
		created_at: "2024-08-26T20:42:06.216Z",
		content: "Vous avez répondu au sondage pour choisir un sticker Victory Road à retaper à la Rose Griffon il y a une semaine, voici la seconde partie où c'est VOUS qui choisissez qui l'incarnera ! Pour rappel : ce n'est pas un sondage de popularité, veuillez choisir en fonction du personnage que vous pensez le plus approprié pour l'expression donnée !",
		color: 16393766,
		footer: "Poll ID: b99e9c66",
		reactions: [{"emoji":{"id":"1142879907660181535","name":"RG_hurley_like"},"count":9}],
		description: `**Question**
Quel personnage aimeriez-vous voir incarner ce sticker (référence ci-dessus) ? Vous avez TROIS choix possibles !

**Choices**
🦌 Archer Hawkins / Tobitaka Seiya
🐉 Kevin Dragonfly / Someoka Ryuugo
🐻 Aiden Froste / Fubuki Atsuya (AresOrion)
⚔️ Victor Blade / Tsurugi Kyousuke
🟫 Buddy Fury / Kusaka Ryuuji
🐍 Michael Ballazck / Kurama Norihito
🥊 Frank Foreman / Tetsukado Shin
🐧 Elliot Ember / Haizaki Ryouhei

**Final Result**
🦌 ▓▓░░░░░░░░ [38 • 21%]
🐉 ▓▓░░░░░░░░ [34 • 19%]
🐻 ▓░░░░░░░░░ [24 • 13%]
⚔️ ▓░░░░░░░░░ [26 • 14%]
🟫 ░░░░░░░░░░ [8 • 4%]
🐍 ░░░░░░░░░░ [7 • 4%]
🥊 ░░░░░░░░░░ [6 • 3%]
🐧 ▓▓░░░░░░░░ [40 • 22%]
*183 votes from 100 users*

**Settings**
<:stopwatch:1263838160304082974> Poll already ended (<t:1725309726:R>)
<:three:1263838178511425598> allowed choices
<:lock:1263838023951450112> No other votes allowed`,
	},
	"d4caa664": {
		message_id: "1313241190824673370",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 0,
		created_at: "2024-12-02T20:31:38.734Z",
		content: "",
		color: 16393766,
		footer: "Poll ID: d4caa664",
		reactions: [{"emoji":{"id":null,"name":"💤"},"count":1}],
		description: `**Question**
Quel personnage irait le mieux pour cette émote (visuel ci-dessus) ? Vous avez le droit à 3 choix ! Attention, ce n'est pas un sondage de popularité, veuiller voter pour les personnages qui vous semblent le plus appropriés pour l'expression donnée !

**Choices**
🦅 Falco Flashman / Matatagi Hayato
😃 Steve Grimm / Handa Shinichi
👓 Eugene Peabody / Hayami Tsurumasa
🐲 Kevin Dragonfly / Someoka Ryuugo
🌸 Cerise Blossom / Nozaki Sakura
👌 Bobby Shearer / Domon Asuka
🎀 Jade Greene / Seto Midori
👾 Rugen Baran / Ryugel Baran

**Final Result**
🦅 ▓▓░░░░░░░░ [26 • 17%]
😃 ▓░░░░░░░░░ [11 • 7%]
👓 ▓▓░░░░░░░░ [29 • 19%]
🐲 ▓░░░░░░░░░ [8 • 5%]
🌸 ░░░░░░░░░░ [7 • 5%]
👌 ▓▓░░░░░░░░ [32 • 21%]
🎀 ▓░░░░░░░░░ [17 • 11%]
👾 ▓░░░░░░░░░ [21 • 14%]
*151 votes from 77 users*

**Settings**
<:stopwatch:1263838160304082974> Poll already ended (<t:1733776298:R>)
<:three:1263838178511425598> allowed choices
<:lock:1263838023951450112> No other votes allowed`,
	},
	"4faf107b": {
		message_id: "1346960062345908254",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2025-03-05T21:38:24.171Z",
		content: "",
		color: 16393766,
		footer: "Poll ID: 4faf107b",
		reactions: [],
		description: `**Question**
Quel personnage irait le mieux pour cette émote (visuel ci-dessus) ? Vous avez le droit à 3 choix ! Attention, ce n'est pas un sondage de popularité, veuiller voter pour les personnages qui vous semblent le plus appropriés pour l'expression donnée !

**Choices**
❄️ Shawn Froste / Fubuki Shirou
🐯 Austin Hobbs / Utsunomiya Toramaru
🌊 Sandra Fischer / Umihara Norika
🛡️ Duske Grayling / Nishikage Seiya
🐰 Jean Pierre Lapin / Nishizono Shinsuke
🏀 Terry Archibald / Ibuki Munemasa
👾 Dvalin / Desarm
🐅 Joseph King / Genda Kojirou

**Final Result**
❄️ ▓▓░░░░░░░░ | 15.8% (21)
🐯 ▓░░░░░░░░░ | 8.3% (11)
🌊 ▓░░░░░░░░░ | 6.0% (8)
🛡️ ░░░░░░░░░░ | 3.8% (5)
🐰 ▓▓▓░░░░░░░ | 29.3% (39)
🏀 ▓▓░░░░░░░░ | 15.0% (20)
👾 ▓░░░░░░░░░ | 8.3% (11)
🐅 ▓░░░░░░░░░ | 13.5% (18)
*133 votes from 77 users*

**Settings**
<:stopwatch:1263838160304082974> Poll already ended (<t:1741815503:R>)
<:choices:1332384702061084763> 3 allowed choices
<:lock:1263838023951450112> No other votes allowed`,
	},
	"3e501896": {
		message_id: "1532068802936705187",
		channel_id: "1135716082972381234",
		guild_id: "1072991720268111892",
		author_id: "437618149505105920",
		author_username: "EasyPoll",
		author_is_bot: true,
		type: 20,
		created_at: "2026-07-29T16:54:27.082Z",
		content: "",
		color: 16393766,
		footer: "ID du sondage : 3e501896",
		reactions: [],
		description: `**Question**
Quel personnage irait le mieux pour cette émote (visuel ci-dessus) ? Vous avez le droit à 3 choix ! Attention, ce n'est pas un sondage de popularité, veuiller voter pour les personnages qui vous semblent le plus appropriés pour l'expression donnée !

**Choix**
🥞 Goldie Lemmon / Nanobana Kinako
🌸 Shinohara Raika
🐰 Fei Rune
🕵️ Tori Vanguard / Zaizen Touko
🇮🇹 Paolo Bianchi / Fidio Aldena
💙 Skye Blue / Sorano Aoi
⚔️ Vladimir Blade / Tsurugi Yuuichi
👼 Byron Love / Afuro Terumi

**Résultat final**
🥞 ▓▓░░░░░░░░ | 20.8% (25)
🌸 ▓▓▓░░░░░░░ | 25.8% (31)
🐰 ▓░░░░░░░░░ | 11.7% (14)
🕵️ ▓░░░░░░░░░ | 7.5% (9)
🇮🇹 ▓░░░░░░░░░ | 7.5% (9)
💙 ▓░░░░░░░░░ | 9.2% (11)
⚔️ ▓░░░░░░░░░ | 10.0% (12)
👼 ▓░░░░░░░░░ | 7.5% (9)
*120 votes de 67 utilisateurs*

**Paramètres**
<:stopwatch:1263838160304082974> Sondage déjà terminé (<t:1785948540:R>)
<:choices:1332384702061084763> 3 choix autorisés
<:lock:1263838023951450112> Aucun autre vote autorisé`,
	},
};

const NATIF_1269002639828586547 = {
	message_id: "1269002639828586547",
	channel_id: "1135716082972381234",
	guild_id: "1072991720268111892",
	author_id: "218711013938167809",
	author_username: "thanatos_emio",
	created_at: "2024-08-02T18:43:26.264Z",
	poll: {
		"expiry": "2024-08-16T18:43:26.247581+00:00",
		"answers": [
			{
				"answer_id": 1,
				"poll_media": {
					"text": "Roy !"
				}
			},
			{
				"answer_id": 2,
				"poll_media": {
					"text": "Gaëlle !"
				}
			}
		],
		"results": {
			"is_finalized": true,
			"answer_counts": [
				{
					"id": 2,
					"count": 32,
					"me_voted": false
				},
				{
					"id": 1,
					"count": 50,
					"me_voted": false
				}
			]
		},
		"question": {
			"text": "Alors, pour l'InazumaRG, vous êtes plutôt team Roy ou Gaëlle ?"
		},
		"layout_type": 1,
		"allow_multiselect": false
	},
};

const NATIF_1276869517565493352 = {
	message_id: "1276869517565493352",
	channel_id: "1135716082972381234",
	guild_id: "1072991720268111892",
	author_id: "218711013938167809",
	author_username: "thanatos_emio",
	created_at: "2024-08-24T11:43:36.076Z",
	poll: {
		"expiry": "2024-08-27T11:43:36.069816+00:00",
		"answers": [
			{
				"answer_id": 1,
				"poll_media": {
					"text": "Oui"
				}
			},
			{
				"answer_id": 2,
				"poll_media": {
					"text": "Non"
				}
			}
		],
		"results": {
			"is_finalized": true,
			"answer_counts": [
				{
					"id": 2,
					"count": 16,
					"me_voted": false
				},
				{
					"id": 1,
					"count": 30,
					"me_voted": false
				}
			]
		},
		"question": {
			"text": "Vice-Versa"
		},
		"layout_type": 1,
		"allow_multiselect": false
	},
};

// ─── OUTILS ──────────────────────────────────────────────────────────────────

/** Message analysable construit à partir d'une fixture, sans rien inventer. */
function messageDe(encart: Encart): MessageSondage {
	return {
		message_id: encart.message_id,
		channel_id: encart.channel_id,
		guild_id: encart.guild_id,
		created_at: new Date(encart.created_at),
		content: encart.content,
		reactions: encart.reactions,
		author_id: encart.author_id,
		author_username: encart.author_username,
		author_is_bot: encart.author_is_bot,
		type: encart.type,
	};
}

/** Analyse une fixture et échoue explicitement si le parseur la rejette. */
function analyser(id: string): SondageExtrait {
	const encart = ENCARTS[id];
	if (!encart) throw new Error(`fixture ${id} absente`);
	const sondage = parseEasyPollEmbed(encart.description, encart.footer, messageDe(encart));
	if (!sondage) throw new Error(`fixture ${id} rejetée par le parseur`);
	return sondage;
}

const sommeVotes = (sondage: SondageExtrait): number =>
	sondage.options.reduce((total, option) => total + (option.votes ?? 0), 0);

// ─── ÈRES ET LANGUES ─────────────────────────────────────────────────────────

describe("parseEasyPollEmbed — les trois ères d'écriture", () => {
	test("3e501896 : encart FRANÇAIS complet, résultats « | 20.8% (25) »", () => {
		const s = analyser("3e501896");
		expect(s.poll_id).toBe("3e501896");
		expect(s.langue).toBe("fr");
		expect(s.provider).toBe("easypoll");
		expect(s.source).toBe("embed");
		expect(s.options).toHaveLength(8);
		expect(s.max_choices).toBe(3);
		expect(s.ended).toBe(true);
		expect(s.locked).toBe(true);
		expect(s.results_hidden).toBe(false);
		expect(s.total_votes).toBe(120);
		expect(s.total_voters).toBe(67);
		expect(s.ends_at?.toISOString()).toBe(new Date(1785948540 * 1000).toISOString());
		expect(s.options[0]).toMatchObject({
			position: 0,
			emoji: "🥞",
			label: "Goldie Lemmon / Nanobana Kinako",
			votes: 25,
			pourcentage: 20.8,
		});
		expect(sommeVotes(s)).toBe(120);
		expect(s.avertissements).toEqual([]);
	});

	test("4faf107b : encart ANGLAIS, même ère de résultats", () => {
		const s = analyser("4faf107b");
		expect(s.langue).toBe("en");
		expect(s.options).toHaveLength(8);
		expect(s.max_choices).toBe(3);
		expect(s.total_votes).toBe(133);
		expect(s.total_voters).toBe(77);
		expect(s.options[4]).toMatchObject({ emoji: "🐰", votes: 39, pourcentage: 29.3 });
		expect(s.avertissements).toEqual([]);
	});

	test("489f97c9 : ère 1 « [32 • 42%] » + « 77 users voted » = des VOTANTS", () => {
		const s = analyser("489f97c9");
		expect(s.options).toHaveLength(4);
		expect(s.max_choices).toBe(1);
		expect(s.locked).toBe(true);
		expect(s.options.map((o) => o.votes)).toEqual([32, 41, 2, 2]);
		expect(s.options.map((o) => o.pourcentage)).toEqual([42, 53, 3, 3]);
		// `N users voted` ne donne PAS le nombre de votes : il se reconstitue par
		// somme, et il vaut ici le même chiffre parce que le sondage est à choix
		// unique. Sur un multi-choix les deux divergent (cf. a453e8bb).
		expect(s.total_voters).toBe(77);
		expect(s.total_votes).toBe(77);
		expect(s.avertissements).toEqual([]);
	});

	test("d4caa664 : « <:three:1263838178511425598> allowed choices » (mot-emoji personnalisé)", () => {
		const s = analyser("d4caa664");
		expect(s.max_choices).toBe(3);
		expect(s.total_votes).toBe(151);
		expect(s.total_voters).toBe(77);
		expect(s.question.length).toBe(249);
		expect(s.avertissements).toEqual([]);
	});
});

describe("parseEasyPollEmbed — cas limites du corpus", () => {
	test("3c67262a : sondage en cours, aucun décompte publié", () => {
		const s = analyser("3c67262a");
		expect(s.results_hidden).toBe(true);
		expect(s.total_votes).toBeNull();
		expect(s.total_voters).toBeNull();
		expect(s.options).toHaveLength(10);
		expect(s.options.every((o) => o.votes === null && o.pourcentage === null)).toBe(true);
		expect(s.ended).toBe(false);
		expect(s.locked).toBe(false);
		expect(s.ends_at).toBeNull();
		expect(s.max_choices).toBe(3);
	});

	test("17ee14d2 : « :infinity: Unlimited choices » vaut 0, pas 1", () => {
		expect(analyser("17ee14d2").max_choices).toBe(0);
	});

	test("a453e8bb : VOTANTS ≠ VOTES, et emoji de vote suivi d'un second emoji", () => {
		const s = analyser("a453e8bb");
		expect(s.options).toHaveLength(12);
		expect(s.max_choices).toBe(4);
		expect(s.total_voters).toBe(97);
		expect(s.total_votes).toBe(167);
		expect(sommeVotes(s)).toBe(167);
		// Le PREMIER token est l'emoji de vote ; le 🩷 appartient au libellé.
		expect(s.options[9]).toMatchObject({ emoji: "🇯", label: "🩷 rose", votes: 13 });
		expect(s.options[10]).toMatchObject({ emoji: "🇰", label: "🩶 gris", votes: 6 });
		// Teintes de peau : le modificateur reste collé à l'emoji de vote.
		expect(s.options.slice(0, 3).map((o) => o.emoji)).toEqual(["👍🏻", "👍🏽", "👍🏿"]);
	});

	test("7835ac27 : quatre choix au libellé strictement identique", () => {
		const s = analyser("7835ac27");
		expect(s.options).toHaveLength(4);
		expect(s.options.map((o) => o.label)).toEqual(["Horreur", "Horreur", "Horreur", "Horreur"]);
		// La clé d'une option est sa POSITION, jamais son libellé.
		expect(s.options.map((o) => o.position)).toEqual([0, 1, 2, 3]);
	});

	test("bb1f3c28 : sondage à une seule option (inscription à un tirage)", () => {
		const s = analyser("bb1f3c28");
		expect(s.options).toHaveLength(1);
		expect(s.options[0]?.votes).toBe(42);
		expect(s.total_votes).toBe(42);
		expect(s.total_voters).toBe(42);
	});

	test("7fc282db : la question ne s'arrête pas au premier saut de ligne", () => {
		const s = analyser("7fc282db");
		expect(s.question.includes("\n")).toBe(true);
		expect(s.question.length).toBe(370);
		expect(s.options).toHaveLength(4);
		expect(s.max_choices).toBe(4);
	});

	test("4cabbaaf : emoji personnalisés conservés bruts, mention de rôle intacte", () => {
		const s = analyser("4cabbaaf");
		expect(s.options.map((o) => o.emoji)).toEqual([
			"<:IE_TerryLike:1089594869623832636>",
			"<:Hey2:1089276549120925717>",
			"🤷",
		]);
		expect(s.options[0]?.label).toBe("Style chibi");
		// Le balisage Discord de la question est CONSERVÉ : c'est le site qui le rend.
		expect(s.question).toContain("<@&1136286992620064778>");
	});
});

// ─── SONDAGE NATIF DISCORD ───────────────────────────────────────────────────

describe("parseSondageNatif", () => {
	test("1269002639828586547 : `answer_counts` arrive DANS LE DÉSORDRE", () => {
		const message: MessageSondage = {
			message_id: NATIF_1269002639828586547.message_id,
			channel_id: NATIF_1269002639828586547.channel_id,
			guild_id: NATIF_1269002639828586547.guild_id,
			created_at: new Date(NATIF_1269002639828586547.created_at),
			content: "",
			reactions: [],
			author_id: NATIF_1269002639828586547.author_id,
			author_username: NATIF_1269002639828586547.author_username,
			author_is_bot: false,
			type: 0,
		};
		const s = parseSondageNatif(NATIF_1269002639828586547.poll, message);
		expect(s).not.toBeNull();
		expect(s!.provider).toBe("discord");
		expect(s!.langue).toBeNull();
		expect(s!.poll_id).toBe("1269002639828586547");
		// Trié par `answer_id` : Roy (1) puis Gaëlle (2). Un appariement par
		// position aurait interverti 50 et 32.
		expect(s!.options.map((o) => o.label)).toEqual(["Roy !", "Gaëlle !"]);
		expect(s!.options.map((o) => o.votes)).toEqual([50, 32]);
		expect(s!.max_choices).toBe(1);
		expect(s!.ended).toBe(true);
		expect(s!.results_hidden).toBe(false);
		expect(s!.total_votes).toBe(82);
		// Sans multi-choix, un votant = un vote : 82, et non le score du gagnant.
		expect(s!.total_voters).toBe(82);
		// L'auteur du message EST le créateur : aucune déduction hasardeuse.
		expect(s!.creator_id).toBe("218711013938167809");
		expect(s!.creator_username).toBe("thanatos_emio");
	});

	test("un objet vide n'est pas un sondage", () => {
		const message = messageDe(ENCARTS["489f97c9"]!);
		expect(parseSondageNatif(null, message)).toBeNull();
		expect(parseSondageNatif({}, message)).toBeNull();
	});
});

// ─── RECONSTITUTION PAR LES RÉACTIONS ────────────────────────────────────────

describe("appliquerVotesDepuisReactions — les quatre garde-fous", () => {
	test("3c67262a : masqué + aligné + avant juin 2024 → reconstitué", () => {
		const encart = ENCARTS["3c67262a"]!;
		const s = appliquerVotesDepuisReactions(analyser("3c67262a"), encart.reactions);
		expect(s.source).toBe("reactions");
		// `count - 1` : EasyPoll amorce chaque choix de sa propre réaction.
		expect(s.options.map((o) => o.votes)).toEqual([45, 12, 11, 54, 11, 8, 23, 10, 33, 35]);
		expect(s.total_votes).toBe(242);
		// `results_hidden` RESTE vrai : c'est l'ENCART qui ne publie rien.
		expect(s.results_hidden).toBe(true);
		// Le nombre de votants distincts reste inconnu — on ne l'invente pas.
		expect(s.total_voters).toBeNull();
		// La reconstitution est une NOTE, pas un avertissement : elle est attendue
		// et sans gravité. Rangée dans `avertissements`, elle en noyait le signal
		// (25 entrées sur 51 sondages) et le rapport de fin de passe, censé rester
		// vide, n'avertissait plus de rien.
		expect(s.notes.join(" ")).toContain("reconstitué");
		expect(s.avertissements.join(" ")).not.toContain("reconstitué");
	});

	test("489f97c9 : résultats publiés ET réactions alignées → l'encart PRIME", () => {
		const encart = ENCARTS["489f97c9"]!;
		const avant = analyser("489f97c9");
		const apres = appliquerVotesDepuisReactions(avant, encart.reactions);
		expect(apres).toEqual(avant);
		expect(apres.source).toBe("embed");
		expect(apres.options.map((o) => o.votes)).toEqual([32, 41, 2, 2]);
	});

	test("b99e9c66 : réaction décorative → aucun décompte inventé", () => {
		const encart = ENCARTS["b99e9c66"]!;
		expect(encart.reactions).toHaveLength(1);
		const avant = analyser("b99e9c66");
		expect(appliquerVotesDepuisReactions(avant, encart.reactions)).toEqual(avant);
	});

	test("les emoji doivent correspondre EXACTEMENT, ordre compris", () => {
		const base = analyser("3c67262a");
		const encart = ENCARTS["3c67262a"]!;
		const inversees = [...encart.reactions].reverse();
		expect(appliquerVotesDepuisReactions(base, inversees)).toEqual(base);
		const tronquees = encart.reactions.slice(0, 9);
		expect(appliquerVotesDepuisReactions(base, tronquees)).toEqual(base);
		expect(appliquerVotesDepuisReactions(base, [])).toEqual(base);
	});

	test("après la bascule aux boutons, une réaction n'est plus un vote", () => {
		const encart = ENCARTS["3c67262a"]!;
		const tardif: SondageExtrait = {
			...analyser("3c67262a"),
			created_at: new Date(FIN_ERE_REACTIONS.getTime() + 1000),
		};
		expect(appliquerVotesDepuisReactions(tardif, encart.reactions)).toEqual(tardif);
	});
});

// ─── REJETS ET PURETÉ ────────────────────────────────────────────────────────

describe("parseEasyPollEmbed — rejets propres, jamais d'exception", () => {
	const message = () => messageDe(ENCARTS["489f97c9"]!);

	test("pied d'encart illisible", () => {
		const journal: { raison?: string } = {};
		expect(
			parseEasyPollEmbed("**Question**\nBonjour ?\n\n**Choices**\n🇦 Oui", "Poll", message(), journal)
		).toBeNull();
		expect(journal.raison).toBe("pied d'encart illisible");
	});

	test("description vide ou absente", () => {
		expect(parseEasyPollEmbed("", "Poll ID: abcdef", message())).toBeNull();
		expect(parseEasyPollEmbed(null, "Poll ID: abcdef", message())).toBeNull();
		expect(parseEasyPollEmbed(undefined, "Poll ID: abcdef", message())).toBeNull();
	});

	test("description sans section Question", () => {
		const journal: { raison?: string } = {};
		parseEasyPollEmbed("Un texte quelconque", "Poll ID: abcdef", message(), journal);
		expect(journal.raison).toBe("section question absente");
	});

	test("question vide", () => {
		const journal: { raison?: string } = {};
		parseEasyPollEmbed("**Question**\n\n**Choices**\n🇦 Oui", "Poll ID: abcdef", message(), journal);
		expect(journal.raison).toBe("question vide");
	});

	test("section choix absente", () => {
		const journal: { raison?: string } = {};
		parseEasyPollEmbed("**Question**\nBonjour ?", "Poll ID: abcdef", message(), journal);
		expect(journal.raison).toBe("section choix absente");
	});

	test("une ligne de paramètre inconnue avertit mais ne rejette pas", () => {
		const s = parseEasyPollEmbed(
			"**Question**\nBonjour ?\n\n**Choices**\n🇦 Oui\n\n**Settings**\n:sparkles: Quelque chose de neuf",
			"Poll ID: abcdef",
			message()
		);
		expect(s).not.toBeNull();
		expect(s!.avertissements.join(" ")).toContain("ligne de paramètre non reconnue");
		expect(s!.max_choices).toBe(1);
	});

	test("pureté : deux analyses identiques, argument non muté", () => {
		const encart = ENCARTS["a453e8bb"]!;
		const m = messageDe(encart);
		const copie = JSON.parse(JSON.stringify(m.reactions));
		const a = parseEasyPollEmbed(encart.description, encart.footer, m);
		const b = parseEasyPollEmbed(encart.description, encart.footer, m);
		expect(a).toEqual(b);
		expect(m.reactions).toEqual(copie);
	});
});

// ─── CHAPÔ ───────────────────────────────────────────────────────────────────

describe("chapoUtilisable", () => {
	test("un ping de rôle seul n'est pas un chapô", () => {
		expect(chapoUtilisable("<@&1136286992620064778>")).toBeNull();
		expect(chapoUtilisable("")).toBeNull();
		expect(chapoUtilisable("   ")).toBeNull();
	});

	test("un texte réel est conservé, débarrassé de ses mentions nues", () => {
		expect(chapoUtilisable(ENCARTS["489f97c9"]!.content)).toBe(
			"Premier sondage pour mieux vous connaître, vous et votre rapport à la license ! ⚡"
		);
		expect(chapoUtilisable("Nouveau sondage <@&1136286992620064778>")).toBe("Nouveau sondage");
	});
});

// ─── RATTACHEMENT DU VISUEL ──────────────────────────────────────────────────

describe("choisirVisuel", () => {
	const encart = { created_at: new Date("2026-07-29T16:54:27.082Z") };

	/** Message humain réel : la pièce jointe du sondage 3e501896 (−11 s). */
	const avecPieceJointe: MessageHumainAvecMedia = {
		message_id: "1532068756610744360",
		created_at: new Date("2026-07-29T16:54:16.037Z"),
		content: "",
		attachments: [
			{
				id: "1532068756304433293",
				url: "https://cdn.discordapp.com/attachments/1135716082972381234/1532068756304433293/20260729_arion_sondage.png?ex=6a7d4df7&is=6a7bfc77&hm=6fa766290e21c6e587dd8f75a937f51762c7ea2682ced9dd5c4b3549ab5ba4c7&",
				content_type: "image/png",
				filename: "20260729_arion_sondage.png",
				width: 5800,
				height: 4342,
				size: 4035887,
			},
		],
		embeds: [],
	};

	/** Message humain réel : le lien Tenor du sondage cc5449c8 (−27 s). */
	const avecVignetteTenor: MessageHumainAvecMedia = {
		message_id: "1159505289922478100",
		created_at: new Date("2023-10-05T15:00:03.684Z"),
		content: "https://tenor.com/view/think-smart-meme-use-your-head-gif-4595800915730774837",
		attachments: [],
		embeds: [
			{
				thumbnail: {
					url: "https://media.tenor.com/P8eQlVCMOzUAAAAe/think-smart-meme.png",
					width: 470,
					height: 470,
				},
			},
		],
	};

	test("le message le plus proche AVANT l'encart est retenu", () => {
		const v = choisirVisuel(encart, [avecPieceJointe]);
		expect(v?.message_id).toBe("1532068756610744360");
		expect(v?.attachment_id).toBe("1532068756304433293");
		expect(v?.ecart_s).toBe(-11);
		expect(v?.width).toBe(5800);
	});

	test("une vignette d'encart compte comme visuel (lien Tenor)", () => {
		const v = choisirVisuel({ created_at: new Date("2023-10-05T15:00:30.551Z") }, [
			avecVignetteTenor,
		]);
		expect(v?.attachment_id).toBe("embed-0");
		expect(v?.ecart_s).toBe(-27);
	});

	test("hors fenêtre de ±15 minutes : aucun rattachement", () => {
		const loin: MessageHumainAvecMedia = {
			...avecPieceJointe,
			created_at: new Date(encart.created_at.getTime() - 16 * 60 * 1000),
		};
		expect(choisirVisuel(encart, [loin])).toBeNull();
	});

	test("aucun candidat porteur d'image : aucun rattachement", () => {
		expect(choisirVisuel(encart, [])).toBeNull();
		expect(
			choisirVisuel(encart, [{ ...avecPieceJointe, attachments: [], embeds: [] }])
		).toBeNull();
	});

	test("le précédent l'emporte sur le suivant, même plus proche", () => {
		const suivant: MessageHumainAvecMedia = {
			...avecPieceJointe,
			message_id: "apres",
			created_at: new Date(encart.created_at.getTime() + 2000),
		};
		expect(choisirVisuel(encart, [suivant, avecPieceJointe])?.message_id).toBe(
			"1532068756610744360"
		);
	});

	test("à défaut de précédent, le suivant est retenu", () => {
		const suivant: MessageHumainAvecMedia = {
			...avecPieceJointe,
			message_id: "apres",
			created_at: new Date(encart.created_at.getTime() + 24000),
		};
		expect(choisirVisuel(encart, [suivant])?.ecart_s).toBe(24);
	});
});

// ─── CANARIS DE CORPUS ───────────────────────────────────────────────────────

describe("cohérence du corpus", () => {
	test("color = 16393766 ⟺ résultats publiés ET terminé ET verrouillé", () => {
		for (const [id, encart] of Object.entries(ENCARTS)) {
			const s = parseEasyPollEmbed(encart.description, encart.footer, messageDe(encart));
			expect(s, `fixture ${id}`).not.toBeNull();
			const publie = !s!.results_hidden && s!.ended && s!.locked;
			expect(encart.color === 16393766, `fixture ${id}`).toBe(publie);
		}
	});

	test("chaque fixture rend son propre identifiant de pied d'encart", () => {
		for (const [id, encart] of Object.entries(ENCARTS)) {
			expect(analyser(id).poll_id, encart.footer).toBe(id);
		}
	});
});

// ─── LIGNE ROUGE : VIE PRIVÉE ────────────────────────────────────────────────

describe("garde-fous du fichier d'import", () => {
	test("la tâche ne mentionne JAMAIS discord_poll_votes", async () => {
		const source = await Bun.file(new URL("./discord-polls.ts", import.meta.url)).text();
		expect(source.includes("discord_poll_votes")).toBe(false);
	});

	test("les récapitulatifs POLL_RESULT (type 46) sont exclus du sélecteur", async () => {
		const source = await Bun.file(new URL("./discord-polls.ts", import.meta.url)).text();
		expect(source).toContain("m.type <> 46");
	});
});
