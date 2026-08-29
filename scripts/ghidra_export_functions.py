# Export des fonctions analysées par Ghidra vers un CSV ingérable par niers.
#
# Script Ghidra (Jython) : à passer à `analyzeHeadless … -postScript`.
# Écrit une ligne par fonction : adresse, nom, source du nom, taille, nb de
# paramètres, convention d'appel.
#
# La colonne `source` est ce qui compte pour la fusion : seules les fonctions
# dont Ghidra a trouvé le nom autrement que par défaut (`FUN_<hex>`) valent
# quelque chose ici — en particulier celles reconnues par FID (Function ID),
# qui identifie les fonctions de bibliothèques statiques par signature et donne
# donc leur nom *réel*.
#
# Sortie : $NIE_GHIDRA_OUT, ou <projet>/ghidra-functions.csv à défaut.
# @category niers

import os

from ghidra.program.model.symbol import SourceType

out_path = os.environ.get("NIE_GHIDRA_OUT")
if not out_path:
    out_path = os.path.join(os.getcwd(), "ghidra-functions.csv")

fm = currentProgram.getFunctionManager()
listing = currentProgram.getListing()

n_total = 0
n_named = 0
with open(out_path, "w") as fh:
    fh.write("vaddr,name,source,size,params,cc\n")
    for f in fm.getFunctions(True):
        n_total += 1
        name = f.getName()
        sym = f.getSymbol()
        src = sym.getSource().toString() if sym is not None else "UNKNOWN"
        # Un nom par défaut (`FUN_140001000`) n'apprend rien : il est exporté
        # quand même, mais marqué DEFAULT pour que l'ingestion l'écarte.
        if src != "DEFAULT":
            n_named += 1
        try:
            size = f.getBody().getNumAddresses()
        except Exception:
            size = 0
        try:
            cc = f.getCallingConventionName() or ""
        except Exception:
            cc = ""
        # Les virgules et guillemets d'un nom C++ démanglé casseraient le CSV.
        safe = name.replace('"', "'").replace(",", ";")
        fh.write(
            "0x%x,%s,%s,%d,%d,%s\n"
            % (f.getEntryPoint().getOffset(), safe, src, size, f.getParameterCount(), cc)
        )

print("[niers] %d fonctions exportees (%d avec un nom non par defaut) -> %s"
      % (n_total, n_named, out_path))
