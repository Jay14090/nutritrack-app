/* ═══════════════════════════════════════════════════
   NutriTrack — Main Application Logic
   Supabase + OpenAI powered nutrition tracker
   ═══════════════════════════════════════════════════ */

// ─── INIT SUPABASE ───
let db;
try {
  db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  console.log('Supabase initialized successfully');
} catch (e) {
  console.error('Supabase init failed:', e);
}

const APP = {
  targets: { calories: 2200, protein: 180, fat: 70, carbs: 220 },
  currentDate: new Date(),
  activeTab: 'today',
};

const SYSTEM_PROMPT = `You are an advanced nutrition intelligence engine. Parse natural language food input and estimate nutrition.
USER: 190cm, 130kg, Sedentary, Goal: aggressive fat loss. TARGETS: 2200kcal, P:180g, F:70g, C:220g.
RULES: Identify each food. Estimate quantity (default=standard portion). Detect hidden calories (oil, butter, sugar, fried). Assume oil in Indian cooking, sugar in tea/coffee unless stated. For each item: calories, protein_g, fat_g, carbs_g, fiber_g. Use realistic Indian/global averages. Slightly conservative (overestimate). No decimals. Split multiple items. Break down mixed dishes internally.
Return ONLY valid JSON: {"foods":[{"name":"string","calories":num,"protein_g":num,"fat_g":num,"carbs_g":num,"fiber_g":num}],"reply":"1-2 line message with total kcal + macro insight for fat loss. Clean, helpful, NOT motivational, NOT verbose."}
If unclear, best guess. NEVER ask questions. NEVER fail. JSON ONLY.`;

// ─── DATE HELPERS ───
function fmtKey(d) { return d.toISOString().split('T')[0]; }

function fmtLabel(d) {
  const t = new Date(), y = new Date(t), tm = new Date(t);
  y.setDate(t.getDate() - 1); tm.setDate(t.getDate() + 1);
  if (fmtKey(d) === fmtKey(t)) return 'Today';
  if (fmtKey(d) === fmtKey(y)) return 'Yesterday';
  if (fmtKey(d) === fmtKey(tm)) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getDayName(d) {
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short' });
}

function getDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days + 1);
  return { start: fmtKey(start), end: fmtKey(end) };
}

// ─── SUPABASE QUERIES ───
async function fetchLogs(date) {
  const { data, error } = await db
    .from('food_logs')
    .select('*')
    .eq('date', fmtKey(date))
    .order('created_at', { ascending: true });
  if (error) { console.error('Fetch error:', error); return []; }
  return data || [];
}

async function insertLogs(foods, date) {
  const rows = foods.map(f => ({
    date: fmtKey(date),
    name: f.name,
    calories: f.calories,
    protein_g: f.protein_g,
    fat_g: f.fat_g,
    carbs_g: f.carbs_g,
    fiber_g: f.fiber_g || 0,
  }));
  const { error } = await db.from('food_logs').insert(rows);
  if (error) console.error('Insert error:', error);
}

async function deleteLog(id) {
  const { error } = await db.from('food_logs').delete().eq('id', id);
  if (error) console.error('Delete error:', error);
}

async function updateLog(id, updates) {
  const { error } = await db.from('food_logs').update(updates).eq('id', id);
  if (error) console.error('Update error:', error);
}

async function fetchRange(startDate, endDate) {
  const { data, error } = await db
    .from('food_logs')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });
  if (error) { console.error('Range fetch error:', error); return []; }
  return data || [];
}

