/* ═══════════════════════════════════════════════════
   T-CRM  app.js  v4.1
   Novidades:
   • Sidebar retrátil com estado persistente
   • Painéis: CRM, Dashboard, Agendamentos, Contatos
   • Coluna "Agendamento" no kanban
   • Modal de data/hora ao drop em Agendamento
   • Worker de alertas persistentes
   • Status Online/Ocupado/Offline
   • Theme switch interativo
═══════════════════════════════════════════════════ */
'use strict';

const API = '';

/* ── Columns (agendamento adicionado) ────────────── */
const COLUMNS = [
  { id:'lead',                    label:'Lead',                 color:'#2563eb', icon:'📣' },
  { id:'negociacao',              label:'Negociação',           color:'#0891b2', icon:'🤝' },
  { id:'aguardando-documentacao', label:'Aguard. Doc.',         color:'#7c3aed', icon:'📋' },
  { id:'aguardando-cotacao',      label:'Aguard. Cotação',      color:'#d97706', icon:'📊' },
  { id:'agendamento',             label:'Agendamento',          color:'#ec4899', icon:'📅' },
  { id:'lancar-venda',            label:'Lançar Venda',         color:'#059669', icon:'🚀' },
  { id:'pendente-pagamento',      label:'Pendente Pagamento',   color:'#dc2626', icon:'⏳' },
  { id:'pago',                    label:'Pago',                 color:'#047857', icon:'✅' },
  { id:'sem-retorno',             label:'Sem Retorno',          color:'#6b7280', icon:'🔕' },
  { id:'outros',                  label:'Outros',               color:'#475569', icon:'📦' },
];
const COL_MAP = Object.fromEntries(COLUMNS.map(c => [c.id, c]));
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

const CLRS = ['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#9333ea','#65a30d','#e11d48','#0284c7'];

/* ── State ───────────────────────────────────────── */
const S = {
  token: null, user: null,
  convs: [], convCache: {}, msgCache: {},
  agents: [], allLabels: [],
  activeId: null, pendingFile: null, selLabels: [],
  isRec: false, mediaRec: null, audioChunks: [],
  audioBlob: null, recSecs: 0, recInterval: null,
  boardTimer: null, msgTimer: null, searchTimer: null,
  dashCharts: {},
};

/* ── DOM ─────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const QA = s  => document.querySelectorAll(s);

/* ════════════════════════════════════════════════
   UTILS
════════════════════════════════════════════════ */
function esc(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function clr(n=''){let h=0;for(const c of n)h=(h*31+c.charCodeAt(0))&0xffffffff;return CLRS[Math.abs(h)%CLRS.length];}
function ini(n=''){return n.trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';}
function fmtT(ts){if(!ts)return'';const d=new Date(ts*1000),n=new Date();if(d.toDateString()===n.toDateString())return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});return Math.floor((n-d)/86400000)===1?'Ontem':d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});}
function fmtD(ts){if(!ts)return'';const d=new Date(ts*1000),n=new Date();if(d.toDateString()===n.toDateString())return'Hoje';if(Math.floor((n-d)/86400000)===1)return'Ontem';return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});}
function fmtSec(s){return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function fmtB(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB';}
function colOf(conv){
  const labels=(conv.labels||[]).map(normLabel);
  for(const raw of labels){
    const norm=LABEL_ALIASES[raw]||raw;
    const hit=COLUMNS.find(c=>c.id===norm);
    if(hit)return hit;
  }
  return COL_MAP['outros'];
}
function phone(conv){return conv.meta?.sender?.phone_number||conv.meta?.channel?.phone_number||'';}

function toast(msg,tp=''){const e=$('toast');e.textContent=msg;e.className=`show ${tp}`;clearTimeout(e._t);e._t=setTimeout(()=>e.className='',2800);}

/* ════════════════════════════════════════════════
   SIDEBAR
════════════════════════════════════════════════ */
function initSidebar() {
  const sb = $('sidebar');
  // Restaurar estado salvo
  const saved = localStorage.getItem('tcrm_sb');
  if (saved === '0') sb.classList.remove('sb-collapsed');
  else sb.classList.add('sb-collapsed');

  $('sb-toggle').addEventListener('click', () => {
    const collapsed = sb.classList.toggle('sb-collapsed');
    localStorage.setItem('tcrm_sb', collapsed ? '1' : '0');
  });

  // Navegação pelos botões da sidebar
  QA('.sb-item[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (panel) showPanel(panel);
    });
  });

  // Dashboard (sem panel — abre overlay)
  $('nav-dash').addEventListener('click', openDashboard);
}

function showPanel(id) {
  // Atualizar painéis
  QA('.panel').forEach(p => p.classList.remove('active'));
  const panel = $('panel-' + id);
  if (panel) panel.classList.add('active');

  // Atualizar sidebar
  QA('.sb-item').forEach(i => i.classList.remove('active'));
  const navBtn = $('nav-' + id);
  if (navBtn) navBtn.classList.add('active');

  // Carregar conteúdo do painel ao ativar
  if (id === 'schedules') renderSchedulesPanel();
}

/* ════════════════════════════════════════════════
   STATUS (Online/Ocupado/Offline)
════════════════════════════════════════════════ */
function initStatus() {
  const saved = localStorage.getItem('tcrm_status') || 'online';
  const sel = $('sb-status-sel');
  if (sel) sel.value = saved;
  updateStatusDot(saved);
  sel?.addEventListener('change', () => {
    const v = sel.value;
    localStorage.setItem('tcrm_status', v);
    updateStatusDot(v);
  });
}

function updateStatusDot(status) {
  const dot = $('sb-status-dot');
  if (!dot) return;
  dot.className = 'sb-status-dot ' + status;
}

/* ════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════ */
function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  document.body.classList.toggle('light', !dark);
  // Compat com botão legado
  const btn = $('theme-btn');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
  // Novo switch
  const sw = $('theme-toggle-sw');
  if (sw) sw.checked = dark;
}

function initTheme() {
  applyTheme(localStorage.getItem('tcrm_theme') === 'dark');
  // Novo switch interativo
  $('theme-toggle-sw')?.addEventListener('change', () => {
    const dark = $('theme-toggle-sw').checked;
    applyTheme(dark);
    localStorage.setItem('tcrm_theme', dark ? 'dark' : 'light');
  });
  // Compat botão legado (agora oculto, mas mantido)
  $('theme-btn')?.addEventListener('click', () => {
    const d = document.body.classList.contains('dark');
    applyTheme(!d);
    localStorage.setItem('tcrm_theme', d ? 'light' : 'dark');
  });
}

/* ════════════════════════════════════════════════
   API
════════════════════════════════════════════════ */
async function api(path,opts={}){
  const h={'Content-Type':'application/json'};
  if(S.token) h['Authorization']=`Bearer ${S.token}`;
  Object.assign(h,opts.headers||{});
  const r=await fetch(API+path,{...opts,headers:h});
  if(r.status===401){doLogout();return null;}
  if(!r.ok){const t=await r.text();throw new Error(t||`HTTP ${r.status}`);}
  return r.json();
}

/* ════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════ */
function showLogin(){$('login-page').classList.remove('hidden');$('app').classList.remove('visible');}
function showApp(){$('login-page').classList.add('hidden');$('app').classList.add('visible');}

