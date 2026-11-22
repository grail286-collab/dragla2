/* «Логово дракона 3D» — объёмное поле поверх той же игры.
   Правила, окна, панели и сеть — из основной игры; этот модуль только рисует поле в 3D
   и переводит касания по полю в те же действия, что и клик по 2D-клетке. */
(function(){
if(typeof THREE==='undefined'){console.warn('3D: three.js не загрузился — остаётся 2D');return;}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.body.classList.add('three');
const st=document.createElement('style');
st.textContent=`body.three #stage{visibility:hidden} body.three #box{overflow:hidden!important} body.three #hedge{display:none}
#gl3d{position:fixed;z-index:3;display:block;touch-action:none;cursor:grab}
#gl3d:active{cursor:grabbing}`;
document.head.appendChild(st);
const cv=document.createElement('canvas');cv.id='gl3d';cv.setAttribute('aria-label','Объёмное поле подземелья');document.body.appendChild(cv);

// --- рендерер и сцена
const R=new THREE.WebGLRenderer({canvas:cv,antialias:true,powerPreference:'high-performance'});
let DPR=Math.min(devicePixelRatio,1.5);R.setPixelRatio(DPR);R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;
R.shadowMap.autoUpdate=false;let shadowDirty=true,lastShadow=0;   // тени пересчитываем только когда что-то сдвинулось
R.outputEncoding=THREE.sRGBEncoding;R.toneMapping=THREE.ACESFilmicToneMapping;R.toneMappingExposure=1.3;
const SC=new THREE.Scene();SC.background=new THREE.Color(0x05080f);SC.fog=new THREE.FogExp2(0x05080f,0.022);
const cam=new THREE.PerspectiveCamera(45,1,0.1,200);
const hemi=new THREE.HemisphereLight(0x8a92a8,0x1a120c,.42);SC.add(hemi);
const moon=new THREE.DirectionalLight(0x9aa6c4,.3);moon.position.set(-8,14,6);moon.castShadow=false;SC.add(moon);SC.add(moon.target);

// --- текстуры из игры
const TL=new THREE.TextureLoader();
const tex=(u,srgb=true)=>{const t=TL.load(u);if(srgb)t.encoding=THREE.sRGBEncoding;t.anisotropy=4;return t;};
const texRock=tex('img/rock-black.jpg');texRock.wrapS=texRock.wrapT=THREE.RepeatWrapping;
/* Атлас пола: положить файл в img/floor_atlas.png
   Сетка FLOOR_ATLAS_COLS×FLOOR_ATLAS_ROWS (сейчас 4×3 = 12 плиток), порядок row-major (слева направо, сверху вниз).
   Плитки одинакового размера; тонкие тёмные швы между ними срезаются через FLOOR_ATLAS_INSET. Если файла нет — берётся прежний img/floor-tiles.jpg (6 плит). */
const FLOOR_ATLAS_URL='img/floor_atlas.png';
const FLOOR_ATLAS_COLS=4,FLOOR_ATLAS_ROWS=3;
const FLOOR_ATLAS_INSET=0.035;  // доля стороны плитки, срезаемая с каждого края — убирает тёмные швы атласа и артефакты мипмапов
const FLOOR_LEGACY_URL='img/floor-tiles.jpg',FLOOR_LEGACY_COUNT=6,FLOOR_LEGACY_COLS=3;
const FLOOR_TILE_MAX=FLOOR_ATLAS_COLS*FLOOR_ATLAS_ROWS;
// Веса плиток в порядке row-major (0 — верхний левый, 11 — нижний правый; ряд = 4 плитки).
// Чем больше вес, тем чаще плитка. Чтобы «особые» (эмблема, череп, решётка) встречались реже,
// уменьшите их вес. Все 1 — равновероятно.
const FLOOR_TILE_WEIGHTS=[3,1,1,3, 3,1,1,3, 1,3,3,1]; // 3 — обычный камень, 1 — «особые»: рамка, дракон, ромб, решётка, череп, круг
let floorTileCount=FLOOR_LEGACY_COUNT;
const plateTex=[];
for(let i=0;i<FLOOR_TILE_MAX;i++){const t=new THREE.Texture();t.encoding=THREE.sRGBEncoding;t.anisotropy=4;plateTex.push(t);}
function pickFloorPlate(r,c){
  const n=floorTileCount,w=FLOOR_TILE_WEIGHTS;
  let sum=0;for(let i=0;i<n;i++)sum+=w[i]>0?w[i]:0;
  if(!(sum>0))return Math.floor(hsh(r,c,11)*n)%n;
  let t=hsh(r,c,11)*sum;
  for(let i=0;i<n;i++){const wi=w[i]>0?w[i]:0;if((t-=wi)<0)return i;}
  return n-1;
}
function sliceFloorTile(img,i,cols,rows,insetFrac,outSize){
  const tw=img.naturalWidth/cols,th=img.naturalHeight/rows,padX=insetFrac*tw,padY=insetFrac*th;
  const c=document.createElement('canvas');c.width=c.height=outSize;const g=c.getContext('2d');
  g.drawImage(img,(i%cols)*tw+padX,Math.floor(i/cols)*th+padY,Math.max(1,tw-2*padX),Math.max(1,th-2*padY),0,0,outSize,outSize);
  return c;
}
function stampFloor(r,c,i,x,z,isDead,burn){
  const plate=pickFloorPlate(r,c),rot=Math.floor(hsh(r,c,12)*4)%4;
  B.floors.forEach((f,j)=>{if(j!==plate)poolDel(f,i);});
  if(S.rules==='descent'){const lift=hsh(r,c,31)*.045;dm.position.set(x,TILE_Y+.001+lift,z);dm.rotation.set((hsh(r,c,32)-.5)*.05,rot*Math.PI/2,(hsh(r,c,33)-.5)*.05);}
  else{dm.position.set(x,TILE_Y+.001,z);dm.rotation.set(0,rot*Math.PI/2,0);}
  dm.scale.set(1,1,1);dm.updateMatrix();
  poolSet(B.floors[plate],i,dm.matrix,plateColor(r,c,isDead,burn));
}
function restampFloors(){
  if(!B||!S)return;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const i=r*N+c,k=cell(r,c);
    if(!k||!k.rev||k.block||inRoom(r,c)||inChasm(r,c))continue;
    const [x,z]=cellXZ(r,c);
    stampFloor(r,c,i,x,z,!!dead(r,c),!!burning(r,c));
  }
}
function applyFloorAtlas(img,mode){
  if(mode==='atlas'){
    floorTileCount=FLOOR_ATLAS_COLS*FLOOR_ATLAS_ROWS;
    for(let i=0;i<FLOOR_TILE_MAX;i++){
      plateTex[i].image=sliceFloorTile(img,i,FLOOR_ATLAS_COLS,FLOOR_ATLAS_ROWS,FLOOR_ATLAS_INSET,256);   // плитка атласа ~170px: 512 только раздувал память в 4 раза
      plateTex[i].needsUpdate=true;
    }
  }else{
    // прежний атлас 3×2 (6 плит), без врезки и с тёплой тонировкой — поле выглядит как раньше
    floorTileCount=FLOOR_LEGACY_COUNT;
    const ts=img.naturalWidth/FLOOR_LEGACY_COLS;
    for(let i=0;i<FLOOR_LEGACY_COUNT;i++){
      const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
      g.drawImage(img,(i%FLOOR_LEGACY_COLS)*ts,Math.floor(i/FLOOR_LEGACY_COLS)*ts,ts,ts,0,0,256,256);
      g.fillStyle='rgba(125,82,42,.26)';g.fillRect(0,0,256,256);
      plateTex[i].image=c;plateTex[i].needsUpdate=true;
    }
  }
  restampFloors();
}
function loadLegacyFloor(){
  const img=new Image();
  img.onload=()=>applyFloorAtlas(img,'legacy');
  img.onerror=()=>console.warn('3D: не загрузился ни атлас пола, ни запасной floor-tiles.jpg');
  img.src=FLOOR_LEGACY_URL;
}
const FLOOR_ATLAS=new Image();
FLOOR_ATLAS.onload=()=>{if(FLOOR_ATLAS.naturalWidth)applyFloorAtlas(FLOOR_ATLAS,'atlas');else loadLegacyFloor();};
FLOOR_ATLAS.onerror=loadLegacyFloor;
FLOOR_ATLAS.src=FLOOR_ATLAS_URL;
// hsh — общий с игрой (тот же узор плит, оттенков и факелов, что в 2D)

/* Атлас внутренних стен: положить файл в img/wall_atlas.png
   Сетка WALL_ATLAS_COLS×WALL_ATLAS_ROWS (сейчас 2×2), порядок row-major.
   Каждая плитка — вертикальная грань кладки с рядом-венцом кирпичей сверху.
   Тонкие тёмные швы срезаются через WALL_ATLAS_INSET; сверху чуть меньше (WALL_ATLAS_INSET_TOP), чтобы не срезать венец.
   Если файла нет — стороны стен остаются на прежнем img/rock-black.jpg. */
const WALL_ATLAS_URL='img/wall_atlas.png';
const WALL_ATLAS_COLS=2,WALL_ATLAS_ROWS=2;
const WALL_ATLAS_INSET=0.020;      // ~9px при плитке ~459 — убирает межплиточные швы и тёмную кромку
const WALL_ATLAS_INSET_TOP=0.014;  // меньше сверху, чтобы сохранился ряд-венец
const WALL_TILE_MAX=WALL_ATLAS_COLS*WALL_ATLAS_ROWS;
// Веса 2×2: 0 верх-лево (ровная кладка), 1 верх-право (булыжник/мох), 2 низ-лево, 3 низ-право (кладка).
// Чуть чаще обычную кладку, «особые» (мох, рваный камень) — реже. Все 1 — равновероятно.
const WALL_TILE_WEIGHTS=[2,1, 1,2];
let wallTileCount=1;   // 1, пока атлас не загрузился (запасная текстура скалы)
const wallTex=[];
for(let i=0;i<WALL_TILE_MAX;i++){const t=new THREE.Texture();t.encoding=THREE.sRGBEncoding;t.anisotropy=4;wallTex.push(t);}

/* Атлас внешней скалы и закрытых клеток: положить файл в img/big_wall_atlas.png
   Сетка BIG_WALL_ATLAS_COLS×BIG_WALL_ATLAS_ROWS (сейчас 4×4) грубого тёмного камня.
   Ряды разной высоты — режем по найденным тёмным швам, не равномерно по высоте/4.
   Используется для бортика поля (внешние стены) и закрытых/глухих клеток (InstancedMesh скалы).
   Если файла нет — скала и бортик остаются на прежних текстурах (rock-black.jpg / процедурный камень). */
const BIG_WALL_ATLAS_URL='img/big_wall_atlas.png';
const BIG_WALL_ATLAS_COLS=4,BIG_WALL_ATLAS_ROWS=4;
const BIG_WALL_ATLAS_INSET=0.042;  // ~7–8px при плитке ~189 — срезает швы (~7px) и тёмную кромку атласа
const BIG_WALL_TILE_MAX=BIG_WALL_ATLAS_COLS*BIG_WALL_ATLAS_ROWS;
// Веса 16 плиток row-major. Все 1 — равновероятно; уменьшите вес «особых» (мох), если они слишком частые.
const BIG_WALL_TILE_WEIGHTS=[1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1];
let bigWallTileCount=1;
const bigWallTex=[];
for(let i=0;i<BIG_WALL_TILE_MAX;i++){const t=new THREE.Texture();t.encoding=THREE.sRGBEncoding;t.anisotropy=4;bigWallTex.push(t);}

function pickWeighted(r,c,salt,n,weights){
  let sum=0;for(let i=0;i<n;i++)sum+=(weights[i]>0?weights[i]:0);
  if(!(sum>0))return Math.floor(hsh(r,c,salt)*n)%n;
  let t=hsh(r,c,salt)*sum;
  for(let i=0;i<n;i++){const wi=weights[i]>0?weights[i]:0;if((t-=wi)<0)return i;}
  return n-1;
}
function pickWallTile(r,c,salt){return pickWeighted(r,c,salt,wallTileCount,WALL_TILE_WEIGHTS);}
function pickBigWallTile(r,c,salt){return pickWeighted(r,c,salt,bigWallTileCount,BIG_WALL_TILE_WEIGHTS);}

// Ищем тёмные межплиточные швы около ожидаемых равномерных границ (окно ±16% шага),
// чтобы неровные ряды (у big_wall первый ряд выше) кроились по реальным зазорам.
function atlasGutters(img,cols,rows){
  const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
  const d=g.getImageData(0,0,w,h).data;
  const colLum=new Float64Array(w),rowLum=new Float64Array(h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4,L=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];
    colLum[x]+=L;rowLum[y]+=L;
  }
  for(let x=0;x<w;x++)colLum[x]/=h;for(let y=0;y<h;y++)rowLum[y]/=w;
  const splits=(lum,n,size)=>{
    const xs=[0],step=size/n,win=Math.max(8,Math.round(step*.16));
    for(let k=1;k<n;k++){
      const exp=Math.round(k*step);let best=exp,bv=lum[Math.max(0,Math.min(size-1,exp))];
      for(let p=Math.max(1,exp-win);p<=Math.min(size-2,exp+win);p++)if(lum[p]<bv){bv=lum[p];best=p;}
      if(best<=xs[xs.length-1]+8)best=xs[xs.length-1]+Math.max(8,Math.round(step*.5));
      xs.push(Math.min(size-1,best));
    }
    xs.push(size);return xs;
  };
  const xs=splits(colLum,cols,w),ys=splits(rowLum,rows,h);
  let ok=true;for(let i=1;i<xs.length;i++)if(!(xs[i]>xs[i-1]+16))ok=false;
  for(let i=1;i<ys.length;i++)if(!(ys[i]>ys[i-1]+16))ok=false;
  if(!ok){const ux=[0],uy=[0];for(let i=1;i<cols;i++)ux.push(Math.round(i*w/cols));ux.push(w);
    for(let i=1;i<rows;i++)uy.push(Math.round(i*h/rows));uy.push(h);return {xs:ux,ys:uy};}
  return {xs,ys};
}
function sliceAtlasTile(img,i,xs,ys,inset,outW,outH,insetTop){
  const cols=xs.length-1,c=i%cols,r=Math.floor(i/cols);
  const x0=xs[c],x1=xs[c+1],y0=ys[r],y1=ys[r+1],tw=x1-x0,th=y1-y0;
  const padX=inset*tw,padT=(insetTop!=null?insetTop:inset)*th,padB=inset*th;
  const cvs=document.createElement('canvas');cvs.width=outW;cvs.height=outH;
  cvs.getContext('2d').drawImage(img,x0+padX,y0+padT,Math.max(1,tw-2*padX),Math.max(1,th-padT-padB),0,0,outW,outH);
  return cvs;
}

function restampWalls(){
  if(!B||!S)return;
  B.cache.fill('');
  const now=typeof performance!=='undefined'?performance.now():0;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)syncCell(r,c,now);
}
function restampRocks(){
  if(!B||!S)return;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    if(inRoom(r,c)||inChasm(r,c))continue;
    const i=r*N+c,k=cell(r,c);
    if(!k||!k.rev)rockAt(i,r,c,0);
    else if(k.block)rockAt(i,r,c,0,true);
    else hideRock(i);
  }
}

