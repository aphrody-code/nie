import { createHash } from 'node:crypto';
const pageUrl = 'https://zukan.inazuma.jp/en/chara_model_view/?q=hN2cl56NnpyLmo2glpvdxaTdnM_Kz83LyM_P3aKC';
const response = await fetch(pageUrl);
if (!response.ok) throw new Error(`Page: HTTP ${response.status}`);
const html = await response.text();
const model = html.match(/const modelId = '([^']+)'/)?.[1];
const count = Number(html.match(/const imageCount = (\d+)/)?.[1]);
const base = html.match(/return `(https:\/\/[^`]+)` \+ `_r/)?.[1];
if (!model || !base || !count || count > 100) throw new Error('Configuration du visualiseur introuvable');
const root = `outputs/zukan-reference/${model}`;
await Bun.write(`${root}/source.html`, html);
const frames: any[] = [];
for (const suffix of ['', '_fullbody']) {
 for (let index = 0; index < count; index++) {
  const url = `${base}_r${index}${suffix}.png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`PNG invalide: ${url}`);
  const name = `${model}_r${index}${suffix}.png`;
  await Bun.write(`${root}/${name}`,bytes);
  frames.push({index, view:suffix ? 'fullbody':'portrait', file:name, url, width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
}
await Bun.write(`${root}/manifest.json`,JSON.stringify({source:pageUrl,downloadedAt:new Date().toISOString(),model,frames},null,2));
console.log(JSON.stringify({root,count:frames.length,bytes:frames.reduce((n,f)=>n+f.bytes,0),sizes:[...new Set(frames.map(f=>`${f.view}: ${f.width}x${f.height}`))]}));
