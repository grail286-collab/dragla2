<script>
/* ===== fx3: отдельный экран выбора героя =====
   Фон — тот же экран главного меню: арка (img/menu-arch-live.png), синее пламя и факелы — их рисует код MMFIRE
   (скрипт ниже), этот экран лишь включает режим #mainmenu.mmhero и показывает свои элементы внутри .mmin.
   Посередине в проёме — 3D-модель героя (модели и текстуры из three3d.js, отдельный WebGL-рендерер, освобождается при закрытии),
   снизу — ряд лиц, справа/снизу — имя, роль, параметры и кнопки «Выбрать»/«Назад».
   pickHero({current,seat,taken,swap,takenBy,confirm}) → Promise<номер портрета | null>. Логика выбора остаётся у вызывающего кода.
   ВСЕ НАСТРОЙКИ — в объекте HEROSEL и в CSS-переменных блока «fx3: экран выбора героя». */
(function(){
const HEROSEL={
  fov:24,          // угол обзора камеры модели
  fit:.9,          // какую часть высоты сцены занимает модель
  spin:.5,         // скорость авто-вращения, рад/с (0 — не вращать)
  drag:.011,       // чувствительность вращения пальцем/мышью
  pixelRatio:2,    // максимум пикселей на CSS-пиксель
  maxPix:650000,   // потолок пикселей холста модели
  info:[           // героев нарисовано 8 (по номеру портрета); класс, характеристики и способность — из HERO_CLASSES (index.html)
    {name:'Страж',cls:'Страж',txt:'Коричневый капюшон, алый плащ за плечами. Плащ-щит один раз погасит удар, что должен был сразить.'},
    {name:'Лучница',cls:'Лучница',txt:'Зелёный капюшон и лук за спиной. Где другие срываются в пропасть, она находит верный шаг.'},
    {name:'Чародейка',cls:'Чародейка',txt:'Пурпурный плащ, светлые волосы. Свитки читает быстрее, чем дракон успевает моргнуть. Почти.'},
    {name:'Ведунья',cls:'Ведунья',txt:'Беловолосая эльфийка. Её иней гасит то, чему не должно быть хода: нежить, призраков, охотников.'},
    {name:'Алхимик',cls:'Алхимик',txt:'Седина и пурпурный плащ, в карманах позвякивает. Котелок всегда под рукой: одно зелье можно сварить на месте.'},
    {name:'Следопыт',cls:'Следопыт',txt:'Борода в тени тёмного плаща, шаг почти не слышен. Тропа следопыта откроет путь там, где карта молчит.'},
    {name:'Воин',cls:'Воин',txt:'Гном в рогатом капюшоне, топор наготове. Если первый удар не взял — будет второй.'},
    {name:'Берсерк',cls:'Берсерк',txt:'Шрамов больше, чем историй. Ярость добавляет силы, когда её и так не занимать.'}]
};
window.HEROSEL=HEROSEL;
const $=id=>document.getElementById(id);
let busy=null;
const KINDS=[0,1,2,3,4,5,6,7];
function kindOf(k){return window.__heroFig?__heroFig.kind({portrait:k}):null;}

window.pickHero=function(o){
  if(busy)return busy.p;
  o=o||{};
  const menu=$('mainmenu'),mm=menu&&menu.querySelector('.mmin');
  const P=window.PORTRAITS||[1,2,3,4,5,6,7,8].map(i=>`img/hero-${i}.webp`);
  if(!menu||!mm)return Promise.resolve(null);
  let cur=Math.max(0,Math.min(P.length-1,o.current|0)),alive=true,lastFocus=document.activeElement;
  const seatName=o.seat!=null&&window.SEATS&&SEATS[o.seat]?SEATS[o.seat].side:'';
  const root=document.createElement('div');root.className='mmhsel';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Выбор героя');
  if(o.seat!=null&&window.SEATS&&SEATS[o.seat])root.style.setProperty('--hc',`var(${SEATS[o.seat].color})`);
  const hp=typeof MAXHP==='number'?MAXHP:3;
  root.innerHTML=`<div class="mmhhead"><small>Выбор героя</small><b>${seatName?'Место: '+seatName:'Твой герой'}</b><span>Листай лица внизу, а модель можно крутить пальцем</span></div>
    <div class="mmhstage"><canvas aria-hidden="true"></canvas><img class="mmhfb" alt="" hidden><i class="mmhspin" aria-hidden="true"></i></div>
    <div class="mmhside">
      <div class="mmhname"><small>Выбор героя${seatName?' · '+seatName:''}</small><b class="mmhn"></b></div>
      <div class="mmhchips" aria-label="Характеристики"></div>
      <div class="mmhabil"><b></b><span></span><small></small></div>
      <p class="mmhflav"></p><p class="mmhnote" hidden></p>
      <div class="mmhacts"><button type="button" class="ok" data-a="ok">${o.confirm||'Выбрать'}</button><button type="button" class="bk" data-a="back">← Назад</button></div>
    </div>
    <div class="mmhfaces" role="listbox" aria-label="Герои">${P.map((src,k)=>`<button type="button" role="option" data-k="${k}" aria-label="${(HEROSEL.info[k]||{}).cls||'Герой '+(k+1)}"><span class="mmhf"><img alt="" src="${src}"></span><small>${(HEROSEL.info[k]||{}).cls||''}</small><u aria-hidden="true">🔒</u></button>`).join('')}</div>`;
  mm.appendChild(root);
  const stage=root.querySelector('.mmhstage'),cv=stage.querySelector('canvas'),fb=stage.querySelector('.mmhfb'),spin=stage.querySelector('.mmhspin'),
    faces=root.querySelector('.mmhfaces'),chips=root.querySelector('.mmhchips'),okb=root.querySelector('[data-a=ok]');
  const wasHidden=menu.hidden;
  menu.classList.add('mmhero');menu.hidden=false;
  // ---------- 3D ----------
  const T=window.THREE;let R=null,sc=null,cam=null,rig=null,lights=[],disc=null,cache={},loadTok=0,raf=0,last=0,rotY=0,vel=0,dragging=false,idleT=0,popT=1,curGrp=null,rendered=0,fbMode=false;
  function ok3d(){return !!(T&&window.__heroFig&&cv);}
  function init3d(){
    if(!ok3d())return false;
    try{
      R=new T.WebGLRenderer({canvas:cv,alpha:true,antialias:true,powerPreference:'low-power'});
      R.outputEncoding=T.sRGBEncoding;R.setClearColor(0,0);
      sc=new T.Scene();cam=new T.PerspectiveCamera(HEROSEL.fov,1,.1,30);
      // свет: тёплый ключ спереди-слева, синий контровой из туннеля, оранжевые отсветы факелов по бокам
      sc.add(new T.HemisphereLight(0xa9c8ff,0x2b2433,1.05));
      const key=new T.DirectionalLight(0xffe2bd,1.55);key.position.set(-2.2,3.2,3.4);sc.add(key);
      const rim=new T.DirectionalLight(0x59a6ff,1.5);rim.position.set(2.4,2.2,-3);sc.add(rim);
      const tl=new T.PointLight(0xff8a2c,1.7,7,1.5);tl.position.set(-2.4,1.1,.8);sc.add(tl);
      const tr=new T.PointLight(0xff8a2c,1.7,7,1.5);tr.position.set(2.4,1.1,.8);sc.add(tr);
      const fill=new T.PointLight(0x4f9bff,1.3,6,1.6);fill.position.set(0,.3,2.6);sc.add(fill);
      // светящийся круг под ногами
      const k=128,c=document.createElement('canvas');c.width=c.height=k;const g=c.getContext('2d'),gr=g.createRadialGradient(k/2,k/2,k*.08,k/2,k/2,k/2);
      gr.addColorStop(0,'rgba(120,190,255,.85)');gr.addColorStop(.45,'rgba(60,130,255,.35)');gr.addColorStop(1,'rgba(30,80,255,0)');g.fillStyle=gr;g.fillRect(0,0,k,k);
      const dt=new T.CanvasTexture(c);
      disc=new T.Mesh(new T.CircleGeometry(1.15,40),new T.MeshBasicMaterial({map:dt,transparent:true,depthWrite:false,blending:T.AdditiveBlending}));disc.rotation.x=-Math.PI/2;sc.add(disc);
      const sh=new T.Mesh(new T.CircleGeometry(.62,32),new T.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.55,depthWrite:false}));sh.rotation.x=-Math.PI/2;sh.position.y=.004;sc.add(sh);
      rig=new T.Group();sc.add(rig);
      lights=[key,rim,tl,tr,fill];
      cv.addEventListener('webglcontextlost',e=>{e.preventDefault();toFallback();},{once:true});
      return true;
    }catch(e){console.warn('hero 3D',e);R=null;return false;}
  }
  function toFallback(){fbMode=true;stopLoop();cv.style.display='none';fb.hidden=false;fb.src=P[cur];spin.hidden=true;}
  // копия модели только для этого рендерера: свои геометрия/материал/текстура — их можно освободить, не задев игровое поле
  function build(kind){
    const f=__heroFig.get(kind);if(!f||!f.mesh)return null;
    const m0=f.mesh.children[0];if(!m0)return null;
    const geo=m0.geometry.clone();geo.computeBoundingBox();
    const tex=m0.material.map.clone();tex.needsUpdate=true;tex.encoding=T.sRGBEncoding;tex.flipY=false;tex.anisotropy=4;
    const mat=new T.MeshStandardMaterial({map:tex,roughness:.82,metalness:0});
    const mesh=new T.Mesh(geo,mat),bb=geo.boundingBox,h=bb.max.y-bb.min.y,s=1.8/h;
    const grp=new T.Group();mesh.position.set(-(bb.max.x+bb.min.x)/2,-bb.min.y,-(bb.max.z+bb.min.z)/2);
    const holder=new T.Group();holder.add(mesh);holder.scale.setScalar(s);grp.add(holder);
    return {grp,geo,tex,mat};
  }
  function freeEntry(e){if(!e)return;try{e.geo.dispose();e.mat.dispose();e.tex.dispose();}catch(x){}}
  function show(k){
    const kind=kindOf(k);
    if(fbMode||!R||!kind){fb.src=P[k];return;}
    const tok=++loadTok;spin.hidden=!!cache[k];
    const put=()=>{
      if(!alive||tok!==loadTok)return;
      let e=cache[k];if(!e){e=build(kind);if(!e){toFallback();return;}cache[k]=e;}
      if(curGrp)rig.remove(curGrp);curGrp=e.grp;rig.add(curGrp);popT=0;spin.hidden=true;
      if(!raf&&alive)startLoop();
      prefetch();
    };
    const f=__heroFig.get(kind);
    if(f&&f.mesh)put();else __heroFig.load(kind).then(put,()=>{if(alive&&tok===loadTok)toFallback();});
  }
  // соседние герои подгружаются заранее, по одному
  let pfT=0;function prefetch(){clearTimeout(pfT);if(!alive||!window.__heroFig)return;
    const order=[1,-1,2,-2,3,-3,4].map(d=>(cur+d+P.length)%P.length);
    const next=order.find(k=>{const kd=kindOf(k),f=kd&&__heroFig.get(kd);return f&&!f.mesh;});
    if(next!=null)pfT=setTimeout(()=>{if(alive)__heroFig.load(kindOf(next)).then(prefetch,()=>{});},350);}
  // ---------- размер/положение ----------
  function layout(){
    if(!alive)return;
    const ar=window.__mmFire&&__mmFire.archRect?__mmFire.archRect():null;if(!ar)return;
    const [ax,ay,aw,ah]=ar,vw=innerWidth,vh=innerHeight;
    const desk=matchMedia('(min-width:900px) and (min-height:561px) and (orientation:landscape)').matches,land=!desk&&matchMedia('(orientation:landscape)').matches;
    const top=ay+ah*.265,left=ax+aw*.2,w=aw*.6;
    let bottom;
    if(desk)bottom=ay+ah*.79;else if(land)bottom=ay+ah*.85;
    else{const ae=root.querySelector('.mmhabil'),cr=(ae&&!ae.hidden?ae:chips).getBoundingClientRect();bottom=cr.top>0?cr.top-2:ay+ah*.74;}
    const h=Math.max(120,bottom-top);
    stage.style.cssText=`left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px`;
    if(R){
      const pr=Math.min(devicePixelRatio||1,HEROSEL.pixelRatio,Math.sqrt(HEROSEL.maxPix/(w*h)));
      R.setPixelRatio(pr);R.setSize(Math.round(w),Math.round(h),false);cam.aspect=w/h;
      // дистанция: вся модель (высота 1.8) помещается с запасом и по высоте, и по ширине
      const tf=Math.tan(HEROSEL.fov*Math.PI/360),dh=(1.8/HEROSEL.fit/2)/tf,dw=(1.25/(w/h)/1)/tf;
      const d=Math.max(dh,dw*.9);cam.position.set(0,1.0+d*.1,d);cam.lookAt(0,.86,0);cam.updateProjectionMatrix();
      disc.scale.setScalar(1);
    }
    if(!R||fbMode)fb.style.cssText='';
  }
  // ---------- цикл ----------
  const visible=()=>!menu.hidden&&!document.hidden&&alive;
  function startLoop(){if(raf||!visible()||!R)return;last=performance.now();raf=requestAnimationFrame(loop);}
  function stopLoop(){if(raf)cancelAnimationFrame(raf);raf=0;}
  let manual=false;
  function loop(now){
    raf=0;if(!visible()||!R||manual)return;
    const dt=Math.min(.1,(now-last)/1000);last=now;
    step(dt,now);
    raf=requestAnimationFrame(loop);
  }
  function step(dt,now){
    if(!dragging){
      idleT+=dt;
      const red=matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(Math.abs(vel)>.0005){rotY+=vel*dt*60;vel*=Math.pow(.92,dt*60);}
      else if(idleT>1.2&&!red)rotY+=HEROSEL.spin*dt;
    }
    if(curGrp){
      popT=Math.min(1,popT+dt/.38);const e=1-Math.pow(1-popT,3);
      curGrp.rotation.y=rotY;curGrp.scale.setScalar(.82+.18*e);curGrp.position.y=(1-e)*-.12;
    }
    const t=now/1000;lights[2].intensity=1.7+.25*Math.sin(t*9)+.12*Math.sin(t*23);lights[3].intensity=1.7+.25*Math.sin(t*8.2+1)+.12*Math.sin(t*19);
    R.render(sc,cam);rendered++;
  }
  // вращение пальцем/мышью
  let px=0,pid=null;
  stage.addEventListener('pointerdown',e=>{pid=e.pointerId;px=e.clientX;dragging=true;vel=0;try{stage.setPointerCapture(pid);}catch(x){}});
  stage.addEventListener('pointermove',e=>{if(!dragging||e.pointerId!==pid)return;const dx=e.clientX-px;px=e.clientX;rotY+=dx*HEROSEL.drag;vel=dx*HEROSEL.drag*.5;});
  const up=e=>{if(e.pointerId!==pid)return;dragging=false;idleT=0;pid=null;};
  stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',up);
  // ---------- интерфейс ----------
  function takenSet(){try{return o.taken?new Set(o.taken()):new Set();}catch(e){return new Set();}}
  function paint(){
    const tk=takenSet(),info=HEROSEL.info[cur]||{name:'Герой '+(cur+1),cls:'',txt:''};
    faces.querySelectorAll('button').forEach(b=>{const k=+b.dataset.k,t=tk.has(k)&&k!==o.current;
      b.classList.toggle('on',k===cur);b.classList.toggle('taken',t);b.classList.toggle('lock',t&&!o.swap);b.setAttribute('aria-selected',k===cur);b.tabIndex=k===cur?0:-1;
      b.title=t?(o.swap?'Занят другим местом — вы поменяетесь':'Этот герой уже занят'):'';});
    const hc=(window.HERO_CLASSES||[])[cur],HS=window.HERO_STATS||{};
    root.querySelector('.mmhn').textContent=hc?hc.cls:(info.cls||info.name);   // в заголовке — только класс (без прозвища)
    // характеристики (модификаторы к d20): +2 — золотом, −1 — приглушённо; общие для всех ♥/d4/зелье — мелкой строкой
    chips.innerHTML=hc?['str','dex','int','spi'].map(k=>{const v=hc.st[k]||0,S2=HS[k]||{s:k,i:'',n:k};return`<span class="${v>=2?'hi':v<0?'lo':''}" title="${S2.n}: ${v>0?'+':''}${v} к проверкам"><i>${S2.i}</i>${S2.s}<b>${v>0?'+':v<0?'−':''}${Math.abs(v)}</b></span>`;}).join(''):'';
    const ab=root.querySelector('.mmhabil');ab.hidden=!hc;
    if(hc){ab.querySelector('b').textContent=`${hc.ai} ${hc.an}`;ab.querySelector('span').textContent=`${hc.adP||hc.ad}.`;ab.querySelector('small').textContent=`У всех героев: ${'♥'.repeat(hp)} · шаг d4 · ✚1 зелье`;}
    layout();root.querySelector('.mmhflav').textContent=info.txt;
    const nt=root.querySelector('.mmhnote'),isT=tk.has(cur)&&cur!==o.current;
    if(isT&&o.swap){nt.hidden=false;const who=o.takenBy?o.takenBy(cur):'';nt.textContent=who?`Сейчас этот герой у места «${who}» — вы поменяетесь местами.`:'Этот герой уже у другого места — вы поменяетесь местами.';}
    else if(isT){nt.hidden=false;nt.textContent='Этого героя уже выбрал другой игрок.';}
    else nt.hidden=true;
    okb.disabled=isT&&!o.swap;
    root.classList.toggle('mmhtaken',isT);
  }
  function pick(k,center){
    if(k<0||k>=P.length)return;
    cur=k;paint();idleT=-.6;rotY=Math.round(rotY/(2*Math.PI))*2*Math.PI;vel=0;show(k);
    const b=faces.querySelector(`[data-k="${k}"]`);if(b&&center!==false){try{b.scrollIntoView({inline:'center',block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}catch(e){}}
  }
  faces.addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(b)pick(+b.dataset.k);});
  root.addEventListener('click',e=>{const b=e.target.closest('button[data-a]');if(!b)return;if(b.dataset.a==='ok'&&!b.disabled)close(cur);else if(b.dataset.a==='back')close(null);});
  const onKey=e=>{
    if(!alive)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(null);}
    else if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();pick((cur+1)%P.length);}
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();pick((cur+P.length-1)%P.length);}
    else if(e.key==='Enter'&&!(e.target&&e.target.closest&&e.target.closest('[data-a=back]'))){if(!okb.disabled){e.preventDefault();e.stopPropagation();close(cur);}}
  };
  document.addEventListener('keydown',onKey,true);
  const onVis=()=>{if(visible())startLoop();else stopLoop();};
  document.addEventListener('visibilitychange',onVis);
  const mo=new MutationObserver(onVis);mo.observe(menu,{attributes:true,attributeFilter:['hidden']});
  let rzT=0;const onRz=()=>{if(rzT)return;rzT=requestAnimationFrame(()=>{rzT=0;layout();});};
  addEventListener('resize',onRz);
  const ro=window.ResizeObserver?new ResizeObserver(onRz):null;ro&&ro.observe(mm);
  // ---------- закрытие: всё освобождается ----------
  let resolve;const p=new Promise(r=>{resolve=r;});
  function close(v){
    if(!alive)return;alive=false;stopLoop();clearTimeout(pfT);
    document.removeEventListener('keydown',onKey,true);document.removeEventListener('visibilitychange',onVis);removeEventListener('resize',onRz);
    mo.disconnect();ro&&ro.disconnect();cancelAnimationFrame(rzT);
    Object.values(cache).forEach(freeEntry);cache={};
    if(R){try{sc.traverse(o=>{if(o.isMesh&&o.material){o.geometry.dispose();if(o.material.map&&o===disc)o.material.map.dispose();o.material.dispose();}});R.dispose();const x=R.getContext&&R.getContext(),ext=x&&x.getExtension&&x.getExtension('WEBGL_lose_context');ext&&ext.loseContext();}catch(e){}R=null;}
    root.remove();menu.classList.remove('mmhero');menu.hidden=wasHidden;
    HEROSEL.live=Math.max(0,(HEROSEL.live||0)-1);busy=null;
    try{lastFocus&&lastFocus.focus&&lastFocus.focus({preventScroll:true});}catch(e){}
    resolve(v);
  }
  busy={p,refresh:()=>{if(alive)paint();},close:()=>close(null)};
  HEROSEL.live=(HEROSEL.live||0)+1;HEROSEL.opens=(HEROSEL.opens||0)+1;
  if(!init3d()){fbMode=true;cv.style.display='none';fb.hidden=false;fb.src=P[cur];spin.hidden=true;}
  paint();layout();show(cur);
  requestAnimationFrame(()=>{layout();pick(cur);okb.focus({preventScroll:true});});
  document.fonts&&document.fonts.ready&&document.fonts.ready.then(()=>alive&&layout());
  HEROSEL.manual=on=>{manual=!!on;if(on)stopLoop();else startLoop();};HEROSEL.tick=(dt,t)=>{if(R)step(dt,t*1000);};   // покадровая съёмка видео
  HEROSEL.setRot=v=>{rotY=v;vel=0;idleT=-1e9;};   // для проверки/съёмки
  HEROSEL.debug=()=>({alive,R:!!R,cur,fbMode,rendered,mem:R?R.info.memory:null,programs:R&&R.info.programs?R.info.programs.length:0});
  return p;
};
window.pickHero.refresh=()=>{if(busy)busy.refresh();};
window.pickHero.close=()=>{if(busy)busy.close();};
})();
</script>