// ─── EMOJI ───
function getEmoji(name) {
  const n = name.toLowerCase();
  const m = [
    [['rice','biryani','pulao','khichdi'],'🍚'],[['chicken','murgh'],'🍗'],
    [['egg','anda','omelette'],'🥚'],[['roti','chapati','naan','paratha','bread'],'🫓'],
    [['dosa','idli','uttapam'],'🥞'],[['samosa','pakora','vada','bhaji'],'🥟'],
    [['dal','lentil','rajma','chole'],'🍲'],[['paneer','cheese','tofu'],'🧀'],
    [['milk','lassi','curd','yogurt','raita'],'🥛'],[['tea','chai'],'☕'],
    [['coffee'],'☕'],[['coke','pepsi','soda','juice','drink'],'🥤'],
    [['pizza'],'🍕'],[['burger'],'🍔'],[['pasta','noodle','maggi'],'🍝'],
    [['sandwich','wrap'],'🥪'],[['salad','sabzi','vegetable'],'🥗'],
    [['fruit','apple','banana','mango'],'🍎'],[['fish','machhi'],'🐟'],
    [['mutton','lamb','keema','meat'],'🥩'],[['sweet','halwa','dessert','cake'],'🍰'],
    [['biscuit','cookie'],'🍪'],[['chutney','pickle'],'🫙'],
    [['poha','upma','curry'],'🍛'],[['protein','shake','whey'],'🥤'],
  ];
  for (const [kw, e] of m) { if (kw.some(k => n.includes(k))) return e; }
  return '🍽️';
}

// ─── OPENAI ───
async function queryOpenAI(input) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: input }],
      temperature: 0.3, max_tokens: 800,
    }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `API ${r.status}`); }
  const d = await r.json();
  let s = d.choices[0].message.content.trim();
  const cb = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) s = cb[1].trim();
  return JSON.parse(s);
}

