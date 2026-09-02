/**
 * Partie CLIENT-SAFE du hub de données « Inazuma Eleven Cross » (`/cross/*`).
 *
 * Jeu mobile Unity IL2CPP DISTINCT d'Inazuma Eleven: Victory Road. Ce module ne
 * contient QUE des types + constantes purs (aucune dépendance Node/SQLite) ; le
 * data-fetch serveur vit dans `cross/data.ts` (sous-chemin serveur de la lib).
 *
 * Toutes les structures proviennent de l'extraction statique du dump IL2CPP
 * (schéma masterdata typé, enums) — voir `data/cross/*`. Les VALEURS de jeu
 * (lignes masterdata) ne sont pas encore récupérables (anti-triche serveur),
 * donc on n'affiche que le MODÈLE DE DONNÉES réel, jamais de fausse donnée.
 */

/** Teinte cyan officielle de la landing Cross (signal « jeu différent »). */
export const CROSS_CYAN = "#00aeef";

/** Une colonne typée d'une table masterdata. */
export interface CrossColumn {
	name: string;
	type: string;
	/** Famille du type : int | float | bool | string | enum | ref | array | list | dict | struct | localizationKey. */
	kind: string;
	enumValues?: { name: string; value: number }[];
	/** Table masterdata cible si `kind === "ref"`. */
	ref?: string;
	element?: string;
	key?: string;
	value?: string;
	nullable?: boolean;
	inherited?: boolean;
	from?: string;
}

/** Une table masterdata (= un fichier TSV côté jeu). */
export interface CrossTable {
	file: string;
	fullName: string;
	extends: string | null;
	relatedFiles?: string[];
	columns: CrossColumn[];
}

export type CrossSchema = Record<string, CrossTable>;

export interface CrossEnumMember {
	name: string;
	value: number;
}
export type CrossEnums = Record<string, CrossEnumMember[]>;

/** Statut d'extraction (compteurs + blocage), affiché sur le hub. */
export interface CrossExtractionStatus {
	game: string;
	package: string;
	version: string;
	engine: string;
	released: string;
	masterdata_tables: number;
	masterdata_columns: number;
	enums: number;
	remote_bundles: number;
	audio_wav: number;
	local_assets: number;
	classes: number;
	game_classes: number;
	localization_langs: string[];
	blocked: string;
	extracted_static: string[];
}

/** Manifest des voix de personnages décodées (CRI HCA → WAV). */
export interface CrossAudioManifest {
	total_wav: number;
	characters: Record<string, string[]>;
}

/** Libellés FR des familles de type (colonne « kind »). */
export const KIND_LABELS: Record<string, string> = {
	int: "entier",
	float: "décimal",
	bool: "booléen",
	string: "texte",
	enum: "énumération",
	ref: "référence",
	array: "tableau",
	list: "liste",
	dict: "dictionnaire",
	struct: "structure",
	localizationKey: "clé i18n",
};

/** Couleur de chip MD3 par famille de type. */
export const KIND_TONE: Record<string, string> = {
	int: "bg-primary-container text-on-primary-container",
	float: "bg-primary-container text-on-primary-container",
	bool: "bg-tertiary-container text-on-tertiary-container",
	string: "bg-secondary-container text-on-secondary-container",
	localizationKey: "bg-secondary-container text-on-secondary-container",
	enum: "bg-tertiary-container text-on-tertiary-container",
	ref: "bg-surface-container-highest text-on-surface",
	array: "bg-surface-container text-on-surface-variant",
	list: "bg-surface-container text-on-surface-variant",
	dict: "bg-surface-container text-on-surface-variant",
	struct: "bg-surface-container text-on-surface-variant",
};

/** Slug URL stable pour une table (nom court, sans le namespace). */
export function tableSlug(fullNameOrShort: string): string {
	const short = fullNameOrShort.split(".").pop() ?? fullNameOrShort;
	return short;
}