function applyWallAtlas(img){
  const {xs,ys}=atlasGutters(img,WALL_ATLAS_COLS,WALL_ATLAS_ROWS);
  wallTileCount=WALL_ATLAS_COLS*WALL_ATLAS_ROWS;
  for(let i=0;i<WALL_TILE_MAX;i++){
    wallTex[i].image=sliceAtlasTile(img,i,xs,ys,WALL_ATLAS_INSET,512,512,WALL_ATLAS_INSET_TOP);
    wallTex[i].needsUpdate=true;
    wallSideMats[i].map=wallTex[i];
    wallSideMats[i].color.setHex(0xb3aea8);  // лёгкое приглушение, без «кислотности»
    wallSideMats[i].roughness=.9;
    wallSideMats[i].needsUpdate=true;
  }
  restampWalls();
}
function applyBigWallAtlas(img){
  const {xs,ys}=atlasGutters(img,BIG_WALL_ATLAS_COLS,BIG_WALL_ATLAS_ROWS);
  bigWallTileCount=BIG_WALL_ATLAS_COLS*BIG_WALL_ATLAS_ROWS;
  for(let i=0;i<BIG_WALL_TILE_MAX;i++){
    bigWallTex[i].image=sliceAtlasTile(img,i,xs,ys,BIG_WALL_ATLAS_INSET,256,256);   // плитка ~189px — 256 хватает без потери чёткости
    bigWallTex[i].needsUpdate=true;
    const col=0x8e8a86;
    rockSideMats[i].map=bigWallTex[i];rockSideMats[i].color.setHex(0xa8a49e);rockSideMats[i].roughness=.95;rockSideMats[i].needsUpdate=true;
    rockTopMats[i].map=bigWallTex[i];rockTopMats[i].color.setHex(0x9a9692);rockTopMats[i].roughness=.92;rockTopMats[i].needsUpdate=true;
    rimTileMats[i].map=bigWallTex[i];rimTileMats[i].color.setHex(0x7a7672);rimTileMats[i].roughness=.95;rimTileMats[i].needsUpdate=true;
  }
  // верх внутренних стен — одна плитка грубого камня (тонкая кромка, видна сверху)
  const topI=Math.min(13,BIG_WALL_TILE_MAX-1);
  wallTopMat.map=bigWallTex[topI];wallTopMat.color.setHex(0x7e7a76);wallTopMat.needsUpdate=true;
  restampRocks();
  if(B)stampRim(B.rims,B.rimN,B.rimEdges);
}

// --- материалы
const rockMat=new THREE.MeshStandardMaterial({map:texRock,color:0x6d6660,roughness:.95});
function stoneTex(seed,base,hi){
  const k=256,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d');
  let s=seed;const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
  g.fillStyle=base;g.fillRect(0,0,k,k);
  for(let i=0;i<2600;i++){const v=rnd();g.fillStyle=v<.5?'rgba(0,0,0,'+(.05+rnd()*.12)+')':'rgba(255,255,255,'+(.02+rnd()*.06)+')';g.fillRect(rnd()*k,rnd()*k,1+rnd()*4,1+rnd()*4);}
  g.strokeStyle='rgba(0,0,0,.45)';g.lineWidth=2;
  for(let i=0;i<3;i++){g.beginPath();let x=rnd()*k,y=rnd()*k;g.moveTo(x,y);for(let j=0;j<5;j++){x+=(rnd()-.5)*70;y+=(rnd()-.5)*70;g.lineTo(x,y);}g.stroke();}
  g.strokeStyle=hi;g.lineWidth=6;g.strokeRect(3,3,k-6,k-6);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;t.anisotropy=4;return t;}
const blockSide=new THREE.MeshStandardMaterial({map:texRock,color:0x3a3633,roughness:.95});
const blockTop=new THREE.MeshStandardMaterial({map:stoneTex(4242,'#24242a','rgba(0,0,0,.7)'),color:0x9a9aa0,roughness:.92});
const blockMat=[blockSide,blockSide,blockTop,blockSide,blockSide,blockSide];
const rimMat=new THREE.MeshStandardMaterial({map:stoneTex(99,'#4a464c','rgba(0,0,0,.5)'),roughness:.95});
const rockTopMat=new THREE.MeshStandardMaterial({map:texRock,color:0x3e3a37,roughness:1});
// UV-крючок ставится ниже, после WALL_H/ROCK_H: сторона бокса кроится пропорционально W×H экземпляра, верх текстуры остаётся сверху.
function hookAspectUV(mat,geomH){
  mat.onBeforeCompile=shader=>{
    const H=geomH.toFixed(4);
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',
`#include <uv_vertex>
#ifdef USE_UV
#ifdef USE_INSTANCING
  vec3 iS=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
  vec3 fn=normal;
  float faceW,faceH;
  if(abs(fn.y)>0.5){faceW=iS.x;faceH=iS.z;}
  else{faceW=abs(fn.x)>0.5?iS.z:iS.x;faceH=iS.y*${H};}
  float aS=max(max(faceW,faceH),0.0001);
  vec2 u2=abs(fn.y)>0.5?vec2(uv.x*(faceW/aS),uv.y*(faceH/aS)):vec2(uv.x*(faceW/aS),1.0+(uv.y-1.0)*(faceH/aS));
  vUv=(uvTransform*vec3(u2,1.0)).xy;
#endif
#endif
`);
  };
}
const wallSideMats=[];
for(let i=0;i<WALL_TILE_MAX;i++){
  const m=new THREE.MeshStandardMaterial({map:i===0?texRock:wallTex[i],color:0x6d6660,roughness:.95});
  wallSideMats.push(m);
}
const wallTopMat=new THREE.MeshStandardMaterial({map:texRock,color:0x3e3a37,roughness:1});
const rockSideMats=[],rockTopMats=[],rimTileMats=[];
for(let i=0;i<BIG_WALL_TILE_MAX;i++){
  const sm=new THREE.MeshStandardMaterial({map:i===0?texRock:bigWallTex[i],color:0x3a3633,roughness:.95});
  const tm=new THREE.MeshStandardMaterial({map:i===0?blockTop.map:bigWallTex[i],color:i===0?0x9a9aa0:0x9a9692,roughness:.92});
  const rm=new THREE.MeshStandardMaterial({map:i===0?rimMat.map:bigWallTex[i],color:0xffffff,roughness:.95});
  rockSideMats.push(sm);rockTopMats.push(tm);rimTileMats.push(rm);
}
const floorMats=plateTex.map(t=>new THREE.MeshStandardMaterial({map:t,roughness:.85,emissive:0xffffff,emissiveMap:t,emissiveIntensity:.1}));
const flameMat=new THREE.MeshBasicMaterial({color:0xff4a12,transparent:true,opacity:.9,depthWrite:false,toneMapped:false});
const flameMat2=new THREE.MeshBasicMaterial({color:0xffb22e,transparent:true,opacity:.95,depthWrite:false,toneMapped:false});
const glowMat=(()=>{const k=64,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d');const gr=g.createRadialGradient(k/2,k/2,0,k/2,k/2,k/2);
  gr.addColorStop(0,'rgba(255,170,70,.55)');gr.addColorStop(1,'rgba(255,120,30,0)');g.fillStyle=gr;g.fillRect(0,0,k,k);
  return new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});})();
// цвет плиты: от тёмно-синего через зелёный к песочному, у каждой клетки своя яркость
// как в 2D-версии: тёплый камень, у каждой плитки своя затемнённость и редкий зеленоватый/синеватый налёт
// считаем в sRGB, как наложение слоёв в 2D, и переводим в линейное пространство рендера
const TINT_G=new THREE.Color(0x3c6e32),TINT_B=new THREE.Color(0x32508c);
const plateColor=(r,c,dead,burn)=>{const col=new THREE.Color(1,1,1);
  const dk=hsh(r,c,13);if(dk>.3)col.multiplyScalar(1-(dk-.3)/.7*.42);
  const tn=hsh(r,c,14);if(tn<.14)col.lerp(TINT_G,Math.min(.6,(.1+tn*.9)*1.6));else if(tn>.86)col.lerp(TINT_B,Math.min(.6,(.1+(1-tn)*.9)*1.6));
  if(S&&S.rules==='descent'&&S.depth>1)col.lerp(new THREE.Color(0xc0503a),Math.min(.55,(S.depth-1)*.11));   // глубже — пол краснее
  col.convertSRGBToLinear();if(dead)col.multiplyScalar(.4);if(burn)col.lerp(new THREE.Color(0xff5a20),.45);return col;};

// --- поле: строится заново для каждой партии
let B=null;   // {g, n, rocks[], walls[], rims[], floors[], cache[], torches[], flames, lair...}
const WALL_H=.286,TILE_Y=0,ROCK_H=.3,ROCK_W=.94;   // WALL_H было .22, +30% на внутренних стенах открытых плиток
hookAspectUV(rockMat,WALL_H);hookAspectUV(rockTopMat,WALL_H);hookAspectUV(wallTopMat,WALL_H);
wallSideMats.forEach(m=>hookAspectUV(m,WALL_H));
// у скалы и бортика UV запечены в геометрию (boxWithSideUV) — шейдерный крючок для них не нужен
const WALL_ATLAS=new Image();
WALL_ATLAS.onload=()=>{if(WALL_ATLAS.naturalWidth)applyWallAtlas(WALL_ATLAS);else console.warn('3D: wall_atlas.png пустой — внутренние стены остаются на запасной текстуре');};
WALL_ATLAS.onerror=()=>console.warn('3D: не загрузился img/wall_atlas.png — внутренние стены остаются на img/rock-black.jpg');
WALL_ATLAS.src=WALL_ATLAS_URL;
const BIG_WALL_ATLAS=new Image();
BIG_WALL_ATLAS.onload=()=>{if(BIG_WALL_ATLAS.naturalWidth)applyBigWallAtlas(BIG_WALL_ATLAS);else console.warn('3D: big_wall_atlas.png пустой — скала и бортик остаются на запасных текстурах');};
BIG_WALL_ATLAS.onerror=()=>console.warn('3D: не загрузился img/big_wall_atlas.png — скала и бортик остаются на запасных текстурах');
BIG_WALL_ATLAS.src=BIG_WALL_ATLAS_URL;
// UV боковых граней бокса: венец/верх текстуры остаётся сверху, по вертикали берётся доля, равная отношению высоты к ширине — без растяжения.
function boxWithSideUV(sx,sy,sz,v0,v1){
  const g=new THREE.BoxGeometry(sx,sy,sz),uv=g.attributes.uv,pos=g.attributes.position,n=g.attributes.normal;
  for(let i=0;i<pos.count;i++){
    const ny=n.getY(i);if(Math.abs(ny)>0.5)continue;   // верх/низ — как в BoxGeometry
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    const vv=v0+(y/sy+0.5)*(v1-v0);
    if(Math.abs(n.getX(i))>0.5)uv.setXY(i,z/sz+0.5,vv);else uv.setXY(i,x/sx+0.5,vv);
  }
  uv.needsUpdate=true;g._shared=true;return g;
}
// --- компактные InstancedMesh: в буфере только реально видимые экземпляры (а не все слоты поля с нулевой матрицей).
// Ключ — номер слота (клетка / стена клетки), значение — индекс экземпляра; удаление — перестановкой последнего на место удалённого.
const _pm4=new THREE.Matrix4(),_pc3=new THREE.Color(),_rockCol=new THREE.Color();
function poolInit(m){m.count=0;m.visible=false;m.userData.slot=new Map();m.userData.key=[];m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);if(m.instanceColor)m.instanceColor.setUsage(THREE.DynamicDrawUsage);}
function poolTouch(m){m.visible=m.count>0;m.instanceMatrix.updateRange.offset=0;m.instanceMatrix.updateRange.count=m.count*16;m.instanceMatrix.needsUpdate=true;
  if(m.instanceColor){m.instanceColor.updateRange.offset=0;m.instanceColor.updateRange.count=m.count*3;m.instanceColor.needsUpdate=true;}}
function poolSet(m,key,mat,col){const u=m.userData;let i=u.slot.get(key);if(i===undefined){i=m.count++;u.slot.set(key,i);u.key[i]=key;}
  m.setMatrixAt(i,mat);if(col&&m.instanceColor)m.setColorAt(i,col);poolTouch(m);}
function poolDel(m,key){const u=m.userData,i=u.slot.get(key);if(i===undefined)return;const last=--m.count,lk=u.key[last];
  if(i!==last){m.getMatrixAt(last,_pm4);m.setMatrixAt(i,_pm4);if(m.instanceColor){m.getColorAt(last,_pc3);m.setColorAt(i,_pc3);}u.slot.set(lk,i);u.key[i]=lk;}
  u.slot.delete(key);u.key.length=last;poolTouch(m);}
function hideRock(i){if(!B||!B.rocks)return;B.rocks.forEach(m=>poolDel(m,i));}
// Бокс: 4 боковые грани — одна группа (материал 0), верх — вторая (материал 1), низ не рисуем (его никогда не видно).
// Было 6 групп = 6 вызовов отрисовки на каждую InstancedMesh (и столько же в каждом проходе теней).
function regroupBox(g){const idx=g.index.array,side=[],top=[];
  g.groups.forEach(q=>{const part=Array.from(idx.subarray(q.start,q.start+q.count));if(q.materialIndex===2)top.push(...part);else if(q.materialIndex!==3)side.push(...part);});
  g.setIndex(side.concat(top));g.clearGroups();g.addGroup(0,side.length,0);g.addGroup(side.length,top.length,1);return g;}
// Стены режем на куски WALL_CH×WALL_CH клеток: у каждого куска своя сфера охвата, и three.js отсекает далёкие куски —
// и в кадре, и в 6 проходах тени от факела героя (его свет бьёт всего на ~5 клеток).
let WALL_CH=6;   // ставится в build(): ~4×4 куска на любую карту (21 → по 6, 41 → по 11 клеток), чтобы вызовов отрисовки было немного и в обзоре
function wallMeshes(wi){const i=Math.floor(wi/16),r=Math.floor(i/N),c=i%N,nc=Math.ceil(N/WALL_CH);return B.wallsCh[Math.floor(r/WALL_CH)*nc+Math.floor(c/WALL_CH)];}
function hideWall(wi){if(!B||!B.wallsCh)return;wallMeshes(wi).forEach(m=>poolDel(m,wi));}
function rockAt(i,r,c,sink,tall){const [x,z]=cellXZ(r,c),k=sink||0,h=tall?WALL_H*2.25*(1+hsh(r,c,21)*.12):ROCK_H*(.7+hsh(r,c,21)*.75),wd=tall?1/ROCK_W:1;
  dm.position.set(x,h/2-.04-k*h*1.1,z);dm.rotation.set(0,Math.floor(hsh(r,c,22)*4)*Math.PI/2,0);dm.scale.set((1-k*.15)*wd,h/ROCK_H,(1-k*.15)*wd);dm.updateMatrix();
  const tile=pickBigWallTile(r,c,71);
  const v=.6+hsh(r,c,23)*.45;_rockCol.setRGB(v,v*.97,v*.93);
  B.rocks.forEach((m,j)=>{if(j!==tile)poolDel(m,i);});
  poolSet(B.rocks[tile],i,dm.matrix,_rockCol);}
