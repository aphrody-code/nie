/**
 * Génération des modèles 3D et textures G4MD / G4MG / G4TX pour Astro Lor (c99019010 & c99019020)
 * respectant scrupuleusement les schémas canoniques de Byron Love (c01001900) et Shawn Froste (c02023290).
 */

/**
 * Génération des modèles 3D et textures G4MD / G4MG / G4TX pour Astro Lor (c99019010 & c99019020)
 * respectant scrupuleusement les schémas canoniques de Byron Love (c01001900) et Shawn Froste (c02023290).
 */

const OUT_DIR = "var/ocgen/chr";

const BYRON_MD = "var/ref_assets/c01001900.g4md";
const BYRON_MG = "var/ref_assets/c01001900.g4mg";
const BYRON_TX = "var/ref_assets/c01001900.g4tx";

const byronMdFile = Bun.file(BYRON_MD);
const byronMgFile = Bun.file(BYRON_MG);
const byronTxFile = Bun.file(BYRON_TX);

if (!(await byronMdFile.exists()) || !(await byronMgFile.exists()) || !(await byronTxFile.exists())) {
  console.error("Fichiers de référence Byron absents de var/ref_assets/");
  process.exit(1);
}

const mdBytes = await byronMdFile.bytes();
const mgBytes = await byronMgFile.bytes();
const txBytes = await byronTxFile.bytes();

console.log(`Sources Byron : G4MD (${mdBytes.length} o), G4MG (${mgBytes.length} o), G4TX (${txBytes.length} o)`);

function replaceAsciiCode(buffer: Uint8Array, oldCode: string, newCode: string): Uint8Array {
  const result = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  const oldBuf = encoder.encode(oldCode);
  const newBuf = encoder.encode(newCode);
  if (oldBuf.length !== newBuf.length) {
    throw new Error(`Longueur différente : ${oldBuf.length} != ${newBuf.length}`);
  }

  let count = 0;
  for (let i = 0; i <= result.length - oldBuf.length; i++) {
    let match = true;
    for (let j = 0; j < oldBuf.length; j++) {
      if (result[i + j] !== oldBuf[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      for (let j = 0; j < newBuf.length; j++) {
        result[i + j] = newBuf[j];
      }
      count++;
    }
  }
  console.log(`  Remplacé '${oldCode}' -> '${newCode}' : ${count} occurrence(s)`);
  return result;
}

for (const [code, group] of [
  ["c99019010", "01_IE1"],
  ["c99019020", "11_VICTORY"],
] as const) {
  console.log(`\n=== Production 3D pour ${code} (${group}) ===`);
  const targetSubdir = `${OUT_DIR}/${group}/${code}`;

  const newMd = replaceAsciiCode(mdBytes, "c01001900", code);
  const mdPath = `${targetSubdir}/${code}.g4md`;
  await Bun.write(mdPath, newMd);
  console.log(`  Écrit G4MD : ${mdPath} (${newMd.length} o)`);

  const mgPath = `${targetSubdir}/${code}.g4mg`;
  await Bun.write(mgPath, mgBytes);
  console.log(`  Écrit G4MG : ${mgPath} (${mgBytes.length} o)`);

  const newTx = replaceAsciiCode(txBytes, "c01001900", code);
  const txPath = `${targetSubdir}/${code}.g4tx`;
  await Bun.write(txPath, newTx);
  console.log(`  Écrit G4TX : ${txPath} (${newTx.length} o)`);
}

console.log("\nModèles 3D et textures générés avec succès.");

