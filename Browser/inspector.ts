import { CONTRACT_VERSION, ENGINE_ID, ENGINE_VERSION, canonicalJson, contractResult, imageToWorld, siteSchema, validateSite, worldToImage,
  type Position, type Polygon, type SiteContract, type Validation } from '../Engine/contracts';
import { fixtures } from '../Engine/fixtures';
import { generateStreetNetwork } from '../Engine/streets';

declare global {
  interface Window { cityBuild?: { id: string; appRoot: string }; contractInspector?: { getState: () => unknown }; }
}
const element = <ElementType extends HTMLElement>(selector: string): ElementType => document.querySelector(selector) as ElementType;
const canvas = element<HTMLCanvasElement>('#contract-map');
const context = canvas.getContext('2d')!;
const fixtureInput = element<HTMLSelectElement>('#fixture');
const seedInput = element<HTMLInputElement>('#contract-seed');
const jsonInput = element<HTMLTextAreaElement>('#contract-json');
const buildId = window.cityBuild?.id ?? 'unversioned';
const root = new URL(window.cityBuild?.appRoot ?? './', location.href);
type Approval = { status: 'approved'; fingerprint: string; engineVersion: string; buildId: string; reviewedAt: string };
let draft: unknown = fixtures[0].create();
let site: SiteContract | null = null;
let validation: Validation = validateSite(draft);
let image: HTMLImageElement | null = null;
let assetKey = '';
let assetError = '';
let pending = false;
let fingerprint = '';
let approval: Approval | null = null;
let streetResult: ReturnType<typeof generateStreetNetwork> | null = null;
let revision = 0;
let selected = 'land';
let frame = { left: -50, top: -50, width: 1100, height: 900 };
let pointer: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
const layers = { background: true, grid: true, buildable: true, land: true, water: true, forbidden: true, protected: true, entrances: true, streets: true, registration: true };
const colors: Record<keyof typeof layers, string> = { background: '#d6dbd5', grid: '#bac4bb', buildable: '#cce2cb', land: '#2c664a',
  water: '#6eafc1', forbidden: '#d37a72', protected: '#c5a34e', entrances: '#304e75', streets: '#364d59', registration: '#757d9e' };

function message(text: string) { const output = element<HTMLOutputElement>('#inspector-message'); output.textContent = text; output.hidden = !text; }
function approvalKey() { return `city-contract-review:${ENGINE_VERSION}:${buildId}:${fingerprint}`; }
function currentResult() { return site && validation.valid && !pending ? streetResult ?? contractResult(site) : null; }
window.contractInspector = { getState: () => ({ contract: structuredClone(draft), validation: structuredClone(validation),
  fingerprint, approval, ready: !pending, engineId: ENGINE_ID, engineVersion: ENGINE_VERSION, phase: streetResult?.phase ?? 'contract', result: currentResult() }) };