function doLogout(){
  S.token=null;S.user=null;
  localStorage.removeItem('tcrm_token');localStorage.removeItem('tcrm_user');
  clearInterval(S.boardTimer);clearInterval(S.msgTimer);
  showLogin();toast('Sessão encerrada');
}

function applyUserUI(){
  const u=S.user;if(!u)return;
  $('hd-user-av').textContent=ini(u.name);
  $('hd-user-av').style.background=clr(u.name);
  $('hd-user-name').textContent=u.name;
  if($('hd-user-role'))$('hd-user-role').textContent=u.role;
  if(u.role==='supervisor'){
    $('config-btn').style.display='flex';
    const navCfg=$('nav-config');
    if(navCfg)navCfg.style.display='flex';
  }
  if(u.role==='vendedor'){
    $('sh-filter-wrap')?.style.setProperty('display','none');
  }
}

async function tryAutoLogin(){
  const token=localStorage.getItem('tcrm_token');
  const user=localStorage.getItem('tcrm_user');
  if(!token||!user)return showLogin();
  S.token=token;S.user=JSON.parse(user);
  try{
    const d=await api('/auth/me');if(!d)return;
    S.user=d.user;localStorage.setItem('tcrm_user',JSON.stringify(S.user));
    applyUserUI();showApp();await bootApp();
  }catch{doLogout();}
}

$('login-btn').addEventListener('click',doLogin);
$('login-pass').addEventListener('keydown',e=>e.key==='Enter'&&doLogin());

async function doLogin(){
  const email=$('login-email').value.trim();
  const pass=$('login-pass').value;
  const errEl=$('login-error');
  const btn=$('login-btn');
  errEl.classList.remove('show');
  if(!email||!pass){errEl.textContent='Preencha email e senha.';errEl.classList.add('show');return;}
  btn.disabled=true;$('login-btn-text').textContent='Entrando...';
  try{
    const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const j=await r.json();
    if(!r.ok){errEl.textContent=j.error||'Credenciais inválidas.';errEl.classList.add('show');return;}
    S.token=j.token;S.user=j.user;
    localStorage.setItem('tcrm_token',S.token);localStorage.setItem('tcrm_user',JSON.stringify(S.user));
    applyUserUI();showApp();await bootApp();
  }catch(err){
    errEl.textContent='Erro de conexão. Verifique se o servidor está rodando em localhost:3000.';
    errEl.classList.add('show');
  }finally{btn.disabled=false;$('login-btn-text').textContent='Entrar';}
}
$('logout-btn').addEventListener('click',doLogout);

/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */
async function bootApp(){
  buildBoard();
  populateDashAgentFilter();
  await Promise.all([loadAgents(),loadLabels()]);
  await loadConvs(true);
  clearInterval(S.boardTimer);
  S.boardTimer=setInterval(()=>loadConvs(false),3000);
  updateScheduleBadge();
  initScheduleWorker();
}

/* ════════════════════════════════════════════════
   AGENTS + LABELS
════════════════════════════════════════════════ */
async function loadAgents(){
  try{
    const d=await api('/agents');if(!d)return;
    S.agents=Array.isArray(d)?d:[];
    const sel=$('filter-agent');
    sel.innerHTML='<option value="">Todos</option>';
    S.agents.forEach(a=>{const o=document.createElement('option');o.value=a.id;o.textContent=a.name;sel.appendChild(o);});
    populateDashAgentFilter();
  }catch{}
}
async function loadLabels(){
  try{const d=await api('/labels');if(d)S.allLabels=Array.isArray(d)?d:[];}catch{}
}

/* ════════════════════════════════════════════════
   CONVERSATIONS / BOARD
════════════════════════════════════════════════ */
async function loadConvs(showLoader=false){
  if(showLoader)$('board-loading').classList.remove('hidden');
  try{
    const agentId=$('filter-agent').value;
    const d=await api('/conversations'+(agentId?`?assignee_id=${agentId}`:''));
    if(!d)return;
    const newConvs=d.conversations||[];
    const changed=hasChanged(newConvs);
    if(changed||showLoader){
      S.convs=newConvs;
      newConvs.forEach(c=>S.convCache[c.id]={id:c.id,last_activity_at:c.last_activity_at,unread_count:c.unread_count,labels:JSON.stringify(c.labels||[])});
      renderBoard();
    }
    $('tb-total').textContent=`${S.convs.length} conversa${S.convs.length!==1?'s':''}`;
    $('refresh-label').textContent=new Date().toLocaleTimeString('pt-BR');
  }catch(err){if(showLoader)toast('Erro: '+err.message,'err');}
  finally{$('board-loading').classList.add('hidden');}
}

function hasChanged(newList){
  if(newList.length!==S.convs.length)return true;
  for(const nc of newList){
    const oc=S.convCache[nc.id];
    if(!oc||oc.last_activity_at!==nc.last_activity_at||oc.unread_count!==nc.unread_count||oc.labels!==JSON.stringify(nc.labels||[]))
      return true;
  }
  return false;
}

function buildBoard(){
  $('board').innerHTML='';
  COLUMNS.forEach(col=>{
    const el=document.createElement('div');
    el.className='col';el.dataset.col=col.id;
    el.innerHTML=`
      <div class="col-head" style="background:${col.color}">
        <span class="col-icon">${col.icon}</span>
        <span class="col-title">${col.label}</span>
        <span class="col-count">0</span>
      </div>
      <div class="col-body" data-body="${col.id}"></div>`;
    $('board').appendChild(el);
  });
  setupDrop();
}

function renderBoard(){
  const groups={};COLUMNS.forEach(c=>groups[c.id]=[]);
  S.convs.forEach(conv=>{const col=colOf(conv);if(col)groups[col.id].push(conv);});

  COLUMNS.forEach(col=>{
    const body=document.querySelector(`[data-body="${col.id}"]`);
    const colEl=document.querySelector(`[data-col="${col.id}"]`);
    if(!body)return;
    const convos=groups[col.id];
    colEl.querySelector('.col-count').textContent=convos.length;
    const newIds=new Set(convos.map(c=>String(c.id)));
    [...body.querySelectorAll('.card')].forEach(c=>{if(!newIds.has(c.dataset.id))c.remove();});
    if(!convos.length){
      if(!body.querySelector('.col-empty'))body.innerHTML=`<div class="col-empty"><div class="col-empty-icon">📭</div>Nenhum cliente aqui</div>`;
      return;
    }
    body.querySelector('.col-empty')?.remove();
    convos.forEach(conv=>{
      const id=String(conv.id);
      let card=body.querySelector(`.card[data-id="${id}"]`);
      if(!card){card=mkCard(conv,col);body.appendChild(card);}
      else fillCard(card,conv,col);
    });
  });
}

function mkCard(conv,col){
  const card=document.createElement('div');
  card.className='card';card.dataset.id=conv.id;
  card.draggable=true;
  card.addEventListener('dragstart',onDragStart);
  card.addEventListener('click',()=>openChat(conv.id));
  fillCard(card,conv,col);
  if(String(conv.id)===String(S.activeId))card.classList.add('active');
  return card;
}

