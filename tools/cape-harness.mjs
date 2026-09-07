// Real chat UI, backed by an isolated local test inventory (never writes user data).
import fs from 'node:fs';
const designs = ['tools/cape-designs.json','tools/cape-designs-v2.json','tools/cape-designs-v3.json'].flatMap(file=>JSON.parse(fs.readFileSync(file, 'utf8')))
 .filter(design => fs.existsSync('assets/pixelheroes/Cape/'+design.id+'.png'));
const stub = `<script>
(()=>{
const handlers={};
const notify=()=>{for(const cb of handlers['self:appearance']||[])cb({appearance:equipped});};
let equipped={race:{name:'Human'},hair:{name:'Hair1'},armor:{name:'TravelerTunic'},cape:{name:'PixelLabAngel'}};
const owned=['race:Human','Hair/Hair1','Armor/TravelerTunic',...${JSON.stringify(designs.map(d=>'Cape/'+d.id))}];
const api={
 on:(event,callback)=>{(handlers[event]??=[]).push(callback);return()=>{}},
 getSelf:async()=>({nickname:'망토테스트',tag:'0006',appearance:equipped,giftIntervalSec:180}),
 getSettings:async()=>({opacity:100,scale:4,chatColor:'#d94f63'}),
 getNetState:async()=>({selfId:'local',connected:false,online:1,players:[]}),
 getInventory:async()=>({version:2,owned,equipped}),
 getManifest:async()=>fetch('/assets/pixelheroes/manifest.json').then(r=>r.json()),
 loadPart:async(layer,name)=>'/assets/pixelheroes/'+encodeURIComponent(layer)+'/'+encodeURIComponent(name)+'.png',
 getChatHistory:async()=>[],getWallet:async()=>({coins:0,items:[],fish:[],gems:0,actions:[],minerals:[]}),
 getCoins:async()=>0,
 equip:payload=>{equipped={...equipped,[payload.slot]:payload.name?{name:payload.name,h:payload.h||0,s:payload.s||0,v:payload.v||0}:null};notify();},
};
window.overlay=new Proxy(api,{get:(target,key)=>key in target?target[key]:()=>Promise.resolve(null)});
const panel=document.getElementById('appearance-panel');
const observer=new MutationObserver(()=>{if(panel.classList.contains('open')){observer.disconnect();notify()}});
observer.observe(panel,{attributes:true,attributeFilter:['class']});
})();</script>`;
const source=fs.readFileSync('packages/client/src/renderer/chat.html','utf8');
const html=source.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/,'')
 .replace('<script src="../../dist/renderer/composer.js"></script>',stub+'<script src="/packages/client/dist/renderer/composer.js"></script>')
 .replace('<script src="../../dist/renderer/chat.js"></script>','<script src="/packages/client/dist/renderer/chat.js"></script>');
fs.writeFileSync('tools/cape-harness.html',html);
console.log('Cape appearance harness ready');