function polygonPath(target: CanvasRenderingContext2D, polygon: Polygon) {
  target.beginPath();
  for (const ring of polygon.coordinates) {
    if (!ring.length) continue;
    target.moveTo(ring[0][0], ring[0][1]);
    for (const point of ring.slice(1)) target.lineTo(point[0], point[1]);
    target.closePath();
  }
}
function geometryList() {
  return site ? [{id:'land', label:site.name, geometry:site.land}, ...site.masks, ...site.protected] : [];
}
function transform(width = canvas.clientWidth, height = canvas.clientHeight) {
  const scale = Math.min(width / frame.width, height / frame.height);
  return { scale, left: (width - frame.width * scale) / 2 - frame.left * scale,
    top: (height - frame.height * scale) / 2 - frame.top * scale };
}
function worldAt(x: number, y: number): Position { const view = transform(); return [(x - view.left) / view.scale, (y - view.top) / view.scale]; }
function paint(target: CanvasRenderingContext2D, width: number, height: number, ratio = 1, exported = false) {
  const view = transform(width, height);
  target.setTransform(ratio,0,0,ratio,0,0); target.clearRect(0,0,width,height); target.fillStyle = '#f8faf8'; target.fillRect(0,0,width,height);
  target.save(); target.translate(view.left,view.top); target.scale(view.scale,view.scale);
  if (site?.background && image && layers.background) {
    const background = site.background;
    target.save(); target.translate(...background.origin); target.rotate(background.rotationDegrees * Math.PI / 180);
    target.scale(background.metersPerPixel,background.metersPerPixel); target.globalAlpha = background.opacity;
    target.drawImage(image,0,0,background.pixelWidth,background.pixelHeight); target.restore();
  }
  if (layers.grid) {
    const raw = 75 / view.scale; const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1,2,5,10].map(multiplier => multiplier * power).find(value => value >= raw)!;
    target.lineWidth = 0.6 / view.scale; target.strokeStyle = '#c7d1c84f'; target.beginPath();
    for (let position = Math.floor(frame.left / step) * step; position < frame.left + frame.width; position += step) { target.moveTo(position,frame.top); target.lineTo(position,frame.top+frame.height); }
    for (let position = Math.floor(frame.top / step) * step; position < frame.top + frame.height; position += step) { target.moveTo(frame.left,position); target.lineTo(frame.left+frame.width,position); }
    target.stroke();
  }
  const draw = (polygon: Polygon, fill: string | null, stroke: string, id: string) => {
    polygonPath(target,polygon); if(fill){target.fillStyle=fill;target.fill('evenodd');}
    const hasError = validation.issues.some(issue => issue.severity==='error' && issue.entityId===id);
    target.strokeStyle = hasError ? '#b53730' : (selected===id ? '#162f23' : stroke);
    target.lineWidth = (selected===id ? 3 : 1.5)/view.scale; target.stroke();
  };
  if (site) {
    if (layers.buildable && validation.valid) for (const part of validation.buildable)
      draw({type:'Polygon',coordinates:part as Position[][]},'#cce2cb72','#83aa86','buildable');
    for(const mask of site.masks) if(layers[mask.kind]) draw(mask.geometry,mask.kind==='water'?'#6eafc185':'#d37a7255',colors[mask.kind],mask.id);
    if(layers.protected) for(const feature of site.protected) draw(feature.geometry,'#e8cf8b85',colors.protected,feature.id);
    if(layers.land) draw(site.land,null,colors.land,'land');
    if(layers.entrances) for(const entrance of site.entrances){
      const angle=entrance.headingDegrees*Math.PI/180; const start=entrance.position;
      const length=Math.max(entrance.clearanceMeters,22/view.scale); const end:Position=[start[0]+Math.cos(angle)*length,start[1]+Math.sin(angle)*length];
      const invalid=validation.issues.some(issue=>issue.severity==='error'&&issue.entityId===entrance.id);
      target.strokeStyle=invalid?'#b53730':colors.entrances;target.fillStyle=target.strokeStyle;target.lineWidth=2/view.scale;
      target.beginPath();target.arc(start[0],start[1],4/view.scale,0,Math.PI*2);target.fill();
      target.beginPath();target.moveTo(...start);target.lineTo(...end);target.stroke();
      target.beginPath();target.moveTo(...end);target.lineTo(end[0]-Math.cos(angle-.55)*7/view.scale,end[1]-Math.sin(angle-.55)*7/view.scale);
      target.lineTo(end[0]-Math.cos(angle+.55)*7/view.scale,end[1]-Math.sin(angle+.55)*7/view.scale);target.closePath();target.fill();
    }
    if(streetResult&&layers.streets) for(const edge of streetResult.streets.edges){
      const path=edge.centerline;if(path.length<2)continue;
      target.lineCap='round';target.lineJoin='round';target.beginPath();target.moveTo(...path[0]);for(const point of path.slice(1))target.lineTo(...point);
      target.strokeStyle='#fffdf4';target.lineWidth=(edge.widthMeters+2.5)/view.scale;target.stroke();
      target.strokeStyle=edge.kind==='primary'?'#334d5c':edge.kind==='secondary'?'#a25d3a':'#3f765b';
      target.lineWidth=edge.widthMeters/view.scale;target.stroke();
    }
    if(site.background&&layers.registration){
      const corners:Position[]=[[0,0],[site.background.pixelWidth,0],[site.background.pixelWidth,site.background.pixelHeight],[0,site.background.pixelHeight],[0,0]];
      target.strokeStyle=colors.registration;target.lineWidth=1/view.scale;target.setLineDash([6/view.scale,4/view.scale]);target.beginPath();
      corners.map(point=>imageToWorld(point,site!.background!)).forEach((point,index)=>index?target.lineTo(...point):target.moveTo(...point));target.stroke();target.setLineDash([]);
      target.font=`${10/view.scale}px Menlo, monospace`;target.fillStyle='#51665a';
      for(const point of [[100,100],[900,100],[100,700]] as Position[]){
        target.beginPath();target.moveTo(point[0]-5/view.scale,point[1]);target.lineTo(point[0]+5/view.scale,point[1]);
        target.moveTo(point[0],point[1]-5/view.scale);target.lineTo(point[0],point[1]+5/view.scale);target.stroke();
        target.fillText(`${point[0]},${point[1]}`,point[0]+7/view.scale,point[1]-5/view.scale);
      }
    }
  }
  target.restore(); target.fillStyle='#526259';target.font='11px Menlo, monospace';
  const raw=90/view.scale;const power=10**Math.floor(Math.log10(raw));const bar=[1,2,5,10].map(value=>value*power).find(value=>value>=raw)!;
  target.strokeStyle='#526259';target.lineWidth=2;target.beginPath();target.moveTo(16,height-24);target.lineTo(16+bar*view.scale,height-24);target.stroke();target.fillText(`${bar} m`,16,height-31);
  if(exported){target.fillStyle='#ffffffed';target.fillRect(0,0,width,54);target.fillStyle='#203a2c';target.font='16px "Avenir Next", sans-serif';
    target.fillText(`${site?.name??'Invalid Contract'} | ${validation.valid?'VALIDATED':'INVALID'} | ${streetResult?'Street network phase':'Contract phase only'}`,16,23);
    target.font='10px Menlo, monospace';target.fillText(`Engine ${ENGINE_VERSION} | Build ${buildId} | Seed ${site?.seed??'-'} | ${fingerprint.slice(0,16)}`,16,43);}
}
function redraw(){const ratio=Math.min(devicePixelRatio||1,2);const width=canvas.clientWidth,height=canvas.clientHeight;if(!width||!height)return;
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);paint(context,width,height,ratio);}
function fitSite(){if(!site)return;const points=site.land.coordinates.flat();const minX=Math.min(...points.map(point=>point[0])),maxX=Math.max(...points.map(point=>point[0]));
  const minY=Math.min(...points.map(point=>point[1])),maxY=Math.max(...points.map(point=>point[1]));const margin=Math.max(maxX-minX,maxY-minY)*.08;
  frame={left:minX-margin,top:minY-margin,width:Math.max(1,maxX-minX+margin*2),height:Math.max(1,maxY-minY+margin*2)};redraw();}