function fillCard(card,conv,col){
  const name=conv.meta?.sender?.name||'Sem nome';
  const ph=phone(conv)||'—';
  const agent=conv.meta?.assignee?.name||'Sem atribuição';
  const unread=conv.unread_count||0;
  const lastTs=conv.last_activity_at||conv.created_at;
  const preview=conv.last_non_activity_message?.content||(conv.last_non_activity_message?.attachments?.length?'📎 Anexo':'—');
  const avSrc=conv.meta?.sender?.avatar;
  const c=clr(name);
  card.style.setProperty('--card-color',col.color);
  card.classList.toggle('active',String(conv.id)===String(S.activeId));

  // Mostrar badge de agendamento se existir
  const sched = getScheduleForConv(conv.id);
  const schedTag = sched ? `<div class="card-sched-tag" title="Agendado: ${sched.date} ${sched.time}">📅 ${sched.time}</div>` : '';

  card.innerHTML=`
    <div class="card-top">
      <div class="card-av" style="background:${c}">${avSrc?`<img src="${avSrc}" loading="lazy" alt="">`:ini(name)}</div>
      <div class="card-meta">
        <div class="card-name">${esc(name)}</div>
        <div class="card-phone">📞 ${esc(ph)}</div>
      </div>
      ${unread>0?`<div class="card-unread">${unread}</div>`:''}
    </div>
    <div class="card-preview">${esc(preview)}</div>
    ${schedTag}
    <div class="card-foot">
      <span class="card-agent">${esc(agent)}</span>
      <span class="card-time">${fmtT(lastTs)}</span>
    </div>`;
}

/* ── Drag & Drop ─────────────────────────────────── */
let _dragId=null;
function onDragStart(e){_dragId=e.currentTarget.dataset.id;e.currentTarget.classList.add('dragging');e.dataTransfer.effectAllowed='move';}

function setupDrop(){
  QA('[data-body]').forEach(body=>{
    body.addEventListener('dragover',e=>{e.preventDefault();body.closest('.col').classList.add('drag-over');});
    body.addEventListener('dragleave',e=>{if(!body.contains(e.relatedTarget))body.closest('.col').classList.remove('drag-over');});
    body.addEventListener('drop',async e=>{
      e.preventDefault();
      const colEl=body.closest('.col');colEl.classList.remove('drag-over');
      const colId=colEl.dataset.col;if(!_dragId||!colId)return;
      const conv=S.convs.find(c=>String(c.id)===_dragId);if(!conv)return;
      const old=colOf(conv)?.id;if(old===colId)return;
      conv.labels=[...(conv.labels||[]).filter(l=>!COL_MAP[l]),colId];
      renderBoard();
      try{
        await api(`/conversations/${_dragId}/label`,{method:'PATCH',body:JSON.stringify({labels:conv.labels})});
        toast(`✓ Movido para "${COL_MAP[colId]?.label}"`, 'ok');
        if(String(S.activeId)===_dragId)refreshStageBtns(conv);
        // Gatilho de agendamento
        if(colId==='agendamento'){
          const name=conv.meta?.sender?.name||'Contato';
          openScheduleModal(_dragId,name);
        }
      }catch(err){toast('Erro: '+err.message,'err');await loadConvs();}
      QA('.card.dragging').forEach(c=>c.classList.remove('dragging'));_dragId=null;
    });
  });
}

/* ════════════════════════════════════════════════
   CHAT
════════════════════════════════════════════════ */
async function openChat(convId){
  S.activeId=convId;
  QA('.card').forEach(c=>c.classList.toggle('active',c.dataset.id===String(convId)));
  const conv=S.convs.find(c=>c.id==convId);if(!conv)return;
  const name=conv.meta?.sender?.name||'Contato';
  const ph=phone(conv)||'—';
  const avSrc=conv.meta?.sender?.avatar;
  const c=clr(name);
  const av=$('chat-av');av.style.background=c;av.innerHTML=avSrc?`<img src="${avSrc}" alt="">`:ini(name);
  $('chat-head-name').textContent=name;$('chat-head-phone').innerHTML=`📞 ${esc(ph)}`;
  refreshStageBtns(conv);initLddDrop(conv);
  $('chat-panel').classList.add('open');
  $('messages-area').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:60px;color:var(--text-3)"><div class="spinner-sm"></div>Carregando...</div>`;
  clearInterval(S.msgTimer);
  if(S.msgCache[convId])renderMsgs(S.msgCache[convId]);
  await loadMsgs(convId);
  S.msgTimer=setInterval(()=>loadMsgs(convId),3000);
}

function refreshStageBtns(conv){
  const cur=colOf(conv)?.id;
  $('stage-btns').innerHTML=COLUMNS.map(c=>`
    <button class="stage-btn ${c.id===cur?'active':''}" data-col="${c.id}" style="background:${c.color};border-color:${c.color}">
      ${c.icon} ${c.label}
    </button>`).join('');
  QA('#stage-btns .stage-btn').forEach(b=>b.addEventListener('click',()=>moveStage(S.activeId,b.dataset.col)));
}

async function moveStage(convId,colId){
  const conv=S.convs.find(c=>c.id==convId);if(!conv)return;
  const labels=[...(conv.labels||[]).filter(l=>!COL_MAP[l]),colId];
  try{
    await api(`/conversations/${convId}/label`,{method:'PATCH',body:JSON.stringify({labels})});
    conv.labels=labels;toast(`✓ Etapa: "${COL_MAP[colId]?.label}"`, 'ok');
    renderBoard();refreshStageBtns(conv);initLddDrop(conv);
    // Gatilho de agendamento via stage buttons
    if(colId==='agendamento'){
      const name=conv.meta?.sender?.name||'Contato';
      openScheduleModal(String(convId),name);
    }
  }catch(err){toast('Erro: '+err.message,'err');}
}

/* Labels dropdown */
function initLddDrop(conv){
  const cl=conv.labels||[];S.selLabels=[...cl];
  const chips=[
    ...COLUMNS.map(c=>({id:c.id,title:c.label,color:c.color})),
    ...S.allLabels.filter(l=>!COL_MAP[l.title?.toLowerCase()?.replace(/ /g,'-')]).map(l=>({id:l.title,title:l.title,color:l.color||'#64748b'})),
  ];
  $('ldd-grid').innerHTML=chips.map(l=>`
    <span class="lbl-chip ${cl.includes(l.id)?'on':''}" data-lid="${esc(l.id)}" style="background:${l.color};border-color:${l.color}">
      ${esc(l.title)}
    </span>`).join('');
  QA('#ldd-grid .lbl-chip').forEach(ch=>{
    ch.addEventListener('click',()=>{
      const lid=ch.dataset.lid;
      if(S.selLabels.includes(lid)){S.selLabels=S.selLabels.filter(x=>x!==lid);ch.classList.remove('on');}
      else{S.selLabels.push(lid);ch.classList.add('on');}
    });
  });
}
async function applyLabels(){
  const conv=S.convs.find(c=>c.id==S.activeId);if(!conv)return;
  try{
    await api(`/conversations/${S.activeId}/label`,{method:'PATCH',body:JSON.stringify({labels:S.selLabels})});
    conv.labels=[...S.selLabels];toast('✓ Etiquetas atualizadas','ok');
    renderBoard();refreshStageBtns(conv);$('labels-dropdown').classList.remove('open');
  }catch(err){toast('Erro: '+err.message,'err');}
}

/* ════════════════════════════════════════════════
   MESSAGES
════════════════════════════════════════════════ */
async function loadMsgs(convId){
  try{
    const d=await api(`/messages/${convId}`);if(!d)return;
    const msgs=d?.payload||[];
    const cached=S.msgCache[convId]||[];
    if(msgs[msgs.length-1]?.id!==cached[cached.length-1]?.id||msgs.length!==cached.length){
      S.msgCache[convId]=msgs;
      if(String(S.activeId)===String(convId))renderMsgs(msgs);
    }
  }catch{}
}