function stampWall(wi,r,c,salt,px,pz,w,dd,f){
  if(S.rules==='descent')f*=2.25;   // в «Спуске» стены залов выше
  const ms=wallMeshes(wi),ce=ms.center;
  dm.position.set(px-ce.x,TILE_Y+WALL_H*f/2,pz-ce.z);dm.rotation.set(0,0,0);dm.scale.set(w,f,dd);dm.updateMatrix();
  const tile=pickWallTile(r,c,salt);
  ms.forEach((m,j)=>{if(j!==tile)poolDel(m,wi);});
  poolSet(ms[tile],wi,dm.matrix);
}
function stampRim(rims,rimN,rimEdges){
  rims.forEach(m=>{if(!m.userData.slot)poolInit(m);});
  let j=0;
  for(let q=-1;q<N;q++)for(const [r,c] of [[-1,q],[q+1,-1],[N,q+1],[q,N]]){const [x,z]=cellXZ(r,c),h=(.4+hsh(r,c,41)*.5)*1.5,w=.82+hsh(r,c,42)*.26;
    dm.position.set(x+(hsh(r,c,43)-.5)*.14,h/2-.3,z+(hsh(r,c,44)-.5)*.14);dm.rotation.set((hsh(r,c,46)-.5)*.08,(hsh(r,c,45)-.5)*.3,(hsh(r,c,47)-.5)*.08);dm.scale.set(w,h,w);dm.updateMatrix();
    const tile=pickBigWallTile(r,c,81),v=.38+hsh(r,c,48)*.24,col=new THREE.Color(v,v,v*1.04);
    rims.forEach((m,t)=>{if(t!==tile)poolDel(m,j);else poolSet(m,j,dm.matrix,col);});
    j++;}
  rimEdges.forEach(([r,c,dr,dc],e)=>{const [x,z]=cellXZ(r,c),q=e*7+3,h=(.4+hsh(q,r,41)*.5)*1.5,w=.86+hsh(q,c,42)*.3,d=.36+hsh(q,c,49)*.16;
    dm.position.set(x+dc*.32+(hsh(q,r,43)-.5)*.1,h/2-.3,z+dr*.32+(hsh(q,r,44)-.5)*.1);dm.rotation.set((hsh(q,c,46)-.5)*.1,(hsh(q,c,45)-.5)*.3,(hsh(q,c,47)-.5)*.1);
    dm.scale.set(dr?w:d,h,dr?d:w);dm.updateMatrix();
    const tile=pickBigWallTile(q,c,81),v=.38+hsh(q,c,48)*.24,col=new THREE.Color(v,v,v*1.04);
    rims.forEach((m,t)=>{if(t!==tile)poolDel(m,j);else poolSet(m,j,dm.matrix,col);});
    j++;});
}
const dm=new THREE.Object3D();
function cellXZ(r,c){return [c-C,r-C];}
function build(){
  if(B){SC.remove(B.g);B.g.traverse(o=>{if(o.geometry&&!o.geometry._shared)o.geometry.dispose();});
    if(B.rockGeo)B.rockGeo.dispose();if(B.wallGeo)B.wallGeo.dispose();if(B.rimGeo)B.rimGeo.dispose();}
  const g=new THREE.Group();SC.add(g);
  const n=N*N;
  // скала закрытых клеток: по одной InstancedMesh на плитку атласа (общий материал нельзя развести по экземплярам)
  const rockSideV=1-Math.min(0.95,ROCK_H/ROCK_W);   // на боках — верхняя полоса текстуры по аспекту ROCK_H:ROCK_W
  const rockGeo=regroupBox(boxWithSideUV(ROCK_W,ROCK_H,ROCK_W,rockSideV,1));
  const rocks=[];
  for(let t=0;t<BIG_WALL_TILE_MAX;t++){
    const mat=[rockSideMats[t],rockTopMats[t]];
    const rock=new THREE.InstancedMesh(rockGeo,mat,n);
    rock.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3);
    rock.castShadow=rock.receiveShadow=true;g.add(rock);rocks.push(rock);
  }
  const wallGeo=regroupBox(new THREE.BoxGeometry(1,WALL_H,1));wallGeo._shared=true;
  WALL_CH=Math.max(6,Math.ceil(N/4));
  const walls=[],wallsCh=[],wnc=Math.ceil(N/WALL_CH);
  for(let q=0;q<wnc*wnc;q++){
    const r0=Math.floor(q/wnc)*WALL_CH,c0=(q%wnc)*WALL_CH,r1=Math.min(N,r0+WALL_CH)-1,c1=Math.min(N,c0+WALL_CH)-1;
    const [x0,z0]=cellXZ(r0,c0),[x1,z1]=cellXZ(r1,c1),arr=[];arr.center={x:(x0+x1)/2,z:(z0+z1)/2};
    const geo=wallGeo.clone();geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.4,0),Math.hypot(x1-x0+1,z1-z0+1)/2+.6);   // своя сфера охвата куска
    for(let t=0;t<WALL_TILE_MAX;t++){
      const wmesh=new THREE.InstancedMesh(geo,[wallSideMats[t],wallTopMat],(r1-r0+1)*(c1-c0+1)*16);
      wmesh.position.set(arr.center.x,0,arr.center.z);wmesh.castShadow=wmesh.receiveShadow=true;g.add(wmesh);arr.push(wmesh);walls.push(wmesh);
    }
    wallsCh.push(arr);
  }
  // в «Спуске» плиты пола — толстые и чуть разной высоты, со щелями между ними; в остальных режимах — ровная плоскость
  const fgeo=S.rules==='descent'?new THREE.BoxGeometry(.965,.09,.965).translate(0,-.045,0):new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
  const floors=floorMats.map(m=>{const im=new THREE.InstancedMesh(fgeo,m,n);im.receiveShadow=true;im.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3);g.add(im);return im;});
  const zero=new THREE.Matrix4().makeScale(0,0,0);
  floors.forEach(poolInit);walls.forEach(poolInit);rocks.forEach(poolInit);   // пустые: экземпляры добавляются по мере раскрытия
  // бортик подземелья: крупные неровные каменные блоки по внешнему краю (плитки big_wall)
  const rimEdges=[];   // кромка пропасти: стороны клеток пропасти, граничащие с подземельем
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(inChasm(r,c))for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){const r2=r+dr,c2=c+dc;if(inB(r2,c2)&&!inChasm(r2,c2)&&!inRoom(r2,c2))rimEdges.push([r,c,dr,dc]);}
  const rimN=4*(N+1)+rimEdges.length,rimGeo=new THREE.BoxGeometry(1,1,1);rimGeo._shared=true;  // бортик почти кубический, UV 0–1
  const rims=[];
  for(let t=0;t<BIG_WALL_TILE_MAX;t++){
    const rim=new THREE.InstancedMesh(rimGeo,rimTileMats[t],rimN);rim.castShadow=rim.receiveShadow=true;
    rim.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(rimN*3),3);
    g.add(rim);rims.push(rim);
  }
  // временный B.zero, чтобы stampRim мог прятать чужие плитки до присваивания B
  const _prevB=B;B={zero};stampRim(rims,rimN,rimEdges);B=_prevB;
  // основание под всем полем
  const base=new THREE.Mesh(new THREE.BoxGeometry(N+2,.6,N+2),new THREE.MeshStandardMaterial({color:0x0b0a0c,roughness:1}));base.position.y=-.3;base.receiveShadow=true;g.add(base);
  // пропасть вокруг логова: чёрная яма с красным отсветом
  const pit=new THREE.Mesh(new THREE.BoxGeometry(5,.02,5),new THREE.MeshBasicMaterial({color:0x1a0503}));pit.position.y=-.29;g.add(pit);
  const pitWall=new THREE.MeshBasicMaterial({color:0x030204});
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(inChasm(r,c)){const [x,z]=cellXZ(r,c);const m=new THREE.Mesh(new THREE.BoxGeometry(1,.02,1),pitWall);m.position.set(x,.005,z);g.add(m);}
  const pitLight=new THREE.PointLight(0xff3a1a,.9,4.5,2);pitLight.position.set(0,-.1,0);g.add(pitLight);
  // помост логова, золото, дракон
  const lair=buildLair();g.add(lair.g);
  // огонь пробуждения: по два язычка на клетку, видимость по кольцу
  const fgeo1=new THREE.ConeGeometry(.08,.34,6),fgeo2=new THREE.ConeGeometry(.045,.22,6);
  const flames=[new THREE.InstancedMesh(fgeo1,flameMat,n),new THREE.InstancedMesh(fgeo2,flameMat2,n)];
  flames.forEach(f=>{f.frustumCulled=false;f.count=0;f.visible=false;g.add(f);});
  const sh=N/2+1;Object.assign(moon.shadow.camera,{left:-sh,right:sh,top:sh,bottom:-sh,near:1,far:40});moon.shadow.camera.updateProjectionMatrix();
  B={g,n,N,rocks,walls,wallsCh,rims,floors,zero,rim:rims[0],rimN,rimEdges,rockGeo,wallGeo,rimGeo,cache:new Array(n).fill(''),deco:[],arches:new Set(),archG:new Map(),torches:[],flames,fireN:-1,lair,pitLight,anim:[],G:S,cells:S.cells,monYaw:new Map()};
  if(S.rules==='descent'){lair.g.visible=false;}   // в «Спуске» логова нет — в центре просто провал
  {const need=['dragon',...new Set(S.players.map(heroKind))];if(S.awake)need.push('wake');if(S.rules==='hunt'&&(S.hunters||[]).length)need.push(...S.hunters.map(h=>h.k));
   const todo=need.filter(k=>!FIG[k].mesh);
   if(todo.length){let got=0;loader.show(todo.length);
     Promise.race([Promise.all(todo.map(k=>loadFig(k).then(()=>loader.step(++got)))),new Promise(r=>setTimeout(r,12000))]).then(()=>{loader.hide();bgLoad();});}
   else bgLoad();}
  for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(!inRoom(r,c)&&!inChasm(r,c))rockAt(r*N+c,r,c,0);
}
function buildLair(){
  const g=new THREE.Group();
  const plat=new THREE.Mesh(new THREE.BoxGeometry(2.96,.34,2.96),new THREE.MeshStandardMaterial({map:texRock,color:0x6a4a30,roughness:.9}));plat.position.y=.05;plat.receiveShadow=plat.castShadow=true;g.add(plat);
  const goldMat=new THREE.MeshStandardMaterial({color:0xffc54a,metalness:.95,roughness:.28,emissive:0x3a2200,emissiveIntensity:.6});
  const NC=420,coins=new THREE.InstancedMesh(new THREE.CylinderGeometry(.07,.07,.018,10),goldMat,NC);coins.castShadow=true;
  let sd=7;const rr=()=>(sd=(sd*48271)%2147483647)/2147483647;
  for(let i=0;i<NC;i++){const a=rr()*6.283,d=Math.pow(rr(),.7)*1.15,h=Math.max(0,.55-d*.48)*rr()+.23;
    dm.position.set(Math.cos(a)*d,h,Math.sin(a)*d+.15);dm.rotation.set((rr()-.5)*1.4,rr()*3,(rr()-.5)*1.4);dm.scale.set(1,1,1);dm.updateMatrix();coins.setMatrixAt(i,dm.matrix);}
  g.add(coins);
  // дракон из простых форм
  const D=new THREE.Group();
  const scale=new THREE.MeshStandardMaterial({color:0x1d4a26,roughness:.5,metalness:.25,emissive:0x041208,emissiveIntensity:.6,flatShading:true});
  const belly=new THREE.MeshStandardMaterial({color:0xc7a35a,roughness:.7,flatShading:true});
  const body=new THREE.Mesh(new THREE.SphereGeometry(.62,10,8),scale);body.scale.set(1,.62,1.45);body.position.set(0,.55,-.1);D.add(body);
  const tum=new THREE.Mesh(new THREE.SphereGeometry(.5,10,8),belly);tum.scale.set(.85,.45,1.25);tum.position.set(0,.4,-.05);D.add(tum);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.14,.24,.9,8),scale);neck.position.set(.35,.62,.72);neck.rotation.set(1.15,0,-.6);D.add(neck);
  const head=new THREE.Group();head.position.set(.72,.45,1.05);D.add(head);
  head.add(new THREE.Mesh(new THREE.BoxGeometry(.32,.24,.4),scale));
  const snout=new THREE.Mesh(new THREE.BoxGeometry(.22,.15,.32),scale);snout.position.set(0,-.04,.32);head.add(snout);
  for(const s of [-1,1]){const horn=new THREE.Mesh(new THREE.ConeGeometry(.05,.32,6),belly);horn.position.set(s*.11,.17,-.16);horn.rotation.x=-1;head.add(horn);}
  const eyeMat=new THREE.MeshStandardMaterial({color:0x1a0800,emissive:0xff2a00,emissiveIntensity:0});
  const eyes=[-1,1].map(s=>{const e=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),eyeMat);e.position.set(s*.13,.06,.12);e.scale.y=.25;head.add(e);return e;});
  head.rotation.y=-.5;
  for(let i=0;i<9;i++){const t=i/8,b=new THREE.Mesh(new THREE.SphereGeometry(.22*(1-t*.8),8,6),scale);b.position.set(-.3-Math.sin(t*2.6)*.9,.32-t*.12,-.8+Math.cos(t*2.6)*.2-t*.5);D.add(b);}
  const ws=new THREE.Shape();ws.moveTo(0,0);ws.lineTo(1.1,.35);ws.lineTo(.9,-.05);ws.lineTo(1,-.4);ws.lineTo(.55,-.25);ws.lineTo(.2,-.5);ws.lineTo(0,0);
  const wingMat=new THREE.MeshStandardMaterial({color:0x163a20,roughness:.6,side:THREE.DoubleSide,flatShading:true});
  const wings=[-1,1].map(s=>{const w=new THREE.Mesh(new THREE.ShapeGeometry(ws),wingMat);w.position.set(s*.3,.85,-.1);w.rotation.set(-Math.PI/2+.25,0,s>0?-.35:Math.PI+.35);D.add(w);return w;});
  D.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  D.position.set(-.25,.2,-.25);D.rotation.y=.35;g.add(D);
  const light=new THREE.PointLight(0xffb347,2.4,7,2);light.position.set(0,1.5,.2);g.add(light);
  const L={g,body,head,eyes,eyeMat,wings,light,D,coins,model:null};
  // 3D-модель спящего дракона на груде золота заменяет простую фигуру
  const put=()=>{const f=FIG.dragon,m=f.mesh.clone(),k=2.75;m.scale.setScalar(k);
    const w=new THREE.Group();w.add(m);w.position.set(0,.22+.195*k,0);w.rotation.y=-.6;g.add(w);L.model=w;D.visible=false;coins.visible=false;};
  if(FIG.dragon.mesh)put();else FIG.dragon.wait.push(put);
  // проснувшийся: стоит на золоте, раскрыв крылья, поворачивается к ходящему герою и дышит огнём
  const putW=()=>{const m=FIG.wake.mesh.clone(),k=2.75;m.scale.setScalar(k);
    const w=new THREE.Group();w.add(m);w.position.set(0,.22+.41*k,0);w.visible=false;g.add(w);
    const mouth=new THREE.Object3D();mouth.position.set(0,.17,.24);m.add(mouth);L.wake=w;L.mouth=mouth;L.yaw=0;};
  if(FIG.wake.mesh)putW();else FIG.wake.wait.push(putW);
  if(S.awake)loadFig('wake');
  return L;
}

// --- раскрытие клеток: скала уходит вниз, под ней — коридор с плитой пола и стенами
const SLOTS=[[-1,-1,'c'],[1,-1,'c'],[-1,1,'c'],[1,1,'c'],[0,-1,'U'],[0,1,'D'],[-1,0,'L'],[1,0,'R']];
function exitsOf(r,c,k){   // как liveArrows в игре: тупиковые обрубки не показываем
  return liveArrows(r,c,k);
}
function syncCell(r,c,now){
  const i=r*N+c,k=cell(r,c);
  if(inRoom(r,c)||inChasm(r,c))return;
  const burn=burning(r,c),isDead=k.rev&&dead(r,c);
  const sig=k.block?'B':k.rev?('o'+exitsOf(r,c,k).join('')+(isDead?'d':'')+(burn?'b':'')):'';
  if(sig===B.cache[i])return;
  const was=B.cache[i];B.cache[i]=sig;shadowDirty=true;
  const [x,z]=cellXZ(r,c);
  if(!k.rev){rockAt(i,r,c,0);return;}
  if(k.block){rockAt(i,r,c,0,true);return;}   // в зале — глухая плита из камня
  // плита пола
  stampFloor(r,c,i,x,z,isDead,burn);
  // стены: углы всегда, стороны — где нет выхода
  const ex=new Set(exitsOf(r,c,k)),a=.17,o=.5-a/2,mid=1-a*2;
  // верх стены неровный: угловые столбы выше, стороны собраны из 3 блоков разной высоты и толщины
  SLOTS.forEach(([sx,sz,d],j)=>{
    if(d==='c'){if(S.rules==='descent'&&ex.has(sz<0?'U':'D')&&ex.has(sx<0?'L':'R')){hideWall(i*16+j);return;}   // в зале 3×3 внутри нет колонн
      stampWall(i*16+j,r,c,210+j,x+sx*o,z+sz*o,a*(1+hsh(r,c,110+j)*.12),a*(1+hsh(r,c,114+j)*.12),1.15+hsh(r,c,118+j)*.45);return;}
    const base=i*16+4+(j-4)*3;
    if(ex.has(d)){for(let q=0;q<3;q++)hideWall(base+q);return;}
    const ps=[0,1,2].map(q=>.6+hsh(r,c,130+j*3+q)),sum=ps[0]+ps[1]+ps[2],along=d==='U'||d==='D';let t=-mid/2;
    ps.forEach((pp,q)=>{const L=mid*pp/sum,cen=t+L/2;t+=L;const f=.8+hsh(r,c,150+j*3+q)*.6,th=a*(.88+hsh(r,c,170+j*3+q)*.3);
      if(along)stampWall(base+q,r,c,230+j*3+q,x+cen,z+sz*o,L*.97,th,f);else stampWall(base+q,r,c,230+j*3+q,x+sx*o,z+cen,th,L*.97,f);});});
  // скала «уходит» анимацией, если клетка открылась только что
  if(!was&&!reduce)B.anim.push({i,r,c,t0:now});else hideRock(i);
  // факел на глухой стене — как в игре (примерно каждая восьмая клетка)
  archesFor(r,c,ex);archVis(r,c);
  if(!was&&isTorch(r,c,k)){const sides=['U','D','L','R'].filter(d=>!ex.has(d));
    if(sides.length)addWallTorch(r,c,sides[Math.floor(hsh(r,c,98)*sides.length)]);}
}
const DV={U:[0,-1],D:[0,1],L:[-1,0],R:[1,0]};
// неподвижные группы: матрицы считаем один раз, а не каждый кадр
function freeze(g){g.updateMatrixWorld(true);g.traverse(o=>{o.matrixAutoUpdate=false;});}
// --- арки над проходами: целые и полуразрушенные, местами (узор постоянный для клетки)
const archMat=new THREE.MeshStandardMaterial({map:stoneTex(555,'#9a8f82','rgba(40,30,20,.35)'),roughness:.88});
const archGeo=(()=>{const ex={depth:.16,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:1,curveSegments:14};
  const R0=.29,cy=.5;
  const whole=new THREE.Shape();whole.moveTo(-.47,0);whole.lineTo(-.47,.84);whole.lineTo(.47,.84);whole.lineTo(.47,0);whole.lineTo(R0,0);whole.lineTo(R0,cy);
  whole.absarc(0,cy,R0,0,Math.PI,false);whole.lineTo(-R0,0);whole.closePath();
  // обломок: левая опора и кусок свода с рваным краем
  const ru=new THREE.Shape();ru.moveTo(-.47,0);ru.lineTo(-.47,.7);ru.lineTo(-.43,.78);ru.lineTo(-.3,.85);ru.lineTo(-.17,.86);ru.lineTo(-.09,.9);ru.lineTo(-.04,.83);ru.lineTo(-.1,.79);
  for(let a=108;a<=180;a+=8){const t=a*Math.PI/180;ru.lineTo(Math.cos(t)*R0,cy+Math.sin(t)*R0);}
  ru.lineTo(-R0,0);ru.closePath();
  const f=sh=>{const g=new THREE.ExtrudeGeometry(sh,ex);g.translate(0,0,-.08);g._shared=true;return g;};
  return {whole:f(whole),ruin:f(ru)};})();
