/* NutriTrack App - Main Logic (uses auth.js globals: db, currentUser, userSettings, etc.) */
const APP = { targets: { calories: 2200, protein: 180, fat: 70, carbs: 220 }, currentDate: new Date(), activeTab: 'today' };

function buildSystemPrompt() {
  return 'You are an advanced nutrition intelligence engine. Parse natural language food input and estimate nutrition.\nRULES: Identify each food. Estimate quantity (default=standard portion). Detect hidden calories (oil, butter, sugar, fried). Assume oil in Indian cooking, sugar in tea/coffee unless stated. For each item: calories, protein_g, fat_g, carbs_g, fiber_g. Use realistic Indian/global averages. Slightly conservative (overestimate). No decimals. Split multiple items.\nReturn ONLY valid JSON: {\"foods\":[{\"name\":\"string\",\"calories\":num,\"protein_g\":num,\"fat_g\":num,\"carbs_g\":num,\"fiber_g\":num}],\"reply\":\"1-2 line message with total kcal + macro insight. Clean, helpful.\"}\nIf unclear, best guess. NEVER ask questions. NEVER fail. JSON ONLY.';
}

function fmtKey(d) { return d.toISOString().split('T')[0]; }
function fmtLabel(d) {
  const t = new Date(), y = new Date(t), tm = new Date(t);
  y.setDate(t.getDate()-1); tm.setDate(t.getDate()+1);
  if (fmtKey(d)===fmtKey(t)) return 'Today';
  if (fmtKey(d)===fmtKey(y)) return 'Yesterday';
  if (fmtKey(d)===fmtKey(tm)) return 'Tomorrow';
  return d.toLocaleDateString('en-IN',{weekday:'short',month:'short',day:'numeric'});
}
function getDayName(d) { return new Date(d).toLocaleDateString('en-IN',{weekday:'short'}); }
function getDateRange(days) { const e=new Date(),s=new Date(); s.setDate(e.getDate()-days+1); return {start:fmtKey(s),end:fmtKey(e)}; }

async function fetchLogs(date) {
  if (!currentUser) return [];
  const {data,error}=await db.from('food_logs').select('*').eq('date',fmtKey(date)).eq('user_id',currentUser.id).order('created_at',{ascending:true});
  if(error){console.error(error);return[];} return data||[];
}
async function insertLogs(foods,date) {
  const rows=foods.map(f=>({date:fmtKey(date),name:f.name,calories:f.calories,protein_g:f.protein_g,fat_g:f.fat_g,carbs_g:f.carbs_g,fiber_g:f.fiber_g||0,user_id:currentUser.id}));
  const {error}=await db.from('food_logs').insert(rows); if(error)console.error(error);
}
async function deleteLog(id){const{error}=await db.from('food_logs').delete().eq('id',id);if(error)console.error(error);}
async function updateLog(id,u){const{error}=await db.from('food_logs').update(u).eq('id',id);if(error)console.error(error);}
async function fetchRange(s,e){
  if(!currentUser)return[];
  const{data,error}=await db.from('food_logs').select('*').eq('user_id',currentUser.id).gte('date',s).lte('date',e).order('date',{ascending:true});
  if(error){console.error(error);return[];}return data||[];
}

function getEmoji(name){const n=name.toLowerCase();const m=[[['rice','biryani','pulao','khichdi'],'🍚'],[['chicken','murgh'],'🍗'],[['egg','anda','omelette'],'🥚'],[['roti','chapati','naan','paratha','bread'],'🫓'],[['dosa','idli'],'🥞'],[['samosa','pakora','vada'],'🥟'],[['dal','lentil','rajma','chole'],'🍲'],[['paneer','cheese','tofu'],'🧀'],[['milk','lassi','curd','yogurt'],'🥛'],[['tea','chai','coffee'],'☕'],[['coke','pepsi','soda','juice'],'🥤'],[['pizza'],'🍕'],[['burger'],'🍔'],[['pasta','noodle','maggi'],'🍝'],[['sandwich','wrap'],'🥪'],[['salad','sabzi','vegetable'],'🥗'],[['fruit','apple','banana','mango'],'🍎'],[['fish','machhi'],'🐟'],[['mutton','lamb','meat'],'🥩'],[['sweet','halwa','dessert','cake'],'🍰'],[['poha','upma','curry'],'🍛'],[['protein','shake','whey'],'🥤']];for(const[kw,e]of m){if(kw.some(k=>n.includes(k)))return e;}return '🍽️';}

