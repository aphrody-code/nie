import { describe, expect, mock, test } from "bun:test";
import type { AssetSource } from "@niers/asset-source";
import { INITIAL_AVATAR_STATE } from "@niers/inacord-ui/avatar/contract";
import { avatarProject, profileWithPlayerStats, resolvePlayerReference } from "./AvatarExtensions";

describe("Avatar OC extensions", () => {
	test("resolves an exact canonical player and maps all seven database stats", async () => {
		let request: unknown;
		const source = {
			hote: "nie",
			entityRows: async (table: string, options: unknown) => {
				request = { table, options };
				return {
					elements: [{
						internal_code: "c05024700", base_slug: "victor-blade", slug: "victor-blade",
						name_fr: "Victor Blade", name_en: "Victor Blade", name_ja: null,
						element: "air", position: "FW", model_id: "mdl_chara_05024700",
						stat_frappe: 101, stat_controle: 102, stat_technique: 103,
						stat_pression: 104, stat_physique: 105, stat_agilite: 106,
						stat_intelligence: 107,
					}],
				};
			},
			urlModele: (code: string) => `/modeles/personnages/${code}.glb`,
		} as unknown as AssetSource;

		const player = await resolvePlayerReference(source, { identifier: "victor-blade" });
		expect(request).toMatchObject({ table: "inagle_characters", options: { q: "victor-blade", perPage: 200 } });
		expect(player).toMatchObject({
			internalCode: "c05024700", modelUrl: "/modeles/personnages/c05024700.glb",
			stats: { kick: 101, control: 102, technique: 103, pressure: 104, physical: 105, agility: 106, intelligence: 107 },
		});
	});

	test("copies reference stats only through the explicit profile operation", () => {
		const profile = { ...INITIAL_AVATAR_STATE.profile, name: "OC", kick: 10 };
		const copied = profileWithPlayerStats(profile, { kick: 200, intelligence: 180 });
		expect(profile).toMatchObject({ kick: 10 });
		expect(copied).toMatchObject({ name: "OC", kick: 200, intelligence: 180 });
	});

	test("delegates OC serialization to the Rust-WASM owner with stats and file metadata", async () => {
		const owner = mock(async (_catalog, state, metadata) => JSON.stringify({
			schema: "niers.oc.avatar-document/v1", avatarState: state, ...metadata,
		}));
		const catalog = { categories: [], modelesDeBase: { morphologies: [], visages: [] } } as never;
		const json = await avatarProject(catalog, {
			...INITIAL_AVATAR_STATE,
			profile: { ...INITIAL_AVATAR_STATE.profile, kick: 77, agility: 88 },
		}, {
			slug: "my-oc",
			internalCode: null,
			references: [{ kind: "glb", value: "avatar.glb", bytes: 1234, sha256: "a".repeat(64) }],
		}, owner);
		const document = JSON.parse(json);
		expect(document).toMatchObject({
			schema: "niers.oc.avatar-document/v1",
			slug: "my-oc",
			avatarState: { profile: { kick: 77, agility: 88 } },
			references: [{ kind: "glb", value: "avatar.glb", bytes: 1234, sha256: "a".repeat(64) }],
		});
		expect(json).not.toContain("data:application/octet-stream");
		expect(owner).toHaveBeenCalledTimes(1);
	});
});