function renderMsgs(msgs){
  const atBot=$('messages-area').scrollHeight-$('messages-area').scrollTop-$('messages-area').clientHeight<80;
  const sorted=[...msgs].sort((a,b)=>a.created_at-b.created_at);
  $('messages-area').innerHTML='';let lastDate='';
  sorted.forEach(msg=>{
    const dl=fmtD(msg.created_at);
    if(dl!==lastDate){const d=document.createElement('div');d.className='msg-div';d.textContent=dl;$('messages-area').appendChild(d);lastDate=dl;}
    $('messages-area').appendChild(buildMsg(msg));
  });
  if(atBot||msgs.length<=12)$('messages-area').scrollTop=$('messages-area').scrollHeight;
}

function buildMsg(msg){
  const isOut=msg.message_type===1||msg.message_type==='outgoing';
  const wrap=document.createElement('div');wrap.className=`message ${isOut?'out':'in'}`;
  const sn=isOut?'Agente':(msg.sender?.name||'Contato');const sc=clr(sn);const sav=msg.sender?.avatar_url||msg.sender?.avatar;
  wrap.innerHTML=`
    <div class="msg-av" style="background:${sc}">${sav?`<img src="${sav}" alt="">`:ini(sn)}</div>
    <div><div class="msg-bub">${buildMsgBody(msg)}<div class="msg-time">${fmtT(msg.created_at)} ${isOut?'✓✓':''}</div></div></div>`;
  return wrap;
}

function buildMsgBody(msg){
  const atts=msg.attachments||[];let h='';
  if(msg.content)h+=`<div>${esc(msg.content)}</div>`;
  atts.forEach(att=>{
    const url=att.data_url||att.file_url||'';const tp=att.file_type||'';const nm=att.file_name||'arquivo';
    if(tp==='image')h+=`<img class="msg-img" src="${url}" alt="" onclick="window._lb('${url}')" loading="lazy">`;
    else if(tp==='video')h+=`<video class="msg-video" src="${url}" controls preload="metadata"></video>`;
    else if(tp==='audio')h+=`<audio class="msg-audio" src="${url}" controls></audio>`;
    else h+=`<a class="msg-file" href="${url}" target="_blank" rel="noopener">📎 <span>${esc(nm)}</span></a>`;
  });
  if(!h)h='<em style="opacity:.4">mensagem sem conteúdo</em>';
  return h;
}

/* ── Send ────────────────────────────────────────── */
async function sendMsg(){
  const convId=S.activeId;const content=$('msg-input').value.trim();
  if(S.pendingFile){await sendMedia(convId,content);return;}
  if(!content||!convId)return;
  $('msg-input').value='';$('msg-input').style.height='';
  try{await api(`/messages/${convId}`,{method:'POST',body:JSON.stringify({content})});await loadMsgs(convId);}
  catch(err){toast('Erro: '+err.message,'err');$('msg-input').value=content;}
}
async function sendMedia(convId,caption=''){
  const file=S.pendingFile;clearFP();
  const form=new FormData();form.append('file',file,file.name||'arquivo');if(caption)form.append('content',caption);
  try{
    const h={};if(S.token)h['Authorization']=`Bearer ${S.token}`;
    const r=await fetch(`${API}/media/${convId}`,{method:'POST',headers:h,body:form});
    if(!r.ok)throw new Error(await r.text());
    await loadMsgs(convId);toast('✓ Arquivo enviado','ok');
  }catch(err){toast('Erro: '+err.message,'err');}
}

/* ── File ────────────────────────────────────────── */
function onFile(file){
  if(!file)return;S.pendingFile=file;$('fp-bar').classList.add('on');
  $('fp-name').textContent=file.name;$('fp-size').textContent=fmtB(file.size);
  const thumb=$('fp-thumb');
  if(file.type.startsWith('image/')){const r=new FileReader();r.onload=e=>{const i=document.createElement('img');i.src=e.target.result;i.style.cssText='width:44px;height:44px;object-fit:cover;border-radius:7px;';thumb.innerHTML='';thumb.appendChild(i);};r.readAsDataURL(file);}
  else{const icons={'video/':'🎬','audio/':'🎵','application/pdf':'📄'};thumb.textContent=Object.entries(icons).find(([k])=>file.type.startsWith(k))?.[1]||'📎';}
}
function clearFP(){S.pendingFile=null;$('fp-bar').classList.remove('on');$('fp-thumb').textContent='';$('fp-name').textContent='';$('fp-size').textContent='';$('file-input').value='';$('msg-input').value='';}

/* ── Audio ───────────────────────────────────────── */
async function startRec(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const types=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
    const mime=types.find(t=>MediaRecorder.isTypeSupported(t))||'';
    S.audioChunks=[];S.audioBlob=null;
    S.mediaRec=new MediaRecorder(stream,mime?{mimeType:mime}:{});
    S.mediaRec.ondataavailable=e=>{if(e.data&&e.data.size>0)S.audioChunks.push(e.data);};
    S.mediaRec.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      S.audioBlob=new Blob(S.audioChunks,{type:mime||'audio/webm'});
      $('audio-preview').src=URL.createObjectURL(S.audioBlob);
      $('audio-preview-wrap').classList.add('on');
      $('rec-stop').style.display='none';$('rec-send').style.display='flex';$('rec-txt').textContent='Pronto para enviar';
    };
    S.mediaRec.start(250);S.isRec=true;S.recSecs=0;
    $('rec-ui').classList.add('on');$('rec-txt').textContent='Gravando...';$('rec-timer').textContent='00:00';
    $('audio-preview-wrap').classList.remove('on');$('rec-stop').style.display='flex';$('rec-send').style.display='none';
    S.recInterval=setInterval(()=>{S.recSecs++;$('rec-timer').textContent=fmtSec(S.recSecs);},1000);
    toast('🎙️ Gravando...');
  }catch{toast('Microfone não disponível','err');}
}
function stopRec(){if(S.mediaRec&&S.mediaRec.state!=='inactive')S.mediaRec.stop();S.isRec=false;clearInterval(S.recInterval);}
function cancelRec(){
  if(S.mediaRec&&S.mediaRec.state!=='inactive'){S.mediaRec.stream?.getTracks().forEach(t=>t.stop());S.mediaRec.stop();}
  S.isRec=false;S.audioBlob=null;S.audioChunks=[];clearInterval(S.recInterval);
  $('rec-ui').classList.remove('on');$('audio-preview-wrap').classList.remove('on');$('audio-preview').src='';toast('Gravação cancelada');
}
async function sendAudio(){
  if(!S.audioBlob||!S.activeId)return;
  const ext=S.audioBlob.type.includes('ogg')?'ogg':S.audioBlob.type.includes('mp4')?'mp4':'webm';
  const file=new File([S.audioBlob],`audio_${Date.now()}.${ext}`,{type:S.audioBlob.type});
  $('rec-ui').classList.remove('on');$('audio-preview-wrap').classList.remove('on');$('audio-preview').src='';S.audioBlob=null;S.audioChunks=[];
  const form=new FormData();form.append('file',file,file.name);
  try{
    toast('Enviando áudio...');
    const h={};if(S.token)h['Authorization']=`Bearer ${S.token}`;
    const r=await fetch(`${API}/media/${S.activeId}`,{method:'POST',headers:h,body:form});
    if(!r.ok)throw new Error(await r.text());
    await loadMsgs(S.activeId);toast('✓ Áudio enviado!','ok');
  }catch(err){toast('Erro ao enviar áudio: '+err.message,'err');}
}

