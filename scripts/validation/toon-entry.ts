import { mountCharacterRenderer } from '../apps/azalee/lib/character-renderer';
const host = document.querySelector('#viewer') as HTMLElement;
const renderer = mountCharacterRenderer(host,{src:'/model.glb?presentation=6',alt:'Shawn Froste',onLoad(){document.querySelector('#status')!.textContent='Rendu cel chargé';},onError(error){console.error(error);document.querySelector('#status')!.textContent=String(error);}});
for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>{const i=Number(button.dataset.angle);renderer.setAngle(-i*45);(document.querySelector('#reference') as HTMLImageElement).src='/reference/'+i+'.png';});