function zoom(factor:number,x=canvas.clientWidth/2,y=canvas.clientHeight/2){const anchor=worldAt(x,y);frame={left:anchor[0]+(frame.left-anchor[0])/factor,
  top:anchor[1]+(frame.top-anchor[1])/factor,width:Math.max(.1,Math.min(2e7,frame.width/factor)),height:Math.max(.1,Math.min(2e7,frame.height/factor))};redraw();}

async function referenceImage(background:NonNullable<SiteContract['background']>):Promise<HTMLImageElement|null>{
  let source=background.imageDataUrl;
  if(!source&&background.fixture){const fixture=fixtures.find(entry=>entry.id===background.fixture)!.create();const bitmap=document.createElement('canvas');bitmap.width=1000;bitmap.height=800;
    const drawing=bitmap.getContext('2d')!;drawing.fillStyle='#e8eee4';drawing.fillRect(0,0,1000,800);
    drawing.strokeStyle='#bccbb94d';drawing.lineWidth=1;for(let position=0;position<=1000;position+=50){drawing.beginPath();drawing.moveTo(position,0);drawing.lineTo(position,800);drawing.stroke();}
    for(let position=0;position<=800;position+=50){drawing.beginPath();drawing.moveTo(0,position);drawing.lineTo(1000,position);drawing.stroke();}
    for(const mask of fixture.masks){polygonPath(drawing,mask.geometry);drawing.fillStyle=mask.kind==='water'?'#9ac5cf':'#c4b1ab';drawing.fill('evenodd');}
    drawing.strokeStyle='#49655a';drawing.lineWidth=2;for(const point of [[100,100],[900,100],[100,700]]){drawing.beginPath();drawing.moveTo(point[0]-8,point[1]);drawing.lineTo(point[0]+8,point[1]);drawing.moveTo(point[0],point[1]-8);drawing.lineTo(point[0],point[1]+8);drawing.stroke();}
    source=bitmap.toDataURL('image/png');}
  if(!source)throw new Error('Background has no raster source.');const result=new Image();result.src=source;await result.decode();
  if(result.naturalWidth!==background.pixelWidth||result.naturalHeight!==background.pixelHeight)throw new Error('Background pixel dimensions do not match the contract.');
  return result;
}

