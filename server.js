/* ═══════════════════════════════════════════════════════════════
   T-CRM  server.js  v4.0
   Fixes:
   • Token enviado como query-param E header (resolve 401)
   • Auto-seed do usuário supervisor na primeira execução
   • Rota /dashboard com métricas agregadas
   • node-fetch compatível com Node 16 e 18+
═══════════════════════════════════════════════════════════════ */
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const multer    = require('multer');
const FormData  = require('form-data');
const fs        = require('fs');
const path      = require('path');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');

/* ── fetch (Node 16 compat) ─────────────────────── */
let fetcher;
if (typeof globalThis.fetch === 'function') {
  fetcher = globalThis.fetch.bind(globalThis);
} else {
  fetcher = require('node-fetch');
}

/* ── Env ────────────────────────────────────────── */
const {
  CHATWOOT_URL,
  CHATWOOT_TOKEN,
  ACCOUNT_ID,
  JWT_SECRET = 'tcrm_dev_secret_change_in_prod',
  PORT = 3000,
} = process.env;

if (!CHATWOOT_URL || !CHATWOOT_TOKEN || !ACCOUNT_ID) {
  console.error('\n❌  Configure CHATWOOT_URL, CHATWOOT_TOKEN e ACCOUNT_ID no arquivo .env\n');
  process.exit(1);
}

const BASE = `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}`;

/* ── Users file ─────────────────────────────────── */
const USERS_FILE     = path.join(__dirname, 'users.json');
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function writeUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2));
}
function readSchedules() {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')); }
  catch { return []; }
}
function writeSchedules(list) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(list, null, 2));
}

/* Auto-seed supervisor na primeira execução */
(function seedSupervisor() {
  const users = readUsers();
  if (users.length === 0) {
    const hash = bcrypt.hashSync('supervisor123', 10);
    writeUsers([{
      id: '1',
      name: 'Supervisor',
      email: 'supervisor@pvcorretor.com',
      password: hash,
      role: 'supervisor',
      createdAt: new Date().toISOString(),
    }]);
    console.log('✅  Supervisor criado: supervisor@pvcorretor.com / supervisor123');
  }
})();

/* ── App ────────────────────────────────────────── */
const app    = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 3600000,
  setHeaders(res, fp) { if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));

/* ═══════════════════════════════════════════════════
   CHATWOOT HELPER
   Token enviado como query-param E header (dupla garantia)
═══════════════════════════════════════════════════ */
async function cw(urlPath, options = {}) {
  const sep = urlPath.includes('?') ? '&' : '?';
  const url = `${BASE}${urlPath}${sep}api_access_token=${encodeURIComponent(CHATWOOT_TOKEN)}`;

  const res = await fetcher(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'api_access_token': CHATWOOT_TOKEN,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Chatwoot ${res.status}: ${txt}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

/* Cache em memória para conversas — TTL 8s */
const convsCache = {};

/* Cache de agentes por email — TTL 60s */
let _agentEmailCache = null;
let _agentEmailCacheTs = 0;
async function getAgentIdByEmail(email) {
  const now = Date.now();
  if (!_agentEmailCache || now - _agentEmailCacheTs > 60000) {
    try {
      const list = await cw('/agents');
      const agents = Array.isArray(list) ? list : (list?.payload || []);
      _agentEmailCache = Object.fromEntries(agents.map(a => [a.email, String(a.id)]));
      _agentEmailCacheTs = now;
    } catch { _agentEmailCache = _agentEmailCache || {}; }
  }
  return _agentEmailCache[email] || null;
}

/* Busca todas as conversas com paginação paralela + cache */
async function fetchAllConvs(assigneeId) {
  const cacheKey = assigneeId || '__all__';
  const now = Date.now();
  if (convsCache[cacheKey] && now - convsCache[cacheKey].ts < 8000) {
    return convsCache[cacheKey].data;
  }
  let all = [], page = 1;
  while (page <= 10) {
    const chunk = Math.min(4, 11 - page);
    const results = await Promise.all(
      Array.from({ length: chunk }, (_, i) => page + i)
        .map(p => cw(`/conversations?page=${p}&sort=last_activity_at`).catch(() => null))
    );
    let done = false;
    for (const data of results) {
      if (!data) { done = true; break; }
      const batch = data?.data?.payload || [];
      all = all.concat(batch);
      if (batch.length < 25) { done = true; break; }
    }
    if (done) break;
    page += chunk;
  }
  if (assigneeId) all = all.filter(c => String(c?.meta?.assignee?.id) === String(assigneeId));
  convsCache[cacheKey] = { data: all, ts: now };
  return all;
}

/* ═══════════════════════════════════════════════════
   JWT MIDDLEWARE
═══════════════════════════════════════════════════ */
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido ou expirado' }); }
}

function role(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ error: 'Acesso negado' });
    next();
  };
}