function totals(entries){return entries.reduce((a,i)=>({calories:a.calories+(i.calories||0),protein:a.protein+(i.protein_g||0),fat:a.fat+(i.fat_g||0),carbs:a.carbs+(i.carbs_g||0)}),{calories:0,protein:0,fat:0,carbs:0});}

function updateRing(t){
  const pct=Math.min(t.calories/APP.targets.calories,1),circ=2*Math.PI*88,off=circ*(1-pct);
  const rp=document.getElementById('ringProgress');rp.style.strokeDasharray=circ;rp.style.strokeDashoffset=off;
  const g=document.getElementById('ringGradient');
  if(pct<0.7){g.children[0].setAttribute('stop-color','#38bd94');g.children[1].setAttribute('stop-color','#2dd4bf');}
  else if(pct<0.9){g.children[0].setAttribute('stop-color','#fbbf24');g.children[1].setAttribute('stop-color','#fb923c');}
  else{g.children[0].setAttribute('stop-color','#f87171');g.children[1].setAttribute('stop-color','#ef4444');}
  document.getElementById('caloriesEaten').textContent=t.calories;
  document.getElementById('caloriesRemaining').innerHTML='<span>'+Math.max(APP.targets.calories-t.calories,0)+'</span> kcal remaining';
}

function updateBars(t){['protein','fat','carbs'].forEach(m=>{const pct=Math.min((t[m]/APP.targets[m])*100,100);document.getElementById(m+'Fill').style.width=pct+'%';document.getElementById(m+'Value').innerHTML=Math.round(t[m])+'g <span>/ '+APP.targets[m]+'g</span>';});}

function renderLog(entries){
  const c=document.getElementById('foodLog'),cnt=document.getElementById('logCount');
  if(!entries.length){c.innerHTML='<div class="empty-state"><div class="empty-icon">🍽️</div><div class="empty-text">No food logged yet</div><div class="empty-hint">Type what you ate to get started</div></div>';cnt.textContent='0 items';return;}
  cnt.textContent=entries.length+' item'+(entries.length>1?'s':'');
  c.innerHTML=entries.map(i=>{const isFav=isFavorite(i.name);return '<div class="food-card"><div class="food-card-header"><div class="food-name">'+getEmoji(i.name)+' '+i.name+'</div><div class="food-calories">'+i.calories+' kcal <button class="fav-star-btn '+(isFav?'is-fav':'')+'" onclick="toggleFavFromCard(\''+i.name.replace(/'/g,"\\\'")+'\','+i.calories+','+i.protein_g+','+i.fat_g+','+i.carbs_g+','+(i.fiber_g||0)+',this)" title="'+(isFav?'Remove from favorites':'Add to favorites')+'">★</button><button class="edit-btn" onclick="showEditModal(\''+i.id+'\',\''+i.name.replace(/'/g,"\\\'")+'\','+i.calories+','+i.protein_g+','+i.fat_g+','+i.carbs_g+','+(i.fiber_g||0)+')" title="Edit">✎</button><button class="delete-btn" onclick="delEntry(\''+i.id+'\')" title="Remove">✕</button></div></div><div class="food-macros"><div class="food-macro p">P: <span>'+i.protein_g+'g</span></div><div class="food-macro f">F: <span>'+i.fat_g+'g</span></div><div class="food-macro c">C: <span>'+i.carbs_g+'g</span></div>'+(i.fiber_g?'<div class="food-macro">Fiber: '+i.fiber_g+'g</div>':'')+'</div></div>';}).join('');
}

async function refreshToday(){const entries=await fetchLogs(APP.currentDate);const t=totals(entries);updateRing(t);updateBars(t);renderLog(entries);document.getElementById('dateLabel').textContent=fmtLabel(APP.currentDate);}

async function loadWeekStats(){
  const{start,end}=getDateRange(7);const data=await fetchRange(start,end);const byDay={};
  for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()-6+i);byDay[fmtKey(d)]=[];}
  data.forEach(r=>{if(byDay[r.date])byDay[r.date].push(r);});
  const days=Object.keys(byDay).sort();const dayTotals=days.map(d=>({date:d,...totals(byDay[d]),count:byDay[d].length}));
  const logged=dayTotals.filter(d=>d.count>0);const avgCal=logged.length?Math.round(logged.reduce((s,d)=>s+d.calories,0)/logged.length):0;
  const avgPro=logged.length?Math.round(logged.reduce((s,d)=>s+d.protein,0)/logged.length):0;
  const inTarget=logged.filter(d=>d.calories<=APP.targets.calories).length;const maxCal=Math.max(...dayTotals.map(d=>d.calories),APP.targets.calories);
  document.getElementById('weekContent').innerHTML='<div class="stats-grid"><div class="stat-card accent"><div class="stat-card-label">Avg Calories</div><div class="stat-card-value">'+avgCal+'</div><div class="stat-card-unit">kcal / day</div></div><div class="stat-card"><div class="stat-card-label">Avg Protein</div><div class="stat-card-value">'+avgPro+'</div><div class="stat-card-unit">g / day</div></div><div class="stat-card"><div class="stat-card-label">Days Logged</div><div class="stat-card-value">'+logged.length+'</div><div class="stat-card-unit">of 7 days</div></div><div class="stat-card"><div class="stat-card-label">In Target</div><div class="stat-card-value">'+inTarget+'</div><div class="stat-card-unit">days ≤ '+APP.targets.calories+'</div></div></div><div class="bar-chart-section"><div class="bar-chart-title">Daily Calories</div><div class="bar-chart">'+dayTotals.map(d=>{const h=d.calories>0?Math.max((d.calories/maxCal)*100,5):3;const cls=d.calories>APP.targets.calories?'over-target':(d.count===0?'no-data':'');return '<div class="bar-col"><div class="bar-value">'+(d.count>0?d.calories:'-')+'</div><div class="bar-fill '+cls+'" style="height:'+h+'%"></div><div class="bar-label">'+getDayName(d.date)+'</div></div>';}).join('')+'</div></div>';
}