/* ════════════════════════════════════════════════
   SEARCH
════════════════════════════════════════════════ */
function onSearch(){
  const q=$('global-search').value.trim();$('gs-clear').classList.toggle('visible',q.length>0);
  clearTimeout(S.searchTimer);
  if(!q){closeSearch();return;}
  $('search-results').classList.add('open');
  $('search-results').innerHTML='<div class="search-hint"><div class="spinner-sm"></div>Buscando...</div>';
  S.searchTimer=setTimeout(()=>doSearch(q),350);
}
async function doSearch(q){
  try{
    const d=await api(`/contacts/search?q=${encodeURIComponent(q)}`);if(!d)return;
    const contacts=d?.payload||[];
    if(!contacts.length){$('search-results').innerHTML='<div class="search-hint">Nenhum contato encontrado.</div>';return;}
    $('search-results').innerHTML=contacts.slice(0,20).map(c=>`
      <div class="sri" data-cid="${c.id}">
        <div class="sri-av" style="background:${clr(c.name||'')}">${c.avatar?`<img src="${c.avatar}" alt="">`:ini(c.name||'')}</div>
        <div><div class="sri-name">${esc(c.name||'Sem nome')}</div><div class="sri-phone">📞 ${esc(c.phone_number||'—')}</div></div>
      </div>`).join('');
    QA('#search-results .sri').forEach(el=>el.addEventListener('click',()=>openContactConv(el.dataset.cid)));
  }catch(err){$('search-results').innerHTML=`<div class="search-hint">Erro: ${esc(err.message)}</div>`;}
}
async function openContactConv(cid){
  closeSearch();
  try{
    const d=await api(`/contacts/${cid}/conversations`);if(!d)return;
    const convs=d?.payload||[];
    if(!convs.length){toast('Nenhuma conversa encontrada','err');return;}
    const latest=convs.sort((a,b)=>b.id-a.id)[0];
    if(!S.convs.find(c=>c.id===latest.id)){S.convs.push(latest);renderBoard();}
    showPanel('crm');
    openChat(latest.id);
  }catch(err){toast('Erro: '+err.message,'err');}
}
function closeSearch(){$('search-results').classList.remove('open');$('search-results').innerHTML='';}

/* ════════════════════════════════════════════════
   CONTACTS PANEL
════════════════════════════════════════════════ */
async function loadContactsPanel(query='') {
  const list = $('contacts-list');
  if (!query) {
    list.innerHTML = '<div class="panel-empty"><div class="panel-empty-icon">🔍</div>Use a busca acima para encontrar contatos.</div>';
    return;
  }
  list.innerHTML = '<div class="panel-loading"><div class="spinner-sm"></div> Buscando...</div>';
  try {
    const d = await api(`/contacts/search?q=${encodeURIComponent(query)}`);
    const contacts = d?.payload || [];
    if (!contacts.length) {
      list.innerHTML = '<div class="panel-empty"><div class="panel-empty-icon">📭</div>Nenhum contato encontrado.</div>';
      return;
    }
    list.innerHTML = contacts.slice(0, 50).map(c => `
      <div class="contact-row">
        <div class="contact-av" style="background:${clr(c.name||'')}">${c.avatar ? `<img src="${c.avatar}" alt="">` : ini(c.name || '')}</div>
        <div class="contact-info">
          <div class="contact-name">${esc(c.name || 'Sem nome')}</div>
          <div class="contact-phone">📞 ${esc(c.phone_number || '—')}</div>
          ${c.email ? `<div class="contact-email">✉️ ${esc(c.email)}</div>` : ''}
        </div>
        <button class="contact-open-btn" data-cid="${c.id}">Abrir chat →</button>
      </div>`).join('');
    list.querySelectorAll('.contact-open-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await openContactConv(btn.dataset.cid);
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="panel-empty">Erro: ${esc(err.message)}</div>`;
  }
}

/* ════════════════════════════════════════════════
   SCHEDULES — ARMAZENAMENTO
════════════════════════════════════════════════ */
function getSchedules() {
  try { return JSON.parse(localStorage.getItem('tcrm_schedules') || '[]'); }
  catch { return []; }
}

function saveSchedules(list) {
  localStorage.setItem('tcrm_schedules', JSON.stringify(list));
}

function getScheduleForConv(convId) {
  return getSchedules().find(s => String(s.convId) === String(convId)) || null;
}

function deleteSchedule(convId) {
  saveSchedules(getSchedules().filter(s => String(s.convId) !== String(convId)));
  renderSchedulesPanel();
  updateScheduleBadge();
  toast('✓ Agendamento removido', 'ok');
}

function updateScheduleBadge() {
  const upcoming = getSchedules().filter(s => !s.alerted).length;
  const badge = $('sched-badge');
  if (!badge) return;
  if (upcoming > 0) {
    badge.textContent = upcoming;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

/* ════════════════════════════════════════════════
   SCHEDULE MODAL
════════════════════════════════════════════════ */
let _schedConvId = null;
let _schedConvName = null;

function openScheduleModal(convId, name) {
  _schedConvId = String(convId);
  _schedConvName = name;
  $('scm-contact-name').textContent = name;

  // Verificar se já tem agendamento existente
  const existing = getScheduleForConv(convId);
  if (existing) {
    $('scm-date').value = existing.date;
    $('scm-time').value = existing.time;
    $('scm-note').value = existing.note || '';
  } else {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    $('scm-date').value = tomorrow.toISOString().split('T')[0];
    $('scm-time').value = '09:00';
    $('scm-note').value = '';
  }
  $('schedule-modal').classList.add('open');
}

function closeScheduleModal() {
  $('schedule-modal').classList.remove('open');
  _schedConvId = null;
  _schedConvName = null;
}

function saveSchedule() {
  const date = $('scm-date').value;
  const time = $('scm-time').value;
  const note = $('scm-note').value.trim();
  if (!date || !time) { toast('Selecione data e horário', 'err'); return; }

  const schedules = getSchedules().filter(s => s.convId !== _schedConvId);
  schedules.push({
    convId: _schedConvId,
    name: _schedConvName,
    date, time, note,
    datetime: `${date}T${time}:00`,
    createdAt: new Date().toISOString(),
    alerted: false,
  });
  saveSchedules(schedules);
  toast('✓ Agendamento salvo', 'ok');
  closeScheduleModal();
  renderSchedulesPanel();
  renderBoard(); // atualizar badge nas cards
  updateScheduleBadge();
}

/* ════════════════════════════════════════════════
   SCHEDULE WORKER + ALERTA
════════════════════════════════════════════════ */
let _currentAlert = null;
let _alertRepeatTimer = null;

function initScheduleWorker() {
  checkSchedules();
  setInterval(checkSchedules, 30 * 1000); // a cada 30s
}

function checkSchedules() {
  const schedules = getSchedules();
  const now = new Date();
  let updated = false;

  for (const sched of schedules) {
    if (sched.alerted) continue;
    const dt = new Date(sched.datetime);
    if (dt <= now) {
      showScheduleAlert(sched);
      sched.alerted = true;
      updated = true;
      break; // um alerta por vez
    }
  }

  if (updated) {
    saveSchedules(schedules);
    updateScheduleBadge();
  }
}

function showScheduleAlert(sched) {
  _currentAlert = sched;
  $('sal-name').textContent = sched.name;
  const [y, m, d] = sched.date.split('-');
  $('sal-time').textContent = `${d}/${m}/${y} às ${sched.time}`;
  $('sal-note').textContent = sched.note || '';
  $('sal-note').style.display = sched.note ? 'block' : 'none';
  $('schedule-alert').classList.add('show');

  // Repetir som/notificação a cada 60s enquanto não dispensar
  clearInterval(_alertRepeatTimer);
  _alertRepeatTimer = setInterval(() => {
    if ($('schedule-alert').classList.contains('show')) {
      // Piscar para chamar atenção
      $('schedule-alert').style.transform = 'scale(1.03)';
      setTimeout(() => { $('schedule-alert').style.transform = ''; }, 300);
    } else {
      clearInterval(_alertRepeatTimer);
    }
  }, 60 * 1000);

  // Notificação nativa do browser (se permitido)
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('T-CRM — Retorno agendado!', {
      body: `${sched.name} — ${d}/${m}/${y} às ${sched.time}`,
      icon: '/favicon.ico',
    });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

function dismissAlert() {
  $('schedule-alert').classList.remove('show');
  clearInterval(_alertRepeatTimer);
  _currentAlert = null;
}

/* ════════════════════════════════════════════════
   SCHEDULE PANEL RENDER
════════════════════════════════════════════════ */
function renderSchedulesPanel() {
  const el = $('schedules-list');
  if (!el) return;
  const schedules = getSchedules();
  if (!schedules.length) {
    el.innerHTML = '<div class="panel-empty"><div class="panel-empty-icon">📅</div>Nenhum agendamento criado ainda. Arraste um card para a coluna "Agendamento" no CRM.</div>';
    return;
  }
  const sorted = [...schedules].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const now = new Date();

  el.innerHTML = sorted.map(s => {
    const dt = new Date(s.datetime);
    const isPast = dt < now;
    const isToday = dt.toDateString() === now.toDateString();
    const [y, m, d] = s.date.split('-');
    return `<div class="sched-row ${isPast ? 'past' : isToday ? 'today' : ''}">
      ${isToday ? '<span class="sched-tag-today">Hoje</span>' : ''}
      <div class="sched-av" style="background:${clr(s.name)}">${ini(s.name)}</div>
      <div class="sched-info">
        <div class="sched-name">${esc(s.name)}</div>
        <div class="sched-time">📅 ${d}/${m}/${y} às ${s.time}</div>
        ${s.note ? `<div class="sched-note">${esc(s.note)}</div>` : ''}
      </div>
      <div class="sched-actions">
        <button class="sched-open" data-id="${s.convId}">→ Chat</button>
        <button class="sched-del" data-id="${s.convId}" title="Remover">🗑</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.sched-open').forEach(btn => {
    btn.addEventListener('click', () => {
      showPanel('crm');
      openChat(btn.dataset.id);
    });
  });
  el.querySelectorAll('.sched-del').forEach(btn => {
    btn.addEventListener('click', () => deleteSchedule(btn.dataset.id));
  });
}