// ─── TOTALS ───
function totals(entries) {
  return entries.reduce((a, i) => ({
    calories: a.calories + (i.calories || 0),
    protein: a.protein + (i.protein_g || 0),
    fat: a.fat + (i.fat_g || 0),
    carbs: a.carbs + (i.carbs_g || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
}

// ─── RENDER TODAY ───
function updateRing(t) {
  const pct = Math.min(t.calories / APP.targets.calories, 1);
  const circ = 2 * Math.PI * 88, off = circ * (1 - pct);
  const rp = document.getElementById('ringProgress');
  rp.style.strokeDasharray = circ;
  rp.style.strokeDashoffset = off;
  const g = document.getElementById('ringGradient');
  if (pct < 0.7) { g.children[0].setAttribute('stop-color','#38bd94'); g.children[1].setAttribute('stop-color','#2dd4bf'); }
  else if (pct < 0.9) { g.children[0].setAttribute('stop-color','#fbbf24'); g.children[1].setAttribute('stop-color','#fb923c'); }
  else { g.children[0].setAttribute('stop-color','#f87171'); g.children[1].setAttribute('stop-color','#ef4444'); }
  document.getElementById('caloriesEaten').textContent = t.calories;
  document.getElementById('caloriesRemaining').innerHTML = `<span>${Math.max(APP.targets.calories - t.calories, 0)}</span> kcal remaining`;
}

function updateBars(t) {
  ['protein','fat','carbs'].forEach(m => {
    const pct = Math.min((t[m] / APP.targets[m]) * 100, 100);
    document.getElementById(`${m}Fill`).style.width = `${pct}%`;
    document.getElementById(`${m}Value`).innerHTML = `${Math.round(t[m])}g <span>/ ${APP.targets[m]}g</span>`;
  });
}

function renderLog(entries) {
  const c = document.getElementById('foodLog'), cnt = document.getElementById('logCount');
  if (!entries.length) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><div class="empty-text">No food logged yet</div><div class="empty-hint">Type what you ate to get started</div></div>`;
    cnt.textContent = '0 items'; return;
  }
  cnt.textContent = `${entries.length} item${entries.length > 1 ? 's' : ''}`;
  c.innerHTML = entries.map(i => {
    const isFav = isFavorite(i.name);
    return `
    <div class="food-card">
      <div class="food-card-header">
        <div class="food-name">${getEmoji(i.name)} ${i.name}</div>
        <div class="food-calories">${i.calories} kcal
          <button class="fav-star-btn ${isFav ? 'is-fav' : ''}" onclick="toggleFavFromCard('${i.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}',${i.calories},${i.protein_g},${i.fat_g},${i.carbs_g},${i.fiber_g || 0}, this)" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">★</button>
          <button class="edit-btn" onclick="showEditModal('${i.id}','${i.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}',${i.calories},${i.protein_g},${i.fat_g},${i.carbs_g},${i.fiber_g || 0})" title="Edit macros">✎</button>
          <button class="delete-btn" onclick="delEntry('${i.id}')" title="Remove">✕</button>
        </div>
      </div>
      <div class="food-macros">
        <div class="food-macro p">P: <span>${i.protein_g}g</span></div>
        <div class="food-macro f">F: <span>${i.fat_g}g</span></div>
        <div class="food-macro c">C: <span>${i.carbs_g}g</span></div>
        ${i.fiber_g ? `<div class="food-macro">Fiber: ${i.fiber_g}g</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function refreshToday() {
  const entries = await fetchLogs(APP.currentDate);
  const t = totals(entries);
  updateRing(t); updateBars(t); renderLog(entries);
  document.getElementById('dateLabel').textContent = fmtLabel(APP.currentDate);
}

// ─── RENDER WEEK ───
async function loadWeekStats() {
  const { start, end } = getDateRange(7);
  const data = await fetchRange(start, end);
  const byDay = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    byDay[fmtKey(d)] = [];
  }
  data.forEach(r => { if (byDay[r.date]) byDay[r.date].push(r); });

  const days = Object.keys(byDay).sort();
  const dayTotals = days.map(d => ({ date: d, ...totals(byDay[d]), count: byDay[d].length }));
  const logged = dayTotals.filter(d => d.count > 0);
  const avgCal = logged.length ? Math.round(logged.reduce((s, d) => s + d.calories, 0) / logged.length) : 0;
  const avgPro = logged.length ? Math.round(logged.reduce((s, d) => s + d.protein, 0) / logged.length) : 0;
  const totalCal = dayTotals.reduce((s, d) => s + d.calories, 0);
  const inTarget = logged.filter(d => d.calories <= APP.targets.calories).length;
  const maxCal = Math.max(...dayTotals.map(d => d.calories), APP.targets.calories);

  document.getElementById('weekContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card accent"><div class="stat-card-label">Avg Calories</div><div class="stat-card-value">${avgCal}</div><div class="stat-card-unit">kcal / day</div></div>
      <div class="stat-card"><div class="stat-card-label">Avg Protein</div><div class="stat-card-value">${avgPro}</div><div class="stat-card-unit">g / day</div></div>
      <div class="stat-card"><div class="stat-card-label">Days Logged</div><div class="stat-card-value">${logged.length}</div><div class="stat-card-unit">of 7 days</div></div>
      <div class="stat-card"><div class="stat-card-label">In Target</div><div class="stat-card-value">${inTarget}</div><div class="stat-card-unit">days ≤ ${APP.targets.calories}</div></div>
    </div>
    <div class="bar-chart-section">
      <div class="bar-chart-title">Daily Calories</div>
      <div class="bar-chart">
        ${dayTotals.map(d => {
          const h = d.calories > 0 ? Math.max((d.calories / maxCal) * 100, 5) : 3;
          const cls = d.calories > APP.targets.calories ? 'over-target' : (d.count === 0 ? 'no-data' : '');
          return `<div class="bar-col">
            <div class="bar-value">${d.count > 0 ? d.calories : '-'}</div>
            <div class="bar-fill ${cls}" style="height:${h}%"></div>
            <div class="bar-label">${getDayName(d.date)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="bar-chart-title">Daily Breakdown</div>
    <div class="breakdown-list">
      ${dayTotals.slice().reverse().map(d => `
        <div class="breakdown-row">
          <div class="breakdown-date">${getDayName(d.date)} ${new Date(d.date).getDate()}</div>
          <div class="breakdown-macros">
            <div class="breakdown-macro p">P:<span>${d.protein}g</span></div>
            <div class="breakdown-macro f">F:<span>${d.fat}g</span></div>
            <div class="breakdown-macro c">C:<span>${d.carbs}g</span></div>
          </div>
          <div class="breakdown-cals">${d.count > 0 ? d.calories + ' kcal' : '—'}</div>
        </div>`).join('')}
    </div>`;
}

// ─── RENDER MONTH ───
async function loadMonthStats() {
  const { start, end } = getDateRange(30);
  const data = await fetchRange(start, end);
  const byDay = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(); d.setDate(d.getDate() - 29 + i);
    byDay[fmtKey(d)] = [];
  }
  data.forEach(r => { if (byDay[r.date]) byDay[r.date].push(r); });

  const days = Object.keys(byDay).sort();
  const dayTotals = days.map(d => ({ date: d, ...totals(byDay[d]), count: byDay[d].length }));
  const logged = dayTotals.filter(d => d.count > 0);
  const avgCal = logged.length ? Math.round(logged.reduce((s, d) => s + d.calories, 0) / logged.length) : 0;
  const avgPro = logged.length ? Math.round(logged.reduce((s, d) => s + d.protein, 0) / logged.length) : 0;
  const avgFat = logged.length ? Math.round(logged.reduce((s, d) => s + d.fat, 0) / logged.length) : 0;
  const avgCarbs = logged.length ? Math.round(logged.reduce((s, d) => s + d.carbs, 0) / logged.length) : 0;
  const totalCal = dayTotals.reduce((s, d) => s + d.calories, 0);
  const inTarget = logged.filter(d => d.calories <= APP.targets.calories).length;
  const compliancePct = logged.length ? Math.round((inTarget / logged.length) * 100) : 0;

  // Streak calculation
  let streak = 0;
  for (let i = dayTotals.length - 1; i >= 0; i--) {
    if (dayTotals[i].count > 0) streak++; else break;
  }

  // Weekly averages for the 4 weeks
  const weeks = [];
  for (let w = 0; w < 4; w++) {
    const wStart = w * 7;
    const wEnd = Math.min(wStart + 7, dayTotals.length);
    const wDays = dayTotals.slice(wStart, wEnd);
    const wLogged = wDays.filter(d => d.count > 0);
    const wAvg = wLogged.length ? Math.round(wLogged.reduce((s, d) => s + d.calories, 0) / wLogged.length) : 0;
    const weekNum = w + 1;
    weeks.push({ label: `Week ${weekNum}`, avg: wAvg, logged: wLogged.length });
  }
  const maxWeekAvg = Math.max(...weeks.map(w => w.avg), APP.targets.calories);

  document.getElementById('monthContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card accent"><div class="stat-card-label">Avg Calories</div><div class="stat-card-value">${avgCal}</div><div class="stat-card-unit">kcal / day</div></div>
      <div class="stat-card"><div class="stat-card-label">Avg Protein</div><div class="stat-card-value">${avgPro}</div><div class="stat-card-unit">g / day</div></div>
      <div class="stat-card"><div class="stat-card-label">Days Logged</div><div class="stat-card-value">${logged.length}</div><div class="stat-card-unit">of 30 days</div></div>
      <div class="stat-card"><div class="stat-card-label">Current Streak</div><div class="stat-card-value">${streak}</div><div class="stat-card-unit">consecutive days</div></div>
    </div>
    <div class="compliance-bar">
      <div class="compliance-label"><span>Target Compliance</span><span>${compliancePct}%</span></div>
      <div class="compliance-track"><div class="compliance-fill" style="width:${compliancePct}%"></div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-card-label">Avg Fat</div><div class="stat-card-value">${avgFat}</div><div class="stat-card-unit">g / day</div></div>
      <div class="stat-card"><div class="stat-card-label">Avg Carbs</div><div class="stat-card-value">${avgCarbs}</div><div class="stat-card-unit">g / day</div></div>
      <div class="stat-card wide"><div class="stat-card-label">Total Calories (30 days)</div><div class="stat-card-value">${totalCal.toLocaleString()}</div><div class="stat-card-unit">kcal total</div></div>
    </div>
    <div class="bar-chart-section">
      <div class="bar-chart-title">Weekly Averages</div>
      <div class="bar-chart">
        ${weeks.map(w => {
          const h = w.avg > 0 ? Math.max((w.avg / maxWeekAvg) * 100, 5) : 3;
          const cls = w.avg > APP.targets.calories ? 'over-target' : (w.logged === 0 ? 'no-data' : '');
          return `<div class="bar-col">
            <div class="bar-value">${w.logged > 0 ? w.avg : '-'}</div>
            <div class="bar-fill ${cls}" style="height:${h}%"></div>
            <div class="bar-label">${w.label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ─── EVENT HANDLERS ───
async function delEntry(id) {
  await deleteLog(id);
  await refreshToday();
}

function navigateDate(delta) {
  APP.currentDate.setDate(APP.currentDate.getDate() + delta);
  refreshToday();
}

async function handleSubmit() {
  const input = document.getElementById('foodInput');
  const text = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('submitBtn');
  const reply = document.getElementById('aiReply');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';
  reply.classList.remove('visible');

  try {
    const result = await queryOpenAI(text);
    if (result.foods && result.foods.length) {
      await insertLogs(result.foods, APP.currentDate);
      await refreshToday();
      input.value = '';
    }
    if (result.reply) {
      reply.textContent = result.reply;
      reply.classList.add('visible');
    }
  } catch (err) {
    reply.textContent = `Error: ${err.message}`;
    reply.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '→';
  }
}

function switchTab(tab) {
  APP.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
  if (tab === 'week') loadWeekStats();
  if (tab === 'month') loadMonthStats();
}

// ─── API KEY MODAL ───
function showKeyModal() {
  const modal = document.getElementById('keyModal');
  const input = document.getElementById('apiKeyInput');
  modal.classList.add('visible');
  input.value = CONFIG.OPENAI_API_KEY || '';
  input.focus();
}

function hideKeyModal() {
  document.getElementById('keyModal').classList.remove('visible');
}

function saveApiKey() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key || !key.startsWith('sk-')) {
    document.getElementById('apiKeyInput').style.borderColor = '#f87171';
    return;
  }
  localStorage.setItem('nutritrack_openai_key', key);
  CONFIG.OPENAI_API_KEY = key;
  hideKeyModal();
  showToast('✅ API key saved successfully');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

// ─── EDIT MODAL ───
function showEditModal(id, name, cal, pro, fat, carbs, fiber) {
  document.getElementById('editFoodId').value = id;
  document.getElementById('editFoodName').value = name;
  document.getElementById('editCalories').value = cal;
  document.getElementById('editProtein').value = pro;
  document.getElementById('editFat').value = fat;
  document.getElementById('editCarbs').value = carbs;
  document.getElementById('editFiber').value = fiber;
  document.getElementById('editModal').classList.add('visible');
  document.getElementById('editFoodName').focus();
}

function hideEditModal() {
  document.getElementById('editModal').classList.remove('visible');
}

async function saveEditFood() {
  const id = document.getElementById('editFoodId').value;
  const name = document.getElementById('editFoodName').value.trim();
  const cal = parseInt(document.getElementById('editCalories').value) || 0;
  const pro = parseInt(document.getElementById('editProtein').value) || 0;
  const fat = parseInt(document.getElementById('editFat').value) || 0;
  const carbs = parseInt(document.getElementById('editCarbs').value) || 0;
  const fiber = parseInt(document.getElementById('editFiber').value) || 0;

  if (!name) {
    document.getElementById('editFoodName').style.borderColor = '#f87171';
    return;
  }

  await updateLog(id, {
    name, calories: cal, protein_g: pro, fat_g: fat, carbs_g: carbs, fiber_g: fiber
  });
  hideEditModal();
  await refreshToday();
  showToast('✅ Macros updated');
}

// ─── MANUAL ADD MODAL ───
function showAddModal() {
  document.getElementById('addFoodName').value = '';
  document.getElementById('addCalories').value = '';
  document.getElementById('addProtein').value = '';
  document.getElementById('addFat').value = '';
  document.getElementById('addCarbs').value = '';
  document.getElementById('addFiber').value = '';
  document.getElementById('addModal').classList.add('visible');
  document.getElementById('addFoodName').focus();
}

function hideAddModal() {
  document.getElementById('addModal').classList.remove('visible');
}

async function saveAddFood() {
  const name = document.getElementById('addFoodName').value.trim();
  const cal = parseInt(document.getElementById('addCalories').value) || 0;
  const pro = parseInt(document.getElementById('addProtein').value) || 0;
  const fat = parseInt(document.getElementById('addFat').value) || 0;
  const carbs = parseInt(document.getElementById('addCarbs').value) || 0;
  const fiber = parseInt(document.getElementById('addFiber').value) || 0;

  if (!name) {
    document.getElementById('addFoodName').style.borderColor = '#f87171';
    return;
  }

  await insertLogs([{
    name, calories: cal, protein_g: pro, fat_g: fat, carbs_g: carbs, fiber_g: fiber
  }], APP.currentDate);
  hideAddModal();
  await refreshToday();
  showToast('✅ Food added');
}

// ─── FAVORITES SYSTEM (localStorage) ───
function getFavorites() {
  try { return JSON.parse(localStorage.getItem('nutritrack_favorites') || '[]'); }
  catch { return []; }
}

function saveFavorites(favs) {
  localStorage.setItem('nutritrack_favorites', JSON.stringify(favs));
}

function isFavorite(name) {
  return getFavorites().some(f => f.name.toLowerCase() === name.toLowerCase());
}

function addFavorite(item) {
  const favs = getFavorites();
  if (favs.some(f => f.name.toLowerCase() === item.name.toLowerCase())) return false;
  favs.push(item);
  saveFavorites(favs);
  return true;
}

function removeFavorite(name) {
  const favs = getFavorites().filter(f => f.name.toLowerCase() !== name.toLowerCase());
  saveFavorites(favs);
}

function renderFavDropdown() {
  const list = document.getElementById('favList');
  const favs = getFavorites();
  if (!favs.length) {
    list.innerHTML = '<div class="fav-empty">No favorites yet.<br><span>Star a food or tap \"+ New\"</span></div>';
    return;
  }
  list.innerHTML = favs.map((f, idx) => `
    <div class="fav-item">
      <div class="fav-item-info">
        <div class="fav-item-name">${getEmoji(f.name)} ${f.name}</div>
        <div class="fav-item-macros">
          <span class="cal">${f.calories} kcal</span>
          <span class="p">P:${f.protein_g}g</span>
          <span class="f">F:${f.fat_g}g</span>
          <span class="c">C:${f.carbs_g}g</span>
        </div>
      </div>
      <div class="fav-item-actions">
        <button class="fav-log-btn" onclick="logFavorite(${idx})" title="Add to today's log">+ Log</button>
        <button class="fav-remove-btn" onclick="deleteFavorite(${idx})" title="Remove favorite">&times;</button>
      </div>
    </div>`).join('');
}

function toggleFavDropdown() {
  const dd = document.getElementById('favDropdown');
  const btn = document.getElementById('favToggleBtn');
  const isOpen = dd.classList.contains('visible');
  if (isOpen) {
    dd.classList.remove('visible');
    btn.classList.remove('active');
  } else {
    renderFavDropdown();
    dd.classList.add('visible');
    btn.classList.add('active');
  }
}

function closeFavDropdown() {
  document.getElementById('favDropdown').classList.remove('visible');
  document.getElementById('favToggleBtn').classList.remove('active');
}

function toggleFavFromCard(name, cal, pro, fat, carbs, fiber, btnEl) {
  if (isFavorite(name)) {
    removeFavorite(name);
    btnEl.classList.remove('is-fav');
    btnEl.title = 'Add to favorites';
    showToast('Removed from favorites');
  } else {
    addFavorite({ name, calories: cal, protein_g: pro, fat_g: fat, carbs_g: carbs, fiber_g: fiber });
    btnEl.classList.add('is-fav');
    btnEl.title = 'Remove from favorites';
    showToast('⭐ Added to favorites');
  }
  renderFavDropdown();
}

async function logFavorite(idx) {
  const favs = getFavorites();
  const f = favs[idx];
  if (!f) return;
  await insertLogs([{ name: f.name, calories: f.calories, protein_g: f.protein_g, fat_g: f.fat_g, carbs_g: f.carbs_g, fiber_g: f.fiber_g }], APP.currentDate);
  await refreshToday();
  showToast(`✅ Logged ${f.name}`);
}

function deleteFavorite(idx) {
  const favs = getFavorites();
  favs.splice(idx, 1);
  saveFavorites(favs);
  renderFavDropdown();
  refreshToday(); // re-render star states
  showToast('Removed from favorites');
}

// ─── FAVORITE MODAL (add new) ───
function showFavModal() {
  closeFavDropdown();
  document.getElementById('favFoodName').value = '';
  document.getElementById('favCalories').value = '';
  document.getElementById('favProtein').value = '';
  document.getElementById('favFat').value = '';
  document.getElementById('favCarbs').value = '';
  document.getElementById('favFiber').value = '';
  document.getElementById('favModal').classList.add('visible');
  document.getElementById('favFoodName').focus();
}

function hideFavModal() {
  document.getElementById('favModal').classList.remove('visible');
}

function saveFavFromModal() {
  const name = document.getElementById('favFoodName').value.trim();
  const cal = parseInt(document.getElementById('favCalories').value) || 0;
  const pro = parseInt(document.getElementById('favProtein').value) || 0;
  const fat = parseInt(document.getElementById('favFat').value) || 0;
  const carbs = parseInt(document.getElementById('favCarbs').value) || 0;
  const fiber = parseInt(document.getElementById('favFiber').value) || 0;
  if (!name) {
    document.getElementById('favFoodName').style.borderColor = '#f87171';
    return;
  }
  const added = addFavorite({ name, calories: cal, protein_g: pro, fat_g: fat, carbs_g: carbs, fiber_g: fiber });
  if (!added) {
    showToast('Already in favorites');
    return;
  }
  hideFavModal();
  renderFavDropdown();
  showToast('⭐ Saved to favorites');
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', () => {
  // Register ALL event listeners FIRST (before any async calls)
  document.getElementById('submitBtn').addEventListener('click', handleSubmit);
  document.getElementById('foodInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  });
  document.getElementById('prevDay').addEventListener('click', () => navigateDate(-1));
  document.getElementById('nextDay').addEventListener('click', () => navigateDate(1));

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  // Settings gear
  document.getElementById('settingsBtn').addEventListener('click', showKeyModal);
  document.getElementById('saveKeyBtn').addEventListener('click', saveApiKey);
  document.getElementById('apiKeyInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveApiKey();
  });
  document.getElementById('keyModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideKeyModal();
  });

  // Edit modal
  document.getElementById('editSaveBtn').addEventListener('click', saveEditFood);
  document.getElementById('editCancelBtn').addEventListener('click', hideEditModal);
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideEditModal();
  });

  // Manual add modal
  document.getElementById('manualAddBtn').addEventListener('click', showAddModal);
  document.getElementById('addSaveBtn').addEventListener('click', saveAddFood);
  document.getElementById('addCancelBtn').addEventListener('click', hideAddModal);
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideAddModal();
  });

  // Favorites dropdown
  document.getElementById('favToggleBtn').addEventListener('click', toggleFavDropdown);
  document.getElementById('favAddNewBtn').addEventListener('click', showFavModal);

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    const wrapper = document.querySelector('.fav-dropdown-wrapper');
    if (wrapper && !wrapper.contains(e.target)) closeFavDropdown();
  });

  // Favorites modal
  document.getElementById('favSaveBtn').addEventListener('click', saveFavFromModal);
  document.getElementById('favCancelBtn').addEventListener('click', hideFavModal);
  document.getElementById('favModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideFavModal();
  });

  // Show modal if no API key configured
  if (!CONFIG.OPENAI_API_KEY) {
    showKeyModal();
  }

  // Load data (async, won't block listeners)
  refreshToday().catch(err => console.error('Initial load error:', err));
});