/* ═══════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════ */
app.post('/auth/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: 'Email e senha obrigatórios' });

    const users = readUsers();
    const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Email ou senha incorretos' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)  return res.status(401).json({ error: 'Email ou senha incorretos' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: '10h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('[POST /auth/login]', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

app.get('/auth/me', auth, (req, res) => res.json({ user: req.user }));

/* ═══════════════════════════════════════════════════
   USERS (Supervisor only)
═══════════════════════════════════════════════════ */
app.get('/users', auth, role('supervisor'), (req, res) => {
  res.json(readUsers().map(u => ({ id:u.id, name:u.name, email:u.email, role:u.role, createdAt:u.createdAt })));
});

app.post('/users', auth, role('supervisor'), async (req, res) => {
  try {
    const { name, email, password, role: r = 'vendedor' } = req.body || {};
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Nome, email e senha obrigatórios' });
    if (!['vendedor','supervisor','backoffice'].includes(r))
      return res.status(400).json({ error: 'Tipo inválido' });

    const users = readUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
      return res.status(409).json({ error: 'Email já cadastrado' });

    const newUser = { id: String(Date.now()), name: name.trim(), email: email.trim().toLowerCase(),
      password: await bcrypt.hash(password, 10), role: r, createdAt: new Date().toISOString() };
    users.push(newUser);
    writeUsers(users);
    res.status(201).json({ id:newUser.id, name:newUser.name, email:newUser.email, role:newUser.role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/users/:id', auth, role('supervisor'), async (req, res) => {
  try {
    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Usuário não encontrado' });
    const { name, email, password, role: r } = req.body || {};
    if (name)  users[idx].name  = name.trim();
    if (email) users[idx].email = email.trim().toLowerCase();
    if (r && ['vendedor','supervisor','backoffice'].includes(r)) users[idx].role = r;
    if (password) users[idx].password = await bcrypt.hash(password, 10);
    writeUsers(users);
    res.json({ id:users[idx].id, name:users[idx].name, email:users[idx].email, role:users[idx].role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/users/:id', auth, role('supervisor'), (req, res) => {
  const users  = readUsers();
  const after  = users.filter(u => u.id !== req.params.id);
  if (after.length === users.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  writeUsers(after);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════
   CONVERSATIONS
═══════════════════════════════════════════════════ */
app.get('/conversations', auth, async (req, res) => {
  try {
    let { assignee_id } = req.query;
    /* Vendedor sempre filtra por si mesmo — lookup por email no Chatwoot */
    if (req.user.role === 'vendedor') {
      const myId = await getAgentIdByEmail(req.user.email);
      if (myId) assignee_id = myId;
    }
    const all = await fetchAllConvs(assignee_id || undefined);
    res.json({ conversations: all });
  } catch (err) {
    console.error('[GET /conversations]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   MESSAGES
═══════════════════════════════════════════════════ */
app.get('/messages/:id', auth, async (req, res) => {
  try {
    const qs = req.query.before ? `?before=${encodeURIComponent(req.query.before)}` : '';
    res.json(await cw(`/conversations/${req.params.id}/messages${qs}`));
  }
  catch (err) { console.error('[GET /messages]', err.message); res.status(500).json({ error: err.message }); }
});

app.post('/messages/:id', auth, async (req, res) => {
  try {
    const { content, message_type = 'outgoing', private: priv = false } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Conteúdo vazio' });
    res.json(await cw(`/conversations/${req.params.id}/messages`, {
      method: 'POST', body: JSON.stringify({ content, message_type, private: priv }),
    }));
  } catch (err) { console.error('[POST /messages]', err.message); res.status(500).json({ error: err.message }); }
});

/* ═══════════════════════════════════════════════════
   MEDIA / ÁUDIO
═══════════════════════════════════════════════════ */
app.post('/media/:id', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const tmp = req.file.path;
  try {
    let mimeType = req.file.mimetype || 'application/octet-stream';
    let filename  = req.file.originalname || req.file.filename || 'file';

    if (['application/octet-stream', ''].includes(mimeType)) {
      if (filename.endsWith('.webm'))     mimeType = 'audio/webm';
      else if (filename.endsWith('.ogg')) mimeType = 'audio/ogg';
      else if (filename.endsWith('.mp4')) mimeType = 'audio/mp4';
    }
    if (!filename.match(/\.[a-z0-9]+$/i) && mimeType.startsWith('audio/')) {
      filename = `audio_${Date.now()}.${mimeType.split('/')[1].replace('mpeg','mp3')}`;
    }

    const form = new FormData();
    form.append('message_type', 'outgoing');
    form.append('content',      req.body.content || '');
    form.append('private',      'false');
    form.append('attachments[]', fs.createReadStream(tmp), {
      filename, contentType: mimeType, knownLength: req.file.size,
    });

    const url = `${BASE}/conversations/${req.params.id}/messages?api_access_token=${encodeURIComponent(CHATWOOT_TOKEN)}`;
    const r   = await fetcher(url, {
      method: 'POST',
      headers: { 'api_access_token': CHATWOOT_TOKEN, ...form.getHeaders() },
      body: form,
    });
    const txt = await r.text();
    fs.unlink(tmp, () => {});
    if (!r.ok) throw new Error(`Chatwoot ${r.status}: ${txt}`);
    res.json(JSON.parse(txt));
  } catch (err) {
    console.error('[POST /media]', err.message);
    fs.unlink(tmp, () => {});
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   LABELS
═══════════════════════════════════════════════════ */
app.get('/labels', auth, async (req, res) => {
  try { const d = await cw('/labels'); res.json(d?.payload || []); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/conversations/:id/label', auth, async (req, res) => {
  try {
    const labels = req.body.labels || [];
    const result = await cw(`/conversations/${req.params.id}/labels`, {
      method: 'POST', body: JSON.stringify({ labels }),
    });
    // Tag HUMANO: desativa o robô na conversa
    if (labels.some(l => String(l).toLowerCase() === 'humano')) {
      try {
        await cw(`/conversations/${req.params.id}/agent_bot`, { method: 'DELETE' });
      } catch (e) { console.log('[HUMANO] bot disable:', e.message); }
    }
    Object.keys(convsCache).forEach(k => delete convsCache[k]);
    res.json(result);
  } catch (err) { console.error('[PATCH /label]', err.message); res.status(500).json({ error: err.message }); }
});

/* ═══════════════════════════════════════════════════
   AGENDAMENTOS
═══════════════════════════════════════════════════ */
app.get('/schedules', auth, (req, res) => {
  res.json(readSchedules());
});

app.post('/schedules', auth, async (req, res) => {
  try {
    const { convId, name, date, time, note } = req.body;
    if (!convId || !date || !time) return res.status(400).json({ error: 'convId, date e time obrigatórios' });
    const all = readSchedules().filter(s => String(s.convId) !== String(convId));
    const sched = {
      id: `s_${Date.now()}`,
      convId: String(convId), name: name || 'Cliente',
      date, time, note: note || '',
      datetime: `${date}T${time}:00`,
      createdAt: new Date().toISOString(),
      createdBy: req.user.name || req.user.email,
      alerted: false,
    };
    all.push(sched);
    writeSchedules(all);
    // Notificar cliente no chat
    const [y, m, d] = date.split('-');
    const msg = `📅 *Agendamento confirmado!*\n\nOlá ${name}! Seu atendimento foi agendado:\n\n📆 *Data:* ${d}/${m}/${y}\n🕐 *Horário:* ${time}\n👤 *Atendente:* ${sched.createdBy}${note ? `\n📝 *Obs:* ${note}` : ''}`;
    try {
      await cw(`/conversations/${convId}/messages`, {
        method: 'POST', body: JSON.stringify({ content: msg, message_type: 'outgoing', private: false }),
      });
    } catch (e) { console.error('[schedules] notif:', e.message); }
    res.json(sched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/schedules/:id/alerted', auth, (req, res) => {
  const all = readSchedules();
  const s = all.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Não encontrado' });
  s.alerted = true;
  writeSchedules(all);
  res.json(s);
});

app.delete('/schedules/:id', auth, (req, res) => {
  const all = readSchedules();
  const filtered = all.filter(s => s.id !== req.params.id);
  if (filtered.length === all.length) return res.status(404).json({ error: 'Não encontrado' });
  writeSchedules(filtered);
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════════
   CONTACTS
═══════════════════════════════════════════════════ */
app.get('/contacts/search', auth, async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q.trim()) return res.json({ payload: [] });
    res.json(await cw(`/contacts/search?q=${encodeURIComponent(q)}&include_contacts=true`));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/contacts/:id/conversations', auth, async (req, res) => {
  try { res.json(await cw(`/contacts/${req.params.id}/conversations`)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* ═══════════════════════════════════════════════════
   AGENTS
═══════════════════════════════════════════════════ */
app.get('/agents', auth, async (req, res) => {
  try { res.json(await cw('/agents')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/assign', auth, role('supervisor', 'backoffice'), async (req, res) => {
  try {
    const { conversation_id, assignee_id } = req.body;
    res.json(await cw(`/conversations/${conversation_id}/assignments`, {
      method: 'POST', body: JSON.stringify({ assignee_id }),
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ═══════════════════════════════════════════════════
   DASHBOARD — métricas agregadas
═══════════════════════════════════════════════════ */
const STAGE_IDS = [
  'lead','negociacao','aguardando-documentacao','aguardando-cotacao','agendamento',
  'lancar-venda','pendente-pagamento','pago','sem-retorno','outros',
];
const LABEL_ALIASES = {
  'aguardando_pagamento':'pendente-pagamento',
  'aguardando-pagamento':'pendente-pagamento',
  'pendente_pagamento':'pendente-pagamento',
  'lancar_venda':'lancar-venda',
  'lançar_venda':'lancar-venda',
  'lançar-venda':'lancar-venda',
  'aguardando_documentacao':'aguardando-documentacao',
  'aguardando_cotacao':'aguardando-cotacao',
  'sem_retorno':'sem-retorno',
};
function normLabel(s){return (s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function getStage(conv) {
  const ls = (conv.labels || []).map(normLabel);
  for (const raw of ls) {
    const norm = LABEL_ALIASES[raw] || raw;
    if (STAGE_IDS.includes(norm)) return norm;
  }
  return 'outros';
}

app.get('/dashboard', auth, async (req, res) => {
  try {
    const { assignee_id, date_from, date_to } = req.query;

    let all = await fetchAllConvs(assignee_id || undefined);

    // Date filter (Unix timestamps)
    if (date_from) {
      const ts = new Date(date_from).getTime() / 1000;
      all = all.filter(c => (c.created_at || 0) >= ts);
    }
    if (date_to) {
      const ts = new Date(date_to + 'T23:59:59').getTime() / 1000;
      all = all.filter(c => (c.created_at || 0) <= ts);
    }

    const total = all.length;

    // By stage
    const byStage = {};
    STAGE_IDS.forEach(id => byStage[id] = 0);
    all.forEach(c => { const s = getStage(c); if (s) byStage[s]++; });

    // By date (day)
    const dateMap = {};
    all.forEach(c => {
      const key = new Date((c.created_at || 0) * 1000).toISOString().split('T')[0];
      if (!dateMap[key]) { dateMap[key] = { date: key, total: 0 }; STAGE_IDS.forEach(id => dateMap[key][id] = 0); }
      dateMap[key].total++;
      const s = getStage(c); if (s) dateMap[key][s]++;
    });

    // By agent
    const agentMap = {};
    all.forEach(c => {
      const ag = c?.meta?.assignee; if (!ag) return;
      if (!agentMap[ag.id]) { agentMap[ag.id] = { id:ag.id, name:ag.name||'Agente', total:0 }; STAGE_IDS.forEach(id => agentMap[ag.id][id] = 0); }
      agentMap[ag.id].total++;
      const s = getStage(c); if (s) agentMap[ag.id][s]++;
    });

    const pagos    = byStage['pago'] || 0;
    const perdidos = byStage['sem-retorno'] || 0;

    res.json({
      metrics: {
        total,
        byStage,
        conversion: total > 0 ? +((pagos   / total) * 100).toFixed(1) : 0,
        loss:       total > 0 ? +((perdidos / total) * 100).toFixed(1) : 0,
        negotiation:total > 0 ? +((byStage['negociacao'] / total) * 100).toFixed(1) : 0,
      },
      by_date:  Object.values(dateMap).sort((a,b) => a.date.localeCompare(b.date)),
      by_agent: Object.values(agentMap).sort((a,b) => b.total - a.total),
    });
  } catch (err) {
    console.error('[GET /dashboard]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   HEALTH CHECK
═══════════════════════════════════════════════════ */
app.get('/health', async (req, res) => {
  try {
    await cw('/profile');
    res.json({ ok: true, chatwoot: CHATWOOT_URL, account: ACCOUNT_ID });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message, chatwoot: CHATWOOT_URL });
  }
});

/* ═══════════════════════════════════════════════════
   START
═══════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n✅  T-CRM v4.0 → http://localhost:${PORT}`);
  console.log(`    Chatwoot  : ${CHATWOOT_URL}`);
  console.log(`    Conta     : ${ACCOUNT_ID}`);
  console.log(`\n    🔑 Login padrão:`);
  console.log(`    Email : supervisor@pvcorretor.com`);
  console.log(`    Senha : supervisor123\n`);
});