function refreshPanels(){
  const valid=validation.valid&&!pending;
  const state=element<HTMLOutputElement>('#validation-status');state.textContent=pending?'Validating image...':validation.valid?'Valid':'Invalid';state.classList.toggle('invalid',!validation.valid);
  const metrics=element<HTMLDListElement>('#contract-metrics');metrics.replaceChildren();
  for(const [name,value] of Object.entries(validation.metrics)){const term=document.createElement('dt');term.textContent=name.replace(/([A-Z])/g,' $1');const detail=document.createElement('dd');detail.textContent=name==='regions'?String(value):`${value.toLocaleString(undefined,{maximumFractionDigits:1})} m²`;metrics.append(term,detail);}
  const issues=element<HTMLDivElement>('#issues');issues.replaceChildren();for(const issue of validation.issues){const button=document.createElement('button');button.className=`issue ${issue.severity}`;button.type='button';
    const code=document.createElement('strong');code.textContent=`${issue.code} · ${issue.entityId}`;const body=document.createElement('span');body.textContent=issue.message;button.append(code,body);button.onclick=()=>{selected=issue.entityId;refreshPanels();redraw();};issues.append(button);}
  const features=element<HTMLDivElement>('#features');features.replaceChildren();for(const feature of [...geometryList(),...(site?.entrances??[])]){const button=document.createElement('button');button.type='button';button.textContent=feature.label;button.classList.toggle('selected',selected===feature.id);button.onclick=()=>{selected=feature.id;refreshPanels();redraw();};features.append(button);}
  element<HTMLOutputElement>('#review-state').textContent=approval?`Approved locally · ${new Date(approval.reviewedAt).toLocaleString()}`:'Pending visual review';
  element<HTMLButtonElement>('#approve-contract').disabled=!valid||Boolean(approval);
  element<HTMLButtonElement>('#revoke-review').disabled=!approval;
  const streetStatus=element<HTMLOutputElement>('#street-status');
  streetStatus.textContent=streetResult?(streetResult.streets.connected
    ?`Connected network · ${streetResult.streets.nodes.length} junctions · ${streetResult.streets.edges.length} streets`
    :`Disconnected · ${streetResult.streets.components} components · some land is unreachable`):'No street network generated';
  streetStatus.classList.toggle('invalid',Boolean(streetResult&&!streetResult.streets.connected));
  element<HTMLButtonElement>('#generate-streets').disabled=!valid;
  element<HTMLOutputElement>('#contract-fingerprint').textContent=fingerprint?`SHA-256 ${fingerprint}`:'';
  if(site){seedInput.value=String(site.seed);const background=site.background;const form=element<HTMLFormElement>('#registration-form');
    for(const control of Array.from(form.elements) as HTMLInputElement[])control.disabled=!background;
    if(background){element<HTMLInputElement>('#image-x').value=String(background.origin[0]);element<HTMLInputElement>('#image-y').value=String(background.origin[1]);
      element<HTMLInputElement>('#image-scale').value=String(background.metersPerPixel);element<HTMLInputElement>('#image-rotation').value=String(background.rotationDegrees);element<HTMLInputElement>('#image-opacity').value=String(background.opacity);}
    element<HTMLOutputElement>('#image-size').textContent=background?`${background.label} · ${background.pixelWidth} × ${background.pixelHeight} px`:'No background';}
}

