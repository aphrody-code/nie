export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	graphql_public: {
		Tables: {
			[_ in never]: never;
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			graphql: {
				Args: {
					extensions?: Json;
					operationName?: string;
					query?: string;
					variables?: Json;
				};
				Returns: Json;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
	public: {
		Tables: {
			articles: {
				Row: {
					author_id: string | null;
					category: string | null;
					content: string | null;
					created_at: string | null;
					excerpt: string | null;
					featured_image_url: string | null;
					id: string;
					pinned: boolean;
					published_at: string | null;
					slug: string;
					status: string | null;
					title: string;
					updated_at: string | null;
				};
				Insert: {
					author_id?: string | null;
					category?: string | null;
					content?: string | null;
					created_at?: string | null;
					excerpt?: string | null;
					featured_image_url?: string | null;
					id?: string;
					pinned?: boolean;
					published_at?: string | null;
					slug: string;
					status?: string | null;
					title: string;
					updated_at?: string | null;
				};
				Update: {
					author_id?: string | null;
					category?: string | null;
					content?: string | null;
					created_at?: string | null;
					excerpt?: string | null;
					featured_image_url?: string | null;
					id?: string;
					pinned?: boolean;
					published_at?: string | null;
					slug?: string;
					status?: string | null;
					title?: string;
					updated_at?: string | null;
				};
				Relationships: [];
			};
			inagle_auras: {
				Row: {
					asset_code: string | null;
					created_at: string | null;
					description_fr: string | null;
					element_id: number | null;
					id: string;
					image_url: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					sheet_data: Json | null;
					sub_type: string | null;
				};
				Insert: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					element_id?: number | null;
					id: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Update: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					element_id?: number | null;
					id?: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Relationships: [];
			};
			inagle_awakenings: {
				Row: {
					asset_code: string | null;
					created_at: string | null;
					description_fr: string | null;
					description_ja: string | null;
					element_id: number | null;
					id: string;
					image_url: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					sheet_data: Json | null;
					sub_type: string | null;
				};
				Insert: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Update: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id?: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Relationships: [];
			};
			inagle_characters: {
				Row: {
					constellation: string | null;
					constellation_index: number | null;
					data: Json | null;
					description_en: string | null;
					description_fr: string | null;
					description_ja: string | null;
					element: string | null;
					gender: string | null;
					id: string;
					image_url: string | null;
					internal_code: string | null;

					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					position: string | null;
					rarity: number | null;
					rarity_label: string | null;
					series: string | null;
					sheet_data: Json | null;
					skills: Json | null;
					slug: string | null;
					stat_agilite: number | null;
					stat_controle: number | null;
					stat_frappe: number | null;
					stat_intelligence: number | null;
					stat_physique: number | null;
					stat_pression: number | null;
					stat_technique: number | null;
					stats: Json | null;
					team_id: string | null;
					teams: Json | null;
					updated_at: string | null;
					zukan_hash: string | null;
					zukan_order: number | null;
					is_primary: boolean | null;
				};
				Insert: {
					constellation?: string | null;
					constellation_index?: number | null;
					data?: Json | null;
					description_en?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element?: string | null;
					gender?: string | null;
					id: string;
					image_url?: string | null;
					internal_code?: string | null;

					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					position?: string | null;
					rarity?: number | null;
					rarity_label?: string | null;
					series?: string | null;
					sheet_data?: Json | null;
					skills?: Json | null;
					slug?: string | null;
					stat_agilite?: number | null;
					stat_controle?: number | null;
					stat_frappe?: number | null;
					stat_intelligence?: number | null;
					stat_physique?: number | null;
					stat_pression?: number | null;
					stat_technique?: number | null;
					stats?: Json | null;
					team_id?: string | null;
					teams?: Json | null;
					updated_at?: string | null;
					zukan_hash?: string | null;
					zukan_order?: number | null;
					is_primary?: boolean | null;
				};
				Update: {
					constellation?: string | null;
					constellation_index?: number | null;
					data?: Json | null;
					description_en?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element?: string | null;
					gender?: string | null;
					id?: string;
					image_url?: string | null;
					internal_code?: string | null;

					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					position?: string | null;
					rarity?: number | null;
					rarity_label?: string | null;
					series?: string | null;
					sheet_data?: Json | null;
					skills?: Json | null;
					slug?: string | null;
					stat_agilite?: number | null;
					stat_controle?: number | null;
					stat_frappe?: number | null;
					stat_intelligence?: number | null;
					stat_physique?: number | null;
					stat_pression?: number | null;
					stat_technique?: number | null;
					stats?: Json | null;
					team_id?: string | null;
					teams?: Json | null;
					updated_at?: string | null;
					zukan_hash?: string | null;
					zukan_order?: number | null;
					is_primary?: boolean | null;
				};
				Relationships: [];
			};
			inagle_coordinators: {
				Row: {
					buff: string | null;
					element: string | null;
					game: string | null;
					gender: string | null;
					id: number;
					image: string | null;
					name_hiragana: string | null;
					name_kanji: string | null;
					name_localised: string | null;
					name_romaji: string | null;
					passive_no: number | null;
					passive_slot: number | null;
					playstyle: string | null;
					requirements: string | null;
					role: string | null;
					stat: string | null;
				};
				Insert: {
					buff?: string | null;
					element?: string | null;
					game?: string | null;
					gender?: string | null;
					id?: number;
					image?: string | null;
					name_hiragana?: string | null;
					name_kanji?: string | null;
					name_localised?: string | null;
					name_romaji?: string | null;
					passive_no?: number | null;
					passive_slot?: number | null;
					playstyle?: string | null;
					requirements?: string | null;
					role?: string | null;
					stat?: string | null;
				};
				Update: {
					buff?: string | null;
					element?: string | null;
					game?: string | null;
					gender?: string | null;
					id?: number;
					image?: string | null;
					name_hiragana?: string | null;
					name_kanji?: string | null;
					name_localised?: string | null;
					name_romaji?: string | null;
					passive_no?: number | null;
					passive_slot?: number | null;
					playstyle?: string | null;
					requirements?: string | null;
					role?: string | null;
					stat?: string | null;
				};
				Relationships: [];
			};
			inagle_drops: {
				Row: {
					fixed_beans: string | null;
					game: string | null;
					id: number;
					no: number | null;
					passive_type: string | null;
					requirement: string | null;
					stat: string | null;
					team: string | null;
					value: string | null;
				};
				Insert: {
					fixed_beans?: string | null;
					game?: string | null;
					id?: number;
					no?: number | null;
					passive_type?: string | null;
					requirement?: string | null;
					stat?: string | null;
					team?: string | null;
					value?: string | null;
				};
				Update: {
					fixed_beans?: string | null;
					game?: string | null;
					id?: number;
					no?: number | null;
					passive_type?: string | null;
					requirement?: string | null;
					stat?: string | null;
					team?: string | null;
					value?: string | null;
				};
				Relationships: [];
			};
			inagle_formations: {
				Row: {
					balance: string | null;
					created_at: string | null;
					desc: string | null;
					desc_EN: string | null;
					desc_FR: string | null;
					displayName: string | null;
					formId: string;
					id: string;
					name_EN: string | null;
					name_FR: string | null;
					name_JA: string | null;
					placements: Json | null;
					powerDefense: number | null;
					powerOffense: number | null;
					sheet_data: Json | null;
				};
				Insert: {
					balance?: string | null;
					created_at?: string | null;
					desc?: string | null;
					desc_EN?: string | null;
					desc_FR?: string | null;
					displayName?: string | null;
					formId: string;
					id: string;
					name_EN?: string | null;
					name_FR?: string | null;
					name_JA?: string | null;
					placements?: Json | null;
					powerDefense?: number | null;
					powerOffense?: number | null;
					sheet_data?: Json | null;
				};
				Update: {
					balance?: string | null;
					created_at?: string | null;
					desc?: string | null;
					desc_EN?: string | null;
					desc_FR?: string | null;
					displayName?: string | null;
					formId?: string;
					id?: string;
					name_EN?: string | null;
					name_FR?: string | null;
					name_JA?: string | null;
					placements?: Json | null;
					powerDefense?: number | null;
					powerOffense?: number | null;
					sheet_data?: Json | null;
				};
				Relationships: [];
			};
			inagle_items: {
				Row: {
					category: string | null;
					created_at: string | null;
					description_fr: string | null;
					description_ja: string | null;
					id: string;
					image_url: string | null;
					internal_code: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					rarity: string | null;
					sheet_data: Json | null;
				};
				Insert: {
					category?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					id: string;
					image_url?: string | null;
					internal_code?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					rarity?: string | null;
					sheet_data?: Json | null;
				};
				Update: {
					category?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					id?: string;
					image_url?: string | null;
					internal_code?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					rarity?: string | null;
					sheet_data?: Json | null;
				};
				Relationships: [];
			};
			inagle_keshins: {
				Row: {
					asset_code: string | null;
					created_at: string | null;
					description_fr: string | null;
					description_ja: string | null;
					element_id: number | null;
					id: string;
					image_url: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					sheet_data: Json | null;
					skill_id: string | null;
					sub_type: string | null;
				};
				Insert: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					skill_id?: string | null;
					sub_type?: string | null;
				};
				Update: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id?: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					skill_id?: string | null;
					sub_type?: string | null;
				};
				Relationships: [];
			};
			inagle_kizuna_items: {
				Row: {
					name: string;
					notes: string | null;
					power: number | null;
					shop: string | null;
					size: string | null;
				};
				Insert: {
					name: string;
					notes?: string | null;
					power?: number | null;
					shop?: string | null;
					size?: string | null;
				};
				Update: {
					name?: string;
					notes?: string | null;
					power?: number | null;
					shop?: string | null;
					size?: string | null;
				};
				Relationships: [];
			};
			inagle_miximax: {
				Row: {
					asset_code: string | null;
					created_at: string | null;
					description_fr: string | null;
					description_ja: string | null;
					element_id: number | null;
					id: string;
					image_url: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					sheet_data: Json | null;
					sub_type: string | null;
				};
				Insert: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Update: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id?: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Relationships: [];
			};
			inagle_mode_changes: {
				Row: {
					asset_code: string | null;
					created_at: string | null;
					description_fr: string | null;
					description_ja: string | null;
					element_id: number | null;
					id: string;
					image_url: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					sheet_data: Json | null;
					sub_type: string | null;
				};
				Insert: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Update: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id?: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					sub_type?: string | null;
				};
				Relationships: [];
			};
			inagle_passives: {
				Row: {
					boost_type: string | null;
					category: string | null;
					data: Json | null;
					description_en: string | null;
					description_fr: string | null;
					description_ja: string | null;
					effect_value: number | null;
					id: string;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					updated_at: string | null;
				};
				Insert: {
					boost_type?: string | null;
					category?: string | null;
					data?: Json | null;
					description_en?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					effect_value?: number | null;
					id: string;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					updated_at?: string | null;
				};
				Update: {
					boost_type?: string | null;
					category?: string | null;
					data?: Json | null;
					description_en?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					effect_value?: number | null;
					id?: string;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					updated_at?: string | null;
				};
				Relationships: [];
			};
			inagle_override_skills: {
				Row: {
					id: string;
					name_fr: string | null;
					name_en: string | null;
					name_ja: string | null;
					element_id: number | null;
					category_id: number | null;
					power_min: number | null;
					power_max: number | null;
					conditions: Json | null;
					created_at: string | null;
				};
				Insert: {
					id: string;
					name_fr?: string | null;
					name_en?: string | null;
					name_ja?: string | null;
					element_id?: number | null;
					category_id?: number | null;
					power_min?: number | null;
					power_max?: number | null;
					conditions?: Json | null;
					created_at?: string | null;
				};
				Update: {
					id?: string;
					name_fr?: string | null;
					name_en?: string | null;
					name_ja?: string | null;
					element_id?: number | null;
					category_id?: number | null;
					power_min?: number | null;
					power_max?: number | null;
					conditions?: Json | null;
					created_at?: string | null;
				};
				Relationships: [];
			};
			inagle_skills: {
				Row: {
					category_id: number | null;
					created_at: string | null;
					description_fr: string | null;
					description_ja: string | null;
					element_id: number | null;
					id: string;
					image_url: string | null;
					internal_code: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					poster_url: string | null;
					power_max: number | null;
					power_min: number | null;
					sheet_data: Json | null;
					tension_cost: number | null;
					video_url: string | null;
				};
				Insert: {
					category_id?: number | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id: string;
					image_url?: string | null;
					internal_code?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					poster_url?: string | null;
					power_max?: number | null;
					power_min?: number | null;
					sheet_data?: Json | null;
					tension_cost?: number | null;
					video_url?: string | null;
				};
				Update: {
					category_id?: number | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id?: string;
					image_url?: string | null;
					internal_code?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					poster_url?: string | null;
					power_max?: number | null;
					power_min?: number | null;
					sheet_data?: Json | null;
					tension_cost?: number | null;
					video_url?: string | null;
				};
				Relationships: [];
			};
			inagle_souls: {
				Row: {
					asset_code: string | null;
					created_at: string | null;
					description_fr: string | null;
					description_ja: string | null;
					element_id: number | null;
					id: string;
					image_url: string | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					sheet_data: Json | null;
					skill_id: string | null;
					sub_type: string | null;
				};
				Insert: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					skill_id?: string | null;
					sub_type?: string | null;
				};
				Update: {
					asset_code?: string | null;
					created_at?: string | null;
					description_fr?: string | null;
					description_ja?: string | null;
					element_id?: number | null;
					id?: string;
					image_url?: string | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
					skill_id?: string | null;
					sub_type?: string | null;
				};
				Relationships: [];
			};
			inagle_tactics: {
				Row: {
					cooldown: number | null;
					duration: number | null;
					effect1: string | null;
					effect2: string | null;
					effect3: string | null;
					name: string;
					shop: string | null;
				};
				Insert: {
					cooldown?: number | null;
					duration?: number | null;
					effect1?: string | null;
					effect2?: string | null;
					effect3?: string | null;
					name: string;
					shop?: string | null;
				};
				Update: {
					cooldown?: number | null;
					duration?: number | null;
					effect1?: string | null;
					effect2?: string | null;
					effect3?: string | null;
					name?: string;
					shop?: string | null;
				};
				Relationships: [];
			};
			inagle_teams: {
				Row: {
					created_at: string | null;
					emblems: Json | null;
					id: string;
					internal_code: string | null;
					kits: Json | null;
					members: Json | null;
					name_en: string | null;
					name_fr: string | null;
					name_ja: string | null;
					sheet_data: Json | null;
				};
				Insert: {
					created_at?: string | null;
					emblems?: Json | null;
					id: string;
					internal_code?: string | null;
					kits?: Json | null;
					members?: Json | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
				};
				Update: {
					created_at?: string | null;
					emblems?: Json | null;
					id?: string;
					internal_code?: string | null;
					kits?: Json | null;
					members?: Json | null;
					name_en?: string | null;
					name_fr?: string | null;
					name_ja?: string | null;
					sheet_data?: Json | null;
				};
				Relationships: [];
			};
			patch_notes: {
				Row: {
					content_html: string | null;
					date: string;
					featured_image: string | null;
					id: string;
					platform: Json | null;
					title: string;
					updated_at: string | null;
					url: string;
				};
				Insert: {
					content_html?: string | null;
					date: string;
					featured_image?: string | null;
					id: string;
					platform?: Json | null;
					title: string;
					updated_at?: string | null;
					url: string;
				};
				Update: {
					content_html?: string | null;
					date?: string;
					featured_image?: string | null;
					id?: string;
					platform?: Json | null;
					title?: string;
					updated_at?: string | null;
					url?: string;
				};
				Relationships: [];
			};
			profiles: {
				Row: {
					address_line1: string | null;
					address_line2: string | null;
					avatar_url: string | null;
					banner_url: string | null;
					bio: string | null;
					city: string | null;
					country: string | null;
					discord_id: string | null;
					email: string | null;
					full_name: string | null;
					id: string;
					patreon_id: string | null;
					postal_code: string | null;
					role: string | null;
					twitter_handle: string | null;
					updated_at: string | null;
					username: string | null;
					website: string | null;
				};
				Insert: {
					address_line1?: string | null;
					address_line2?: string | null;
					avatar_url?: string | null;
					banner_url?: string | null;
					bio?: string | null;
					city?: string | null;
					country?: string | null;
					discord_id?: string | null;
					email?: string | null;
					full_name?: string | null;
					id: string;
					patreon_id?: string | null;
					postal_code?: string | null;
					role?: string | null;
					twitter_handle?: string | null;
					updated_at?: string | null;
					username?: string | null;
					website?: string | null;
				};
				Update: {
					address_line1?: string | null;
					address_line2?: string | null;
					avatar_url?: string | null;
					banner_url?: string | null;
					bio?: string | null;
					city?: string | null;
					country?: string | null;
					discord_id?: string | null;
					email?: string | null;
					full_name?: string | null;
					id?: string;
					patreon_id?: string | null;
					postal_code?: string | null;
					role?: string | null;
					twitter_handle?: string | null;
					updated_at?: string | null;
					username?: string | null;
					website?: string | null;
				};
				Relationships: [];
			};
			team_members: {
				Row: {
					created_at: string | null;
					discord_user_id: string | null;
					display_index: number | null;
					id: number;
					image_url: string | null;
					is_active: boolean | null;
					member_link: string | null;
					name: string | null;
					order_index: number | null;
					role: string | null;
					source: string | null;
					team_id: string | null;
					team_name: string | null;
					updated_at: string | null;
				};
				Insert: {
					created_at?: string | null;
					discord_user_id?: string | null;
					display_index?: number | null;
					id?: number;
					image_url?: string | null;
					is_active?: boolean | null;
					member_link?: string | null;
					name?: string | null;
					order_index?: number | null;
					role?: string | null;
					source?: string | null;
					team_id?: string | null;
					team_name?: string | null;
					updated_at?: string | null;
				};
				Update: {
					created_at?: string | null;
					discord_user_id?: string | null;
					display_index?: number | null;
					id?: number;
					image_url?: string | null;
					is_active?: boolean | null;
					member_link?: string | null;
					name?: string | null;
					order_index?: number | null;
					role?: string | null;
					source?: string | null;
					team_id?: string | null;
					team_name?: string | null;
					updated_at?: string | null;
				};
				Relationships: [];
			};
			topics: {
				Row: {
					category: string | null;
					content_html: string | null;
					date: string;
					id: string;
					images: Json | null;
					thumbnail: string | null;
					title: string;
					updated_at: string | null;
					url: string;
				};
				Insert: {
					category?: string | null;
					content_html?: string | null;
					date: string;
					id: string;
					images?: Json | null;
					thumbnail?: string | null;
					title: string;
					updated_at?: string | null;
					url: string;
				};
				Update: {
					category?: string | null;
					content_html?: string | null;
					date?: string;
					id?: string;
					images?: Json | null;
					thumbnail?: string | null;
					title?: string;
					updated_at?: string | null;
					url?: string;
				};
				Relationships: [];
			};
			tweets: {
				Row: {
					author_id: string | null;
					author_name: string | null;
					author_username: string | null;
					conversation_id: string | null;
					created_at: string | null;
					id: string;
					in_reply_to_status_id: string | null;
					media: Json | null;
					metrics: Json | null;
					raw_data: Json | null;
					text: string | null;
					updated_at: string | null;
				};
				Insert: {
					author_id?: string | null;
					author_name?: string | null;
					author_username?: string | null;
					conversation_id?: string | null;
					created_at?: string | null;
					id: string;
					in_reply_to_status_id?: string | null;
					media?: Json | null;
					metrics?: Json | null;
					raw_data?: Json | null;
					text?: string | null;
					updated_at?: string | null;
				};
				Update: {
					author_id?: string | null;
					author_name?: string | null;
					author_username?: string | null;
					conversation_id?: string | null;
					created_at?: string | null;
					id?: string;
					in_reply_to_status_id?: string | null;
					media?: Json | null;
					metrics?: Json | null;
					raw_data?: Json | null;
					text?: string | null;
					updated_at?: string | null;
				};
				Relationships: [];
			};
			user_teams: {
				Row: {
					created_at: string | null;
					formation_data: Json | null;
					formation_id: string | null;
					id: string;
					is_public: boolean | null;
					name: string;
					updated_at: string | null;
					user_id: string;
				};
				Insert: {
					created_at?: string | null;
					formation_data?: Json | null;
					formation_id?: string | null;
					id?: string;
					is_public?: boolean | null;
					name: string;
					updated_at?: string | null;
					user_id: string;
				};
				Update: {
					created_at?: string | null;
					formation_data?: Json | null;
					formation_id?: string | null;
					id?: string;
					is_public?: boolean | null;
					name?: string;
					updated_at?: string | null;
					user_id?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			content_feed: {
				Row: {
					author_id: string | null;
					category: string | null;
					date: string | null;
					excerpt: string | null;
					id: string | null;
					image: string | null;
					slug: string | null;
					title: string | null;
					type: string | null;
				};
				Relationships: [];
			};
			inagle_hissatsu: {
				Row: {
					duration: number | null;
					element: string | null;
					id: string | null;
					name: string | null;
					name_jp: string | null;
					power: number | null;
					shop1: string | null;
					shop2: string | null;
					sub_type: string | null;
					tension: number | null;
					type: string | null;
				};
				Insert: {
					duration?: never;
					element?: never;
					id?: string | null;
					name?: string | null;
					name_jp?: string | null;
					power?: number | null;
					shop1?: never;
					shop2?: never;
					sub_type?: never;
					tension?: number | null;
					type?: never;
				};
				Update: {
					duration?: never;
					element?: never;
					id?: string | null;
					name?: string | null;
					name_jp?: string | null;
					power?: number | null;
					shop1?: never;
					shop2?: never;
					sub_type?: never;
					tension?: number | null;
					type?: never;
				};
				Relationships: [];
			};
		};
		Functions: {
			generate_article_slug: { Args: { title: string }; Returns: string };
			increment_article_views: {
				Args: { article_id: string };
				Returns: undefined;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
		? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		| keyof DefaultSchema["Enums"]
		| { schema: keyof DatabaseWithoutInternals },
	EnumName extends DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
		: never = never,
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
		? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		| keyof DefaultSchema["CompositeTypes"]
		| { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
		: never = never,
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
		? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	graphql_public: {
		Enums: {},
	},
	public: {
		Enums: {},
	},
} as const;

// ============= Convenience type aliases used by api-client and wiki-service =============

/** Mapped aura shape returned by wikiService.getAurasList() */
export interface InagleAura {
	id: number | string;
	auraId?: string;
	name: string | null;
	passive: string | null;
	hissatsu_name: string | null;
	element: string | null;
	image_url: string | null;
	type: string | null;
	sheetData?: Json | null;
	assetCode?: string | null;
}

/** Legacy sheet-based character shape used by api-client mapToBaseCharacter */
export interface InagleCharacter {
	id: string;
	name_localised: string | null;
	name_kanji: string | null;
	position: string | null;
	element: string | null;
	gender: string | null;
	type: string | null;
	game: string | null;
	moveset: string | null;
	kick: number | null;
	control: number | null;
	technique: number | null;
	pressure: number | null;
	physical: number | null;
	agility: number | null;
	intelligence: number | null;
	image_url: string | null;
	slug: string | null;
}

/** Row type from the inagle_hissatsu view */
export interface InagleHissatsu {
	id: string | null;
	name: string | null;
	name_jp: string | null;
	power: number | null;
	tension: number | null;
	type: string | null;
	element: string | null;
	duration: number | null;
	sub_type: string | null;
	shop1: string | null;
	shop2: string | null;
}

/** Convenience alias for inagle_items rows */
export interface InagleItem {
	name: string;
	name_jp?: string | null;
	type?: string | null;
	description?: string | null;
	image_url?: string | null;
}

/** Convenience alias for inagle_tactics rows */
export type InagleTactic = Database["public"]["Tables"]["inagle_tactics"]["Row"];

/** Convenience alias for inagle_drops rows */
export type InagleDrop = Database["public"]["Tables"]["inagle_drops"]["Row"];

/** Convenience alias for inagle_kizuna_items rows */
export type InagleKizunaItem = Database["public"]["Tables"]["inagle_kizuna_items"]["Row"];