async function loadMonthStats(){
  const{start,end}=getDateRange(30);const data=await fetchRange(start,end);const byDay={};
  for(let i=0;i<30;i++){const d=new Date();d.setDate(d.getDate()-29+i);byDay[fmtKey(d)]=[];}
  data.forEach(r=>{if(byDay[r.date])byDay[r.date].push(r);});
  const days=Object.keys(byDay).sort();const dayTotals=days.map(d=>({date:d,...totals(byDay[d]),count:byDay[d].length}));
  const logged=dayTotals.filter(d=>d.count>0);const avgCal=logged.length?Math.round(logged.reduce((s,d)=>s+d.calories,0)/logged.length):0;
  const avgPro=logged.length?Math.round(logged.reduce((s,d)=>s+d.protein,0)/logged.length):0;
  let streak=0;for(let i=dayTotals.length-1;i>=0;i--){if(dayTotals[i].count>0)streak++;else break;}
  const compPct=logged.length?Math.round((logged.filter(d=>d.calories<=APP.targets.calories).length/logged.length)*100):0;
  document.getElementById('monthContent').innerHTML='<div class="stats-grid"><div class="stat-card accent"><div class="stat-card-label">Avg Calories</div><div class="stat-card-value">'+avgCal+'</div><div class="stat-card-unit">kcal / day</div></div><div class="stat-card"><div class="stat-card-label">Avg Protein</div><div class="stat-card-value">'+avgPro+'</div><div class="stat-card-unit">g / day</div></div><div class="stat-card"><div class="stat-card-label">Days Logged</div><div class="stat-card-value">'+logged.length+'</div><div class="stat-card-unit">of 30 days</div></div><div class="stat-card"><div class="stat-card-label">Streak</div><div class="stat-card-value">'+streak+'</div><div class="stat-card-unit">consecutive days</div></div></div><div class="compliance-bar"><div class="compliance-label"><span>Target Compliance</span><span>'+compPct+'%</span></div><div class="compliance-track"><div class="compliance-fill" style="width:'+compPct+'%"></div></div></div>';
}

async function delEntry(id){await deleteLog(id);await refreshToday();}
function navigateDate(delta){APP.currentDate.setDate(APP.currentDate.getDate()+delta);refreshToday();}

