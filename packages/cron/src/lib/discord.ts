/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client, IntentsBitField, Partials, ActivityType, type Guild, type GuildMember, type User } from "discord.js";
import { sql } from "./db.js";
import { resolveGuildId } from "@rosegriffon/types/discord";

export const GUILD_ID = resolveGuildId(Bun.env as Record<string, string | undefined>);
export const DISCORD_TOKEN = Bun.env.DISCORD_BOT_TOKEN || Bun.env.DISCORD_TOKEN;

export interface DiscordTelemetry {
	onlineCount: number;
	idleCount: number;
	dndCount: number;
	offlineCount: number;
	totalMembers: number;
	voiceStateCount: number;
	streamingCount: number;
	activeGames: { game: string; count: number }[];
	voiceChannels: { channelId: string; name: string; count: number }[];
	lastUpdate: string;
}

let discordClient: Client | null = null;
let latestTelemetry: DiscordTelemetry | null = null;
let telemetryCallbacks: ((telemetry: DiscordTelemetry) => void)[] = [];

export function getDiscordClient(): Client | null {
	return discordClient;
}

export function getDiscordTelemetry(): DiscordTelemetry | null {
	if (!latestTelemetry && discordClient && GUILD_ID) {
		const guild = discordClient.guilds.cache.get(GUILD_ID);
		if (guild) {
			latestTelemetry = computeTelemetry(guild);
		}
	}
	return latestTelemetry;
}

export function onTelemetryUpdate(callback: (telemetry: DiscordTelemetry) => void) {
	telemetryCallbacks.push(callback);
}

function notifyTelemetryUpdate(telemetry: DiscordTelemetry) {
	latestTelemetry = telemetry;
	for (const cb of telemetryCallbacks) {
		try {
			cb(telemetry);
		} catch (err) {
			console.error("[discord-telemetry] Callback error:", err);
		}
	}
}

