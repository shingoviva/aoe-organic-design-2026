import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
const info={eye:{name:'Under Eye Mask',category:'目元用シート / 60枚',description:'海藻由来の、しっとりした目元用シート。',price:'¥7,480',image:'assets/eye-front.jpg',title:['海の恵みを、','目元へそっと。']},serum:{name:'Booster Serum',category:'導入美容液 / 30 ml',description:'化粧水の前に使う、さらりとした導入美容液。',price:'¥4,995',image:'assets/serum-front.jpg',title:['うるおいの、','はじまりに。']},wash:{name:'Boost Facial Wash',category:'洗顔料 / PINK / 100 g',description:'ハトムギとクレイ。しっかりした泡で洗うケア。',price:'¥2,590',image:'assets/wash-front.jpg',title:['泡で洗う、','心地よい毎日。']}};

const canvas=q('#product-canvas'),stage=q('.object-stage'),status=q('#object-status'),fallback=q('#object-fallback');
let renderer,scene,camera,holder,activeModel,activeKey='eye',models={},loadToken=0,lidOpen=false,sheetLift=false,visible=true,dirty=true,lastTime=0,rafId=0,frameCallback=null,renderCount=0,drag=null,transition=null,contact=null,blendScene,blendCamera,blendMaterial,oldTarget,newTarget,dragTarget=null;
const reduced=()=>document.body.classList.contains('motion-off')||matchMedia('(prefers-reduced-motion: reduce)').matches;
let reflectionTarget=0,reflectionCurrent=0;
const initial={eye:[0,-.16,0],serum:[0,-.18,0],wash:[0,-.22,0]};
const closed=new Map(),loads=new Map();
const groundBounds=new THREE.Box3(),drawingSize=new THREE.Vector2();
const lidTarget=new THREE.Vector3(),patchTarget=new THREE.Vector3();
// Subtle material relief, authored as a procedural 3D surface, leaves the photographed print untouched.
function surfaceRelief(film=false){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),data=ctx.createImageData(256,256);let seed=7341;for(let y=0;y<256;y++)for(let x=0;x<256;x++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const u=x/255,v=y/255,edge=Math.pow(Math.abs(u-.5)*2,3);const value=film?128+24*edge*Math.sin(u*47+v*23)+9*Math.sin(u*19-v*31):128+(seed/4294967296-.5)*38;const i=(y*256+x)*4;data.data[i]=data.data[i+1]=data.data[i+2]=value;data.data[i+3]=255}ctx.putImageData(data,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
const liquidRelief=surfaceRelief(),filmRelief=surfaceRelief(true);
const contactStyle={eye:{width:2.7,depth:.72,opacity:.76},serum:{width:1.3,depth:.52,opacity:.64},wash:{width:1.65,depth:.42,opacity:.46}};
function requestFrame(){if(!rafId&&frameCallback&&visible&&!document.hidden)rafId=requestAnimationFrame(now=>{rafId=0;frameCallback(now)})}
function invalidate(){dirty=true;requestFrame()}

const washTypes={pink:{color:0xe9c7b9,price:'¥2,590'},blue:{color:0xdce6f2,price:'¥2,750'},yellow:{color:0xefe2bd,price:'¥2,590'}};let washType='pink',washColorTarget=new THREE.Color(washTypes.pink.color);
function setWashType(type){if(!washTypes[type])return;washType=type;washColorTarget.setHex(washTypes[type].color);qa('[data-wash-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.washColor===type)));q('#wash-type').value=type;const repaint=()=>{q('#wash-price').textContent='100 g / '+washTypes[type].price+'（税込）';if(activeKey==='wash'){q('#object-category').textContent='洗顔料 / '+type.toUpperCase()+' / 100 g';q('#object-price').textContent=washTypes[type].price;q('#dock-price').textContent=washTypes[type].price;const small=q('#dock-name small');if(small)small.textContent='100 g / '+type.toUpperCase();}};const textNodes=['#wash-price',...(activeKey==='wash'?['#object-category','#object-price','#dock-price']:[])].map(q);window.aoeTextTransition?window.aoeTextTransition(textNodes,repaint):repaint();invalidate();}
qa('[data-wash-color]').forEach(b=>b.addEventListener('click',()=>setWashType(b.dataset.washColor)));
function movable(){return activeModel?.getObjectByName({eye:'JarLid',serum:'BottleCap',wash:'WashCap'}[activeKey])}
function restore(){activeModel?.traverse(node=>{const position=closed.get(node);if(position){node.position.copy(position);node.rotation.y=0}});lidOpen=false;sheetLift=false}
function groundObject(group){group.updateMatrixWorld(true);groundBounds.setFromObject(group);group.position.y+=-1.705-groundBounds.min.y;group.updateMatrixWorld(true)}
function resetView(){dragTarget=null;if(holder){holder.rotation.set(...initial[activeKey]);holder.position.z=.55;holder.updateMatrixWorld(true);groundBounds.setFromObject(holder);holder.position.z+=1.28-groundBounds.max.z;groundObject(holder);invalidate()}}
function paintInformation(key){activeKey=key;const p=key==='wash'?{...info[key],category:'洗顔料 / '+washType.toUpperCase()+' / 100 g',price:washTypes[washType].price}:info[key];q('#home').dataset.product=key;q('#wash-colors').hidden=key!=='wash';qa('[data-object]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.object===key)));const repaint=()=>{q('#hero-title').replaceChildren(document.createTextNode(p.title[0]),document.createElement('br'));const em=document.createElement('em');em.textContent=p.title[1];q('#hero-title').append(em);for(const [id,value] of [['object-name',p.name],['object-category',p.category],['object-description',p.description],['object-price',p.price]])q('#'+id).textContent=value;q('#object-buy').href=window.aoeProducts[key].url;};if(window.aoeTextTransition)window.aoeTextTransition(['#hero-title','#object-name','#object-category','#object-description','#object-price'].map(q),repaint);else repaint();fallback.src=p.image;fallback.alt=p.name+' ご提供の実物写真';canvas.setAttribute('aria-label',p.name+'の立体モデル。ドラッグ、または左右・上下キーで回転。縦スクロールで次のセクションへ。');q('#open-lid').setAttribute('aria-label',key==='eye'?'ふたを開く':'キャップを開く');q('#open-lid').title=q('#open-lid').getAttribute('aria-label');q('#open-lid').setAttribute('aria-pressed','false');q('#lift-sheet').hidden=true;q('#lift-sheet').setAttribute('aria-pressed','false');q('#stage-caption').textContent='';window.dispatchEvent(new CustomEvent('product-selected',{detail:key}));}
async function loadModel(key){
 if(models[key])return models[key];if(loads.has(key))return loads.get(key);
 const pending=(async()=>{
  const gltf=await new GLTFLoader().loadAsync('models/'+key+'.glb'),object=gltf.scene;
  object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const scale=(key==='eye'?2.55:3.20)/Math.max(size.x,size.y,size.z);
  object.scale.setScalar(scale);object.position.set(-center.x*scale,-center.y*scale,-center.z*scale);
  object.traverse(m=>{if(m.isMesh){
   m.material=m.name.includes('Label')?new THREE.MeshPhysicalMaterial({map:m.material.map,color:m.material.color,roughness:.23,metalness:.035,side:m.material.side,clearcoat:1,clearcoatRoughness:.065}):m.material.clone();const mat=m.material;

   m.castShadow=!mat.transparent&&!m.name.includes('Label');m.receiveShadow=false;
   if(mat.map)mat.map.anisotropy=renderer.capabilities.getMaxAnisotropy();
   if(mat.metalness>.9){mat.envMapIntensity=1.30;mat.roughness=.095;mat.clearcoat=.18;mat.clearcoatRoughness=.10;}
   else if(m.name.includes('Label')){mat.roughness=.25;mat.metalness=0;mat.clearcoat=.65;mat.clearcoatRoughness=.10;mat.envMapIntensity=1.10;mat.specularIntensity=1;}
   else if(mat.isMeshPhysicalMaterial){mat.clearcoat=.85;mat.clearcoatRoughness=.08;mat.roughness=Math.min(mat.roughness,.23);mat.envMapIntensity=1.20;mat.specularIntensity=1;}
   if(m.name==='TransparentFilm'){mat.opacity=.20;mat.roughness=.075;mat.clearcoatRoughness=.06;mat.specularIntensity=1.15;mat.bumpMap=filmRelief;mat.bumpScale=.006;}
   if(m.name==='CleanserLiquid'){mat.roughness=.30;mat.clearcoat=.55;mat.clearcoatRoughness=.18;mat.envMapIntensity=.9;mat.bumpMap=liquidRelief;mat.bumpScale=.0018;}
   if(m.name==='OuterJar'){mat.roughness=.075;mat.envMapIntensity=1.35;}
   if(m.name==='BottleBody'){mat.roughness=.27;mat.clearcoat=.65;mat.clearcoatRoughness=.13;}
   if(m.name==='FrostedBase'){mat.roughness=.30;mat.clearcoat=.40;}
  }if(['JarLid','BottleCap','WashCap','HydrogelPatch'].includes(m.name))closed.set(m,m.position.clone())});
  if(key==='wash')object.getObjectByName('CleanserLiquid').material.color.copy(washColorTarget);
  // Warm shader programs before a model is shown. Other models load sequentially at idle.
  await renderer.compileAsync(object,camera,scene);models[key]=object;return object;
 })();loads.set(key,pending);try{return await pending}finally{loads.delete(key)}
}
function settleTransition(){if(!transition)return;transition.outgoing?.removeFromParent();holder.position.copy(transition.position);holder.rotation.copy(transition.rotation);holder.scale.setScalar(1);transition=null;dirty=true}
async function selectProduct(key){if(!info[key])return;const token=++loadToken;settleTransition();dragTarget=null;if(!renderer){paintInformation(key);return;}status.hidden=!!activeModel;try{const model=await loadModel(key);if(token!==loadToken)return;if(activeModel===model){restore();paintInformation(key);resetView();return}const outgoing=activeModel?holder:null;holder=new THREE.Group();scene.add(holder);activeModel=model;restore();paintInformation(key);holder.add(model);holder.userData.key=key;holder.position.set(.10,0,.55);resetView();if(outgoing&&!reduced()){blendMaterial.uniforms.progress.value=0;transition={outgoing,start:performance.now(),position:holder.position.clone(),rotation:holder.rotation.clone()}}else{outgoing?.removeFromParent();}stage.classList.add('has-product-3d');status.hidden=true;canvas.dataset.model=key;invalidate();if(Object.keys(models).length===1){const preload=async()=>{for(const next of Object.keys(info).filter(x=>x!==key)){await loadModel(next).catch(()=>{});await new Promise(r=>setTimeout(r,150));}};if(window.requestIdleCallback)requestIdleCallback(preload,{timeout:2000});else setTimeout(preload,500);}}catch(e){if(token!==loadToken)return;paintInformation(key);stage.classList.remove('has-product-3d');stage.classList.add('is-unavailable');status.hidden=false;status.textContent='実物の参照写真を表示しています。';console.warn('3D load failed',e)}}
qa('[data-object]').forEach(b=>b.addEventListener('click',()=>selectProduct(b.dataset.object)));q('#object-detail').addEventListener('click',()=>window.showProduct(activeKey));
try{
renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.94;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(24,1,.1,45);camera.position.set(.20,2.45,12.0);camera.lookAt(0,0,0);
// The same coast photograph supplies lower-hemisphere reflections; diffuse sky is the key light.
const coast=await new THREE.TextureLoader().loadAsync('assets/coastal-plate-v15.jpg');coast.colorSpace=THREE.SRGBColorSpace;
const environment=new THREE.Scene();environment.background=new THREE.Color(0xe3eef4);
const horizon=new THREE.Mesh(new THREE.PlaneGeometry(40,16),new THREE.MeshBasicMaterial({map:coast}));horizon.position.set(0,-6,-12);environment.add(horizon);const reflectedShore=horizon.clone();reflectedShore.position.set(0,-2,12);reflectedShore.rotation.y=Math.PI;environment.add(reflectedShore);const rightShore=horizon.clone();rightShore.position.set(12,-3,0);rightShore.rotation.y=-Math.PI/2;environment.add(rightShore);
const shore=new THREE.Mesh(new THREE.PlaneGeometry(45,45),new THREE.MeshBasicMaterial({map:coast,color:0x879ca5}));shore.rotation.x=-Math.PI/2;shore.position.y=-4;environment.add(shore);
const sky=new THREE.Mesh(new THREE.PlaneGeometry(28,22),new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(1.5,1.6,1.65)}));sky.position.set(-8,12,3);sky.lookAt(0,0,0);environment.add(sky);
const skyEdge=new THREE.Mesh(new THREE.PlaneGeometry(3.5,16),new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(2.3,2.4,2.5)}));skyEdge.position.set(-7,5,6);skyEdge.lookAt(0,0,0);environment.add(skyEdge);const leftShore=horizon.clone();leftShore.position.set(-12,-3,0);leftShore.rotation.y=Math.PI/2;environment.add(leftShore);
// A larger photographic reflection capture retains the shoreline detail on polished caps.
const reflectionCapture=new THREE.WebGLCubeRenderTarget(512,{type:THREE.HalfFloatType});const reflectionCamera=new THREE.CubeCamera(.1,80,reflectionCapture);reflectionCamera.update(renderer,environment);
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromCubemap(reflectionCapture.texture).texture;pmrem.dispose();reflectionCapture.dispose();const environmentGeometries=new Set(),environmentMaterials=new Set();environment.traverse(o=>{if(o.isMesh){environmentGeometries.add(o.geometry);environmentMaterials.add(o.material)}});environmentGeometries.forEach(g=>g.dispose());environmentMaterials.forEach(m=>m.dispose());coast.dispose();scene.environmentIntensity=1.08;scene.add(new THREE.HemisphereLight(0xd8e9f3,0x343e42,.78));
const key=new THREE.DirectionalLight(0xf2f4ee,2.65);key.position.set(-4,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4});key.shadow.normalBias=.012;key.shadow.bias=-.00015;key.shadow.radius=5;scene.add(key);
const fill=new THREE.DirectionalLight(0xb3cadb,.45);fill.position.set(5,3,-4);scene.add(fill);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({color:0x18242d,opacity:.35}));ground.rotation.x=-Math.PI/2;ground.position.y=-1.715;ground.receiveShadow=true;scene.add(ground);
// Real-time contact shadow anchors the model to the photographed rock, even while it turns.
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'rgba(10,22,29,.60)');gradient.addColorStop(.42,'rgba(10,22,29,.32)');gradient.addColorStop(1,'rgba(10,22,29,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
contact=new THREE.Mesh(new THREE.PlaneGeometry(2.9,2.4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,opacity:.88,depthWrite:false}));contact.rotation.x=-Math.PI/2;contact.position.set(.10,-1.708,.55);scene.add(contact);
holder=new THREE.Group();scene.add(holder);
const gl=renderer.getContext(),supportedSamples=gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES);const samples=Math.min(4,renderer.capabilities.maxSamples,...(supportedSamples.length?[Math.max(...supportedSamples)]:[0]));
oldTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples});newTarget=oldTarget.clone();blendScene=new THREE.Scene();blendCamera=new THREE.Camera();blendMaterial=new THREE.ShaderMaterial({uniforms:{oldImage:{value:oldTarget.texture},newImage:{value:newTarget.texture},progress:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:`varying vec2 vUv;uniform sampler2D oldImage;uniform sampler2D newImage;uniform float progress;void main(){vec4 a=texture2D(oldImage,vUv);vec4 b=texture2D(newImage,vUv);vec4 blended=mix(a,b,progress);gl_FragColor=vec4(blended.rgb/max(blended.a,0.0001),blended.a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
gl_FragColor.rgb*=gl_FragColor.a;}`,depthTest:false,depthWrite:false,blending:THREE.NoBlending});blendScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),blendMaterial));
function resize(){
 const width=stage.clientWidth,height=stage.clientHeight;if(!width||!height)return;
 // ResizeObserver may report the same box during browser toolbar/scroll changes.
 if(canvas.dataset.size===width+'x'+height)return;canvas.dataset.size=width+'x'+height;
 // Keep high-density edges without allocating unbounded render buffers on large displays.
 const ratio=Math.min(2.25,Math.max(1.75,devicePixelRatio||1),Math.sqrt(2200000/(width*height)));renderer.setPixelRatio(ratio);
 renderer.setSize(width,height,false);renderer.getDrawingBufferSize(drawingSize);
 oldTarget.setSize(drawingSize.x,drawingSize.y);newTarget.setSize(drawingSize.x,drawingSize.y);if(transition)transition.captured=false;
 camera.aspect=width/height;camera.updateProjectionMatrix();invalidate();
}
function contactFor(group){
 const style=contactStyle[group.userData.key];if(!style)return;
 contact.scale.set(style.width/2.9,style.depth,1);contact.material.opacity=style.opacity;
 contact.position.x=group.position.x;contact.position.z=group.position.z;
}
function renderModel(group,target){
 contactFor(group);renderer.setRenderTarget(target);renderer.render(scene,camera);
}
function present(){
 renderer.setRenderTarget(null);renderer.render(blendScene,blendCamera);renderCount++;
}
function frame(now){
 if(!visible||document.hidden)return;
 const dt=Math.min(.06,Math.max(.001,(now-lastTime)/1000));lastTime=now;let moving=false;
 // Rotate the existing photographic environment, never recapture a cube map on scroll.
 const reflectionStep=reduced()?1:1-Math.exp(-9*dt);
 const reflectionDelta=reflectionTarget-reflectionCurrent;
 if(Math.abs(reflectionDelta)>.0001){
  reflectionCurrent+=reflectionDelta*reflectionStep;
  if(Math.abs(reflectionTarget-reflectionCurrent)<.0001)reflectionCurrent=reflectionTarget;
  scene.environmentRotation.set(reflectionCurrent*.11,reflectionCurrent*.48,0);
  dirty=true;moving=Math.abs(reflectionTarget-reflectionCurrent)>.0001;
 }
 const cleanser=models.wash?.getObjectByName('CleanserLiquid');
 if(cleanser&&activeKey==='wash'&&!cleanser.material.color.equals(washColorTarget)){
  cleanser.material.color.lerp(washColorTarget,reduced()?1:1-Math.exp(-7*dt));
  if(Math.abs(cleanser.material.color.r-washColorTarget.r)+Math.abs(cleanser.material.color.g-washColorTarget.g)+Math.abs(cleanser.material.color.b-washColorTarget.b)<.0001)cleanser.material.color.copy(washColorTarget);
  dirty=true;moving=true;
 }
 if(dragTarget&&holder&&!transition){
  const amount=reduced()?1:1-Math.exp(-7*dt);
  holder.rotation.x+=(dragTarget.x-holder.rotation.x)*amount;holder.rotation.y+=(dragTarget.y-holder.rotation.y)*amount;
  const difference=Math.abs(dragTarget.x-holder.rotation.x)+Math.abs(dragTarget.y-holder.rotation.y);
  if(difference>.0005){groundObject(holder);dirty=true;moving=true}
  else{holder.rotation.x=dragTarget.x;holder.rotation.y=dragTarget.y;groundObject(holder);dirty=true;if(!drag)dragTarget=null;}
 }
 if(transition){
  const t=reduced()?1:transition.started?Math.min(1,(now-transition.start)/680):0,e=1-Math.pow(1-t,3);
  blendMaterial.uniforms.progress.value=e;
  holder.rotation.copy(transition.rotation);holder.rotation.y+=(1-e)*.16;
  // Each product stays on its calibrated ground plane throughout the change.
  holder.scale.setScalar(1);holder.position.copy(transition.position);holder.position.x+=(1-e)*.20;groundObject(holder);

  if(t>=1)settleTransition();dirty=true;moving=true;
 }
 const lid=movable();
 if(lid){lidTarget.copy(closed.get(lid));if(lidOpen){lidTarget.x+=activeKey==='eye'?.7:.4;lidTarget.y+=activeKey==='eye'?.7:.45;lidTarget.z-=.15;}
  if(lid.position.distanceTo(lidTarget)>.002){lid.position.lerp(lidTarget,reduced()?1:1-Math.exp(-10*dt));dirty=true;moving=true}
  else lid.position.copy(lidTarget);
 }
 const patch=activeModel?.getObjectByName('HydrogelPatch');
 if(patch){patchTarget.copy(closed.get(patch));if(sheetLift){patchTarget.x-=.28;patchTarget.y+=.85;patchTarget.z+=.30;}
  if(patch.position.distanceTo(patchTarget)>.002){patch.position.lerp(patchTarget,reduced()?1:1-Math.exp(-10*dt));dirty=true;moving=true}
  else patch.position.copy(patchTarget);
 }
 if(dirty&&activeModel){
  if(transition){
   // Capture the old object once. During the dissolve only the incoming scene is drawn.
   if(!transition.captured){holder.visible=false;transition.outgoing.visible=true;renderModel(transition.outgoing,oldTarget);holder.visible=true;transition.captured=true;}if(!transition.started){transition.start=now;transition.started=true;}
   transition.outgoing.visible=false;renderModel(holder,newTarget);transition.outgoing.visible=true;
  }else{blendMaterial.uniforms.progress.value=1;renderModel(holder,newTarget)}
  // Static and transitional frames use this same linear-light, premultiplied-alpha path.
  present();dirty=false;
 }
 if(moving||(dirty&&activeModel))requestFrame();
}
frameCallback=frame;resize();new ResizeObserver(resize).observe(stage);
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible){lastTime=0;invalidate()}else if(rafId){cancelAnimationFrame(rafId);rafId=0}},{rootMargin:'0px'}).observe(stage);
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(rafId);rafId=0}else invalidate()});
const updateScrollReflection=()=>{
 // Bounded world-space drift: scroll changes the reflected viewing environment.
 reflectionTarget=Math.max(0,Math.min(1,window.scrollY/Math.max(innerHeight,1)));
 if(visible&&!document.hidden)invalidate();
};
window.addEventListener('scroll',updateScrollReflection,{passive:true});
window.addEventListener('resize',updateScrollReflection,{passive:true});
updateScrollReflection();
window.addEventListener('motion-changed',invalidate);selectProduct('eye');

}catch(e){renderer=null;stage.classList.add('is-unavailable');status.textContent='実物の参照写真を表示しています。';qa('.object-tools button').forEach(b=>b.disabled=true);console.warn('WebGL unavailable')}
// Lock the document for the entire touch gesture, including Safari rubber-band scrolling.
let pageTouchLock=null;
function unlockTouchPage(){if(!pageTouchLock)return;const saved=pageTouchLock;pageTouchLock=null;document.body.style.cssText=saved.body;document.documentElement.style.cssText=saved.html;const behavior=document.documentElement.style.scrollBehavior;document.documentElement.style.scrollBehavior='auto';window.scrollTo(saved.x,saved.y);document.documentElement.style.scrollBehavior=behavior;}
document.addEventListener('touchstart',e=>{if(!stage.contains(e.target)||e.target.closest('button,a')||pageTouchLock)return;pageTouchLock={x:scrollX,y:scrollY,body:document.body.style.cssText,html:document.documentElement.style.cssText};document.documentElement.style.overflow='hidden';Object.assign(document.body.style,{position:'fixed',top:-pageTouchLock.y+'px',left:-pageTouchLock.x+'px',width:'100%',overflow:'hidden'});},{capture:true,passive:false});
document.addEventListener('touchmove',e=>{if(pageTouchLock&&e.cancelable)e.preventDefault()},{capture:true,passive:false});
for(const name of ['touchend','touchcancel'])document.addEventListener(name,e=>{if(!e.touches.length)unlockTouchPage()},{capture:true,passive:true});
window.addEventListener('blur',unlockTouchPage);
// Touch gestures on the model belong to rotation; the surrounding page remains scrollable.
canvas.style.touchAction='none';
canvas.addEventListener('touchmove',e=>{if(activeModel&&e.cancelable)e.preventDefault()},{passive:false});
canvas.addEventListener('pointerdown',e=>{if(!activeModel||e.button!==0||!e.isPrimary)return;e.preventDefault();settleTransition();stage.classList.add('has-been-touched');dragTarget={x:holder.rotation.x,y:holder.rotation.y};drag={id:e.pointerId,lastX:e.clientX,lastY:e.clientY};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();dragTarget.y+=(e.clientX-drag.lastX)*.0042;dragTarget.x=THREE.MathUtils.clamp(dragTarget.x+(e.clientY-drag.lastY)*.0030,-.70,.70);drag.lastX=e.clientX;drag.lastY=e.clientY;invalidate()});
for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(drag?.id===e.pointerId)drag=null});
canvas.addEventListener('keydown',e=>{if(!holder)return;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home')resetView();else if(e.key==='ArrowLeft'||e.key==='ArrowRight')holder.rotation.y+=e.key==='ArrowLeft'?-.18:.18;else holder.rotation.x=THREE.MathUtils.clamp(holder.rotation.x+(e.key==='ArrowUp'?-.12:.12),-.75,.75);groundObject(holder);invalidate()});
q('#reset-object').addEventListener('click',()=>{restore();resetView();q('#open-lid').setAttribute('aria-pressed','false');q('#open-lid').setAttribute('aria-label',activeKey==='eye'?'ふたを開く':'キャップを開く');q('#lift-sheet').hidden=true});
q('#open-lid').addEventListener('click',()=>{if(!activeModel)return;settleTransition();lidOpen=!lidOpen;if(!lidOpen)sheetLift=false;q('#open-lid').setAttribute('aria-pressed',String(lidOpen));q('#open-lid').setAttribute('aria-label',lidOpen?'ふたを閉じる':activeKey==='eye'?'ふたを開く':'キャップを開く');q('#open-lid').title=q('#open-lid').getAttribute('aria-label');q('#lift-sheet').hidden=!lidOpen||activeKey!=='eye';groundObject(holder);invalidate()});
q('#lift-sheet').addEventListener('click',()=>{sheetLift=!sheetLift;q('#lift-sheet').setAttribute('aria-pressed',String(sheetLift));q('#lift-sheet').setAttribute('aria-label',sheetLift?'シートを戻す':'シートを見る');groundObject(holder);invalidate()});
canvas.addEventListener('webglcontextlost',()=>{stage.classList.remove('has-product-3d');stage.classList.add('is-unavailable');status.hidden=false;status.textContent='実物の参照写真を表示しています。'});
window.product3D={select:selectProduct,setWashType,state:()=>({key:activeKey,washType,washColor:models.wash?.getObjectByName('CleanserLiquid').material.color.getHexString(),loaded:!!activeModel,meshes:(()=>{let n=0;activeModel?.traverse(o=>{if(o.isMesh)n++});return n})(),camera:camera?.position.toArray(),fov:camera?.fov,reflectionRotation:scene?.environmentRotation.toArray(),reflectionTarget,transitionProgress:transition?blendMaterial?.uniforms.progress.value:1,renderCount,scheduled:!!rafId,visible,ground:holder?new THREE.Box3().setFromObject(holder).min.y:null,anchor:holder?.position.toArray(),interaction:true,rotation:holder?.rotation.y,rotationXYZ:holder?.rotation.toArray(),lid:lidOpen,sheet:sheetLift,view:'3d',transitioning:!!transition,quality:{pixelRatio:renderer?.getPixelRatio(),samples:newTarget?.samples,buffer:[newTarget?.width,newTarget?.height],reflectionSize:512},modelFiles:Object.keys(models)}),render:invalidate};