async function handleSubmit(){
  const input=document.getElementById('foodInput'),text=input.value.trim();if(!text)return;
  const btn=document.getElementById('submitBtn'),reply=document.getElementById('aiReply');
  btn.disabled=true;btn.innerHTML='<div class="spinner"></div>';reply.classList.remove('visible');
  try{const result=await queryAI(text,buildSystemPrompt());if(result.foods&&result.foods.length){await insertLogs(result.foods,APP.currentDate);await refreshToday();input.value='';}if(result.reply){reply.textContent=result.reply;reply.classList.add('visible');}}
  catch(err){reply.textContent='Error: '+err.message;reply.classList.add('visible');}
  finally{btn.disabled=false;btn.innerHTML='→';}
}

function switchTab(tab){APP.activeTab=tab;document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-content').forEach(c=>c.classList.toggle('active',c.id==='tab-'+tab));if(tab==='week')loadWeekStats();if(tab==='month')loadMonthStats();}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('visible');setTimeout(()=>t.classList.remove('visible'),3000);}

function showEditModal(id,name,cal,pro,fat,carbs,fiber){document.getElementById('editFoodId').value=id;document.getElementById('editFoodName').value=name;document.getElementById('editCalories').value=cal;document.getElementById('editProtein').value=pro;document.getElementById('editFat').value=fat;document.getElementById('editCarbs').value=carbs;document.getElementById('editFiber').value=fiber;document.getElementById('editModal').classList.add('visible');}
function hideEditModal(){document.getElementById('editModal').classList.remove('visible');}
async function saveEditFood(){const id=document.getElementById('editFoodId').value,name=document.getElementById('editFoodName').value.trim(),cal=parseInt(document.getElementById('editCalories').value)||0,pro=parseInt(document.getElementById('editProtein').value)||0,fat=parseInt(document.getElementById('editFat').value)||0,carbs=parseInt(document.getElementById('editCarbs').value)||0,fiber=parseInt(document.getElementById('editFiber').value)||0;if(!name)return;await updateLog(id,{name,calories:cal,protein_g:pro,fat_g:fat,carbs_g:carbs,fiber_g:fiber});hideEditModal();await refreshToday();showToast('✅ Macros updated');}

function showAddModal(){['addFoodName','addCalories','addProtein','addFat','addCarbs','addFiber'].forEach(id=>document.getElementById(id).value='');document.getElementById('addModal').classList.add('visible');}
function hideAddModal(){document.getElementById('addModal').classList.remove('visible');}
async function saveAddFood(){const name=document.getElementById('addFoodName').value.trim();if(!name)return;await insertLogs([{name,calories:parseInt(document.getElementById('addCalories').value)||0,protein_g:parseInt(document.getElementById('addProtein').value)||0,fat_g:parseInt(document.getElementById('addFat').value)||0,carbs_g:parseInt(document.getElementById('addCarbs').value)||0,fiber_g:parseInt(document.getElementById('addFiber').value)||0}],APP.currentDate);hideAddModal();await refreshToday();showToast('✅ Food added');}

function getFavorites(){try{return JSON.parse(localStorage.getItem('nutritrack_fav_'+(currentUser?currentUser.id:''))||'[]');}catch{return[];}}
function saveFavorites(f){localStorage.setItem('nutritrack_fav_'+(currentUser?currentUser.id:''),JSON.stringify(f));}
function isFavorite(name){return getFavorites().some(f=>f.name.toLowerCase()===name.toLowerCase());}
function addFavorite(item){const f=getFavorites();if(f.some(x=>x.name.toLowerCase()===item.name.toLowerCase()))return false;f.push(item);saveFavorites(f);return true;}
function removeFavorite(name){saveFavorites(getFavorites().filter(f=>f.name.toLowerCase()!==name.toLowerCase()));}

function renderFavDropdown(){const list=document.getElementById('favList'),favs=getFavorites();if(!favs.length){list.innerHTML='<div class="fav-empty">No favorites yet.</div>';return;}list.innerHTML=favs.map((f,i)=>'<div class="fav-item"><div class="fav-item-info"><div class="fav-item-name">'+getEmoji(f.name)+' '+f.name+'</div><div class="fav-item-macros"><span class="cal">'+f.calories+' kcal</span> <span class="p">P:'+f.protein_g+'g</span> <span class="f">F:'+f.fat_g+'g</span> <span class="c">C:'+f.carbs_g+'g</span></div></div><div class="fav-item-actions"><button class="fav-log-btn" onclick="logFavorite('+i+')">+ Log</button><button class="fav-remove-btn" onclick="deleteFavorite('+i+')">&times;</button></div></div>').join('');}

function toggleFavDropdown(){const dd=document.getElementById('favDropdown'),btn=document.getElementById('favToggleBtn');if(dd.classList.contains('visible')){dd.classList.remove('visible');btn.classList.remove('active');}else{renderFavDropdown();dd.classList.add('visible');btn.classList.add('active');}}
function closeFavDropdown(){document.getElementById('favDropdown').classList.remove('visible');document.getElementById('favToggleBtn').classList.remove('active');}

function toggleFavFromCard(name,cal,pro,fat,carbs,fiber,btn){if(isFavorite(name)){removeFavorite(name);btn.classList.remove('is-fav');showToast('Removed from favorites');}else{addFavorite({name,calories:cal,protein_g:pro,fat_g:fat,carbs_g:carbs,fiber_g:fiber});btn.classList.add('is-fav');showToast('⭐ Added to favorites');}renderFavDropdown();}
async function logFavorite(i){const f=getFavorites()[i];if(!f)return;await insertLogs([{name:f.name,calories:f.calories,protein_g:f.protein_g,fat_g:f.fat_g,carbs_g:f.carbs_g,fiber_g:f.fiber_g}],APP.currentDate);await refreshToday();showToast('✅ Logged '+f.name);}
function deleteFavorite(i){const f=getFavorites();f.splice(i,1);saveFavorites(f);renderFavDropdown();refreshToday();showToast('Removed from favorites');}

function showFavModal(){closeFavDropdown();['favFoodName','favCalories','favProtein','favFat','favCarbs','favFiber'].forEach(id=>document.getElementById(id).value='');document.getElementById('favModal').classList.add('visible');}
function hideFavModal(){document.getElementById('favModal').classList.remove('visible');}
function saveFavFromModal(){const name=document.getElementById('favFoodName').value.trim();if(!name)return;const added=addFavorite({name,calories:parseInt(document.getElementById('favCalories').value)||0,protein_g:parseInt(document.getElementById('favProtein').value)||0,fat_g:parseInt(document.getElementById('favFat').value)||0,carbs_g:parseInt(document.getElementById('favCarbs').value)||0,fiber_g:parseInt(document.getElementById('favFiber').value)||0});if(!added){showToast('Already in favorites');return;}hideFavModal();renderFavDropdown();showToast('⭐ Saved to favorites');}

/* ─── SETTINGS ─── */
let settingsProvider = 'openai';

function showSettingsModal(){
  settingsProvider = userSettings?.ai_provider || 'openai';
  document.getElementById('settCalories').value = APP.targets.calories;
  document.getElementById('settProtein').value = APP.targets.protein;
  document.getElementById('settFat').value = APP.targets.fat;
  document.getElementById('settCarbs').value = APP.targets.carbs;
  document.getElementById('settApiKey').value = userSettings?.api_key || '';
  updateSettingsProvider(settingsProvider);
  document.getElementById('settingsModal').classList.add('visible');
}

function updateSettingsProvider(p){
  settingsProvider = p;
  document.getElementById('settProvOpenai').classList.toggle('active', p==='openai');
  document.getElementById('settProvGemini').classList.toggle('active', p==='gemini');
  const hint = document.getElementById('settApiHint');
  if(p==='gemini') hint.innerHTML='Get a key at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com</a>';
  else hint.innerHTML='Get a key at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>';
}

async function saveSettings(){
  const s = {
    calorie_goal: parseInt(document.getElementById('settCalories').value)||2200,
    protein_goal: parseInt(document.getElementById('settProtein').value)||180,
    fat_goal: parseInt(document.getElementById('settFat').value)||70,
    carbs_goal: parseInt(document.getElementById('settCarbs').value)||220,
    ai_provider: settingsProvider,
    api_key: document.getElementById('settApiKey').value.trim(),
  };
  await saveUserSettings(currentUser.id, s);
  userSettings = {...userSettings, ...s};
  APP.targets = {calories:s.calorie_goal, protein:s.protein_goal, fat:s.fat_goal, carbs:s.carbs_goal};
  document.getElementById('settingsModal').classList.remove('visible');
  showToast('✅ Settings saved');
  refreshToday();
}

/* ─── LOGIN / LOGOUT ─── */
async function handleLogin(){
  const un=document.getElementById('loginUsername').value.trim();
  const pw=document.getElementById('loginPassword').value;
  const err=document.getElementById('loginError');
  if(!un||!pw){err.textContent='Enter username and password';return;}
  err.textContent='Signing in...';
  const result=await attemptLogin(un,pw);
  if(!result.ok){err.textContent=result.msg;return;}
  currentUser=result.user;
  saveSession(currentUser);
  await initApp();
}

function handleLogout(){
  clearSession();
  document.getElementById('appContainer').style.display='none';
  document.getElementById('loginOverlay').style.display='flex';
  document.getElementById('loginUsername').value='';
  document.getElementById('loginPassword').value='';
  document.getElementById('loginError').textContent='';
}

async function initApp(){
  userSettings = await loadUserSettings(currentUser.id);
  APP.targets = {calories:userSettings.calorie_goal||2200, protein:userSettings.protein_goal||180, fat:userSettings.fat_goal||70, carbs:userSettings.carbs_goal||220};
  document.getElementById('userGreeting').textContent='Hi, '+(currentUser.display_name||currentUser.username);
  document.getElementById('loginOverlay').style.display='none';
  document.getElementById('appContainer').style.display='block';
  refreshToday().catch(e=>console.error(e));
}

/* ─── PHOTO SCANNING ─── */
function isMobileDevice() {
  return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

let webcamStream = null;
let photoAbortController = null;

function showCameraDropdown() {
  const dd = document.getElementById('cameraDropdown');
  dd.classList.add('visible');
}

function hideCameraDropdown() {
  document.getElementById('cameraDropdown').classList.remove('visible');
}

function handleCameraClick() {
  if (isMobileDevice()) {
    // Mobile: directly open camera
    document.getElementById('fileInputMobile').click();
  } else {
    // Desktop: show dropdown
    const dd = document.getElementById('cameraDropdown');
    if (dd.classList.contains('visible')) {
      hideCameraDropdown();
    } else {
      showCameraDropdown();
    }
  }
}

function showPhotoPreview(dataUrl, analyzing) {
  const preview = document.getElementById('photoPreview');
  const img = document.getElementById('photoPreviewImg');
  const label = preview.querySelector('.photo-preview-label');
  const spinner = preview.querySelector('.photo-preview-spinner');
  img.src = dataUrl;
  if (analyzing) {
    label.textContent = 'Analyzing food...';
    label.classList.remove('done');
    spinner.style.display = 'block';
  } else {
    label.textContent = '✅ Food detected!';
    label.classList.add('done');
    spinner.style.display = 'none';
  }
  preview.style.display = 'block';
}

function hidePhotoPreview() {
  const preview = document.getElementById('photoPreview');
  preview.style.display = 'none';
  document.getElementById('photoPreviewImg').src = '';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, dataUrl, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handlePhotoCapture(file) {
  if (!file) return;
  hideCameraDropdown();
  const reply = document.getElementById('aiReply');
  reply.classList.remove('visible');

  try {
    const { base64, dataUrl, mimeType } = await fileToBase64(file);
    showPhotoPreview(dataUrl, true);

    const result = await queryAIVision(base64, mimeType, buildSystemPrompt());
    if (result.foods && result.foods.length) {
      await insertLogs(result.foods, APP.currentDate);
      await refreshToday();
      showPhotoPreview(dataUrl, false);
      setTimeout(hidePhotoPreview, 2500);
    } else {
      showPhotoPreview(dataUrl, false);
      setTimeout(hidePhotoPreview, 2500);
    }
    if (result.reply) {
      reply.textContent = result.reply;
      reply.classList.add('visible');
    }
  } catch (err) {
    hidePhotoPreview();
    reply.textContent = 'Error: ' + err.message;
    reply.classList.add('visible');
  }

  // Reset file inputs
  document.getElementById('fileInputMobile').value = '';
  document.getElementById('fileInputDesktop').value = '';
}

async function openWebcamModal() {
  hideCameraDropdown();
  const modal = document.getElementById('webcamModal');
  const video = document.getElementById('webcamVideo');

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    video.srcObject = webcamStream;
    modal.classList.add('visible');
  } catch (err) {
    showToast('📷 Camera access denied or unavailable');
    console.error('Webcam error:', err);
  }
}

function closeWebcamModal() {
  const modal = document.getElementById('webcamModal');
  const video = document.getElementById('webcamVideo');
  modal.classList.remove('visible');

  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  video.srcObject = null;
}

function captureWebcam() {
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('webcamCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  closeWebcamModal();

  canvas.toBlob((blob) => {
    if (blob) {
      const file = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' });
      handlePhotoCapture(file);
    }
  }, 'image/jpeg', 0.85);
}

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', () => {
  // Login
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin();});
  document.getElementById('loginUsername').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('loginPassword').focus();});
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // Main app
  document.getElementById('submitBtn').addEventListener('click', handleSubmit);
  document.getElementById('foodInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit();}});
  document.getElementById('prevDay').addEventListener('click',()=>navigateDate(-1));
  document.getElementById('nextDay').addEventListener('click',()=>navigateDate(1));
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', showSettingsModal);
  document.getElementById('settSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('settCancelBtn').addEventListener('click',()=>document.getElementById('settingsModal').classList.remove('visible'));
  document.getElementById('settingsModal').addEventListener('click',e=>{if(e.target===e.currentTarget)document.getElementById('settingsModal').classList.remove('visible');});
  document.getElementById('settProvOpenai').addEventListener('click',()=>updateSettingsProvider('openai'));
  document.getElementById('settProvGemini').addEventListener('click',()=>updateSettingsProvider('gemini'));

  // Edit modal
  document.getElementById('editSaveBtn').addEventListener('click', saveEditFood);
  document.getElementById('editCancelBtn').addEventListener('click', hideEditModal);
  document.getElementById('editModal').addEventListener('click',e=>{if(e.target===e.currentTarget)hideEditModal();});

  // Add modal
  document.getElementById('manualAddBtn').addEventListener('click', showAddModal);
  document.getElementById('addSaveBtn').addEventListener('click', saveAddFood);
  document.getElementById('addCancelBtn').addEventListener('click', hideAddModal);
  document.getElementById('addModal').addEventListener('click',e=>{if(e.target===e.currentTarget)hideAddModal();});

  // Favorites
  document.getElementById('favToggleBtn').addEventListener('click',e=>{e.stopPropagation();toggleFavDropdown();});
  document.getElementById('favAddNewBtn').addEventListener('click',e=>{e.stopPropagation();showFavModal();});
  document.addEventListener('click',e=>{const w=document.querySelector('.fav-dropdown-wrapper');if(w&&!w.contains(e.target))closeFavDropdown();});
  document.getElementById('favSaveBtn').addEventListener('click', saveFavFromModal);
  document.getElementById('favCancelBtn').addEventListener('click', hideFavModal);
  document.getElementById('favModal').addEventListener('click',e=>{if(e.target===e.currentTarget)hideFavModal();});

  // ─── Camera / Photo Scanning ───
  document.getElementById('cameraBtn').addEventListener('click', e => {
    e.stopPropagation();
    handleCameraClick();
  });

  // Desktop dropdown items
  document.getElementById('camTakePhoto').addEventListener('click', e => {
    e.stopPropagation();
    openWebcamModal();
  });
  document.getElementById('camUploadFile').addEventListener('click', e => {
    e.stopPropagation();
    hideCameraDropdown();
    document.getElementById('fileInputDesktop').click();
  });

  // File input handlers
  document.getElementById('fileInputMobile').addEventListener('change', e => {
    if (e.target.files[0]) handlePhotoCapture(e.target.files[0]);
  });
  document.getElementById('fileInputDesktop').addEventListener('change', e => {
    if (e.target.files[0]) handlePhotoCapture(e.target.files[0]);
  });

  // Photo preview close
  document.getElementById('photoPreviewClose').addEventListener('click', hidePhotoPreview);

  // Webcam modal
  document.getElementById('webcamCaptureBtn').addEventListener('click', captureWebcam);
  document.getElementById('webcamCancelBtn').addEventListener('click', closeWebcamModal);
  document.getElementById('webcamModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeWebcamModal();
  });

  // Close camera dropdown on outside click
  document.addEventListener('click', e => {
    const w = document.querySelector('.camera-btn-wrapper');
    if (w && !w.contains(e.target)) hideCameraDropdown();
  });

  // Check session
  const session = getSession();
  if(session && session.id){
    currentUser = session;
    initApp();
  }
});