// Human-readable labels and descriptions for Inazuma Eleven Cross masterdata tables
export const TABLE_METADATA: Record<string, { label: string; desc: string }> = {
	AffinityItemMaster: { label: "Cadeaux d'Affinité", desc: "Liste des objets offerts aux membres pour augmenter leur niveau de relation." },
	AffinityRankMaster: { label: "Niveaux d'Affinité", desc: "Paliers d'expérience requis pour augmenter l'affinité avec un joueur." },
	AffinityRewardMaster: { label: "Récompenses d'Affinité", desc: "Récompenses débloquées à chaque niveau d'affinité atteint pour chaque joueur." },
	AwakeningTierMaster: { label: "Paliers d'Éveil", desc: "Bonus de statistiques et multiplicateurs appliqués à chaque palier d'éveil." },
	AwakeningTierMaterialMaster: { label: "Matériaux d'Éveil", desc: "Objets requis pour éveiller les joueurs à différents paliers." },
	BackgroundMaster: { label: "Fonds d'écran", desc: "Textures d'arrière-plan de l'interface et du terrain." },
	BaseMissionMaster: { label: "Missions de Base", desc: "Objectifs réguliers et défis permanents pour obtenir des récompenses." },
	BaseScheduleMaster: { label: "Calendrier de Jeu", desc: "Planification générale des campagnes et ouvertures de serveurs." },
	BattleBgmMaster: { label: "Musiques de Combat", desc: "Bandes-son associées aux différents types de matchs." },
	BattleOperationParameter: { label: "Physique des Matchs", desc: "Ajustements des calculs physiques, vitesses et collisions en match." },
	BattlePassMaster: { label: "Passe de Combat", desc: "Configuration des passes saisonniers payants et gratuits." },
	BattlePassLevelMaster: { label: "Niveaux de Passe", desc: "Récompenses et points requis pour chaque niveau du passe de combat." },
	CharacterMaster: { label: "Fiches Joueurs", desc: "Statistiques de base, positions, attributs et identifiants des joueurs d'Inazuma." },
	CharacterGradeMaster: { label: "Grades de Rareté", desc: "Définition des raretés de cartes de joueurs (N, R, SR, UR...)." },
	CharacterAwakeningGrowthMaster: { label: "Croissance d'Éveil", desc: "Statistiques additionnelles gagnées à chaque éveil de personnage." },
	CharacterItemMaster: { label: "Objets de Personnages", desc: "Items exclusifs à certains joueurs pour débloquer du contenu." },
	CharacterSoulItemMaster: { label: "Âmes de Joueurs", desc: "Fragments d'âmes requis pour le recrutement et l'évolution." },
	EnemyTeamMaster: { label: "Équipes Adversaires", desc: "Compositions d'équipes et tactiques des adversaires du mode histoire." },
	FormationMaster: { label: "Formations Tactiques", desc: "Ajustements de placement des joueurs sur le terrain." },
	FormationDeckMaster: { label: "Decks d'Équipes", desc: "Structures de configuration de l'équipe du joueur." },
	SpecialMoveManualMaster: { label: "Manuels de Hissatsu", desc: "Manuels pour enseigner des supertechniques aux joueurs." },
	SpecialMoveLevelUpRecipeMasterData: { label: "Recettes de Techniques", desc: "Combinaisons de matériaux requises pour améliorer une supertechnique." },
	SpecialMoveLevelUpMaterialItemMaster: { label: "Matériaux de Techniques", desc: "Objets consommés pour augmenter la puissance des techniques." },
	QuestMaster: { label: "Quêtes du Jeu", desc: "Missions narratives et défis à accomplir." },
	GuildEmblemMaster: { label: "Emblèmes de Guilde", desc: "Logos et bordures personnalisables pour les guildes." },
	GuildMissionGroupMaster: { label: "Missions de Guilde", desc: "Défis hebdomadaires à accomplir en groupe." },
	PvPPlacementMaster: { label: "Saisons PvP", desc: "Récompenses et rangs de la ligue multijoueur." },
	PvPMatchingSlotMaster: { label: "Créneaux de Matchmaking", desc: "Configuration des files d'attente PvP." },
	RaidGroupMaster: { label: "Boss de Raid", desc: "Configuration des boss géants affrontables en multijoueur." },
	RaidDifficultyMaster: { label: "Difficultés de Raid", desc: "Statistiques et taux de loot pour chaque difficulté de boss." },
	GachaDroptableMaster: { label: "Probabilités du Gacha", desc: "Tables de probabilités d'obtention de joueurs et d'objets." },
	FixedDropTableMaster: { label: "Récompenses Fixes", desc: "Tables de butin garanti pour les fins de match et quêtes." },
	GachaBackgroundCutsceneMaster: { label: "Cinématiques de Tirage", desc: "Animation et arrière-plans joués pendant les tirages." },
	InAppLinkProductMaster: { label: "Boutique d'Achats", desc: "Tarifs et contenu des microtransactions réelles." },
	OfferMaster: { label: "Offres Spéciales", desc: "Packs promotionnels limités dans le temps." },
	LoginBonusMaster: { label: "Bonus de Connexion", desc: "Calendriers mensuels et événementiels de fidélité." },
	LoginBonusRewardMaster: { label: "Détail des Bonus", desc: "Récompenses reçues chaque jour de connexion." },
	ChatStampMaster: { label: "Autocollants de Chat", desc: "Images emoji de personnages utilisables en chat multijoueur." },
	InalinkGroupMaster: { label: "Messages Inalink", desc: "Dialogues de messagerie fictive avec les personnages." },
	ClubHouseDecorationItemMaster: { label: "Décorations de Club", desc: "Meubles, trophées et peintures pour personnaliser le club-house." },
	ClubHouseDecorationSlotTypeMaster: { label: "Emplacements Déco", desc: "Zones de placement des meubles dans le club." },
};

