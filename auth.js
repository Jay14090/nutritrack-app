/* ═══ NutriTrack Auth Module ═══ */
let db;
try { db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY); } catch(e) { console.error(e); }

const SESSION_KEY = 'nutritrack_session';
let currentUser = null;
let userSettings = null;

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, display_name: user.display_name }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
  userSettings = null;
}

async function loadUserSettings(userId) {
  const { data } = await db.from('user_settings').select('*').eq('user_id', userId).single();
  return data || { calorie_goal: 2200, protein_goal: 180, fat_goal: 70, carbs_goal: 220, ai_provider: 'openai', api_key: '' };
}

async function saveUserSettings(userId, settings) {
  const { data: existing } = await db.from('user_settings').select('id').eq('user_id', userId).single();
  const payload = { calorie_goal: settings.calorie_goal, protein_goal: settings.protein_goal, fat_goal: settings.fat_goal, carbs_goal: settings.carbs_goal, ai_provider: settings.ai_provider, api_key: settings.api_key, updated_at: new Date().toISOString() };
  if (existing) { await db.from('user_settings').update(payload).eq('user_id', userId); }
  else { await db.from('user_settings').insert([{ user_id: userId, ...payload }]); }
}

async function attemptLogin(username, password) {
  const hash = await hashPassword(password);
  const { data, error } = await db.from('app_users').select('*').eq('username', username.toLowerCase().trim()).eq('password_hash', hash).single();
  if (error || !data) return { ok: false, msg: 'Invalid username or password' };
  if (!data.is_active) return { ok: false, msg: 'Account access has been revoked' };
  return { ok: true, user: data };
}

// ─── AI PROVIDERS ───
async function queryOpenAI(input, apiKey, systemPrompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: CONFIG.OPENAI_MODEL, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: input }], temperature: 0.3, max_tokens: 800 }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `API ${r.status}`); }
  const d = await r.json();
  let s = d.choices[0].message.content.trim();
  const cb = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) s = cb[1].trim();
  return JSON.parse(s);
}

async function queryGemini(input, apiKey, systemPrompt) {
  const url = `${CONFIG.GEMINI_API_URL}/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: input }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
    }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `Gemini API ${r.status}`); }
  const d = await r.json();
  let s = d.candidates[0].content.parts[0].text.trim();
  const cb = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) s = cb[1].trim();
  return JSON.parse(s);
}

async function queryAI(input, systemPrompt) {
  const provider = userSettings?.ai_provider || 'openai';
  const apiKey = userSettings?.api_key || '';
  if (!apiKey) throw new Error('No API key set. Go to Settings to add one.');
  if (provider === 'gemini') return queryGemini(input, apiKey, systemPrompt);
  return queryOpenAI(input, apiKey, systemPrompt);
}

// ─── AI VISION PROVIDERS ───
async function queryOpenAIVision(base64Data, mimeType, apiKey, systemPrompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: CONFIG.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'low' } },
          { type: 'text', text: 'Identify all food items in this photo and estimate their nutrition.' }
        ]}
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `API ${r.status}`); }
  const d = await r.json();
  let s = d.choices[0].message.content.trim();
  const cb = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) s = cb[1].trim();
  return JSON.parse(s);
}

async function queryGeminiVision(base64Data, mimeType, apiKey, systemPrompt) {
  const url = `${CONFIG.GEMINI_API_URL}/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [
        { inlineData: { mimeType: mimeType, data: base64Data } },
        { text: 'Identify all food items in this photo and estimate their nutrition.' }
      ]}],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
    }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `Gemini API ${r.status}`); }
  const d = await r.json();
  let s = d.candidates[0].content.parts[0].text.trim();
  const cb = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) s = cb[1].trim();
  return JSON.parse(s);
}

async function queryAIVision(base64Data, mimeType, systemPrompt) {
  const provider = userSettings?.ai_provider || 'openai';
  const apiKey = userSettings?.api_key || '';
  if (!apiKey) throw new Error('No API key set. Go to Settings to add one.');
  if (provider === 'gemini') return queryGeminiVision(base64Data, mimeType, apiKey, systemPrompt);
  return queryOpenAIVision(base64Data, mimeType, apiKey, systemPrompt);
}