const stumpGeo=new THREE.BoxGeometry(.18,.24,.15);stumpGeo.translate(0,.12,0);stumpGeo._shared=true;
const rubbleGeo=new THREE.DodecahedronGeometry(.06);rubbleGeo._shared=true;
// можно ли пройти между соседними клетками по выходам плиток (как options() в игре)
function edgeOpen(r1,c1,r2,c2){const a=cell(r1,c1),b=cell(r2,c2),d=r2>r1?'D':r2<r1?'U':c2>c1?'R':'L',o=OPP[d];
  if(a.rev&&b.rev)return a.arrows.includes(d)&&b.arrows.includes(o);
  if(a.rev)return a.arrows.includes(d);if(b.rev)return b.arrows.includes(o);return false;}
// арка видна, только пока проход открыт: если сосед открылся без встречного выхода — на месте прохода стена, арку прячем
function archVis(r,c){[[r,c,'D'],[r,c,'R'],[r-1,c,'D'],[r,c-1,'R']].forEach(([a,b,d])=>{const A=B.archG.get(a+','+b+d);if(!A)return;
  const v=edgeOpen(a,b,d==='D'?a+1:a,d==='R'?b+1:b);if(A.visible!==v){A.visible=v;shadowDirty=true;}});}
function addArch(r,c,d){   // d — 'D' или 'R': арка на границе с соседом снизу/справа
  const key=r+','+c+d;if(B.arches.has(key))return;
  const desc=S.rules==='descent';
  const v=desc?0:hsh(r,c,d==='D'?90:91);if(v>=.13)return;B.arches.add(key);   // в «Спуске» — целая арка над каждым выходом из залаlet G=null;
  const [x,z]=cellXZ(r,c),g=new THREE.Group();
  // модели арок: целая, полуразрушенная, низкая развалина; в «Спуске» над проходами чаще целые
  const pick=desc?hsh(r,c,95):(v<.06?0:.6+hsh(r,c,95)*.4),am=FIG[pick<.6?'arch_whole':pick<.85?'arch_half':'arch_low'];
  if(am&&am.mesh){const m=am.mesh.clone(),w=am.key==='arch_low'?.96:.86,k=(desc?1.05:.95)/w;m.scale.setScalar(k);m.position.y=-(am.minY??-.48)*k-.02;
    if(hsh(r,c,96)<.5)m.rotation.y=Math.PI;m.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});g.add(m);
    if(d==='D')g.position.set(x,0,z+.5);else{g.position.set(x+.5,0,z);g.rotation.y=Math.PI/2;}
    freeze(g);B.g.add(g);B.archG.set(key,g);return;}
  const ruin=v>=.06;
  const m=new THREE.Mesh(ruin?archGeo.ruin:archGeo.whole,archMat);m.castShadow=m.receiveShadow=true;
  if(ruin&&hsh(r,c,92)<.5)m.scale.x=-1;   // обломок то слева, то справа
  g.add(m);
  if(ruin){const sx=m.scale.x<0?-1:1;
    const st=new THREE.Mesh(stumpGeo,archMat);st.position.set(sx*.38,0,0);st.rotation.set(0,0,sx*-.12);st.scale.y=.6+hsh(r,c,93)*.7;st.castShadow=true;g.add(st);
    for(let i=0;i<4;i++){const b=new THREE.Mesh(rubbleGeo,archMat);b.position.set(sx*(.05+hsh(r,c,94+i)*.3),.04,(hsh(r,c,98+i)-.5)*.6);b.scale.setScalar(.7+hsh(r,c,102+i)*.9);b.rotation.set(i,i*2,0);b.castShadow=true;g.add(b);}}
  if(d==='D')g.position.set(x,0,z+.5);else{g.position.set(x+.5,0,z);g.rotation.y=Math.PI/2;}
  freeze(g);
  B.g.add(g);B.archG.set(key,g);
}
function archesFor(r,c,ex){   // проход есть у этой клетки, сосед — обычная клетка подземелья
  const gate=(r2,c2)=>S.rules!=='descent'||Math.floor(r/RS)!==Math.floor(r2/RS)||Math.floor(c/RS)!==Math.floor(c2/RS);   // в «Спуске» арки только между залами
  const ok=(r2,c2)=>inB(r2,c2)&&walkable(r2,c2)&&!inRoom(r2,c2)&&!inChasm(r2,c2)&&gate(r2,c2);
  if(ex.has('D')&&ok(r+1,c))addArch(r,c,'D');if(ex.has('R')&&ok(r,c+1))addArch(r,c,'R');
  if(ex.has('U')&&ok(r-1,c))addArch(r-1,c,'D');if(ex.has('L')&&ok(r,c-1))addArch(r,c-1,'R');
}
function addWallTorch(r,c,d){
  const [x,z]=cellXZ(r,c),[dx,dz]=DV[d],o=.5-.17;
  const t=new THREE.Group();
  const stick=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.2,6),new THREE.MeshStandardMaterial({color:0x3a2412,roughness:.9}));stick.rotation.x=-.5;stick.position.set(0,.3,0);t.add(stick);
  const f1=new THREE.Mesh(new THREE.ConeGeometry(.045,.13,7),flameMat);f1.position.set(0,.41,.05);t.add(f1);
  const f2=new THREE.Mesh(new THREE.ConeGeometry(.024,.08,7),flameMat2);f2.position.set(0,.395,.05);t.add(f2);
  const gl=new THREE.Sprite(glowMat);gl.scale.setScalar(.5);gl.position.set(0,.41,.05);t.add(gl);
  t.scale.setScalar(.72);t.position.set(x+dx*o,.05,z+dz*o);t.rotation.y=Math.atan2(-dx,-dz);B.g.add(t);
  B.torches.push({t,f1,ph:hsh(r,c,5)*9,pos:new THREE.Vector3(x+dx*o*.7,.4,z+dz*o*.7)});
}
// --- что лежит на клетке: знак события, мешок павшего героя, кобольд, следы тряски
const glyphTex={};
function glyphSprite(ch,col){const key=ch+col;if(!glyphTex[key]){const k=96,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d');
    g.fillStyle='rgba(10,8,6,.85)';g.beginPath();g.arc(k/2,k/2,k*.42,0,7);g.fill();g.strokeStyle=col;g.lineWidth=k*.06;g.stroke();
    g.fillStyle=col;g.font=`800 ${k*.46}px 'Alegreya Sans',sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(ch,k/2,k/2+2);
    glyphTex[key]=new THREE.CanvasTexture(c);}
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:glyphTex[key],depthWrite:false}));sp.scale.setScalar(.34);return sp;}
const KOB_TEX=tex('img/kobold-map.png'),DEAD_TEX=tex('img/dead_hero_on_map.jpg');
// --- что видно на ещё не посещённой открытой плитке: монстры и вещи (ловушки, торговцы, демон, двери — сюрприз)
// модель: [ключ, высота на поле]; монстры стоят лицом к игроку, вещи парят и медленно вращаются
const EV3={chest:['mon_mimic',.5],potion:['it_potion',.36],haste:['it_haste',.36],amulet:['it_amulet',.34],sword:['it_sword',.5],silver:['it_silver',.5],
  map:['it_map',.36],bomb:['it_bomb',.36],rope:['it_rope',.3],stone:['it_stone',.34],key:['it_key',.4],pick:['it_pick',.5],gold:['it_gold',.4],cache:['it_gold',.46],shield:['it_shield',.42],scroll:['it_scroll',.4],kobold:['kobold',.6]};
const EVIMG={cultist:'',whelp:'',ghost:'img/item-ghost.jpg',mantle:'img/item-mantle.jpg',cultist:'img/mon-cultist.jpg',whelp:'img/mon-whelp.jpg'};
// модели монстров по порядку MONSTERS: крыса, слизень, гоблин, скелет, паук, шаман, призрак, мимик (= сундук), бес, вампир, тролль, зомби, ведьма, минотавр
const MON3={11:['mon_zombie',.72],12:['mon_witch',.72],'cultist':['mon_cultist',.62],'whelp':['mon_whelp',.6],0:['mon_rat',.5],6:['mon_ghost',.72],8:['mon_imp',.62],10:['mon_troll',.85],1:['mon_slime',.55],3:['mon_skeleton',.75],4:['mon_spider',.62],5:['mon_shaman',.62],7:['mon_mimic',.5],9:['mon_vampire',.78],13:['mon_minotaur',.85],
  14:['mon_shaman',.7,0xff8040],15:['mon_ghost',.74,0xa070ff]};   // ЗАГЛУШКИ: Огненный вождь и Пустотное тело — чужие модели с подкраской (3-й элемент — цвет)
// подкрашенная копия фигурки (готовится один раз на цвет и кешируется в FIG)
const tintFig=(f,col)=>f['t'+col]||(f['t'+col]=(()=>{const g=f.mesh.clone(true);g.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.color.setHex(col);o.material.emissive.setHex(col);o.material.emissiveIntensity=.18;}});return g;})());
const ITEM_EV=new Set(Object.keys(EV3).concat(['shield','scroll','ghost','mantle','gold','cache']).filter(k=>k!=='kobold'));
const st0=k=>!!k.stash;
const decoReset=()=>{if(B)B.deco.forEach(d=>{if(d)d.sig='';});};
const ensureFig=key=>FIG[key]||(FIG[key]={url:'models/'+key,mesh:null,wait:[decoReset]});
const evTexC={};
function evIcon(src,ring){const key=src+ring;if(!evTexC[key]){const k=128,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d'),im=new Image();
    const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;evTexC[key]=t;
    im.onload=()=>{g.save();g.beginPath();g.arc(k/2,k/2,k*.44,0,7);g.clip();g.drawImage(im,0,0,k,k);g.restore();g.strokeStyle=ring;g.lineWidth=k*.06;g.beginPath();g.arc(k/2,k/2,k*.44,0,7);g.stroke();t.needsUpdate=true;};im.src=src;}
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:evTexC[key]}));sp.scale.setScalar(.42);return sp;}
const monBaseGeo=new THREE.CylinderGeometry(.27,.31,.08,24);monBaseGeo._shared=true;
const monBaseMat=new THREE.MeshStandardMaterial({color:0x140a12,metalness:.5,roughness:.5});
const monRimGeo=new THREE.TorusGeometry(.275,.014,6,32);monRimGeo._shared=true;
const bossRimMat=new THREE.MeshBasicMaterial({color:0xffc94a,toneMapped:false});
// модели боссов: пока — увеличенные модели обычных монстров; когда будут свои, достаточно поменять ключ (models/<ключ>.json/.jpg)
const BOSS3=[['mon_rat',.95],['mon_skeleton',1.05],['mon_spider',1.05],['mon_imp',1.0],['mon_minotaur',1.15]];
const monRimMat=new THREE.MeshBasicMaterial({color:0xe0523a,toneMapped:false});
const coinGeo=new THREE.CylinderGeometry(.045,.045,.012,10);coinGeo._shared=true;
const coinMat=new THREE.MeshStandardMaterial({color:0xf2c14e,metalness:.75,roughness:.3,emissive:0x3a2600});
const itemGlow=(()=>{const k=64,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d'),gr=g.createRadialGradient(k/2,k/2,0,k/2,k/2,k/2);
  gr.addColorStop(0,'rgba(255,214,120,.55)');gr.addColorStop(1,'rgba(255,214,120,0)');g.fillStyle=gr;g.fillRect(0,0,k,k);
  return new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});})();
const glowDisc=new THREE.PlaneGeometry(.7,.7);glowDisc.rotateX(-Math.PI/2);glowDisc._shared=true;
const stairMat=new THREE.MeshStandardMaterial({map:texRock,color:0x9a9088,roughness:.9});
const stairHole=new THREE.MeshBasicMaterial({color:0x000000});
const stairGlowMat=new THREE.MeshBasicMaterial({color:0x7fc8ff,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
function addStairs(g,guarded){
  const hole=new THREE.Mesh(new THREE.PlaneGeometry(.62,.62),stairHole);hole.rotation.x=-Math.PI/2;hole.position.y=.012;g.add(hole);
  for(let i=0;i<5;i++){const st=new THREE.Mesh(new THREE.BoxGeometry(.6,.05,.12),stairMat);st.position.set(0,.006-i*.05,-.24+i*.12);st.receiveShadow=true;g.add(st);}
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.4,.025,6,4),new THREE.MeshStandardMaterial({color:0x6b6560,roughness:.9}));rim.rotation.set(Math.PI/2,0,Math.PI/4);rim.scale.set(1.08,1.08,1);rim.position.y=.03;g.add(rim);
  if(!guarded){const glow=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,1.4,20,1,true),stairGlowMat);glow.position.y=.6;g.add(glow);}   // пока жив босс — сияния нет
  const lt=new THREE.PointLight(0x8fd0ff,1.2,2.4,2);lt.position.y=.4;g.add(lt);
  const sign=glyphSprite('⇣','#8fd0ff');sign.position.y=guarded?1.75:1.0;sign.scale.setScalar(.4);g.add(sign);
}
// полоска здоровья над монстром: красные деления, потерянные — тёмные
const hpTexC={};
function hpBar(hp,max){const key=hp+'/'+max;if(!hpTexC[key]){const W=128,H=20,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
    g.fillStyle='rgba(8,6,10,.85)';g.fillRect(0,0,W,H);const pad=3,w=(W-pad*2-(max-1)*2)/max;
    for(let i=0;i<max;i++){g.fillStyle=i<hp?(hp/max>.5?'#e0523a':'#ff8a3a'):'#3a2226';g.fillRect(pad+i*(w+2),pad,w,H-pad*2);}
    g.strokeStyle='#e0523a';g.lineWidth=2;g.strokeRect(1,1,W-2,H-2);const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;hpTexC[key]=t;}
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:hpTexC[key],depthTest:false,toneMapped:false}));sp.scale.set(.46,.072,1);sp.renderOrder=5;return sp;}
function addEvent(g,k,r,c){
  const ev=k.ev;let spec=ev==='boss'?BOSS3[k.boss||0]:ev==='monster'?MON3[k.mon]:MON3[ev]||EV3[ev];
  const spinner=ITEM_EV.has(ev)||(ev==='monster'&&k.mon===7);   // сундук и мимик выглядят одинаково — оба вращаются, как вещи
  const item=spinner,mon=!spinner&&(ev==='monster'||ev==='boss'||BAD[ev]),boss=ev==='boss';
  if(item){const d=new THREE.Mesh(glowDisc,itemGlow);d.position.y=.015;g.add(d);}
  let lift=0,host=g;
  if(mon&&spec){host=new THREE.Group();g.add(host);   // монстр с подставкой — отдельной группой: её можно сдвинуть, когда монстр идёт
    const b=new THREE.Mesh(monBaseGeo,monBaseMat),rim=new THREE.Mesh(monRimGeo,boss?bossRimMat:monRimMat);if(boss){b.scale.set(1.45,1,1.45);rim.scale.set(1.45,1.45,1);}b.position.y=.04;rim.rotation.x=Math.PI/2;rim.position.y=.08;b.castShadow=b.receiveShadow=true;host.add(b,rim);lift=.08;
    if(k.from){const [fx,fz]=cellXZ(k.from[0],k.from[1]),[tx,tz]=cellXZ(r,c);host.position.set(fx-tx,0,fz-tz);g.userData.slide={o:host,t0:performance.now()};
      B.monYaw.set(r*N+c,Math.atan2(tx-fx,tz-fz));k.from=null;}}
  if(spec){const f=ensureFig(spec[0]);if(!f.mesh){loadFig(spec[0]);return;}
    const m=(spec[2]?tintFig(f,spec[2]):f.mesh).clone(),h=spec[1];m.scale.setScalar(h);m.position.y=-(f.minY??-.5)*h+lift;
    const w=new THREE.Group();w.add(m);
    if(item){w.position.y=.08;g.userData.spin=w;w.rotation.y=hsh(r,c,63)*6;}
    else{const i=r*N+c;let y=B.monYaw.get(i);
      if(y==null){const q=P&&P();if(q&&q.r!=null){const [hx,hz]=cellXZ(q.r,q.c),[mx,mz]=cellXZ(r,c);y=Math.atan2(hx-mx,hz-mz);}else y=hsh(r,c,64)*Math.PI*2;B.monYaw.set(i,y);}
      w.rotation.y=y;}   // смотрит на героя, открывшего плитку, и больше не крутится
    host.add(w);
    if(mon&&k.hpMax){const bar=hpBar(k.hp,k.hpMax);bar.position.y=lift-(f.minY??-.5)*h*2+.2;host.add(bar);}
    return;}
  if(ev==='gold'||ev==='cache'){const n=ev==='cache'?14:9;for(let q=0;q<n;q++){const cm=new THREE.Mesh(coinGeo,coinMat);const a=hsh(r,c,300+q)*6.28,rr=hsh(r,c,320+q)*.16;
      cm.position.set(Math.cos(a)*rr,.008+q*.006*(rr<.08?1:.2),Math.sin(a)*rr);cm.rotation.set((hsh(r,c,340+q)-.5)*.5,0,(hsh(r,c,360+q)-.5)*.5);cm.castShadow=true;g.add(cm);}return;}
  const src=ev==='monster'?MONSTERS[k.mon]&&MONSTERS[k.mon].img:EVIMG[ev];
  if(src){const sp=evIcon(src,ev==='monster'||BAD[ev]?'#e0523a':'#ecc66a');sp.position.y=.42;g.add(sp);}
}
function decoSig(k){const st=k.stash;return (k.rev?'':'h')+(k.stairs?'S':'')+(S.rules==='trophy'||S.rules==='descent'?'T':'')+(k.ev?(k.visited?'v':'u')+k.ev+(k.mon??'')+(k.hp!=null?'h'+k.hp+'/'+k.hpMax:''):'')+'|'+(st?st.kind+(st.zombie?'z':'')+(st.left!=null?st.left:''):'')+'|'+(k.scar||'');}
// --- мусор на полу: камни, бочки, доски (место и набор постоянны для клетки, как декор в 2D)
const woodMat=new THREE.MeshStandardMaterial({color:0x6b4a2a,roughness:.85});
const woodDark=new THREE.MeshStandardMaterial({color:0x4a3220,roughness:.9});
const ironMat=new THREE.MeshStandardMaterial({color:0x2a2a2e,metalness:.6,roughness:.5});
const pebMat=new THREE.MeshStandardMaterial({color:0x6e6862,roughness:.95,flatShading:true});
const G_PEB=new THREE.DodecahedronGeometry(1,0),G_BAR=new THREE.CylinderGeometry(.085,.085,.2,12),G_BAND=new THREE.TorusGeometry(.087,.009,5,16),G_PLANK=new THREE.BoxGeometry(1,1,1);
[G_PEB,G_BAR,G_BAND,G_PLANK].forEach(g=>g._shared=true);
function addJunk(g,r,c){
  const v=hsh(r,c,70);
  const px=(hsh(r,c,73)<.5?-1:1)*(.12+hsh(r,c,76)*.08),pz=(hsh(r,c,74)<.5?-1:1)*(.12+hsh(r,c,77)*.08);
  const pile=(n,cx,cz,sp,big)=>{for(let q=0;q<n;q++){const m=new THREE.Mesh(G_PEB,pebMat),rr=(big?.035:.018)+hsh(r,c,200+q)*(big?.04:.02);
      m.scale.set(rr,rr*(.6+hsh(r,c,210+q)*.5),rr*(.8+hsh(r,c,220+q)*.4));m.position.set(cx+(hsh(r,c,230+q)-.5)*sp,rr*.5,cz+(hsh(r,c,240+q)-.5)*sp);
      m.rotation.set(q,hsh(r,c,250+q)*6,q*.7);const t=.75+hsh(r,c,260+q)*.4;m.material=pebMat;m.castShadow=big;g.add(m);}};
  if(v<.32){const kind=hsh(r,c,71);
    if(kind<.42)pile(3+Math.floor(hsh(r,c,72)*4),px,pz,.16,true);                       // куски камня
    else if(kind<.72){const n=2+Math.floor(hsh(r,c,78)*2),a0=hsh(r,c,79)*Math.PI;            // доски
      for(let q=0;q<n;q++){const m=new THREE.Mesh(G_PLANK,q%2?woodDark:woodMat);m.scale.set(.26+hsh(r,c,80+q)*.12,.014,.05);
        m.position.set(px+(hsh(r,c,84+q)-.5)*.08,.008+q*.012,pz+(hsh(r,c,88+q)-.5)*.08);m.rotation.set(0,a0+(hsh(r,c,92+q)-.5)*1.2,(hsh(r,c,96+q)-.5)*.12);m.castShadow=true;g.add(m);}}
    else{const b=new THREE.Group(),body=new THREE.Mesh(G_BAR,woodMat);body.castShadow=true;b.add(body);           // бочка: стоит или лежит
      for(const y of [-.065,.065]){const bd=new THREE.Mesh(G_BAND,ironMat);bd.rotation.x=Math.PI/2;bd.position.y=y;b.add(bd);}
      if(hsh(r,c,81)<.35){b.rotation.set(0,hsh(r,c,82)*6,Math.PI/2);b.position.set(px,.085,pz);}else{b.position.set(px,.1,pz);b.rotation.y=hsh(r,c,83)*6;}
      g.add(b);if(hsh(r,c,85)<.4){const b2=b.clone();b2.position.x+=.18*(px<0?1:-1);b2.rotation.y+=1;g.add(b2);}}}
  else if(v<.55)pile(2+Math.floor(hsh(r,c,72)*3),-px,-pz,.2,false);                      // мелкая каменная крошка
}
function syncDeco(r,c){
  const i=r*N+c,k=cell(r,c);if(k.block)return;
  const thief=k.stash&&k.stash.kind==='kobold';
  if(!k.rev&&!thief){if(B.deco[i]){B.g.remove(B.deco[i].g);B.deco[i]=null;shadowDirty=true;}return;}   // вор ушёл с неоткрытой клетки
  const sig=decoSig(k);if((B.deco[i]||{}).sig===sig)return;
  if(B.deco[i])B.g.remove(B.deco[i].g);
  const g=new THREE.Group(),[x,z]=cellXZ(r,c);g.position.set(x,0,z);
  if(!k.rev)g.position.y=blockTopY(r,c);else addJunk(g,r,c);
  if((S.rules==='trophy'||S.rules==='descent')&&k.ev&&!k.visited&&!st0(k))addEvent(g,k,r,c);
  if(k.stairs)addStairs(g,k.ev==='boss');
  if(k.visited&&k.ev){const sp=glyphSprite(GLYPH[k.ev]||'•',BAD[k.ev]?'#ff7a3d':k.ev==='bomb'?'#8fc4ff':'#ecc66a');sp.position.set(-.27,.32,-.27);g.add(sp);}
  const st=k.stash;
  if(st&&!FIG[st.kind==='kobold'?'kobold':'dead'].mesh)loadFig(st.kind==='kobold'?'kobold':'dead');
  if(st&&st.kind==='kobold'){
    if(FIG.kobold.mesh){const k=.62,w=new THREE.Group(),m=FIG.kobold.mesh.clone();m.scale.setScalar(k);m.position.y=.398*k+.005;w.add(m);
      g.add(w);g.userData.kob=w;   // кобольд с мешком; в кадре поворачивается лицом к игроку
      const lt=new THREE.PointLight(0xffd27a,.8,1.8,2);lt.position.set(0,.55,.15);g.add(lt);}   // фонарик вора — его видно в темноте, как в 2D
    else{const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:KOB_TEX}));sp.scale.setScalar(.6);sp.position.y=.45;g.add(sp);}
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.3,.025,8,32),new THREE.MeshBasicMaterial({color:0xecc66a,toneMapped:false}));ring.rotation.x=Math.PI/2;ring.position.y=.04;g.add(ring);
    if(st.left!=null){const n=glyphSprite(String(st.left),'#ff7a3d');n.position.set(.28,.8,0);n.scale.setScalar(.28);g.add(n);}}
  else if(st&&FIG.dead.mesh){   // павший герой: мешок с золотом, череп и догорающий факел
    const k=.6,w=new THREE.Group(),m=FIG.dead.mesh.clone();m.scale.setScalar(k);m.position.y=.375*k+.005;w.add(m);
    const gl=new THREE.Sprite(glowMat);gl.scale.setScalar(.3);gl.position.set(-.44*k,.33*k+.375*k,-.11*k);w.add(gl);
    w.rotation.y=hsh(r,c,61)*Math.PI*2;g.add(w);
  }
  else if(st){const m=new THREE.Mesh(new THREE.BoxGeometry(.5,.04,.5),new THREE.MeshStandardMaterial({map:DEAD_TEX,roughness:.8,emissive:0x221100}));m.position.y=.03;m.castShadow=true;g.add(m);}
  if(st&&st.kind!=='kobold'){
    if(st.zombie){const zz=glyphSprite('☠','#7dff8a');zz.position.set(.22,.6,-.22);g.add(zz);}}
  if(k.scar==='lava'){const l=new THREE.Mesh(new THREE.CircleGeometry(.24,24),new THREE.MeshBasicMaterial({color:0xff7a20,toneMapped:false}));l.rotation.x=-Math.PI/2;l.position.set(.2,.012,.2);g.add(l);}
  else if(k.scar==='hole'){const h=new THREE.Mesh(new THREE.CircleGeometry(.2,24),new THREE.MeshBasicMaterial({color:0x000000}));h.rotation.x=-Math.PI/2;h.scale.y=.6;h.position.set(.2,.012,.22);g.add(h);}
  else if(k.scar){const sm=new THREE.MeshStandardMaterial({color:0x8d97a8,roughness:.9});[[.16,.22,.09],[.32,.16,.07],[.28,.34,.06]].forEach(([a,b,rr])=>{const s2=new THREE.Mesh(new THREE.DodecahedronGeometry(rr),sm);s2.position.set(a,rr,b);s2.castShadow=true;g.add(s2);});}
  if(!g.userData.kob&&!g.userData.face&&!g.userData.spin&&!g.userData.slide)freeze(g);B.g.add(g);B.deco[i]={g,sig};shadowDirty=true;
}
// --- белые стрелки «>» у края открытой плитки: выход ведёт в ещё не открытую клетку (как в 2D)
const arrGeo=(()=>{const w=.14,sh=new THREE.Shape();sh.moveTo(w,0);sh.lineTo(-.6*w,.95*w);sh.lineTo(-.15*w,0);sh.lineTo(-.6*w,-.95*w);sh.closePath();
  const g=new THREE.ShapeGeometry(sh);g.rotateX(-Math.PI/2);g._shared=true;return g;})();
const arrMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.92,toneMapped:false,depthWrite:false});
const arrShMat=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.6,depthWrite:false});
const ADIR={U:[-1,0],D:[1,0],L:[0,-1],R:[0,1]};
let arrSig='',arrT=0;
const glowTopTex=(()=>{const k=128,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d');
  for(let i=0;i<12;i++){g.strokeStyle=`rgba(90,255,140,${(.42*(1-i/12)**2.4).toFixed(3)})`;g.lineWidth=2;g.strokeRect(1+i*2,1+i*2,k-2-i*4,k-2-i*4);}
  g.fillStyle='rgba(90,255,140,.025)';g.fillRect(0,0,k,k);return new THREE.CanvasTexture(c);})();
const glowTopMat=new THREE.MeshBasicMaterial({map:glowTopTex,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
const glowSideMat=new THREE.MeshBasicMaterial({color:0x3dff7a,transparent:true,opacity:.18,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
const glowTopGeo=new THREE.PlaneGeometry(ROCK_W*1.02,ROCK_W*1.02);glowTopGeo.rotateX(-Math.PI/2);glowTopGeo._shared=true;
const glowBoxGeo=new THREE.BoxGeometry(ROCK_W*1.06,1,ROCK_W*1.06);glowBoxGeo._shared=true;
const blockTopY=(r,c)=>ROCK_H*(.7+hsh(r,c,21)*.75)-.04;
function syncArrows(now){
  if(now-arrT<250)return;arrT=now;
  if(!B.arr){const n=N*N*4;B.arr=[new THREE.InstancedMesh(arrGeo,arrShMat,n),new THREE.InstancedMesh(arrGeo,arrMat,n)];B.arr.forEach(m=>{m.frustumCulled=false;m.renderOrder=2;B.g.add(m);});arrSig='';}
  const list=[];
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){const k=cell(r,c);if(!k.rev||!walkable(r,c)||inRoom(r,c))continue;
    liveArrows(r,c,k).forEach(d=>{const [dr,dc]=ADIR[d]||[0,0],nr=r+dr,nc=c+dc;if(!walkable(nr,nc)||cell(nr,nc).rev||inRoom(nr,nc))return;list.push([r,c,dr,dc]);});}
  const sig=list.join(';');if(sig===arrSig)return;arrSig=sig;
  // клетки, куда можно шагнуть с открытых плиток, — светятся зелёным
  if(!B.glow){const n=N*N;B.glow=[new THREE.InstancedMesh(glowTopGeo,glowTopMat,n),new THREE.InstancedMesh(glowBoxGeo,glowSideMat,n)];B.glow.forEach(m=>{m.frustumCulled=false;m.renderOrder=3;B.g.add(m);});}
  const seen=new Set(),tg=[];list.forEach(([r,c,dr,dc])=>{const k2=(r+dr)*N+(c+dc);if(!seen.has(k2)){seen.add(k2);tg.push([r+dr,c+dc]);}});
  B.glow[0].count=B.glow[1].count=tg.length;
  tg.forEach(([r,c],j)=>{const [x,z]=cellXZ(r,c),h=blockTopY(r,c);dm.rotation.set(0,0,0);
    dm.position.set(x,h+.006,z);dm.scale.set(1,1,1);dm.updateMatrix();B.glow[0].setMatrixAt(j,dm.matrix);
    dm.position.set(x,(h-.04)/2,z);dm.scale.set(1,h+.06,1);dm.updateMatrix();B.glow[1].setMatrixAt(j,dm.matrix);});
  B.glow.forEach(m=>m.instanceMatrix.needsUpdate=true);
  const [sm,am]=B.arr;sm.count=am.count=list.length;
  list.forEach(([r,c,dr,dc],j)=>{const [x,z]=cellXZ(r,c),a=Math.atan2(-dr,dc);
    dm.rotation.set(0,a,0);dm.scale.set(1,1,1);
    dm.position.set(x+dc*.38+.012,.02,z+dr*.38+.018);dm.updateMatrix();sm.setMatrixAt(j,dm.matrix);
    dm.position.set(x+dc*.38,.025,z+dr*.38);dm.updateMatrix();am.setMatrixAt(j,dm.matrix);});
  sm.instanceMatrix.needsUpdate=am.instanceMatrix.needsUpdate=true;
}
// пул света для настенных факелов: горят ближайшие к камере
const TL_POOL=[];for(let i=0;i<8;i++){const l=new THREE.PointLight(0xff8a2c,0,2.2,1.6);SC.add(l);TL_POOL.push(l);}

// огонь пробуждения
function syncFire(){
  const f=S.awake?S.fire:-1;if(f===B.fireN)return;B.fireN=f;B.burnCells=[];let fk=0;   // язычков ровно столько, сколько горящих клеток
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){const i=r*N+c;
    if(f>=0&&!inRoom(r,c)&&!inChasm(r,c)&&ring(r,c)<=f){const [x,z]=cellXZ(r,c);
      dm.rotation.set(0,0,0);dm.scale.set(1,1,1);
      dm.position.set(x+(hsh(r,c,31)-.5)*.5,.2,z+(hsh(r,c,32)-.5)*.5);dm.updateMatrix();B.flames[0].setMatrixAt(fk,dm.matrix);
      dm.position.set(x+(hsh(r,c,33)-.5)*.5,.13,z+(hsh(r,c,34)-.5)*.5);dm.updateMatrix();B.flames[1].setMatrixAt(fk++,dm.matrix);
      B.cache[i]=B.cache[i]+'?';B.burnCells.push([r,c]);   // перекрасить плиту в огненный тон
    }}
  B.flames.forEach(m=>{m.count=fk;m.visible=fk>0;});
  B.flames.forEach(m=>m.instanceMatrix.needsUpdate=true);
}

// --- 3D-фигурки героев (glTF). Пока загружаются — стоит обычный портрет
const FIG={male:{url:'models/hero_man',torch:[.378,.31,.052],mesh:null,wait:[]},
           orc:{url:'models/hero_orc',torch:[.33,.42,.17],mesh:null,wait:[]},
           sedoi:{url:'models/hero_sedoi',torch:[.208,.29,.275],mesh:null,wait:[]},
           siniy:{url:'models/hero_siniy',torch:[.289,.42,.193],mesh:null,wait:[]},
           female2:{url:'models/hero_w3',torch:[.306,.42,.153],mesh:null,wait:[]},
           female3:{url:'models/hero_w2',torch:[-.24,.33,.032],mesh:null,wait:[]},
           female:{url:'models/hero_woman',torch:[.161,.32,.275],mesh:null,wait:[]},
           dragon:{url:'models/sleepy_dragon',mesh:null,wait:[]},
           wake:{url:'models/wakeup_dragon',mesh:null,wait:[]},
           arch_whole:{key:'arch_whole',url:'models/arch_whole',mesh:null,wait:[]},arch_half:{key:'arch_half',url:'models/arch_half',mesh:null,wait:[]},arch_low:{key:'arch_low',url:'models/arch_low',mesh:null,wait:[]},
           dead:{url:'models/dead_hero',mesh:null,wait:[()=>{if(B)B.deco.forEach(d=>{if(d)d.sig='';});}]},
           kobold:{url:'models/kobold',mesh:null,wait:[()=>{if(B)B.deco.forEach(d=>{if(d)d.sig='';});}]},
           eye:{url:'models/hunter_eye',mesh:null,wait:[]},hound:{url:'models/hunter_hound',mesh:null,wait:[]},reaper:{url:'models/hunter_reaper',mesh:null,wait:[]}};
// размеры моделей охотников: масштаб, высота центра над подставкой, парит ли
const HFIG={reaper:{k:.9,y:.477},eye:{k:.62,y:.477+.35,fly:1},hound:{k:.95,y:.236}};
const FIG_S=.73;   // масштаб; torch — пламя факела в руке (в координатах модели)   // масштаб и пламя факела в руке (в координатах модели)
// модель — простой JSON с массивами вершин (base64) и отдельная JPG-текстура:
// так она грузится и в артефакте, где запросы к data:/blob: адресам запрещены
const b64=t=>{const s=atob(t),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;};
// модели грузятся по мере надобности: loadFig(ключ) — один раз, дальше берётся готовая
function loadFig(key){const f=FIG[key];if(!f)return Promise.resolve();if(f.p)return f.p;
  f.p=fetch(f.url+'.json').then(r=>{if(!r.ok)throw new Error(r.status);return r.json();}).then(d=>new Promise(res=>{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(b64(d.pos)),3));
  g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(b64(d.nrm)),3));
  g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(b64(d.uv)),2));
  const ib=b64(d.idx);g.setIndex(new THREE.BufferAttribute(d.idxType==='u16'?new Uint16Array(ib):d.idxType==='u8'?new Uint8Array(ib):new Uint32Array(ib),1));
  g.computeBoundingBox();f.minY=g.boundingBox.min.y;
  const done=()=>{const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:t,roughness:.85,metalness:0}));m.castShadow=m.receiveShadow=true;
    f.mesh=new THREE.Group();f.mesh.add(m);f.wait.splice(0).forEach(cb=>cb());res();};
  const t=TL.load(f.url+'.jpg',done,undefined,done);t.encoding=THREE.sRGBEncoding;t.anisotropy=4;t.flipY=false;   // готова, когда пришла и текстура
  })).catch(e=>{console.warn('3D-фигурка не загрузилась',f.url,e);});
  return f.p;}
const heroKind=p=>{const i=p.portrait??0;return i===7?'orc':i===4?'sedoi':i===5?'siniy':i===1?'female2':i===2?'female3':isFemale(i)?'female':'male';};   // 5 — седой, 6 — в синем капюшоне, 8 — орк
// после старта партии — фоном, по одной: павший, проснувшийся дракон, охотники (только в режиме охоты), кобольд
function bgLoad(){const q=['dead','wake',...(S&&S.rules==='hunt'?['hound','eye','reaper']:[]),'kobold'];
  const next=()=>{const k=q.shift();if(!k)return;loadFig(k).then(()=>setTimeout(next,300));};setTimeout(next,1500);}
function attachFigure(T,kind){const f=FIG[kind];if(!f)return;loadFig(kind);
  const go=()=>{const m=f.mesh.clone();m.scale.setScalar(FIG_S);m.position.y=.477*FIG_S+.09;
    const fig=new THREE.Group();fig.add(m);T.g.add(fig);T.fig=fig;
    T.torch.visible=false;                                   // у фигурки свой факел в руке
    const tp=new THREE.Vector3(...f.torch).multiplyScalar(FIG_S);tp.y+=m.position.y;
    const gl=new THREE.Sprite(glowMat);gl.scale.setScalar(.45);gl.position.copy(tp);fig.add(gl);T.fo=gl;T.foBase=.45;
    T.lt.position.copy(tp);T.lt.position.y+=.08;fig.add(T.lt);
    T.stand.scale.setScalar(.5);T.stand.position.y=1.16;   // портрет — маленький, над головой, выше фигурки
    const sh=new THREE.Shape();sh.moveTo(-.13,-.33);sh.lineTo(.13,-.33);sh.lineTo(0,-.55);sh.closePath();   // треугольник вниз — указывает на героя
    const ar=new THREE.Mesh(new THREE.ShapeGeometry(sh),new THREE.MeshBasicMaterial({color:T.colr,toneMapped:false}));ar.position.z=.004;T.stand.add(ar);T.ptr=ar;};
  if(f.mesh)go();else f.wait.push(go);}
// --- многогранник-кубик с цифрами на гранях: d4 (тетраэдр) или d20 (икосаэдр)
const DICE_LOOK={d20:{bg:'#7a1f2b',fg:'#ffe2a0',edge:0xffcf6a,metal:.3},d4:{bg:'#e2b04a',fg:'#2a1d05',edge:0x8c6522,metal:.45}};
function numTex(n,look,big){const k=128,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d');
  g.fillStyle=look.bg;g.fillRect(0,0,k,k);g.fillStyle=look.fg;g.font=`800 ${big?60:n>9?46:54}px 'Alegreya Sans',sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(n,k/2,k*.6);
  if(n===6||n===9){g.fillRect(k*.36,k*.82,k*.28,5);}const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;}
function makePoly(kind){const look=DICE_LOOK[kind],src=kind==='d4'?new THREE.TetrahedronGeometry(1.15,0):new THREE.IcosahedronGeometry(1,0);
  const base=src.toNonIndexed(),pos=base.attributes.position,n=pos.count/3,grp=new THREE.Group(),faces=[];
  for(let f=0;f<n;f++){const a=new THREE.Vector3().fromBufferAttribute(pos,f*3),b=new THREE.Vector3().fromBufferAttribute(pos,f*3+1),c=new THREE.Vector3().fromBufferAttribute(pos,f*3+2);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...a.toArray(),...b.toArray(),...c.toArray()],3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute([.05,.12,.95,.12,.5,.95],2));g.computeVertexNormals();
    grp.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:numTex(f+1,look,kind==='d4'),roughness:.35,metalness:look.metal,flatShading:true})));
    // ориентация, при которой грань с цифрой f+1 смотрит на зрителя и цифра стоит прямо
    const nrm=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
    const up=new THREE.Vector3().subVectors(c,a.clone().add(b).multiplyScalar(.5));up.addScaledVector(nrm,-up.dot(nrm)).normalize();
    const rt=new THREE.Vector3().crossVectors(up,nrm);faces.push(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(rt,up,nrm)).invert());}
  grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(src.clone().scale(1.005,1.005,1.005)),new THREE.LineBasicMaterial({color:look.edge})));
  return {grp,faces};}

