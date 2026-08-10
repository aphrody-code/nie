// ExportDecompiled.java — Ghidra postScript pour exporter toutes les fonctions
// décompilées de nie.exe en fichiers .c individuels pour decomp/functions/
//
// Usage headless:
//   analyzeHeadless <project> IECODE -import nie.exe -postScript ExportDecompiled.java <output_dir>
//
// Usage GUI:
//   Script Manager → Run → choisir le dossier de sortie
//
// @category IECODE
// @author IECODE Project

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.FunctionManager;
import ghidra.util.task.TaskMonitor;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ExportDecompiled extends GhidraScript {

    // Timeout par fonction (secondes)
    private static final int DECOMPILE_TIMEOUT = 60;

    // Taille minimale d'une fonction pour l'exporter (en instructions)
    private static final int MIN_FUNCTION_SIZE = 4;

    // Regroupement par préfixe d'adresse pour organiser en fichiers par domaine
    private static final boolean GROUP_BY_PREFIX = true;

    @Override
    protected void run() throws Exception {
        // Déterminer le dossier de sortie
        String outputDir;
        String[] args = getScriptArgs();
        if (args != null && args.length > 0) {
            outputDir = args[0];
        } else {
            File chosen = askDirectory("Export Directory", "Select output folder for .c files");
            outputDir = chosen.getAbsolutePath();
        }

        File outDir = new File(outputDir);
        if (!outDir.exists()) {
            outDir.mkdirs();
        }

        printf("=== IECODE Decompiler Export ===\n");
        printf("Output: %s\n", outputDir);
        printf("Program: %s\n", currentProgram.getName());

        // Initialiser le décompilateur
        DecompInterface decompiler = new DecompInterface();
        DecompileOptions options = new DecompileOptions();
        decompiler.setOptions(options);

        if (!decompiler.openProgram(currentProgram)) {
            printerr("Failed to open program in decompiler");
            return;
        }

        FunctionManager funcManager = currentProgram.getFunctionManager();
        int totalFunctions = funcManager.getFunctionCount();
        printf("Total functions: %d\n\n", totalFunctions);

        // Collecter toutes les fonctions décompilées
        Map<String, List<String>> fileGroups = new HashMap<>();
        int exported = 0;
        int skipped = 0;
        int errors = 0;
        int count = 0;

        FunctionIterator functions = funcManager.getFunctions(true);
        while (functions.hasNext() && !monitor.isCancelled()) {
            Function func = functions.next();
            count++;

            // Progress
            monitor.setMessage(String.format("Decompiling %d/%d: %s", count, totalFunctions, func.getName()));
            monitor.setProgress(count);
            monitor.setMaximum(totalFunctions);

            // Filtrer les fonctions trop petites ou les thunks
            if (func.getBody().getNumAddresses() < MIN_FUNCTION_SIZE) {
                skipped++;
                continue;
            }

            // Ignorer les fonctions externes (imports DLL)
            if (func.isExternal() || func.isThunk()) {
                skipped++;
                continue;
            }

            // Décompiler
            DecompileResults results = decompiler.decompileFunction(func, DECOMPILE_TIMEOUT, monitor);
            if (results == null || !results.decompileCompleted()) {
                errors++;
                continue;
            }

            DecompiledFunction decompiledFunc = results.getDecompiledFunction();
            if (decompiledFunc == null) {
                errors++;
                continue;
            }

            String cCode = decompiledFunc.getC();
            if (cCode == null || cCode.trim().isEmpty()) {
                skipped++;
                continue;
            }

            // Déterminer le fichier de sortie
            String address = func.getEntryPoint().toString();
            String funcName = func.getName();
            String groupKey = getGroupKey(funcName, address);

            // Construire l'entrée avec commentaire d'adresse
            StringBuilder entry = new StringBuilder();
            entry.append(String.format("// Adresse: nie.exe+0x%s\n", address));
            entry.append(String.format("// Nom: %s\n", funcName));
            entry.append(String.format("// Taille: %d bytes\n", func.getBody().getNumAddresses()));
            entry.append(cCode);
            entry.append("\n\n");

            fileGroups.computeIfAbsent(groupKey, k -> new ArrayList<>()).add(entry.toString());
            exported++;
        }

        // Écrire les fichiers
        printf("\n=== Writing files ===\n");
        for (Map.Entry<String, List<String>> group : fileGroups.entrySet()) {
            String filename = group.getKey() + ".c";
            File outFile = new File(outDir, filename);

            try (PrintWriter writer = new PrintWriter(new FileWriter(outFile))) {
                // Header
                writer.println("// Auto-generated by IECODE ExportDecompiled.java");
                writer.println("// Source: " + currentProgram.getName());
                writer.printf("// Functions: %d\n", group.getValue().size());
                writer.println("//");
                writer.println("// WARNING: This is decompiled pseudo-C. Do not expect it to compile as-is.");
                writer.println("// Add #include \"decomp/compat.h\" and fix types before integrating.\n");
                writer.println("#include \"decomp/compat.h\"");
                writer.println("#include \"decomp/nie_types.h\"");
                writer.println();

                for (String funcCode : group.getValue()) {
                    writer.print(funcCode);
                }
            }
            printf("  %s (%d functions)\n", filename, group.getValue().size());
        }

        // Aussi exporter un index
        File indexFile = new File(outDir, "INDEX.md");
        try (PrintWriter writer = new PrintWriter(new FileWriter(indexFile))) {
            writer.println("# Exported Functions Index");
            writer.println();
            writer.printf("- **Total functions:** %d\n", totalFunctions);
            writer.printf("- **Exported:** %d\n", exported);
            writer.printf("- **Skipped:** %d (thunks, externals, too small)\n", skipped);
            writer.printf("- **Errors:** %d\n", errors);
            writer.printf("- **Files:** %d\n", fileGroups.size());
            writer.println();
            writer.println("## Files");
            writer.println();
            for (Map.Entry<String, List<String>> group : fileGroups.entrySet()) {
                writer.printf("- `%s.c` — %d functions\n", group.getKey(), group.getValue().size());
            }
        }

        decompiler.closeProgram();
        decompiler.dispose();

        printf("\n=== Export Complete ===\n");
        printf("Exported: %d functions -> %d files\n", exported, fileGroups.size());
        printf("Skipped:  %d | Errors: %d\n", skipped, errors);
        printf("Output:   %s\n", outputDir);
    }

    /**
     * Regroupe les fonctions par domaine heuristique basé sur le nom ou la plage d'adresses.
     */
    private String getGroupKey(String funcName, String address) {
        if (!GROUP_BY_PREFIX) {
            return "all_functions";
        }

        // Fonctions nommées par Ghidra (FUN_XXXX) → regrouper par plage d'adresse (256KB blocks)
        if (funcName.startsWith("FUN_")) {
            try {
                long addr = Long.parseUnsignedLong(address, 16);
                long block = addr >> 18; // 256KB blocks
                return String.format("block_%04x", block);
            } catch (NumberFormatException e) {
                return "unknown";
            }
        }

        // Fonctions avec namespace (Class::Method) → regrouper par classe
        if (funcName.contains("::")) {
            String className = funcName.split("::")[0];
            return sanitizeFilename(className.toLowerCase());
        }

        // Fonctions C standard ou imports connus
        if (funcName.startsWith("_") || funcName.startsWith("??")) {
            return "runtime";
        }

        // Autres fonctions nommées
        return "named_functions";
    }

    private String sanitizeFilename(String name) {
        return name.replaceAll("[^a-zA-Z0-9_]", "_").replaceAll("_+", "_");
    }
}
