// ExportSymbols.java — exporte `adresse → nom` des fonctions nommées par Ghidra.
//
// Pourquoi pas `nie-index.json` : dans ce format, la clé d'une fonction porte son adresse
// SEULEMENT sous la forme `FUN_<hex>` ; une fonction *nommée* a pour clé son nom, perd donc
// son adresse et atterrit sur SYNTH_BASE. C'est l'origine du « index Ghidra désaligné ».
// Ici la sortie est un couple explicite (vaddr, name) : alignée sur `.pdata` par construction.
//
// Usage :
//   analyzeHeadless <projects> IECODE -process nie.exe -noanalysis \
//       -scriptPath scripts/ghidra -postScript ExportSymbols.java <sortie.json>
//
// @category IECODE
// @author IECODE Project

import java.io.FileWriter;
import java.io.PrintWriter;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.SourceType;

public class ExportSymbols extends GhidraScript {

    /** Un nom auto-généré par Ghidra n'apprend rien : il encode déjà l'adresse. */
    private static boolean isGenerated(String name) {
        return name.startsWith("FUN_") || name.startsWith("SUB_") || name.startsWith("thunk_FUN_");
    }

    private static String jsonEscape(String s) {
        StringBuilder b = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n");  break;
                case '\r': b.append("\\r");  break;
                case '\t': b.append("\\t");  break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.toString();
    }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        String out = args.length > 0 ? args[0] : "var/ghidra-symbols.json";

        FunctionManager fm = currentProgram.getFunctionManager();
        int total = 0, named = 0, external = 0;

        try (PrintWriter w = new PrintWriter(new FileWriter(out))) {
            w.println("{\"symbols\":[");
            boolean first = true;
            for (Function f : fm.getFunctions(true)) {
                total++;
                if (f.isExternal()) { external++; continue; }
                String name = f.getName();
                if (isGenerated(name)) continue;

                // La source du nom dit ce qui l'a produit (RTTI, demangler, FID, import…).
                SourceType st = f.getSymbol() != null ? f.getSymbol().getSource() : SourceType.DEFAULT;
                long va = f.getEntryPoint().getOffset();

                if (!first) w.println(",");
                first = false;
                w.printf("{\"va\":%d,\"name\":\"%s\",\"src\":\"%s\"}", va, jsonEscape(name), st);
                named++;
            }
            w.println();
            w.println("],");
            w.printf("\"total\":%d,\"named\":%d,\"external\":%d}%n", total, named, external);
        }

        printf("ExportSymbols: %d fonctions, %d nommees, %d externes -> %s\n",
               total, named, external, out);
    }
}