// --- 3D-кубики броска: d4 в окне хода и d20 в проверках — вместо плоских картинок
const dice3d=(()=>{let R3=null,sc,cam3,cvs,dice={},cur=null,host=null,st={mode:'idle',t0:0,q0:new THREE.Quaternion(),qT:new THREE.Quaternion(),w:new THREE.Vector3()};
  const css=`body.three .rp-die::before,body.three .rp-die::after{display:none}body.three .rp-die>b,body.three .rp-die>small{visibility:hidden}
    body.three .rp-die.rolling,body.three .rollcard.ready .rp-die,body.three .rollpop.done .rp-die{animation:none}
    body.three .die.d3{background:none!important;color:transparent!important;text-shadow:none!important;position:relative;animation:none!important}
    .dice3d{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:2}`;
  function init(){if(R3)return true;try{const s2=document.createElement('style');s2.textContent=css;document.head.appendChild(s2);
      cvs=document.createElement('canvas');cvs.className='dice3d';
      R3=new THREE.WebGLRenderer({canvas:cvs,alpha:true,antialias:true});R3.setPixelRatio(Math.min(devicePixelRatio,2));R3.outputEncoding=THREE.sRGBEncoding;
      sc=new THREE.Scene();cam3=new THREE.PerspectiveCamera(30,1,.1,20);cam3.position.set(0,.55,4.6);cam3.lookAt(0,0,0);
      sc.add(new THREE.HemisphereLight(0xfff0d0,0x301018,1.05));const dl=new THREE.DirectionalLight(0xffffff,1.2);dl.position.set(2,4,4);sc.add(dl);
      ['d4','d20'].forEach(k=>{const d=makePoly(k);d.grp.visible=false;sc.add(d.grp);dice[k]=d;});return true;}catch(e){R3=null;return false;}}
  const tilt=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12,0,0));
  function roll(kind,val){const d=dice[kind];st.mode='tumble';st.t0=performance.now();st.val=val;
    st.w.set(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize().multiplyScalar(16+Math.random()*6);
    if(val>=1&&val<=d.faces.length)st.qT.copy(tilt).multiply(d.faces[val-1]);}
  function settle(kind,val){const d=dice[kind];if(!(val>=1&&val<=d.faces.length))return;st.qT.copy(tilt).multiply(d.faces[val-1]);st.q0.copy(d.grp.quaternion);st.mode='settle';st.t0=performance.now();}
  // какое поле с кубиком сейчас на экране
  function findHost(){const pop=document.getElementById('rollpop');
    if(pop&&!pop.hidden){const el=document.getElementById('rpDie');if(el&&el.offsetParent)return {el,kind:'d4',size:90,dist:4.5};}
    for(const el of document.querySelectorAll('.die'))if(el.offsetParent&&el.getBoundingClientRect().width>0)return {el,kind:'d20',size:80,dist:4.9};
    return null;}
  let lastD4='?',d4Rolling=false;
  function tick(){requestAnimationFrame(tick);if(!R3)return;
    const h=findHost();
    if(!h){if(host){if(host.el)host.el.classList.remove('d3');cvs.remove();host=null;}return;}
    if(host&&host.el===h.el&&cvs.parentNode!==h.el)h.el.appendChild(cvs);   // игра переписала текст кубика — холст вернуть
    if(!host||host.el!==h.el){if(host&&host.el)host.el.classList.remove('d3');if(h.kind==='d20')h.el.classList.add('d3');h.el.appendChild(cvs);host=h;cur=h.kind;Object.keys(dice).forEach(k=>dice[k].grp.visible=k===cur);
      cvs.style.width=cvs.style.height=h.size+'px';R3.setSize(h.size,h.size,false);cam3.position.set(0,h.dist*.12,h.dist);cam3.lookAt(0,0,0);st.mode='idle';
      if(cur==='d20'){const v=parseInt(h.el.textContent);if(v>=1)settle('d20',v);}else{lastD4='?';d4Rolling=false;}}
    const d=dice[cur].grp,now=performance.now(),t=now/1000;
    // d4: крутится, пока в игре идёт бросок; останавливается на выпавшем числе
    if(cur==='d4'){const rl=h.el.classList.contains('rolling'),v=parseInt(document.getElementById('rpVal').textContent);
      if(rl&&!d4Rolling){roll('d4');}if(!rl&&d4Rolling&&v>=1)settle('d4',v);
      if(!rl&&!(v>=1)&&st.mode!=='idle')st.mode='idle';d4Rolling=rl;}
    if(st.mode==='idle'){d.rotation.set(.5+Math.sin(t*.9)*.15,t*.9,.2);d.position.y=Math.sin(t*2.2)*.05;}
    else if(st.mode==='tumble'){const dt=1/60,ang=st.w.length()*dt;if(ang>0){const q=new THREE.Quaternion().setFromAxisAngle(st.w.clone().normalize(),ang);d.quaternion.premultiply(q);}
      st.w.multiplyScalar(.985);d.position.y=Math.abs(Math.sin((now-st.t0)/90))*.18;
      if(cur==='d20'&&now-st.t0>320)settle('d20',st.val);}
    else if(st.mode==='settle'){const k=Math.min(1,(now-st.t0)/260),e=1-Math.pow(1-k,3);THREE.Quaternion.slerp(st.q0,st.qT,d.quaternion,e);
      d.position.y=(1-e)*.12;d.scale.setScalar(1+Math.sin(k*Math.PI)*.12);if(k>=1)st.mode='still';}
    R3.render(sc,cam3);}
  // d20: игра добавляет класс spin и сразу пишет выпавшее число — ловим это
  new MutationObserver(ms=>{for(const m of ms){const el=m.target;if(el.classList&&el.classList.contains('die')&&el.classList.contains('spin')&&init()){
      const v=parseInt(el.textContent);if(host&&host.el===el&&v>=1)roll('d20',v);else el.__pend=v;}}})
    .observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
  if(init())requestAnimationFrame(tick);
  return {roll};})();
