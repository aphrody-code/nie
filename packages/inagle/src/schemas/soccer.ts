/**
 * Soccer/Team schemas based on actual JSON structure
 *
 * Source files:
 * - dump/data/common/gamedata/team/team_config_1.04.06.00.json
 * - dump/data/common/gamedata/formation/formation_config_0.02.16.cfg.bin.json
 * - dump/data/common/gamedata/soccer/soccer_game_config_1.04.08.00.cfg.bin.json
 */

/**
 * SOCCER_POSITION_INFO from m_SoccerPositionInfoList
 */
export interface SoccerPositionInfo {
	positionId: number; // 1-10
	centerLineWight: number; // 0.0-1.0 (note: typo in original)
	offenseLineWeight: number; // 0.0-1.0
	defenseLineWeight: number; // 0.0-1.0
}

/**
 * SOCCER_FORM_PLACEMENT_INFO from m_SoccerFormPlacementInfoList
 */
export interface SoccerFormPlacementInfo {
	defensePos: string; // hex encoded position
	offensePos: string;
	startPos: string;
	ckDefenseLeftPos: string; // Corner kick positions
	ckDefenseRightPos: string;
	ckOffenseLeftPos: string;
	ckOffenseRightPos: string;
	pkDefensePos: string; // Penalty kick positions
	pkOffensePos: string;
	bustupPos: string;
	positionNo: number; // 0-10
	positionId: number; // Position type (1=GK, 2=DF, etc.)
	passNo: number;
	bKickoff: boolean;
	bFollow: boolean;
}

/**
 * Soccer position types
 */
export const PositionType = {
	Goalkeeper: 1,
	Defender: 2,
	Midfielder: 3,
	Forward: 4,
} as const;
export type PositionType = (typeof PositionType)[keyof typeof PositionType];

/**
 * formation_config document structure
 */
export interface FormationConfigDocument {
	version: 100;
	lists: [
		{
			name: "m_SoccerPositionInfoList";
			typeName: "SOCCER_POSITION_INFO";
			values: SoccerPositionInfo[];
		},
		{
			name: "m_SoccerFormPlacementInfoList";
			typeName: "SOCCER_FORM_PLACEMENT_INFO";
			values: SoccerFormPlacementInfo[];
		},
	];
}