/* ════════════════════════════════════════════════
   CONFIG PANEL
════════════════════════════════════════════════ */
let _editId=null;
async function openConfig(){$('config-panel').classList.add('open');$('user-form').classList.remove('open');_editId=null;await refreshUsersList();}
function closeConfig(){$('config-panel').classList.remove('open');}
async function refreshUsersList(){
  try{
    const users=await api('/users');if(!users)return;
    $('users-list').innerHTML=users.map(u=>`
      <div class="user-row">
        <div class="user-row-av" style="background:${clr(u.name)}">${ini(u.name)}</div>
        <div class="user-row-info"><div class="user-row-name">${esc(u.name)}</div><div class="user-row-email">${esc(u.email)}</div></div>
        <span class="role-badge ${u.role}">${u.role}</span>
        <div class="user-actions">
          <button class="ua-btn edit" data-id="${u.id}">✏️</button>
          ${u.id!==S.user?.id?`<button class="ua-btn del" data-id="${u.id}">🗑️</button>`:''}
        </div>
      </div>`).join('');
    QA('#users-list .ua-btn.edit').forEach(b=>b.addEventListener('click',()=>startEdit(b.dataset.id,users)));
    QA('#users-list .ua-btn.del').forEach(b=>b.addEventListener('click',()=>delUser(b.dataset.id)));
  }catch(err){toast('Erro: '+err.message,'err');}
}
function startEdit(id,users){
  const u=users.find(x=>x.id===id);if(!u)return;
  _editId=id;$('uf-name').value=u.name;$('uf-email').value=u.email;$('uf-pass').value='';$('uf-role').value=u.role;
  $('uf-pass-hint').style.display='inline';$('uf-title').textContent='Editar usuário';$('user-form').classList.add('open');
}
$('cfg-add-btn').addEventListener('click',()=>{_editId=null;$('uf-name').value='';$('uf-email').value='';$('uf-pass').value='';$('uf-role').value='vendedor';$('uf-pass-hint').style.display='none';$('uf-title').textContent='Novo usuário';$('user-form').classList.add('open');});
$('uf-cancel').addEventListener('click',()=>$('user-form').classList.remove('open'));
$('uf-save').addEventListener('click',async()=>{
  const name=$('uf-name').value.trim();const email=$('uf-email').value.trim();const pass=$('uf-pass').value;const role=$('uf-role').value;
  if(!name||!email){toast('Preencha nome e email','err');return;}
  if(!_editId&&!pass){toast('Defina uma senha','err');return;}
  try{
    const body={name,email,role};if(pass)body.password=pass;
    if(_editId)await api(`/users/${_editId}`,{method:'PUT',body:JSON.stringify(body)});
    else await api('/users',{method:'POST',body:JSON.stringify({...body,password:pass})});
    toast(`✓ Usuário ${_editId?'atualizado':'criado'}`,'ok');$('user-form').classList.remove('open');await refreshUsersList();
  }catch(err){toast('Erro: '+err.message,'err');}
});
async function delUser(id){
  if(!confirm('Excluir este usuário?'))return;
  try{await api(`/users/${id}`,{method:'DELETE'});toast('✓ Excluído','ok');await refreshUsersList();}
  catch(err){toast('Erro: '+err.message,'err');}
}

/* ════════════════════════════════════════════════
   LIGHTBOX
════════════════════════════════════════════════ */
window._lb=src=>{$('lb-img').src=src;$('lightbox').classList.add('open');};

/* ════════════════════════════════════════════════
   ██████████ DASHBOARD ██████████
════════════════════════════════════════════════ */
function populateDashAgentFilter(){
  const sel=$('dash-filter-agent');if(!sel)return;
  sel.innerHTML='<option value="">Todos os vendedores</option>';
  S.agents.forEach(a=>{const o=document.createElement('option');o.value=a.id;o.textContent=a.name;sel.appendChild(o);});
  if(S.user?.role==='vendedor'){
    sel.disabled=true;
    const own=S.agents.find(a=>a.email===S.user.email||a.name===S.user.name);
    if(own)sel.value=own.id;
  }
}