// --- экран загрузки: вращающийся золотой d20 и полоска
const loader=(()=>{let el=null,r2=null,sc2,cam2,die,raf=0,total=1;
  const css=`#ld3d{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    background:radial-gradient(ellipse at 50% 45%,#1e1628,#05060c 75%);transition:opacity .4s;font-family:'Alegreya Sans',sans-serif;color:#ecdcb4}
    #ld3d canvas{width:170px;height:170px}#ld3d .t{font-family:'Forum',serif;font-size:22px;letter-spacing:.06em;color:#f3d38a}
    #ld3d .bar{width:min(220px,60vw);height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}#ld3d .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#c8902e,#ffd77a);transition:width .3s}
    #ld3d .s{font-size:14px;color:#c9b88f}`;
  const makeDie=()=>makePoly('d20').grp;
  function loop(){raf=requestAnimationFrame(loop);const t=performance.now()/1000;die.rotation.set(t*1.3,t*1.9,t*.7);r2.render(sc2,cam2);}
  return {show(n,txt){total=n;if(el){if(txt)el.querySelector('.s').textContent=txt;return;}
      const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
      el=document.createElement('div');el.id='ld3d';el.innerHTML='<canvas></canvas><div class="t">Логово дракона</div><div class="bar"><i></i></div><div class="s">'+(txt||'Расставляем фигурки…')+'</div>';document.body.appendChild(el);
      try{r2=new THREE.WebGLRenderer({canvas:el.querySelector('canvas'),alpha:true,antialias:true});r2.setPixelRatio(Math.min(devicePixelRatio,2));r2.setSize(170,170,false);r2.outputEncoding=THREE.sRGBEncoding;
        sc2=new THREE.Scene();cam2=new THREE.PerspectiveCamera(35,1,.1,20);cam2.position.z=4.4;
        sc2.add(new THREE.HemisphereLight(0xffe8c0,0x301018,1.1));const dl=new THREE.DirectionalLight(0xffffff,1.1);dl.position.set(2,3,4);sc2.add(dl);
        die=makeDie();sc2.add(die);loop();}catch(e){}},
    step(k){if(el)el.querySelector('.bar i').style.width=Math.round(k/total*100)+'%';},
    hide(){if(!el)return;const e=el;el=null;e.querySelector('.bar i').style.width='100%';e.style.opacity='0';
      setTimeout(()=>{cancelAnimationFrame(raf);try{r2.dispose();r2.forceContextLoss();}catch(x){}e.remove();},450);}};})();