export function computeTelemetry(guild: Guild): DiscordTelemetry {
	let onlineCount = 0;
	let idleCount = 0;
	let dndCount = 0;
	let offlineCount = 0;
	let voiceStateCount = 0;
	let streamingCount = 0;
	const activeGamesMap = new Map<string, number>();
	const voiceChannelsMap = new Map<string, { name: string; count: number }>();

	for (const member of guild.members.cache.values()) {
		const presence = member.presence;
		if (!presence || presence.status === "offline") {
			offlineCount++;
		} else {
			if (presence.status === "online") onlineCount++;
			else if (presence.status === "idle") idleCount++;
			else if (presence.status === "dnd") dndCount++;

			if (presence.activities) {
				for (const activity of presence.activities) {
					if (activity.type === ActivityType.Playing) {
						activeGamesMap.set(activity.name, (activeGamesMap.get(activity.name) || 0) + 1);
					}
					if (activity.type === ActivityType.Streaming) {
						streamingCount++;
					}
				}
			}
		}

		const voiceState = member.voice;
		if (voiceState && voiceState.channelId) {
			voiceStateCount++;
			const ch = voiceState.channel;
			if (ch) {
				const current = voiceChannelsMap.get(ch.id) || { name: ch.name, count: 0 };
				current.count++;
				voiceChannelsMap.set(ch.id, current);
			}
		}
	}

	const activeGames = [...activeGamesMap.entries()]
		.map(([game, count]) => ({ game, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10);

	const voiceChannels = [...voiceChannelsMap.entries()].map(([channelId, { name, count }]) => ({
		channelId,
		name,
		count,
	}));

	return {
		onlineCount,
		idleCount,
		dndCount,
		offlineCount,
		totalMembers: guild.memberCount,
		voiceStateCount,
		streamingCount,
		activeGames,
		voiceChannels,
		lastUpdate: new Date().toISOString(),
	};
}

/** Intents historiques du démon : télémétrie, membres, présences, salons vocaux. */
const INTENTS_HISTORIQUES = [
	IntentsBitField.Flags.Guilds,
	IntentsBitField.Flags.GuildMembers,
	IntentsBitField.Flags.GuildPresences,
	IntentsBitField.Flags.GuildVoiceStates,
];

/** Intents supplémentaires exigés par la veille des salons suivis. */
const INTENTS_VEILLE_MESSAGES = [
	IntentsBitField.Flags.GuildMessages,
	IntentsBitField.Flags.MessageContent,
	IntentsBitField.Flags.GuildMessageReactions,
];

const PARTIALS_HISTORIQUES = [Partials.GuildMember, Partials.User];
const PARTIALS_VEILLE_MESSAGES = [Partials.Message, Partials.Channel, Partials.Reaction];

let veilleTempsReelDisponible = false;

/**
 * Indique si la passerelle a bien obtenu les intents de la veille des messages.
 * À `false`, l'archivage des salons se limite au rattrapage REST périodique.
 */
export function laVeilleTempsReelEstDisponible(): boolean {
	return veilleTempsReelDisponible;
}

/** Reconnaît le refus d'un intent privilégié (fermeture 4014 de la passerelle). */
function estRefusDIntents(err: unknown): boolean {
	const code = (err as { code?: unknown } | null)?.code;
	const message = err instanceof Error ? err.message : String(err);
	return code === "DisallowedIntents" || /disallowed intents|privileged intent|4014/i.test(message);
}

export async function initDiscord(): Promise<Client | null> {
	if (!DISCORD_TOKEN) {
		console.warn("⚠ DISCORD_TOKEN is not set. Discord integration disabled.");
		return null;
	}

	if (!GUILD_ID) {
		console.warn("⚠ DISCORD_GUILD_ID is not set. Discord integration disabled.");
		return null;
	}

	console.log("[Discord] Initialisation du client Discord...");

	// Première tentative avec les intents étendus (messages, contenu, réactions).
	const etendu = await connecterClient(true);
	if (etendu.client) {
		veilleTempsReelDisponible = true;
		return etendu.client;
	}

	// GARDE-FOU : si le portail développeur n'autorise pas ces intents privilégiés,
	// Discord ferme la connexion et le démon cron ENTIER ne démarrerait plus. On
	// retente donc avec le jeu d'intents historique, quitte à perdre le temps réel.
	if (!etendu.intentsRefuses) return null;

	console.warn(
		"⚠ [Discord] Intents messages refusés par Discord (GuildMessages / MessageContent / GuildMessageReactions non activés sur le portail développeur)."
	);
	console.warn(
		"⚠ [Discord] Reconnexion avec les intents historiques : la veille des salons est DÉGRADÉE en simple rattrapage REST (aucun événement temps réel, uniquement la synchro périodique)."
	);
	const replique = await connecterClient(false);
	return replique.client;
}

/** Construit un client, branche ses écouteurs et le connecte. */
function connecterClient(
	avecVeilleMessages: boolean
): Promise<{ client: Client | null; intentsRefuses: boolean }> {
	const client = new Client({
		intents: avecVeilleMessages
			? [...INTENTS_HISTORIQUES, ...INTENTS_VEILLE_MESSAGES]
			: INTENTS_HISTORIQUES,
		partials: avecVeilleMessages
			? [...PARTIALS_HISTORIQUES, ...PARTIALS_VEILLE_MESSAGES]
			: PARTIALS_HISTORIQUES,
	});

	return new Promise<{ client: Client | null; intentsRefuses: boolean }>((resolve) => {
		client.once("ready", async () => {
			console.log(`✓ Discord connecté en tant que ${client.user?.tag}`);
			// Affectation ici AUSSI : `ready` peut précéder la résolution de
			// `login()`, et les tâches lancées juste après `initDiscord()` appellent
			// `getDiscordClient()` sans attendre.
			discordClient = client;

			const guild = client.guilds.cache.get(GUILD_ID);
			if (!guild) {
				console.warn(`⚠ Bot n'est pas dans le serveur avec l'ID : ${GUILD_ID}`);
				resolve({ client, intentsRefuses: false });
				return;
			}

			// Pré-remplir le cache des membres pour avoir des présences et des stats précises au démarrage
			try {
				console.log("[Discord] Chargement initial des membres et présences...");
				await guild.members.fetch();
				console.log(`✓ ${guild.members.cache.size} membres chargés.`);
				
				// Première génération de la télémétrie
				const telemetry = computeTelemetry(guild);
				notifyTelemetryUpdate(telemetry);
			} catch (err) {
				console.error("✗ Échec du chargement initial des membres:", err);
			}
			resolve({ client, intentsRefuses: false });
		});

		// Événements en temps réel pour la télémétrie
		client.on("presenceUpdate", (oldPresence, newPresence) => {
			if (newPresence.guild?.id !== GUILD_ID) return;
			const guild = client.guilds.cache.get(GUILD_ID);
			if (guild) {
				notifyTelemetryUpdate(computeTelemetry(guild));
			}
		});

		client.on("voiceStateUpdate", (oldState, newState) => {
			if (newState.guild?.id !== GUILD_ID) return;
			const guild = client.guilds.cache.get(GUILD_ID);
			if (guild) {
				notifyTelemetryUpdate(computeTelemetry(guild));
			}
		});

		client.on("guildMemberAdd", async (member) => {
			if (member.guild.id !== GUILD_ID) return;
			console.log(`[Discord] Membre rejoint : ${member.user.tag}`);
			await syncOneMember(member).catch((err) => console.error("[guildMemberAdd] sync failed:", err));
			const guild = client.guilds.cache.get(GUILD_ID);
			if (guild) notifyTelemetryUpdate(computeTelemetry(guild));
		});

		client.on("guildMemberRemove", async (member) => {
			if (member.guild.id !== GUILD_ID) return;
			console.log(`[Discord] Membre parti : ${member.user.tag}`);
			// Marquage plutôt que suppression : un DELETE perdait `joined_at` et
			// l'historique de rôles, et surtout ne rattrapait jamais les départs
			// survenus pendant une coupure du démon — 173 lignes fantômes constatées
			// le 11/8/2026. Le profil pré-créé correspondant part avec.
			await sql`UPDATE discord_members SET left_at = now(), updated_at = now() WHERE discord_id = ${member.id}`
				.catch((err) => console.error("[guildMemberRemove] marquage du départ impossible:", err));
			await sql`DELETE FROM profiles WHERE discord_id = ${member.id} AND claimed_at IS NULL`
				.catch((err) => console.error("[guildMemberRemove] retrait du profil pré-créé impossible:", err));
			const guild = client.guilds.cache.get(GUILD_ID);
			if (guild) notifyTelemetryUpdate(computeTelemetry(guild));
		});

		client.on("guildMemberUpdate", async (oldMember, newMember) => {
			if (newMember.guild.id !== GUILD_ID) return;
			await syncOneMember(newMember).catch((err) => console.error("[guildMemberUpdate] sync failed:", err));
		});

		client.on("userUpdate", async (oldUser, newUser) => {
			const guild = client.guilds.cache.get(GUILD_ID);
			if (!guild) return;
			await syncOneUser(newUser, guild).catch((err) => console.error("[userUpdate] sync failed:", err));
		});

		client.login(DISCORD_TOKEN)
			.then(() => {
				discordClient = client;
			})
			.catch((err) => {
				const intentsRefuses = estRefusDIntents(err);
				if (!intentsRefuses) {
					console.error("✗ Échec de la connexion Discord:", err);
				}
				// Le client à moitié connecté doit être libéré avant toute nouvelle
				// tentative, sinon sa reconnexion automatique rejoue le même refus.
				void client.destroy().catch(() => {});
				resolve({ client: null, intentsRefuses });
			});
	});
}

// ─── SERVICES DE SYNCHRONISATION ──────────────────────────────────────────

function resolveAvatarUrl(member: GuildMember): string | null {
	const guildAvatar = member.avatarURL({ size: 256, extension: "webp" });
	if (guildAvatar) return guildAvatar;
	const userAvatar = member.user.avatarURL({ size: 256, extension: "webp" });
	if (userAvatar) return userAvatar;
	return member.user.defaultAvatarURL ?? null;
}

function resolveUserAvatarUrl(user: User): string | null {
	return user.avatarURL({ size: 256, extension: "webp" }) ?? user.defaultAvatarURL ?? null;
}

function toPgTextArray(values: string[]): string {
	return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

interface MemberRow {
	discord_id: string;
	username: string;
	display_name: string | null;
	nickname: string | null;
	avatar_url: string | null;
	joined_at: string | null;
	premium_since: string | null;
	roles: string[];
	is_bot: boolean;
	updated_at: string;
}

export function memberToRow(member: GuildMember): MemberRow {
	const roleIds = [...member.roles.cache.keys()].filter((id) => id !== member.guild.id);
	return {
		discord_id: member.id,
		username: member.user.username,
		display_name: member.user.globalName ?? null,
		nickname: member.nickname ?? null,
		avatar_url: resolveAvatarUrl(member),
		joined_at: member.joinedAt?.toISOString() ?? null,
		premium_since: member.premiumSince?.toISOString() ?? null,
		roles: roleIds,
		is_bot: member.user.bot,
		updated_at: new Date().toISOString(),
	};
}

async function upsertRow(row: MemberRow): Promise<void> {
	const rolesLiteral = toPgTextArray(row.roles || []);
	await sql`
    INSERT INTO discord_members (
      discord_id, username, display_name, nickname,
      avatar_url, joined_at, premium_since, roles, is_bot, updated_at
    ) VALUES (
      ${row.discord_id}, ${row.username}, ${row.display_name}, ${row.nickname},
      ${row.avatar_url}, ${row.joined_at}, ${row.premium_since}, ${rolesLiteral}::text[], ${row.is_bot}, NOW()
    )
    ON CONFLICT (discord_id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      nickname = EXCLUDED.nickname,
      avatar_url = EXCLUDED.avatar_url,
      joined_at = COALESCE(EXCLUDED.joined_at, discord_members.joined_at),
      premium_since = EXCLUDED.premium_since,
      roles = EXCLUDED.roles,
      is_bot = EXCLUDED.is_bot,
      updated_at = NOW()
  `;
}

async function syncUserImage(discordId: string, avatarUrl: string | null): Promise<void> {
	if (!avatarUrl) return;
	await sql`
    UPDATE "user" u
    SET image = ${avatarUrl}, updated_at = NOW()
    FROM account a
    WHERE a.user_id = u.id AND a.provider_id = 'discord' AND a.account_id = ${discordId}
  `;
}

export interface SyncReport {
	fetched: number;
	upserted: number;
	/** Membres marqués comme partis par la réconciliation de ce balayage. */
	partis: number;
	errors: { discordId: string; reason: string }[];
	durationMs: number;
}

export async function syncAllMembers(guild: Guild): Promise<SyncReport> {
	const start = Date.now();
	let members = guild.members.cache;
	if (members.size === 0) {
		console.log("[Cron Discord] Cache vide, chargement des membres depuis l'API...");
		try {
			members = await guild.members.fetch();
		} catch (err) {
			console.warn("[Cron Discord] guild.members.fetch() failed (probably rate limited), falling back to cache:", err);
			members = guild.members.cache;
		}
	} else {
		console.log(`[Cron Discord] Utilisation de ${members.size} membres depuis le cache.`);
	}
	const errors: SyncReport["errors"] = [];
	let upserted = 0;

	// Récupérer les comptes Discord reliés pour éviter 1900+ requêtes SQL lentes d'update inutile sur la table "user"
	const linkedAccounts = await sql`SELECT account_id FROM account WHERE provider_id = 'discord'`;
	const linkedDiscordIds = new Set(linkedAccounts.map((a: any) => a.account_id));

	for (const member of members.values()) {
		try {
			const row = memberToRow(member);
			await upsertRow(row);
			if (linkedDiscordIds.has(row.discord_id)) {
				await syncUserImage(row.discord_id, row.avatar_url);
			}
			upserted++;
		} catch (err) {
			errors.push({
				discordId: member.id,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// Réconciliation : tout membre que ce balayage complet n'a pas vu a quitté le
	// serveur. Sans cette étape, seuls les départs observés en direct étaient
	// enregistrés, et le démon manque forcément ceux de ses coupures.
	let partis = 0;
	try {
		const sortis = await sql`
			UPDATE discord_members
			   SET left_at = now()
			 WHERE left_at IS NULL
			   AND updated_at < ${new Date(start).toISOString()}::timestamptz
			RETURNING discord_id`;
		partis = sortis.length;
		if (partis > 0) {
			await sql`
				DELETE FROM profiles
				 WHERE claimed_at IS NULL
				   AND discord_id IN (
				       SELECT discord_id FROM discord_members WHERE left_at IS NOT NULL
				   )`;
		}
	} catch (err) {
		console.error("[discord] réconciliation des départs impossible:", err);
	}

	// L'invariant « tout membre actuel a un profil » est maintenu ici plutôt que
	// par un trigger : un trigger tournerait à chaque ligne de chaque balayage et
	// ferait échouer la synchro entière à la moindre exception.
	try {
		const [res] = await sql`SELECT * FROM rg_precreer_profils_discord()`;
		if (res?.crees) {
			console.log(`[discord] ${res.crees} profil(s) pré-créé(s)`);
		}
	} catch (err) {
		console.error("[discord] pré-création des profils impossible:", err);
	}

	return {
		fetched: members.size,
		upserted,
		partis,
		errors,
		durationMs: Date.now() - start,
	};
}

export async function syncOneMember(member: GuildMember): Promise<void> {
	const row = memberToRow(member);
	await upsertRow(row);
	await syncUserImage(row.discord_id, row.avatar_url);
}

export async function syncOneUser(user: User, guild: Guild): Promise<void> {
	const member =
		guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
	if (member) {
		await syncOneMember(member);
		return;
	}
	const avatarUrl = resolveUserAvatarUrl(user);
	await sql`
    UPDATE discord_members
    SET username = ${user.username},
        display_name = ${user.globalName ?? null},
        avatar_url = ${avatarUrl},
        is_bot = ${user.bot},
        updated_at = NOW()
    WHERE discord_id = ${user.id}
  `;
	await syncUserImage(user.id, avatarUrl);
}

interface StaffRow {
	id: string;
	name: string;
	discord_user_id: string;
	current_image: string | null;
}

export interface StaffPhotoSyncReport {
	total: number;
	updated: number;
	unchanged: number;
	errors: { name: string; reason: string }[];
	durationMs: number;
}

export async function syncStaffPhotos(client: Client): Promise<StaffPhotoSyncReport> {
	const start = Date.now();
	const rows = await sql<StaffRow[]>`
    SELECT id, name, discord_user_id, image_url AS current_image
    FROM team_members
    WHERE is_active = true AND discord_user_id IS NOT NULL AND discord_user_id != ''
    ORDER BY team_id, order_index, name
  `;

	const errors: StaffPhotoSyncReport["errors"] = [];
	let updated = 0;
	let unchanged = 0;

	// Récupérer les comptes Discord reliés pour éviter les requêtes SQL lentes d'update inutile sur la table "user"
	const linkedAccounts = await sql`SELECT account_id FROM account WHERE provider_id = 'discord'`;
	const linkedDiscordIds = new Set(linkedAccounts.map((a: any) => a.account_id));

	for (const row of rows) {
		try {
			// Utiliser le cache en priorité (fetch sans force: true interroge le cache d'abord)
			const user = await client.users.fetch(row.discord_user_id);
			const newWebp = user.displayAvatarURL({ size: 256, extension: "webp" });

			if (row.current_image === newWebp) {
				unchanged++;
				continue;
			}

			const newPng = newWebp.replace(".webp", ".png").replace(/\?size=\d+/, "");

			await sql`UPDATE team_members SET image_url = ${newWebp}, updated_at = NOW() WHERE id = ${row.id}`;
			await sql`
        INSERT INTO discord_members (discord_id, username, display_name, avatar_url, is_bot, updated_at)
        VALUES (${row.discord_user_id}, ${user.username}, ${user.globalName ?? null}, ${newWebp}, ${user.bot}, NOW())
        ON CONFLICT (discord_id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = NOW()
      `;

			if (linkedDiscordIds.has(row.discord_user_id)) {
				await sql`
          UPDATE "user" u
          SET image = ${newPng}, updated_at = NOW()
          FROM account a
          WHERE a.user_id = u.id
            AND a.provider_id = 'discord'
            AND a.account_id = ${row.discord_user_id}
        `;
			}

			updated++;
		} catch (err) {
			errors.push({
				name: row.name,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return {
		total: rows.length,
		updated,
		unchanged,
		errors,
		durationMs: Date.now() - start,
	};
}

export interface RoleSyncReport {
	fetched: number;
	upserted: number;
	errors: { roleId: string; name: string; reason: string }[];
	durationMs: number;
}

export async function syncAllRoles(guild: Guild): Promise<RoleSyncReport> {
	const start = Date.now();
	const roles = await guild.roles.fetch();
	const errors: RoleSyncReport["errors"] = [];
	let upserted = 0;

	for (const role of roles.values()) {
		try {
			await sql`
				INSERT INTO discord_roles (
					role_id, guild_id, name, color, position, is_hoisted, is_mentionable, permissions, icon_url, updated_at
				) VALUES (
					${role.id}, ${guild.id}, ${role.name}, ${role.color}, ${role.position}, ${role.hoist}, ${role.mentionable}, ${role.permissions.bitfield.toString()}, ${role.iconURL({ size: 128, extension: "webp" }) ?? null}, NOW()
				)
				ON CONFLICT (role_id) DO UPDATE SET
					name = EXCLUDED.name,
					color = EXCLUDED.color,
					position = EXCLUDED.position,
					is_hoisted = EXCLUDED.is_hoisted,
					is_mentionable = EXCLUDED.is_mentionable,
					permissions = EXCLUDED.permissions,
					icon_url = EXCLUDED.icon_url,
					updated_at = NOW()
			`;
			upserted++;
		} catch (err) {
			errors.push({
				roleId: role.id,
				name: role.name,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return {
		fetched: roles.size,
		upserted,
		errors,
		durationMs: Date.now() - start,
	};
}