async function refresh(fit=false){
  const ticket=++revision;approval=null;fingerprint='';assetError='';pending=true;streetResult=null;
  const parsed=siteSchema.safeParse(draft);site=parsed.success?parsed.data:null;validation=validateSite(draft);
  jsonInput.value=JSON.stringify(draft,null,2);if(fit)fitSite();
  refreshPanels();redraw();
  const key=site?.background?JSON.stringify([site.background.imageDataUrl??site.background.fixture??'',site.background.pixelWidth,site.background.pixelHeight]):'';
  if(key!==assetKey){image=null;assetKey='';try{const loaded=site?.background?await referenceImage(site.background):null;
      if(ticket!==revision)return;image=loaded;assetKey=key;}catch{if(ticket!==revision)return;assetError='Background could not be decoded or its pixel dimensions do not match.';}}
  if(ticket!==revision)return;
  if(assetError){validation.valid=false;validation.issues.push({severity:'error',code:'BACKGROUND_IMAGE',entityId:'background',message:assetError});}
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(draft)));
  if(ticket!==revision)return;fingerprint=Array.from(new Uint8Array(bytes)).map(value=>value.toString(16).padStart(2,'0')).join('');
  if(validation.valid){try{const saved=localStorage.getItem(approvalKey());if(saved){const parsed:Approval=JSON.parse(saved);
      if(parsed.fingerprint===fingerprint&&parsed.buildId===buildId&&parsed.engineVersion===ENGINE_VERSION)approval=parsed;}}catch{message('Local review storage is unavailable.');}}
  pending=false;refreshPanels();redraw();
}

for(const [key,value] of Object.entries(layers)){const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=value;input.setAttribute('aria-label',`Show ${key}`);
  input.onchange=()=>{layers[key as keyof typeof layers]=input.checked;redraw();};const swatch=document.createElement('i');swatch.className='swatch';swatch.style.background=colors[key as keyof typeof colors];label.append(input,swatch,document.createTextNode(key[0].toUpperCase()+key.slice(1)));element('#layers').append(label);}
for(const fixture of fixtures)fixtureInput.add(new Option(fixture.label,fixture.id));
async function selectFixture(id:string){const fixture=fixtures.find(entry=>entry.id===id)??fixtures[0];draft=fixture.create();selected='land';message('');await refresh(true);
  const url=new URL(location.href);url.searchParams.set('fixture',fixture.id);url.searchParams.set('seed',String(site?.seed??1091337103));history.replaceState(null,'',url);}
fixtureInput.onchange=()=>{void selectFixture(fixtureInput.value);};
seedInput.onchange=()=>{if(!site||!seedInput.reportValidity())return;draft={...site,seed:seedInput.valueAsNumber};void refresh();};
element<HTMLButtonElement>('#apply-json').onclick=()=>{try{draft=JSON.parse(jsonInput.value);message('');}catch{draft=null;message('Invalid JSON.');}void refresh(true);};
element<HTMLFormElement>('#registration-form').onsubmit=event=>{event.preventDefault();if(!site?.background||!element<HTMLFormElement>('#registration-form').reportValidity())return;
  draft={...site,background:{...site.background,origin:[element<HTMLInputElement>('#image-x').valueAsNumber,element<HTMLInputElement>('#image-y').valueAsNumber],
    metersPerPixel:element<HTMLInputElement>('#image-scale').valueAsNumber,rotationDegrees:element<HTMLInputElement>('#image-rotation').valueAsNumber,opacity:Number(element<HTMLInputElement>('#image-opacity').value)}};void refresh();};
element<HTMLButtonElement>('#remove-background').onclick=()=>{if(site){draft={...site,background:null};void refresh();}};
element<HTMLButtonElement>('#upload-background').onclick=()=>element<HTMLInputElement>('#background-file').click();
element<HTMLInputElement>('#background-file').onchange=async event=>{const file=(event.target as HTMLInputElement).files?.[0];if(!file||!site)return;
  if(file.size>8_000_000||!['image/png','image/jpeg','image/webp'].includes(file.type)){message('Choose a PNG, JPEG, or WebP image under 8 MB.');return;}
  const ticket=revision;const reader=new FileReader();reader.onload=async()=>{try{const source=String(reader.result);const loaded=new Image();loaded.src=source;await loaded.decode();if(ticket!==revision||!site)return;
    draft={...site,background:{label:file.name,pixelWidth:loaded.naturalWidth,pixelHeight:loaded.naturalHeight,origin:[0,0],metersPerPixel:1,rotationDegrees:0,opacity:.65,imageDataUrl:source}};message('');await refresh();}catch{message('Image could not be decoded.');}};reader.readAsDataURL(file);};