// --- огонь дракона: поток частиц из пасти + искры над горящими клетками
const FX_N=320,fxPos=new Float32Array(FX_N*3),fxCol=new Float32Array(FX_N*3),fxV=new Float32Array(FX_N*3),fxL=new Float32Array(FX_N),fxM=new Float32Array(FX_N),fxK=new Uint8Array(FX_N);
const fxGeo=new THREE.BufferGeometry();fxGeo.setAttribute('position',new THREE.BufferAttribute(fxPos,3));fxGeo.setAttribute('color',new THREE.BufferAttribute(fxCol,3));
const fxTex=(()=>{const k=64,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d'),gr=g.createRadialGradient(k/2,k/2,0,k/2,k/2,k/2);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.35,'rgba(255,255,255,.55)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,k,k);return new THREE.CanvasTexture(c);})();
const fxPts=new THREE.Points(fxGeo,new THREE.PointsMaterial({size:.42,map:fxTex,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
fxPts.frustumCulled=false;SC.add(fxPts);
const breathLight=new THREE.PointLight(0xff7a20,0,7,1.6);SC.add(breathLight);
let fxIdle=0,fxNext=0,breathTill=0,breathT0=0,lastFire=-1,fxI=0;const tmpV=new THREE.Vector3(),tmpD=new THREE.Vector3();
function fxSpawn(x,y,z,vx,vy,vz,life,kind){const i=fxI;fxI=(fxI+1)%FX_N;fxPos[i*3]=x;fxPos[i*3+1]=y;fxPos[i*3+2]=z;fxV[i*3]=vx;fxV[i*3+1]=vy;fxV[i*3+2]=vz;fxL[i]=life;fxM[i]=life;fxK[i]=kind;}
function fireFx(now,dt,aw){
  const L=B.lair;
  // когда дышать: раз в 5–7 секунд, и сразу — когда огонь пробуждения расползается на новое кольцо
  const f=aw?S.fire:-1;
  if(aw&&L.wake){if(f>lastFire&&lastFire>=0){breathT0=now;breathTill=now+2600;}
    else if(now>fxNext&&now>breathTill){breathT0=now;breathTill=now+1700;fxNext=now+5000+Math.random()*2500;}}
  lastFire=f;
  const breathing=aw&&L.wake&&now<breathTill;
  if(breathing){L.mouth.getWorldPosition(tmpV);
    const yaw=L.yaw,dir=tmpD.set(Math.sin(yaw),-.32,Math.cos(yaw)).normalize(),k=Math.min(1,(now-breathT0)/250,(breathTill-now)/300);
    const n=Math.round(150*dt*k+Math.random());
    for(let q=0;q<n;q++){const sp=3.2+Math.random()*1.8,j=.55;
      fxSpawn(tmpV.x,tmpV.y,tmpV.z,(dir.x+(Math.random()-.5)*j)*sp,(dir.y+(Math.random()-.5)*j*.6)*sp,(dir.z+(Math.random()-.5)*j)*sp,.55+Math.random()*.45,0);}
    breathLight.position.copy(tmpV).addScaledVector(dir,1.4);breathLight.intensity=4.5*k*(.85+Math.random()*.3);}
  else breathLight.intensity*=.85;
  // искры и языки над горящими клетками
  if(B.burnCells&&B.burnCells.length){const m=Math.min(8,B.burnCells.length*.04+1)*dt*12;
    for(let q=0;q<m;q++)if(Math.random()<.7){const [r,c]=B.burnCells[Math.floor(Math.random()*B.burnCells.length)],[x,z]=cellXZ(r,c);
      fxSpawn(x+(Math.random()-.5)*.7,.1,z+(Math.random()-.5)*.7,(Math.random()-.5)*.2,.5+Math.random()*.7,(Math.random()-.5)*.2,.8+Math.random()*1.1,1);}}
  // движение и цвет: белый → жёлтый → оранжевый → тёмно-красный и гаснет
  if(!breathing&&!(B.burnCells&&B.burnCells.length)&&now-fxIdle>1300)return;if(breathing||(B.burnCells&&B.burnCells.length))fxIdle=now;
  for(let i=0;i<FX_N;i++){if(fxL[i]<=0){fxCol[i*3]=fxCol[i*3+1]=fxCol[i*3+2]=0;continue;}
    fxL[i]-=dt;const a=Math.max(0,fxL[i]/fxM[i]),o=1-a,dr=fxK[i]?.99:.965;
    fxV[i*3]*=dr;fxV[i*3+2]*=dr;fxV[i*3+1]=fxV[i*3+1]*dr+(fxK[i]?.15:1.6)*dt;
    fxPos[i*3]+=fxV[i*3]*dt;fxPos[i*3+1]=Math.max(.04,fxPos[i*3+1]+fxV[i*3+1]*dt);fxPos[i*3+2]+=fxV[i*3+2]*dt;
    const e=fxK[i]?a*.7:a;
    fxCol[i*3]=e*(o<.2?1:1-o*.3);fxCol[i*3+1]=e*(o<.2?.85:Math.max(.08,.6-o*.7));fxCol[i*3+2]=e*(o<.15?.55:.08);}
  fxGeo.attributes.position.needsUpdate=true;fxGeo.attributes.color.needsUpdate=true;
}
// --- фишки героев: подставка в цвет игрока, портрет, факел в руке
const tokens=new Map();
function heroToken(p){
  const g=new THREE.Group(),colr=new THREE.Color(pcol(p));
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.28,.32,.09,24),new THREE.MeshStandardMaterial({color:0x1b1f2e,metalness:.6,roughness:.4}));base.position.y=.05;base.castShadow=true;g.add(base);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.29,.028,8,32),new THREE.MeshStandardMaterial({color:colr,emissive:colr,emissiveIntensity:.7,metalness:.8,roughness:.3}));rim.rotation.x=Math.PI/2;rim.position.y=.1;g.add(rim);
  const pt=tex(PORTRAITS[p.portrait]||PORTRAITS[0]);pt.magFilter=THREE.NearestFilter;
  const stand=new THREE.Group();
  const back=new THREE.Mesh(new THREE.CircleGeometry(.29,32),new THREE.MeshStandardMaterial({color:colr,metalness:.7,roughness:.3,side:THREE.DoubleSide}));back.position.z=-.005;
  stand.add(back,new THREE.Mesh(new THREE.CircleGeometry(.25,32),new THREE.MeshBasicMaterial({map:pt})));stand.position.y=.48;g.add(stand);
  const torch=new THREE.Group();torch.position.set(.28,0,.05);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.018,.024,.4,6),new THREE.MeshStandardMaterial({color:0x4a2c14,roughness:.9}));pole.position.y=.4;pole.rotation.z=-.18;torch.add(pole);
  const fo=new THREE.Mesh(new THREE.ConeGeometry(.055,.17,7),flameMat);fo.position.set(.04,.66,0);torch.add(fo);
  const fi=new THREE.Mesh(new THREE.ConeGeometry(.03,.1,7),flameMat2);fi.position.set(.04,.645,0);torch.add(fi);
  const gl=new THREE.Sprite(glowMat);gl.scale.setScalar(.75);gl.position.set(.04,.66,0);torch.add(gl);g.add(torch);
  const lt=new THREE.PointLight(0xff9a48,2,4.6,1.6);lt.position.set(.28,1,.05);lt.shadow.mapSize.set(384,384);lt.shadow.bias=-.004;g.add(lt);
  const halo=new THREE.Mesh(new THREE.RingGeometry(.34,.42,40),new THREE.MeshBasicMaterial({color:0xecc66a,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));halo.rotation.x=-Math.PI/2;halo.position.y=.03;g.add(halo);
  SC.add(g);
  const T={g,stand,lt,fo,halo,torch,colr,ph:Math.random()*9,x:null,z:null};
  attachFigure(T,heroKind(p));   // портрет 8 — орк Грок
  return T;
}
function roomSpot(i){const a=i/4*Math.PI*2+.6;return [Math.cos(a)*.95,Math.sin(a)*.95];}

// --- охотники
const hTok=new Map();
function hunterToken(h){
  const d=HUNTERS[h.k],g=new THREE.Group(),col=new THREE.Color(d.col);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.3,.34,.1,24),new THREE.MeshStandardMaterial({color:0x140a12,metalness:.5,roughness:.5}));base.position.y=.05;g.add(base);
  const t=tex(d.ava);
  const disc=new THREE.Mesh(new THREE.CircleGeometry(.28,32),new THREE.MeshBasicMaterial({map:t}));
  const back=new THREE.Mesh(new THREE.CircleGeometry(.32,32),new THREE.MeshBasicMaterial({color:col,side:THREE.DoubleSide}));back.position.z=-.005;
  const stand=new THREE.Group();stand.add(back,disc);stand.position.y=.5;g.add(stand);
  const l=new THREE.PointLight(col,1.2,2.6,2);l.position.y=.6;g.add(l);
  SC.add(g);const T={g,stand,l,x:null,z:null,fly:0};
  const f=FIG[h.k],hf=HFIG[h.k];
  if(f&&hf){const go=()=>{const m=f.mesh.clone();m.scale.setScalar(hf.k);m.position.y=.1+hf.y*hf.k;const fig=new THREE.Group();fig.add(m);g.add(fig);T.fig=fig;T.fly=hf.fly?1:0;
      stand.scale.setScalar(.5);stand.position.y=hf.fly?1.45:(h.k==='hound'?.85:1.4);l.position.y=.9;
      const sh=new THREE.Shape();sh.moveTo(-.13,-.36);sh.lineTo(.13,-.36);sh.lineTo(0,-.58);sh.closePath();
      const ar=new THREE.Mesh(new THREE.ShapeGeometry(sh),new THREE.MeshBasicMaterial({color:col,toneMapped:false}));ar.position.z=.004;stand.add(ar);};
    if(f.mesh)go();else{f.wait.push(go);loadFig(h.k);}}
  return T;
}

// --- метки возможных ходов
const markGeo=new THREE.RingGeometry(.22,.32,32);markGeo.rotateX(-Math.PI/2);
const markMat=new THREE.MeshBasicMaterial({color:0xecc66a,transparent:true,opacity:.85,depthWrite:false,toneMapped:false});
const marks=[];for(let i=0;i<16;i++){const m=new THREE.Mesh(markGeo,markMat);m.visible=false;m.renderOrder=4;SC.add(m);marks.push(m);}
function targets(){
  if(!S||S.over||!$('modal').hidden||lockedTurn())return [];
  if(S.phase==='tp'&&S.tp)return S.tp.spots;
  if(S.phase==='exit')return EXITS;
  if(S.phase==='move'&&!busy){return options(P()).map(o=>[o.r,o.c]);}
  return [];
}

// --- камера: следует за ходящим героем; палец — вращать, щипок/колесо — приблизить
let az=.55,el=.95,dist=9,tgt=new THREE.Vector3(),userUntil=0,focusI=-1,focusUntil=0;
let tAz=az,tEl=el,distMul=1;
// обзор: всё поле целиком помещается по ширине холста
const fitDist=()=>{const h=Math.tan(cam.fov*Math.PI/360),w=h*cam.aspect;return (N*.72)/Math.min(w,h)+N*.15;};
const zoomDist=()=>zoom===0||zoom===false?fitDist():zoom===1?12:7.5;
let ovw=false;
const ptr=new Map();let pinch0=0,dm0=1,moved=0,downAt=0;
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY});moved=0;downAt=performance.now();
  if(ptr.size===2){const [a,b]=[...ptr.values()];pinch0=Math.hypot(a.x-b.x,a.y-b.y);dm0=distMul;}});
cv.addEventListener('pointermove',e=>{const p=ptr.get(e.pointerId);if(!p)return;
  const dx=e.clientX-p.x,dy=e.clientY-p.y;moved+=Math.abs(dx)+Math.abs(dy);
  if(ptr.size===1&&moved>8){tAz-=dx*.006;tEl=Math.min(1.45,Math.max(.35,tEl+dy*.005));userUntil=performance.now()+6000;}
  p.x=e.clientX;p.y=e.clientY;
  if(ptr.size===2){const [a,b]=[...ptr.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);distMul=Math.min(2.6,Math.max(.45,dm0*pinch0/d));moved=99;}});
const up=e=>{const p=ptr.get(e.pointerId);ptr.delete(e.pointerId);
  if(p&&moved<10&&performance.now()-downAt<600)tap(e.clientX,e.clientY);};
cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',e=>ptr.delete(e.pointerId));
// любое касание/колесо — сразу полный FPS (жесты камеры не должны идти рывками)
let activeUntil=0;const wake3d=()=>{activeUntil=performance.now()+600;};
['pointerdown','pointermove','pointerup','wheel'].forEach(ev=>cv.addEventListener(ev,wake3d,{passive:true}));
addEventListener('keydown',wake3d);
cv.addEventListener('wheel',e=>{e.preventDefault();distMul=Math.min(2.6,Math.max(.45,distMul*(1+Math.sign(e.deltaY)*.1)));},{passive:false});
// пилюля героя — камера к нему
lookAt=function(i){if(!S)return;focusI=i;focusUntil=performance.now()+3500;userUntil=0;};
follow=function(){focusI=-1;userUntil=0;};

// касание: луч до плоскости пола -> клетка -> то же, что клик по 2D-клетке
const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.05),hit=new THREE.Vector3();
function tap(x,y){
  if(!S||!$('modal').hidden||lockedTurn())return;
  const b=cv.getBoundingClientRect();ray.setFromCamera({x:(x-b.left)/b.width*2-1,y:-(y-b.top)/b.height*2+1},cam);
  if(!ray.ray.intersectPlane(plane,hit))return;
  const c=Math.round(hit.x)+C,r=Math.round(hit.z)+C;if(!inB(r,c))return;
  if(S.phase==='tp'){if(S.tp&&S.tp.spots.some(([a,b2])=>a===r&&b2===c))act('tp',{r,c});return;}
  if(busy)return;
  if(S.phase==='roll'){if(typeof hintRollDie==='function')hintRollDie();return;}
  if(S.phase==='exit'){if(EXITS.some(([a,b2])=>a===r&&b2===c))act('exit',{r,c});return;}
  if(S.phase!=='move')return;
  const o=options(P()).find(o=>(o.r===r&&o.c===c)||(o.jump&&inRoom(r,c)));
  if(o)act('move',{r:o.r,c:o.c,j:o.jump?1:0});
}

// 2D-поле больше не рисуем — экономим батарею
drawFrame=function(){};drawDark=function(){};

// --- размер: холст 3D лежит ровно поверх области поля
let rectKey='';
function place(){
  const box=document.getElementById('box');if(!box)return;
  const b=box.getBoundingClientRect(),k=[b.left,b.top,b.width,b.height].map(Math.round).join(',');
  if(k===rectKey)return;rectKey=k;
  Object.assign(cv.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});
  R.setSize(Math.max(1,b.width),Math.max(1,b.height),false);cam.aspect=b.width/Math.max(1,b.height);cam.fov=b.width<b.height?55:45;cam.updateProjectionMatrix();
}
addEventListener('resize',()=>{rectKey='';});

