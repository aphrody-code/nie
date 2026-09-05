const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Validation Shawn Froste</title>
<style>body{margin:0;background:#241f17;color:#fff;font:16px sans-serif}main{display:flex}section{width:50vw;text-align:center}model-viewer,img{width:50vw;height:85vh;object-fit:contain}button{padding:10px;margin:5px}</style>
<script type="module" src="/model-viewer.js"></script>
<nav>${Array.from({length:8},(_,i)=>`<button onclick="view(${i})">Angle ${i}</button>`).join('')}</nav>
<main><section>Modèle corrigé<model-viewer src="/model.glb?v=2" camera-controls camera-orbit="0deg 85deg auto" interaction-prompt="none"></model-viewer></section><section>Référence Zukan<img id="reference" src="/reference/0.png"></section></main>
<script>function view(i){document.querySelector('model-viewer').cameraOrbit=(-i*45)+'deg 85deg auto';document.querySelector('#reference').src='/reference/'+i+'.png'}</script></html>`;
Bun.serve({hostname:'127.0.0.1',port:8794,async fetch(req){const path=new URL(req.url).pathname;
 if(path==='/')return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/toon')return new Response(`<style>body{margin:0;background:#241f17;color:white;font:16px sans-serif}main{display:flex}#viewer,img{width:50vw;height:85vh;object-fit:contain}button{padding:10px;margin:5px}</style><nav>${Array.from({length:8},(_,i)=>`<button data-angle="${i}">Angle ${i}</button>`).join('')}<span id="status">Chargement</span></nav><main><div id="viewer"></div><img id="reference" src="/reference/0.png"></main><script type="module" src="/toon.js"></script>`,{headers:{'Content-Type':'text/html'}});
 if(path==='/toon.js')return new Response(Bun.file('var/outputs/toon.js'));
 if(path==='/atlas')return new Response('<body style="background:black"><img src="/atlas.png" width="700">',{headers:{'Content-Type':'text/html'}});
 if(path==='/atlas.png')return new Response(Bun.file('outputs/c05024700-n000105_10.png'));
 if(path==='/model-viewer.js')return new Response(Bun.file('apps/azalee/public/vendor/model-viewer.min.js'));
 if(path==='/model.glb'){ const res=await fetch('http://127.0.0.1:8793/model-full/c05024700.glb');return new Response(res.body,{headers:{'Content-Type':'model/gltf-binary','Cache-Control':'no-store'}}); }
 const match=path.match(/^\/reference\/([0-7])\.png$/);
 if(match)return new Response(Bun.file('outputs/zukan-reference/c05024700/c05024700_r'+match[1]+'_fullbody.png'));
 return new Response('Absent',{status:404});
}});console.log('http://127.0.0.1:8794');