function openDashboard(){
  $('dashboard-overlay').classList.add('open');
  const today=new Date();
  const past=new Date();past.setDate(past.getDate()-29);
  if(!$('dash-date-to').value)$('dash-date-to').value=today.toISOString().split('T')[0];
  if(!$('dash-date-from').value)$('dash-date-from').value=past.toISOString().split('T')[0];
  renderDashboard();
}

function closeDashboard(){
  $('dashboard-overlay').classList.remove('open');
  destroyDashCharts();
}

function getFilteredConvs(){
  let convs=[...S.convs];
  const agentId=$('dash-filter-agent').value;
  const from=$('dash-date-from').value;
  const to=$('dash-date-to').value;
  if(agentId) convs=convs.filter(c=>String(c?.meta?.assignee?.id)===agentId);
  if(from){const ts=new Date(from).getTime()/1000;convs=convs.filter(c=>(c.created_at||0)>=ts);}
  if(to){const ts=new Date(to+'T23:59:59').getTime()/1000;convs=convs.filter(c=>(c.created_at||0)<=ts);}
  return convs;
}

function computeDashData(convs){
  const total=convs.length;
  const byStage={};COLUMNS.forEach(c=>byStage[c.id]=0);
  convs.forEach(conv=>{const col=colOf(conv);if(col)byStage[col.id]++;});
  const dateMap={};
  convs.forEach(conv=>{
    const key=new Date((conv.created_at||0)*1000).toISOString().split('T')[0];
    if(!dateMap[key]){dateMap[key]={date:key,total:0};COLUMNS.forEach(c=>dateMap[key][c.id]=0);}
    dateMap[key].total++;const col=colOf(conv);if(col)dateMap[key][col.id]++;
  });
  const agentMap={};
  convs.forEach(conv=>{
    const ag=conv?.meta?.assignee;if(!ag)return;
    if(!agentMap[ag.id]){agentMap[ag.id]={id:ag.id,name:ag.name||'Agente',total:0};COLUMNS.forEach(c=>agentMap[ag.id][c.id]=0);}
    agentMap[ag.id].total++;const col=colOf(conv);if(col)agentMap[ag.id][col.id]++;
  });
  const pagos=byStage['pago']||0;
  const perdidos=byStage['sem-retorno']||0;
  const negociacao=byStage['negociacao']||0;
  return{
    total,byStage,
    conv:total>0?+((pagos/total)*100).toFixed(1):0,
    loss:total>0?+((perdidos/total)*100).toFixed(1):0,
    neg:total>0?+((negociacao/total)*100).toFixed(1):0,
    by_date:Object.values(dateMap).sort((a,b)=>a.date.localeCompare(b.date)),
    by_agent:Object.values(agentMap).sort((a,b)=>b.total-a.total),
  };
}

function renderDashboard(){
  const convs=getFilteredConvs();
  const data=computeDashData(convs);
  renderKPI(data);
  destroyDashCharts();
  renderTimelineChart(data);
  renderDonutChart(data);
  renderAgentTable(data);
}

function renderKPI(data){
  const row=$('dash-kpi-row');
  const cards=[
    {label:'Total de leads recebidos',  value:data.total,              icon:'📣', color:'#2563eb', sub:'conversas no período', badge:null},
    {label:'Taxa de conversão',          value:data.conv+'%',           icon:'✅', color:'#047857', sub:'leads pagos / total',  badge:{txt:data.conv>0?'Positivo':'—',cls:data.conv>10?'up':data.conv>0?'neu':'down'}},
    {label:'Taxa de perda',              value:data.loss+'%',           icon:'🔕', color:'#dc2626', sub:'sem retorno / total',  badge:{txt:data.loss>30?'Alta':'Normal',cls:data.loss>30?'down':'up'}},
    {label:'Em negociação',              value:data.neg+'%',            icon:'🤝', color:'#0891b2', sub:'negociação / total',   badge:null},
  ];
  row.innerHTML=cards.map(c=>`
    <div class="kpi-card" style="--kpi-color:${c.color};--kpi-icon:'${c.icon}'">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub">
        ${c.sub}
        ${c.badge?`<span class="kpi-badge ${c.badge.cls}">${c.badge.txt}</span>`:''}
      </div>
    </div>`).join('');
}

function renderTimelineChart(data){
  const ctx=$('chart-timeline')?.getContext('2d');if(!ctx)return;
  const isDark=document.body.classList.contains('dark');
  const txtClr=isDark?'#94a3b8':'#667085';
  const gridClr=isDark?'rgba(255,255,255,.07)':'rgba(0,0,0,.06)';
  const dates=data.by_date.map(d=>d.date);
  const datasets=[
    {label:'Lead',               data:data.by_date.map(d=>d['lead']||0),                  backgroundColor:'rgba(37,99,235,.75)',   borderRadius:4},
    {label:'Negociação',         data:data.by_date.map(d=>d['negociacao']||0),             backgroundColor:'rgba(8,145,178,.75)',   borderRadius:4},
    {label:'Agendamento',        data:data.by_date.map(d=>d['agendamento']||0),            backgroundColor:'rgba(236,72,153,.7)',   borderRadius:4},
    {label:'Pendente Pagamento', data:data.by_date.map(d=>d['pendente-pagamento']||0),     backgroundColor:'rgba(220,38,38,.7)',    borderRadius:4},
    {label:'Pago',               data:data.by_date.map(d=>d['pago']||0),                  backgroundColor:'rgba(4,120,87,.75)',    borderRadius:4},
    {label:'Sem retorno',        data:data.by_date.map(d=>d['sem-retorno']||0),            backgroundColor:'rgba(107,114,128,.6)', borderRadius:4},
  ];
  S.dashCharts['timeline']=new Chart(ctx,{
    type:'bar',
    data:{labels:dates.length?dates:['Sem dados'],datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'top',labels:{font:{family:'DM Sans',size:11},color:txtClr,boxWidth:12,padding:16}},tooltip:{backgroundColor:isDark?'#1e293b':'#fff',titleColor:isDark?'#f1f5f9':'#101828',bodyColor:isDark?'#94a3b8':'#475467',borderColor:isDark?'#334155':'#e4e7ec',borderWidth:1}},
      scales:{
        x:{grid:{color:gridClr},ticks:{color:txtClr,font:{family:'DM Sans',size:11},maxRotation:45}},
        y:{grid:{color:gridClr},ticks:{color:txtClr,font:{family:'DM Sans',size:11},precision:0},beginAtZero:true},
      },
    },
  });
}

function renderDonutChart(data){
  const ctx=$('chart-donut')?.getContext('2d');if(!ctx)return;
  const isDark=document.body.classList.contains('dark');
  const txtClr=isDark?'#94a3b8':'#667085';
  const labels=COLUMNS.map(c=>c.label);
  const vals=COLUMNS.map(c=>data.byStage[c.id]||0);
  const colors=COLUMNS.map(c=>c.color);
  const hasData=vals.some(v=>v>0);
  if(!hasData){
    ctx.canvas.parentElement.innerHTML=`<div class="dash-empty"><div class="dash-empty-icon">📭</div>Sem dados para o período selecionado</div>`;
    return;
  }
  S.dashCharts['donut']=new Chart(ctx,{
    type:'doughnut',
    data:{labels,datasets:[{data:vals,backgroundColor:colors.map(c=>c+'cc'),borderColor:colors,borderWidth:2,hoverOffset:8}]},
    options:{
      responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{
        legend:{position:'right',labels:{font:{family:'DM Sans',size:11},color:txtClr,boxWidth:12,padding:10,filter:(item,chart)=>chart.data.datasets[0].data[item.index]>0}},
        tooltip:{backgroundColor:isDark?'#1e293b':'#fff',titleColor:isDark?'#f1f5f9':'#101828',bodyColor:isDark?'#94a3b8':'#475467',borderColor:isDark?'#334155':'#e4e7ec',borderWidth:1,callbacks:{label:(ctx)=>`${ctx.label}: ${ctx.parsed} (${total(vals)>0?(ctx.parsed/total(vals)*100).toFixed(1):'0'}%)`}},
      },
    },
  });
}
function total(arr){return arr.reduce((a,b)=>a+b,0);}

