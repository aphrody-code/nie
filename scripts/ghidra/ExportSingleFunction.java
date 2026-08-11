// ExportSingleFunction.java — Export une seule fonction par adresse ou nom
// Utile pour cibler des fonctions spécifiques de nie.exe
//
// Usage headless:
//   analyzeHeadless <project> IECODE -process nie.exe -postScript ExportSingleFunction.java <output_file> <func_address_or_name>
//
// Usage GUI:
//   Placer le curseur sur la fonction → Script Manager → Run
//
// @category IECODE
// @author IECODE Project

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;

public class ExportSingleFunction extends GhidraScript {

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        String outputPath = null;
        String target = null;

        if (args != null && args.length >= 2) {
            outputPath = args[0];
            target = args[1];
        } else {
            // GUI mode: utiliser la fonction sous le curseur
            Function funcAtCursor = getFunctionContaining(currentAddress);
            if (funcAtCursor == null) {
                printerr("No function at current cursor position");
                return;
            }
            target = funcAtCursor.getName();
            File chosen = askFile("Save decompiled function", "Save");
            outputPath = chosen.getAbsolutePath();
        }

        // Trouver la fonction
        FunctionManager funcManager = currentProgram.getFunctionManager();
        Function func = null;

        // Essayer par adresse d'abord
        try {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(target);
            func = funcManager.getFunctionAt(addr);
        } catch (Exception e) {
            // Pas une adresse, chercher par nom
        }

        // Chercher par nom si pas trouvé par adresse
        if (func == null) {
            for (Function f : funcManager.getFunctions(true)) {
                if (f.getName().equals(target) || f.getName().contains(target)) {
                    func = f;
                    break;
                }
            }
        }

        if (func == null) {
            printerr("Function not found: " + target);
            return;
        }

        printf("Decompiling: %s @ %s\n", func.getName(), func.getEntryPoint());

        // Décompiler
        DecompInterface decompiler = new DecompInterface();
        DecompileOptions options = new DecompileOptions();
        decompiler.setOptions(options);
        decompiler.openProgram(currentProgram);

        DecompileResults results = decompiler.decompileFunction(func, 120, monitor);

        if (results == null || !results.decompileCompleted()) {
            printerr("Decompilation failed: " +
                (results != null ? results.getErrorMessage() : "null results"));
            decompiler.dispose();
            return;
        }

        DecompiledFunction decompiledFunc = results.getDecompiledFunction();
        String cCode = decompiledFunc.getC();
        String signature = decompiledFunc.getSignature();

        // Écrire le fichier
        try (PrintWriter writer = new PrintWriter(new FileWriter(outputPath))) {
            writer.println("#include \"decomp/compat.h\"");
            writer.println("#include \"decomp/nie_types.h\"");
            writer.println();
            writer.printf("// Adresse: nie.exe+0x%s\n", func.getEntryPoint());
            writer.printf("// Nom: %s\n", func.getName());
            writer.printf("// Signature: %s\n", signature);
            writer.printf("// Taille: %d bytes\n", func.getBody().getNumAddresses());
            writer.println();
            writer.print(cCode);
        }

        decompiler.closeProgram();
        decompiler.dispose();

        printf("Exported to: %s\n", outputPath);
    }
}