// --- кадр
const clock=new THREE.Clock();let lastPlace=0,lastCells=0,fpsAcc=0,fpsN=0,perfLevel=0;
let lastRender=0,prevRendered=false,camPrev=new THREE.Vector3(),camMovedAt=0;
function frame(){
  requestAnimationFrame(frame);
  if(document.hidden){prevRendered=false;return;}
  const now=performance.now();
  // в простое — ~30 FPS: кадр пропускаем, если с прошлого прошло меньше ~28 мс и ничего не движется
  if(S&&B&&now>activeUntil&&now-lastRender<28){prevRendered=false;return;}
  const consecutive=prevRendered,interval=now-lastRender;lastRender=now;prevRendered=true;
  const dt=Math.min(.05,clock.getDelta()),t=clock.elapsedTime;
  if(now-lastPlace>400){place();lastPlace=now;}
  cv.style.display=S?'block':'none';
  if(!S)return;
  if(!B||B.G!==S||B.N!==N||B.cells!==S.cells)build();
  // клетки: проверяем по кусочку поля за кадр, чтобы не тормозить
  if(now-lastCells>120||B.anim.length){lastCells=now;for(let r=0;r<N;r++)for(let c=0;c<N;c++){syncCell(r,c,now);if(!inRoom(r,c)&&!inChasm(r,c))syncDeco(r,c);}}
  syncFire();syncArrows(now);
  // анимация раскрытия: скала опускается
  if(B.anim.length)shadowDirty=true;
  B.anim=B.anim.filter(a=>{const k=Math.min(1,(now-a.t0)/450);
    if(k>=1){hideRock(a.i);return false;}
    rockAt(a.i,a.r,a.c,k);return true;});
  // герои
  const cur=P();
  S.players.forEach((p,i)=>{
    let T=tokens.get(i);if(!T||T.G!==S){if(T)SC.remove(T.g);T=heroToken(p);T.G=S;tokens.set(i,T);}
    const vis=p.mode!=='dead'&&p.mode!=='home';T.g.visible=vis;if(!vis)return;
    let x,z;if(p.mode==='room'){[x,z]=roomSpot(i);}else{[x,z]=cellXZ(p.r,p.c);}
    if(T.x===null||Math.hypot(x-T.x,z-T.z)>3){T.x=x;T.z=z;}
    {const dx=x-T.x,dz=z-T.z;if(Math.hypot(dx,dz)>.03)T.hdT=Math.atan2(dx,dz);   // смотрит туда, куда идёт
     if(T.hd==null)T.hd=T.hdT??0;if(T.hdT!=null){let d=T.hdT-T.hd;d=Math.atan2(Math.sin(d),Math.cos(d));T.hd+=d*Math.min(1,dt*10);}}
    const k=reduce?1:Math.min(1,dt*9);if(Math.abs(x-T.x)+Math.abs(z-T.z)>.002)shadowDirty=true;T.x+=(x-T.x)*k;T.z+=(z-T.z)*k;
    if(T.lt.castShadow!==(p===cur))shadowDirty=true;
    if(p.mode==='out'||p.mode==='back'){if(T.pr!=null&&(T.pr!==p.r||T.pc!==p.c))T.wall=Math.abs(T.pr-p.r)+Math.abs(T.pc-p.c)===1&&!edgeOpen(T.pr,T.pc,p.r,p.c);T.pr=p.r;T.pc=p.c;}
    const dd=Math.hypot(x-T.x,z-T.z),hop=T.wall?Math.min(.6,dd*1.6):Math.min(.25,dd*.6);if(dd<.01)T.wall=false;
    T.g.position.set(T.x,.02+hop,T.z);
    const f=flick(now,i*3.3+1)/.78;T.lt.intensity=(p===cur?2.6:1.3)*f;T.lt.distance=p===cur?4.8:3.2;if(T.foBase)T.fo.scale.setScalar(T.foBase*f);else T.fo.scale.set(1,f*1.1,1);
    T.lt.castShadow=p===cur;
    T.halo.material.opacity=p===cur?.55+Math.sin(t*4)*.25:0;
    const face=Math.atan2(cam.position.x-T.g.position.x,cam.position.z-T.g.position.z);T.stand.quaternion.copy(cam.quaternion);   // портрет всегда лицом к игроку, как в 2D
    if(T.fig)T.fig.rotation.y=T.hd??face;
  });
  // где сейчас свет героя с тенью: рядом с ним вращающиеся предметы и дышащий дракон требуют редкого пересчёта тени
  let curLt=null,rareShadow=false;{const T=tokens.get(S.cur);if(T&&T.g.visible)curLt=T.g.position;}
  if(curLt&&S.rules!=='descent'&&curLt.x*curLt.x+curLt.z*curLt.z<6.5*6.5)rareShadow=true;   // логово в центре поля, свет бьёт на ~4.8
  // охотники
  const act0=(S.hunters||[]).filter(h=>!h.away);
  hTok.forEach((T,id)=>{if(!act0.some(h=>h.id===id)||T.G!==S){SC.remove(T.g);hTok.delete(id);}});
  act0.forEach(h=>{let T=hTok.get(h.id);if(!T){T=hunterToken(h);T.G=S;hTok.set(h.id,T);}
    const [x,z]=cellXZ(h.r,h.c);if(T.x===null){T.x=x;T.z=z;}const k=Math.min(1,dt*5);
    {const dx=x-T.x,dz=z-T.z;if(Math.hypot(dx,dz)>.03){T.hdT=Math.atan2(dx,dz);shadowDirty=true;}if(T.hd==null)T.hd=T.hdT??0;if(T.hdT!=null){let d=T.hdT-T.hd;d=Math.atan2(Math.sin(d),Math.cos(d));T.hd+=d*Math.min(1,dt*8);}}
    T.x+=(x-T.x)*k;T.z+=(z-T.z)*k;
    {const top=walkable(h.r,h.c)&&!cell(h.r,h.c).rev?blockTopY(h.r,h.c):.02;T.y=T.y==null?top:T.y+(top-T.y)*Math.min(1,dt*6);}   // по скале — поверху
    T.g.position.set(T.x,T.y,T.z);T.stand.quaternion.copy(cam.quaternion);
    if(T.fig){T.fig.rotation.y=T.hd||0;if(T.fly)T.fig.position.y=Math.sin(t*2+h.id)*.06;}else T.g.position.y=T.y+Math.sin(t*2+h.id)*.04;});
  B.deco.forEach(d=>{if(!d)return;const u=d.g.userData,w=u.kob||u.face;if(w)w.rotation.y=Math.atan2(cam.position.x-d.g.position.x,cam.position.z-d.g.position.z)-.35;
    if(u.slide){const k=Math.min(1,(performance.now()-u.slide.t0)/450),e=1-Math.pow(1-k,3),o=u.slide.o;   // монстр делает шаг
      if(!u.slide.p0)u.slide.p0=o.position.clone();o.position.copy(u.slide.p0).multiplyScalar(1-e);o.position.y=Math.sin(k*Math.PI)*.12;if(k>=1){o.position.set(0,0,0);u.slide=null;}shadowDirty=true;}
    if(u.spin){if(curLt&&d.g.position.distanceToSquared(curLt)<25)rareShadow=true;u.spin.rotation.y+=dt*.9;u.spin.position.y=.08+Math.sin(t*2+d.g.position.x)*.03;}});
  // метки ходов
  const tg=targets();marks.forEach((m,i)=>{const q=tg[i];m.visible=!!q;if(q){const [x,z]=cellXZ(q[0],q[1]);m.position.set(x,inRoom(q[0],q[1])?.24:cell(q[0],q[1]).rev?(S.rules==='descent'?.07:.03):blockTopY(q[0],q[1])+.025,z);m.scale.setScalar(1+Math.sin(t*5)*.08);}});
  markMat.opacity=.6+Math.sin(t*5)*.25;
  glowTopMat.opacity=.7+Math.sin(t*2.4)*.3;glowSideMat.opacity=.05+Math.sin(t*2.4)*.03;
  // дракон: во сне дышит, проснувшись — смотрит и машет крыльями
  const L=B.lair,aw=!!S.awake;
  const br=aw?Math.sin(t*6)*.04:Math.sin(t*1.4)*.03;L.body.scale.set(1+br,.62+br,1.45+br*.5);
  if(L.model){const sleep=!aw||!L.wake;L.model.visible=sleep;if(sleep)L.model.scale.set(1+br*.25,1+br*.6,1+br*.25);}   // дракон дышит во сне
  if(L.wake){L.wake.visible=aw;
    if(aw){const q=S.players[S.cur];let want=L.yaw;
      if(q&&(q.mode==='out'||q.mode==='back')){const [hx,hz]=cellXZ(q.r,q.c);want=Math.atan2(hx,hz);}
      let d=want-L.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));L.yaw+=d*Math.min(1,dt*2.5);if(Math.abs(d)>.01)shadowDirty=true;
      L.wake.rotation.y=L.yaw;L.wake.scale.set(1+br*.15,1+br*.3,1+br*.15);}}
  fireFx(now,dt,aw);
  L.head.rotation.y=aw?-.2+Math.sin(t*2)*.4:-.5;L.head.position.y=aw?.85+Math.sin(t*3)*.05:.45;
  L.eyeMat.emissiveIntensity=aw?3:0;L.eyes.forEach(e=>e.scale.y=aw?1:.25);
  L.wings.forEach((w,i)=>{w.rotation.z=(i?-1:1)*(aw?.9+Math.sin(t*8)*.5:.35)+(i?0:Math.PI);});
  L.light.color.setHex(aw?0xff5a22:0xffb347);L.light.intensity=(aw?3.4:2.4)+Math.sin(t*3)*.15;
  B.pitLight.intensity=S.rules==='descent'?0:.9+Math.sin(t*1.7)*.3;
  B.flames.forEach((f,j)=>{f.scale.y=1+Math.sin(t*12+j)*.12;});
  // настенные факелы: пламя мерцает, свет — у шести ближайших к центру кадра
  B.torches.forEach(o=>{const f=.85+Math.sin(t*9+o.ph)*.1+Math.sin(t*23+o.ph)*.06;o.f1.scale.set(1,f*1.1,1);o.d=o.pos.distanceToSquared(tgt);});
  const near=B.torches.slice().sort((a,b)=>a.d-b.d).slice(0,TL_POOL.length);
  TL_POOL.forEach((l,i)=>{const o=near[i];if(!o){l.intensity=0;return;}l.position.copy(o.pos);l.intensity=1.2*flick(now,o.ph*7)/.78;});
  // камера
  let fx,fz;
  const fp=focusI>=0&&now<focusUntil?S.players[focusI]:cur;
  if(zoom===0||zoom===false){fx=0;fz=0;}
  else if(fp){if(fp.mode==='room'){fx=0;fz=0;}else{[fx,fz]=cellXZ(fp.r,fp.c);}}
  if(now>userUntil){/* камера сама держит ходящего героя */}
  tgt.x+=((fx||0)-tgt.x)*Math.min(1,dt*3);tgt.z+=((fz||0)-tgt.z)*Math.min(1,dt*3);
  const ov=zoom===0||zoom===false;
  if(ov!==ovw){ovw=ov;if(ov){tAz=0;tEl=1.2;}else{tAz=.55;tEl=.95;}}
  // как в 2D: в обзоре тьма мягче, вблизи — гуще, и свет факелов виден ярче
  hemi.intensity+=((ov?.8:.42)-hemi.intensity)*.08;
  az+=(tAz-az)*.1;el+=(tEl-el)*.1;
  const want=zoomDist()*distMul;dist+=(want-dist)*Math.min(1,dt*4);
  cam.position.set(tgt.x+Math.sin(az)*Math.cos(el)*dist,Math.sin(el)*dist,tgt.z+Math.cos(az)*Math.cos(el)*dist);cam.lookAt(tgt.x,0,tgt.z);
  moon.position.set(tgt.x-8,14,tgt.z+6);moon.target.position.set(tgt.x,0,tgt.z);
  // камера сдвинулась (пан/зум/вращение/следование) — полный FPS; фигурки «лицом к игроку» поворачиваются — тень пересчитаем один раз, когда камера остановится
  const camMoved=cam.position.distanceToSquared(camPrev)>1e-6;camPrev.copy(cam.position);if(camMoved)camMovedAt=now;
  const moving=shadowDirty||camMoved||B.anim.length>0||ptr.size>0||!!S.awake||(typeof busy!=='undefined'&&busy)||now<focusUntil;
  if(moving)activeUntil=Math.max(activeUntil,now+300);
  // тени: только при реальных изменениях; редкий пересчёт (1.5 с) — лишь когда рядом со светом героя дышит дракон или крутится предмет
  if(shadowDirty||(rareShadow&&now-lastShadow>1500)||(camMovedAt>lastShadow&&now-camMovedAt>200)){R.shadowMap.needsUpdate=true;shadowDirty=false;lastShadow=now;}
  R.render(SC,cam);
  // если телефон не тянет (кадр дольше ~30 мс два секунды подряд) — сначала меньше пикселей, потом без теней
  // автодеградация: при полном FPS — интервал между подряд идущими кадрами (отражает и GPU), в простое — время работы кадра;
  // пропуски кадров троттлинга в замер не попадают, ложного срабатывания нет
  const work=performance.now()-now,sample=Math.min(50,consecutive?Math.max(interval,work):work);   // как раньше dt: один долгий кадр (сборка поля) не валит среднее
  fpsAcc+=sample/1000;fpsN++;if(fpsAcc>2||fpsN>=60){const ms=fpsAcc/fpsN*1000;fpsAcc=0;fpsN=0;
    if(ms>30&&perfLevel<2){perfLevel++;if(perfLevel===1){DPR=1;R.setPixelRatio(1);rectKey='';}else{R.shadowMap.enabled=false;SC.traverse(o=>{if(o.material)[].concat(o.material).forEach(m=>m.needsUpdate=true);});}}}
}
requestAnimationFrame(frame);
// для автотестов: где на экране метка хода
window.__3d={R,cam,cv,loader,B:()=>B,FIG:()=>FIG,edgeOpen,info:()=>({arches:B?B.arches.size:-1,calls:R.info.render.calls,tri:R.info.render.triangles,rect:cv.style.cssText,cam:cam.position.toArray().map(v=>+v.toFixed(2))}),
  markerScreen(i){const m=marks[i];if(!m||!m.visible)return null;const v=m.position.clone().project(cam),b=cv.getBoundingClientRect();return {x:b.left+(v.x+1)/2*b.width,y:b.top+(1-v.y)/2*b.height};},
  look(x,z,o={}){tgt.x=x;tgt.z=z;if(o.az!=null)tAz=az=o.az;if(o.el!=null)tEl=el=o.el;if(o.distMul!=null)distMul=o.distMul;if(o.zoom!=null)zoom=o.zoom;userUntil=performance.now()+1e7;focusUntil=0;focusI=-1;}};

// --- при запуске всё грузится в память: картинки, звуки и 3D-модели; пока идёт загрузка — вращается d20
(function preloadAll(){
  const list=(window.ASSETS||[]).slice();if(!list.length)return;
  const figKeys=new Set(Object.keys(FIG));Object.values(EV3).concat(Object.values(MON3)).forEach(([k])=>{ensureFig(k);figKeys.add(k);});
  const total=list.length+figKeys.size;let done=0;
  loader.show(total,'Загружаем подземелье…');
  const tick=()=>{loader.step(++done);const s2=document.querySelector('#ld3d .s');if(s2)s2.textContent=`Загружаем подземелье… ${Math.round(done/total*100)}%`;};
  window.__IMGS=[];
  const one=async u=>{try{
      if(/\.(jpe?g|png)$/i.test(u)&&!u.startsWith('models/')){const im=new Image();im.src=u;window.__IMGS.push(im);await (im.decode?im.decode():new Promise(r=>{im.onload=im.onerror=r;})).catch(()=>{});}
      else{const r=await fetch(u);await r.arrayBuffer();}
    }catch(e){}tick();};
  const q=list.slice();
  const worker=async()=>{while(q.length)await one(q.shift());};
  Promise.all(Array.from({length:6},worker)).then(()=>{
    // звуки — сразу готовые объекты Audio (файлы уже в кеше браузера)
    try{Object.keys(SFX).forEach(k=>{if(!sfxCache[k]){sfxCache[k]=new Audio(SFX[k]);sfxCache[k].preload='auto';}});}catch(e){}
    return Promise.all([...figKeys].map(k=>loadFig(k).then(tick,tick)));
  }).then(()=>loader.hide());
})();
})();