element<HTMLButtonElement>('#import-contract').onclick=()=>element<HTMLInputElement>('#contract-file').click();
element<HTMLInputElement>('#contract-file').onchange=async event=>{const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>14_000_000){message('Contract file is too large.');return;}
  try{const imported=JSON.parse(await file.text());draft=imported.contract??imported;message('');await refresh(true);}catch{message('Contract JSON could not be read.');}};
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
element<HTMLButtonElement>('#generate-streets').onclick=()=>{if(!site||!validation.valid||pending)return;
  try{streetResult=generateStreetNetwork(site);message(streetResult.streets.connected?'':'Some buildable regions cannot be connected without crossing a constraint.');}
  catch(error){streetResult=null;message(error instanceof Error?error.message:'Street generation failed.');}
  refreshPanels();redraw();};
element<HTMLButtonElement>('#export-contract').onclick=()=>download(new Blob([JSON.stringify({artifact:'site-contract-review',schemaVersion:CONTRACT_VERSION,
  engineId:ENGINE_ID,engineVersion:ENGINE_VERSION,buildId,fingerprint,contract:draft,validation,result:currentResult(),review:approval},null,2)],{type:'application/json'}),`site-${site?.id??'invalid'}-${site?.seed??'draft'}-${buildId}.json`);
element<HTMLButtonElement>('#export-diagnostic').onclick=()=>{const bitmap=document.createElement('canvas');bitmap.width=2048;bitmap.height=1536;paint(bitmap.getContext('2d')!,2048,1536,1,true);
  bitmap.toBlob(blob=>{if(blob)download(blob,`site-${site?.id??'invalid'}-${site?.seed??'draft'}-${validation.valid?'valid':'invalid'}-${buildId}.png`);},'image/png');};
element<HTMLButtonElement>('#approve-contract').onclick=()=>{if(!site||!validation.valid||pending||!fingerprint)return;
  approval={status:'approved',fingerprint,engineVersion:ENGINE_VERSION,buildId,reviewedAt:new Date().toISOString()};
  try{localStorage.setItem(approvalKey(),JSON.stringify(approval));message('');}catch{message('Approved for this session; local storage is unavailable.');}refreshPanels();};
element<HTMLButtonElement>('#revoke-review').onclick=()=>{try{localStorage.removeItem(approvalKey());}catch{}approval=null;refreshPanels();};
element<HTMLButtonElement>('#zoom-in').onclick=()=>zoom(1.3);element<HTMLButtonElement>('#zoom-out').onclick=()=>zoom(1/1.3);element<HTMLButtonElement>('#fit-site').onclick=fitSite;
canvas.onwheel=event=>{event.preventDefault();const bounds=canvas.getBoundingClientRect();zoom(event.deltaY<0?1.15:1/1.15,event.clientX-bounds.left,event.clientY-bounds.top);};
canvas.onpointerdown=event=>{pointer={x:event.clientX,y:event.clientY,left:frame.left,top:frame.top,moved:false};canvas.setPointerCapture(event.pointerId);};
canvas.onpointermove=event=>{const bounds=canvas.getBoundingClientRect();if(pointer){const scale=transform().scale;const deltaX=event.clientX-pointer.x,deltaY=event.clientY-pointer.y;
  pointer.moved ||= Math.hypot(deltaX,deltaY)>3;frame.left=pointer.left-deltaX/scale;frame.top=pointer.top-deltaY/scale;redraw();}
  const point=worldAt(event.clientX-bounds.left,event.clientY-bounds.top);const pixel=site?.background?worldToImage(point,site.background):null;
  element<HTMLOutputElement>('#coordinate-readout').textContent=`X ${point[0].toFixed(1)} m | Y ${point[1].toFixed(1)} m${pixel?` | Image ${pixel[0].toFixed(1)}, ${pixel[1].toFixed(1)} px`:''}`;};
canvas.onpointerup=()=>{pointer=null;};canvas.onpointercancel=()=>{pointer=null;};
new ResizeObserver(redraw).observe(canvas.parentElement!);
element<HTMLOutputElement>('#engine-version').textContent=`${ENGINE_VERSION} / contract ${CONTRACT_VERSION}`;
element<HTMLOutputElement>('#inspector-build').textContent=buildId;
element<HTMLAnchorElement>('#generator-link').href=root.href;
const requested=new URLSearchParams(location.search);const initial=fixtures.find(entry=>entry.id===requested.get('fixture'))??fixtures[0];fixtureInput.value=initial.id;
draft=initial.create();const seed=Number(requested.get('seed'));if(Number.isInteger(seed)&&seed>0&&seed<=2147483646)(draft as SiteContract).seed=seed;
void refresh(true);