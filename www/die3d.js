/* Красный 3D-кубик d4 (тетраэдр) для кнопки броска. Отдельный маленький three.js-холст #mdCv.
   API: DIE3D.ok, DIE3D.show(n,'ready'|'idle'), DIE3D.spin(), DIE3D.land(v).
   Если WebGL нет — .movedie остаётся без класса has3d и показывает красный CSS-кубик (.d4).
   Ничего не знает о сети и состоянии игры: только рисует то, что ему сказали. */
(function(){
'use strict';
const D={ok:false};window.DIE3D=D;
if(!window.THREE)return;
const T=window.THREE;
const RM=window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches;
let R,scene,cam,mesh,tex,cv,cx,wrapEl,cvEl;
const CELL=256;
let front=0,txt={},curMode='idle',curVal='?';
let spinning=false,spinW=null,landing=null,qTarget=new T.Quaternion(),t0=performance.now(),raf=0,lastSize=0;
const faces=[];   // {a,b,c,n,up}
function V(x,y,z){return new T.Vector3(x,y,z).normalize();}
function build(){
  const P=[V(1,1,1),V(-1,-1,1),V(-1,1,-1),V(1,-1,-1)];
  const idx=[[0,1,2],[0,3,1],[0,2,3],[1,3,2]];
  const pos=[],uv=[];
  const UA=[.5,.94],UB=[.04,.14],UC=[.96,.14];
  idx.forEach((f,i)=>{
    let [a,b,c]=f.map(k=>P[k]);
    const n=new T.Vector3().subVectors(b,a).cross(new T.Vector3().subVectors(c,a)).normalize();
    const cen=new T.Vector3().add(a).add(b).add(c).multiplyScalar(1/3);
    if(n.dot(cen)<0){[b,c]=[c,b];n.negate();}
    [a,b,c].forEach(v=>pos.push(v.x,v.y,v.z));
    const col=i%2,row=(i>>1);
    const u0=col/2,v0=1-(row+1)/2;
    [UA,UB,UC].forEach(u=>uv.push(u0+u[0]/2,v0+u[1]/2));
    faces.push({n,up:new T.Vector3().subVectors(a,cen).normalize()});
  });
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.computeVertexNormals();
  return g;
}
function cellPaint(i,label){
  const x=(i%2)*CELL,y=(i>>1)*CELL;
  const g=cx.createLinearGradient(x,y,x+CELL,y+CELL);
  g.addColorStop(0,'#e0343a');g.addColorStop(.5,'#b3141c');g.addColorStop(1,'#7c0c13');
  cx.fillStyle=g;cx.fillRect(x,y,CELL,CELL);
  // каменная зернистость и прожилки
  cx.globalAlpha=.16;
  for(let k=0;k<170;k++){const px=x+((k*97+i*31)%CELL),py=y+((k*57+i*71)%CELL),r=2+((k*13)%9);
    cx.fillStyle=k%3?'#3a0508':'#ff9a8a';cx.beginPath();cx.arc(px,py,r,0,7);cx.fill();}
  cx.globalAlpha=.22;cx.strokeStyle='#2a0306';cx.lineWidth=2;
  for(let k=0;k<4;k++){cx.beginPath();cx.moveTo(x+30+k*50,y+10);cx.lineTo(x+60+k*30,y+80+k*20);cx.lineTo(x+40+k*55,y+170);cx.stroke();}
  cx.globalAlpha=1;
  // число в центре треугольной грани: белое с золотой обводкой
  const mx=x+CELL*.5,my=y+CELL*(1-.40);
  cx.font='900 '+(String(label).length>1?96:130)+'px Forum, Georgia, serif';cx.textAlign='center';cx.textBaseline='middle';
  cx.lineJoin='round';cx.lineWidth=14;cx.strokeStyle='#6d4a0e';cx.strokeText(label,mx,my+4);
  cx.lineWidth=7;cx.strokeStyle='#f1c75b';cx.strokeText(label,mx,my+2);
  cx.fillStyle='#fffdf6';cx.shadowColor='rgba(0,0,0,.45)';cx.shadowBlur=6;cx.fillText(label,mx,my+2);cx.shadowBlur=0;
}
function paintAll(){
  for(let i=0;i<4;i++)cellPaint(i,txt[i]!=null?txt[i]:String(i+1));
  tex.needsUpdate=true;
}
function faceQuat(k,out){
  const f=faces[k],right=new T.Vector3().crossVectors(f.up,f.n).normalize();
  const up=new T.Vector3().crossVectors(f.n,right).normalize();
  const m=new T.Matrix4().makeBasis(right,up,f.n);m.invert();   // из объекта в мир: грань k смотрит на камеру, число стоит прямо
  const q=new T.Quaternion().setFromRotationMatrix(m);
  const tilt=new T.Quaternion().setFromEuler(new T.Euler(-.55,.5,0));   // лёгкий наклон: видны соседние грани, объём
  return out.copy(tilt).multiply(q);
}
function size(){
  const w=Math.max(1,Math.round(cvEl.clientWidth)),dpr=Math.min(window.devicePixelRatio||1,2);
  if(w===lastSize)return;lastSize=w;R.setPixelRatio(dpr);R.setSize(w,w,false);
}
function frame(now){
  raf=0;if(!R)return;
  size();
  const t=(now-t0)/1000;let more=false;
  if(spinning){
    const dt=Math.min(.05,(now-(frame.l||now))/1000);
    const q=new T.Quaternion().setFromAxisAngle(spinW.clone().normalize(),spinW.length()*dt);
    mesh.quaternion.premultiply(q);
    mesh.position.y=Math.abs(Math.sin(t*9))*.22;
    mesh.scale.setScalar(1);more=true;
  }else if(landing){
    const k=Math.min(1,(now-landing.t)/landing.d),e=1-Math.pow(1-k,3);
    mesh.quaternion.slerpQuaternions(landing.from,qTarget,e);
    mesh.position.y=Math.sin(Math.min(1,k*1.0)*Math.PI)*.16*(1-k);
    mesh.scale.setScalar(1);
    if(k>=1){landing=null;mesh.quaternion.copy(qTarget);mesh.position.y=0;}else more=true;
  }else if(curMode==='ready'&&!RM){
    const w=new T.Quaternion().setFromEuler(new T.Euler(Math.sin(t*1.7)*.10,Math.cos(t*1.3)*.14,Math.sin(t*1.1)*.05));
    mesh.quaternion.copy(w).multiply(qTarget);
    mesh.position.y=Math.sin(t*2.2)*.035;mesh.scale.setScalar(1+Math.sin(t*2.2)*.025);more=true;
  }else{mesh.quaternion.copy(qTarget);mesh.position.y=0;mesh.scale.setScalar(1);}
  frame.l=now;
  R.render(scene,cam);
  if(more)raf=requestAnimationFrame(frame);else frame.l=0;
}
function kick(){if(!raf)raf=requestAnimationFrame(frame);}
function orient(k,animate){
  front=k;faceQuat(k,qTarget);
  if(animate&&!RM){landing={t:performance.now(),d:260,from:mesh.quaternion.clone()};}else{landing=null;}
  kick();
}
D.show=function(n,mode){
  if(!D.ok)return;
  n=String(n);mode=mode||'idle';
  if(spinning||landing&&landing.rollin)return;
  if(n===curVal&&mode===curMode)return;
  const changed=n!==curVal;curVal=n;curMode=mode;
  txt={};
  const num=parseInt(n,10);
  let k=0;
  if(n==='?'){k=front;txt[k]='?';}
  else if(num>=1&&num<=4){k=num-1;}
  else{k=0;txt[0]=n;}
  paintAll();orient(k,changed);
  cvEl.parentNode.classList.toggle('dready',mode==='ready');
};
D.spin=function(){
  if(!D.ok)return;
  txt={};paintAll();landing=null;
  if(RM){kick();return;}
  spinning=true;spinW=new T.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize().multiplyScalar(13+Math.random()*4);
  curMode='roll';cvEl.parentNode.classList.remove('dready');kick();
};
D.land=function(v){
  if(!D.ok)return;
  spinning=false;curVal=String(v);curMode='idle';txt={};paintAll();
  orient(Math.max(0,Math.min(3,v-1)),true);
  if(landing)landing.d=380;
};
function init(){
  cvEl=document.getElementById('mdCv');if(!cvEl)return;
  try{
    R=new T.WebGLRenderer({canvas:cvEl,alpha:true,antialias:true,powerPreference:'low-power'});
    if(!R.getContext())throw 0;
  }catch(e){return;}
  scene=new T.Scene();cam=new T.PerspectiveCamera(30,1,.1,20);cam.position.set(0,0,4.6);
  cv=document.createElement('canvas');cv.width=cv.height=CELL*2;cx=cv.getContext('2d');
  tex=new T.CanvasTexture(cv);tex.anisotropy=4;
  if(T.sRGBEncoding){tex.encoding=T.sRGBEncoding;R.outputEncoding=T.sRGBEncoding;}
  const mat=new T.MeshStandardMaterial({map:tex,roughness:.30,metalness:.12,emissive:0x300406,emissiveIntensity:.35});
  mesh=new T.Mesh(build(),mat);
  // золотые рёбра
  const eg=new T.EdgesGeometry(mesh.geometry,5);
  mesh.add(new T.LineSegments(eg,new T.LineBasicMaterial({color:0xf3cf6e})));
  scene.add(mesh);
  scene.add(new T.AmbientLight(0xffd8d0,.5));
  const key=new T.DirectionalLight(0xfff1e0,1.05);key.position.set(2.4,3.2,4);scene.add(key);
  const rim=new T.DirectionalLight(0x6aa8ff,.7);rim.position.set(-3,1,-2.5);scene.add(rim);
  const fill=new T.DirectionalLight(0xff9080,.3);fill.position.set(-2,-2,3);scene.add(fill);
  txt={};paintAll();faceQuat(0,qTarget);mesh.quaternion.copy(qTarget);
  D.ok=true;cvEl.parentNode.classList.add('has3d');
  if(window.ResizeObserver)new ResizeObserver(()=>{lastSize=0;kick();}).observe(cvEl);
  cvEl.addEventListener('webglcontextlost',e=>{e.preventDefault();D.ok=false;cvEl.parentNode.classList.remove('has3d');});
  kick();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
