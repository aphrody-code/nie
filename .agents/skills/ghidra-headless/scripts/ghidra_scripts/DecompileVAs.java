/* ###
 * Decompile specific functions by virtual address (comma-separated GHIDRA_VAS env).
 * Output: one .c per function in GHIDRA_OUTPUT_DIR. Reuse an analyzed project via -process.
 * @category Export
 */

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;

public class DecompileVAs extends GhidraScript {

    @Override
    public void run() throws Exception {
        String outDir = System.getenv("GHIDRA_OUTPUT_DIR");
        if (outDir == null || outDir.isEmpty()) {
            outDir = ".";
        }
        String vas = System.getenv("GHIDRA_VAS");
        if (vas == null || vas.isEmpty()) {
            printerr("GHIDRA_VAS is empty (expected comma-separated hex VAs)");
            return;
        }

        DecompInterface dec = new DecompInterface();
        dec.setOptions(new DecompileOptions());
        if (!dec.openProgram(currentProgram)) {
            printerr("Failed to init decompiler: " + dec.getLastMessage());
            return;
        }

        try {
            for (String s : vas.split(",")) {
                s = s.trim();
                if (s.isEmpty()) {
                    continue;
                }
                Address addr = currentProgram.getAddressFactory().getAddress(s);
                Function f = getFunctionContaining(addr);
                if (f == null) {
                    printerr("No function at " + s);
                    continue;
                }
                long ep = f.getEntryPoint().getOffset();
                String base = (f.getName() + "_" + Long.toHexString(ep)).replaceAll("[^a-zA-Z0-9._-]", "_");
                File out = new File(outDir, base + ".c");
                DecompileResults res = dec.decompileFunction(f, 180, monitor);
                try (PrintWriter w = new PrintWriter(new FileWriter(out))) {
                    w.println("// " + f.getName() + " @ " + f.getEntryPoint()
                            + "  (requested VA " + s + ")");
                    w.println("// size=" + f.getBody().getNumAddresses());
                    if (res.decompileCompleted()) {
                        w.println(res.getDecompiledFunction().getC());
                    } else {
                        w.println("// DECOMPILE FAILED: " + res.getErrorMessage());
                    }
                }
                println("wrote " + out.getName());
            }
        } finally {
            dec.dispose();
        }
    }
}