function renderAgentTable(data){
  const el=$('dash-agent-table');if(!el)return;
  if(!data.by_agent.length){
    el.innerHTML=`<div class="dash-empty"><div class="dash-empty-icon">👤</div>Nenhum agente encontrado para este período</div>`;return;
  }
  const rankColors=['#f59e0b','#94a3b8','#cd7c3a'];
  el.innerHTML=`<table class="agent-table">
    <thead><tr>
      <th>#</th><th>Vendedor</th><th>Total</th><th>Pago</th><th>Perda</th><th>Conversão</th><th>Funil</th>
    </tr></thead>
    <tbody>
      ${data.by_agent.map((ag,i)=>{
        const pago=ag['pago']||0;
        const perda=ag['sem-retorno']||0;
        const conv=ag.total>0?((pago/ag.total)*100).toFixed(1):0;
        const pct=ag.total>0?(pago/ag.total*100):0;
        const rc=rankColors[i]||'#64748b';
        return`<tr>
          <td><div class="agent-rank-wrap"><div class="agent-rank" style="background:${rc}">${i+1}</div></div></td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="card-av" style="background:${clr(ag.name)};width:28px;height:28px;font-size:10.5px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">${ini(ag.name)}</div>${esc(ag.name)}</div></td>
          <td><strong>${ag.total}</strong></td>
          <td style="color:#047857;font-weight:600">${pago}</td>
          <td style="color:#dc2626;font-weight:600">${perda}</td>
          <td><span style="font-weight:700;color:${+conv>15?'#047857':+conv>5?'#d97706':'#dc2626'}">${conv}%</span></td>
          <td><div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:${Math.min(pct,100)}%;background:${+conv>15?'#047857':+conv>5?'#d97706':'#dc2626'}"></div></div><span class="prog-pct" style="color:var(--text-3)">${pago}/${ag.total}</span></div></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function destroyDashCharts(){
  Object.values(S.dashCharts).forEach(c=>{try{c.destroy();}catch{}});
  Object.keys(S.dashCharts).forEach(k=>delete S.dashCharts[k]);
}

/* ════════════════════════════════════════════════
   EVENT BINDINGS
════════════════════════════════════════════════ */
function bindEvents(){
  /* Chat */
  $('chat-close').addEventListener('click',()=>{
    $('chat-panel').classList.remove('open');clearInterval(S.msgTimer);S.activeId=null;
    QA('.card.active').forEach(c=>c.classList.remove('active'));cancelRec();
  });
  $('send-btn').addEventListener('click',sendMsg);
  $('msg-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
  $('msg-input').addEventListener('input',()=>{$('msg-input').style.height='auto';$('msg-input').style.height=Math.min($('msg-input').scrollHeight,100)+'px';});

  /* File */
  $('attach-btn').addEventListener('click',()=>$('file-input').click());
  $('file-input').addEventListener('change',e=>e.target.files[0]&&onFile(e.target.files[0]));
  $('fp-rm').addEventListener('click',clearFP);
  $('msg-input').addEventListener('paste',e=>{
    for(const item of e.clipboardData?.items||[])if(item.type.startsWith('image/')){onFile(item.getAsFile());e.preventDefault();break;}
  });

  /* Audio */
  $('record-btn').addEventListener('click',()=>!S.isRec&&startRec());
  $('rec-stop').addEventListener('click',stopRec);
  $('rec-cancel').addEventListener('click',cancelRec);
  $('rec-send').addEventListener('click',sendAudio);

  /* Labels */
  $('labels-btn').addEventListener('click',e=>{e.stopPropagation();$('labels-dropdown').classList.toggle('open');});
  document.addEventListener('click',e=>{
    if(!$('labels-btn')?.contains(e.target)&&!$('labels-dropdown')?.contains(e.target))$('labels-dropdown').classList.remove('open');
    if(!$('gs-wrap')?.contains(e.target))closeSearch();
  });
  $('ldd-apply').addEventListener('click',applyLabels);

  /* Config */
  $('config-btn').addEventListener('click',openConfig);
  $('config-close').addEventListener('click',closeConfig);
  $('config-panel').addEventListener('click',e=>{if(e.target===$('config-panel'))closeConfig();});

  /* Toolbar */
  $('filter-agent').addEventListener('change',()=>loadConvs(true));
  $('refresh-btn').addEventListener('click',()=>loadConvs(true));

  /* Search */
  $('global-search').addEventListener('input',onSearch);
  $('gs-clear').addEventListener('click',()=>{$('global-search').value='';$('gs-clear').classList.remove('visible');closeSearch();$('global-search').focus();});
  $('global-search').addEventListener('keydown',e=>{if(e.key==='Escape')closeSearch();});

  /* Lightbox */
  $('lb-close').addEventListener('click',()=>$('lightbox').classList.remove('open'));
  $('lightbox').addEventListener('click',e=>{if(e.target===$('lightbox'))$('lightbox').classList.remove('open');});

  /* Dashboard */
  $('dash-close').addEventListener('click',closeDashboard);
  $('dashboard-overlay').addEventListener('click',e=>{if(e.target===$('dashboard-overlay'))closeDashboard();});
  $('dash-apply-btn').addEventListener('click',renderDashboard);
  $('dash-reset-btn').addEventListener('click',()=>{
    const today=new Date(),past=new Date();past.setDate(past.getDate()-29);
    $('dash-date-from').value=past.toISOString().split('T')[0];
    $('dash-date-to').value=today.toISOString().split('T')[0];
    $('dash-filter-agent').value='';
    renderDashboard();
  });

  /* Schedule modal */
  $('scm-cancel').addEventListener('click', closeScheduleModal);
  $('scm-save').addEventListener('click', saveSchedule);
  $('schedule-modal').addEventListener('click', e => { if(e.target===$('schedule-modal')) closeScheduleModal(); });

  /* Schedule alert */
  $('sal-open').addEventListener('click', () => {
    if (_currentAlert) {
      showPanel('crm');
      openChat(_currentAlert.convId);
    }
    dismissAlert();
  });
  $('sal-dismiss').addEventListener('click', dismissAlert);

  /* Contacts panel search */
  $('contacts-search-btn').addEventListener('click', () => {
    loadContactsPanel($('contacts-search').value.trim());
  });
  $('contacts-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadContactsPanel($('contacts-search').value.trim());
  });

  /* Nav Config btn */
  $('nav-config')?.addEventListener('click', e => {
    e.stopPropagation(); // evita conflito com data-panel
    openConfig();
  });
}

/* ════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initSidebar();
  initStatus();
  bindEvents();
  await tryAutoLogin();
});
