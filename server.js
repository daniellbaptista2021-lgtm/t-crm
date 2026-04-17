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
const USERS_FILE = path.join(__dirname, 'users.json');

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}

function writeUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2));
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
app.use(express.static(path.join(__dirname, 'public')));

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

/* Busca todas as conversas (paginado) */
async function fetchAllConvs(assigneeId) {
  let all = [];
  for (let page = 1; page <= 10; page++) {
    const data  = await cw(`/conversations?page=${page}&sort=last_activity_at`);
    const batch = data?.data?.payload || [];
    all = all.concat(batch);
    if (batch.length < 25) break;
  }
  if (assigneeId) {
    all = all.filter(c => String(c?.meta?.assignee?.id) === String(assigneeId));
  }
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
    const { assignee_id } = req.query;
    // Vendedor só vê próprias conversas
    const filterId = (req.user.role === 'vendedor' && !assignee_id) ? null : assignee_id;
    const all = await fetchAllConvs(filterId || undefined);
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
  try { res.json(await cw(`/conversations/${req.params.id}/messages`)); }
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
    res.json(await cw(`/conversations/${req.params.id}/labels`, {
      method: 'POST', body: JSON.stringify({ labels: req.body.labels }),
    }));
  } catch (err) { console.error('[PATCH /label]', err.message); res.status(500).json({ error: err.message }); }
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
  'lancar-venda','pendente-pagamento','pago','sem-retorno',
];

function getStage(conv) {
  const ls = conv.labels || [];
  return STAGE_IDS.find(id => ls.includes(id)) || null;
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
