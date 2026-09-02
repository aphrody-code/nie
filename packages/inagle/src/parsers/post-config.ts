/**
 * @file post-config.ts
 * @description Parser for post/delivery/password files
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ParsedPassword {
	id: string;
	codes: string[]; // List of valid codes (localized)
	conditions?: string;
}

export interface ParsedDelivery {
	itemId: string;
	quantity: number;
	isPassphrase: boolean;
}

export function buildPostDatabase(dataPath: string) {
	const dir = join(dataPath, "common", "gamedata", "post");

	const passwords: ParsedPassword[] = [];
	const deliveries: ParsedDelivery[] = [];

	if (!existsSync(dir)) {
		console.warn("[post-config] Directory not found:", dir);
		return { passwords, deliveries };
	}

	// 1. Passwords
	const passFile = join(dir, "password_list_config.cfg.bin.json");
	if (existsSync(passFile)) {
		try {
			const content = JSON.parse(readFileSync(passFile, "utf-8"));
			if (content.lists) {
				const codesList = content.lists.find((l: any) => l.name === "m_Codes")?.values || [];
				// The 'info' list links IDs to codes?
				// Actually m_Codes seems to be the source.
				// But wait, the previous cat showed m_Codes has "japanese", "english", etc.
				// And "info" has "codes": [0, 1] indices into m_Codes.

				const infoList = content.lists.find((l: any) => l.name === "info")?.values || [];

				for (const info of infoList) {
					const pass: ParsedPassword = {
						id: info.id,
						conditions: info.conditions,
						codes: [],
					};

					if (info.codes && Array.isArray(info.codes)) {
						for (const idx of info.codes) {
							const codeEntry = codesList[idx];
							if (codeEntry) {
								// Collect all unique codes from locales
								const variants = new Set<string>();
								Object.values(codeEntry).forEach((v: any) => {
									if (typeof v === "string" && v.length > 2) variants.add(v);
								});
								pass.codes.push(...Array.from(variants));
							}
						}
					}
					passwords.push(pass);
				}
			}
		} catch (e) {
			console.error("[post-config] Failed to parse passwords", e);
		}
	}

	// 2. Deliveries
	const files = readdirSync(dir);
	const deliveryFile = files.find(
		(f) => f.startsWith("delivery_config_") && f.endsWith(".cfg.bin.json")
	);
	if (deliveryFile) {
		try {
			const content = JSON.parse(readFileSync(join(dir, deliveryFile), "utf-8"));
			if (content.lists) {
				const list =
					content.lists.find((l: any) => l.name === "m_DeliveryContentsDataList")?.values || [];
				for (const entry of list) {
					deliveries.push({
						itemId: entry.itemIdCrc,
						quantity: entry.num || 1,
						isPassphrase: entry.isPassphrase || false,
					});
				}
			}
		} catch (e) {
			console.error("[post-config] Failed to parse deliveries", e);
		}
	}

	console.log(
		`[PostParser] Loaded ${passwords.length} passwords, ${deliveries.length} deliveries.`
	);
	return { passwords, deliveries };
}
