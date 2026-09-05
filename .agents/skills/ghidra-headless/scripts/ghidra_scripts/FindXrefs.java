/* ###
 * List all references (read/write/call) to the address in GHIDRA_ADDR.
 * Reuse an analyzed project via -process. @category Analysis
 */

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;

public class FindXrefs extends GhidraScript {

    @Override
    public void run() throws Exception {
        String target = System.getenv("GHIDRA_ADDR");
        if (target == null || target.isEmpty()) {
            printerr("GHIDRA_ADDR empty");
            return;
        }
        Address addr = currentProgram.getAddressFactory().getAddress(target);
        Reference[] refs = getReferencesTo(addr);
        for (Reference r : refs) {
            Address from = r.getFromAddress();
            Function f = getFunctionContaining(from);
            String fn = (f != null) ? (f.getName() + "@" + f.getEntryPoint()) : "?";
            println("XREF " + from + " " + r.getReferenceType() + " in " + fn);
        }
        println("total refs to " + target + ": " + refs.length);
    }
}
