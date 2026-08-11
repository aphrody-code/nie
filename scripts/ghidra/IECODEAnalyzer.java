// IECODEAnalyzer.java — preScript Ghidra pour configurer l'analyse de nie.exe
// Applique les types connus, marque les fonctions intéressantes, et définit les structs du jeu.
//
// Usage:
//   analyzeHeadless <project> IECODE -import nie.exe -preScript IECODEAnalyzer.java -postScript ExportDecompiled.java <output>
//
// @category IECODE
// @author IECODE Project

import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.*;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.*;

public class IECODEAnalyzer extends GhidraScript {

    @Override
    protected void run() throws Exception {
        printf("=== IECODE Pre-Analysis Configuration ===\n");
        printf("Program: %s\n", currentProgram.getName());

        DataTypeManager dtm = currentProgram.getDataTypeManager();

        // --- Créer les structs connues du jeu ---
        createGameStructs(dtm);

        // --- Marquer les constantes connues ---
        markKnownConstants();

        printf("=== Pre-Analysis Complete ===\n");
    }

    private void createGameStructs(DataTypeManager dtm) throws Exception {
        int txId = dtm.startTransaction("IECODE Game Structs");
        try {
            CategoryPath gameCat = new CategoryPath("/IECODE");

            // PlayerData struct
            StructureDataType playerData = new StructureDataType(gameCat, "PlayerData", 0);
            playerData.setPackingEnabled(true);
            playerData.setExplicitMinimumAlignment(1);
            playerData.add(UnsignedIntegerDataType.dataType, "player_id", "ID du joueur");
            playerData.add(UnsignedIntegerDataType.dataType, "name_hash", "Hash CRC32 du nom");
            playerData.add(new ArrayDataType(ShortDataType.dataType, 8, 2), "stats",
                "kick, guard, catch, body, control, speed, stamina, luck");
            playerData.add(ByteDataType.dataType, "position", "Position sur le terrain");
            playerData.add(ByteDataType.dataType, "element", "Element (feu, bois, vent, terre)");
            playerData.add(ByteDataType.dataType, "rarity", "Rarete");
            playerData.add(ByteDataType.dataType, "level", "Niveau");
            playerData.add(new ArrayDataType(UnsignedIntegerDataType.dataType, 5, 4), "passive_skill_ids",
                "IDs des skills passifs");
            dtm.addDataType(playerData, DataTypeConflictHandler.REPLACE_HANDLER);

            // PassiveSkillInfo struct
            StructureDataType skillInfo = new StructureDataType(gameCat, "PassiveSkillInfo", 0);
            skillInfo.setPackingEnabled(true);
            skillInfo.setExplicitMinimumAlignment(1);
            skillInfo.add(UnsignedIntegerDataType.dataType, "skill_hash", null);
            skillInfo.add(UnsignedIntegerDataType.dataType, "name_hash", null);
            skillInfo.add(new ArrayDataType(IntegerDataType.dataType, 2, 4), "reserved", null);
            skillInfo.add(IntegerDataType.dataType, "build_type", null);
            skillInfo.add(IntegerDataType.dataType, "reserved2", null);
            dtm.addDataType(skillInfo, DataTypeConflictHandler.REPLACE_HANDLER);

            // SaveDataHeader struct
            StructureDataType saveHeader = new StructureDataType(gameCat, "SaveDataHeader", 0);
            saveHeader.setPackingEnabled(true);
            saveHeader.setExplicitMinimumAlignment(1);
            saveHeader.add(UnsignedIntegerDataType.dataType, "magic", null);
            saveHeader.add(UnsignedIntegerDataType.dataType, "version", null);
            saveHeader.add(UnsignedIntegerDataType.dataType, "checksum", null);
            saveHeader.add(UnsignedIntegerDataType.dataType, "data_size", null);
            dtm.addDataType(saveHeader, DataTypeConflictHandler.REPLACE_HANDLER);

            printf("[OK] Created IECODE game structs (PlayerData, PassiveSkillInfo, SaveDataHeader)\n");
        } finally {
            dtm.endTransaction(txId, true);
        }
    }

    private void markKnownConstants() throws Exception {
        SymbolTable symTable = currentProgram.getSymbolTable();

        // Marquer les constantes connues comme labels pour faciliter la navigation
        // Steam App ID: 2799860
        // CRI Key: 0x1717E18E
        // Ces valeurs peuvent etre recherchees avec Search -> Scalars dans Ghidra

        printf("[INFO] Known constants for nie.exe:\n");
        printf("  Steam App ID:  2799860 (0x2AB694)\n");
        printf("  CRI XOR Key:   0x1717E18E\n");
        printf("  cfg.bin footer: 01 74 32 62 FE\n");
        printf("  Use Search -> Scalars to find references\n");
    }
}
