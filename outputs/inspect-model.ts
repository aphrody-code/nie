const code = process.argv[2] || 'c05024700';
const response = await fetch(`http://127.0.0.1:8790/model-full/${code}.glb`);
if (!response.ok) throw new Error(`${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
await Bun.write(`outputs/${code}-before.glb`, bytes);
const len = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20,20+len).toString());
const bin = bytes.subarray(28+len);
for (const img of doc.images) {
 const view = doc.bufferViews[img.bufferView];
 await Bun.write(`outputs/${code}-${img.name}.png`,bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength));
}
console.log(doc.materials.map((m:any)=>({name:m.name,alpha:m.alphaMode})));