export function humanizeClassName(className: string): string {
	let name = className.replace(/Master(Data)?$/, "");
	name = name.replace(/([A-Z])/g, " $1").trim();
	name = name
		.replace(/\bAffinity\b/g, "Affinité")
		.replace(/\bAwakening\b/g, "Éveil")
		.replace(/\bTier\b/g, "Palier")
		.replace(/\bMaterial\b/g, "Matériau")
		.replace(/\bCharacter\b/g, "Personnage")
		.replace(/\bSpecial Move\b/g, "Supertechnique")
		.replace(/\bEquipment\b/g, "Équipement")
		.replace(/\bItem\b/g, "Objet")
		.replace(/\bMission\b/g, "Mission")
		.replace(/\bQuest\b/g, "Quête")
		.replace(/\bBattle Pass\b/g, "Passe de combat")
		.replace(/\bReward\b/g, "Récompense")
		.replace(/\bGacha\b/g, "Tirage")
		.replace(/\bDeck\b/g, "Composition")
		.replace(/\bEnemy\b/g, "Ennemi")
		.replace(/\bGuild\b/g, "Guilde")
		.replace(/\bRaid\b/g, "Raid")
		.replace(/\bStory\b/g, "Histoire")
		.replace(/\bStage\b/g, "Niveau")
		.replace(/\bArea\b/g, "Zone")
		.replace(/\bChapter\b/g, "Chapitre")
		.replace(/\bProduct\b/g, "Produit")
		.replace(/\bOffer\b/g, "Offre")
		.replace(/\bLogin Bonus\b/g, "Bonus de connexion")
		.replace(/\bClub House\b/g, "Club")
		.replace(/\bDecoration\b/g, "Décoration")
		.replace(/\bBgm\b/g, "Musique")
		.replace(/\bMatching\b/g, "Matchmaking")
		.replace(/\bSchedule\b/g, "Planification");
	return name;
}

