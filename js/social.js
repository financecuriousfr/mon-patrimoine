/* =========================================================
   Groupe d'amis : synchronisation via Supabase (API REST)
   Sécurité : la clé du groupe (dans le code d'invitation) est
   envoyée en en-tête ; la base ne garde que son empreinte et
   ses règles (RLS) ne laissent modifier que sa propre fiche.
   ========================================================= */
const TABLE = 'patrimoine_members';
const INVITE_PREFIX = 'MP1.';
const sync = { busy: false, lastError: null, members: null, timer: null, pullTimer: null };

/* ---------- Outils ---------- */
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomKey(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlEncode = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

function normalizeUrl(u) {
  u = String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(u) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(u)) return null;
  return u;
}

function makeInvite(g) {
  return INVITE_PREFIX + b64urlEncode(JSON.stringify({ u: g.url, k: g.key, g: g.groupKey, n: g.groupName }));
}
function readInvite(code) {
  try {
    code = String(code || '').trim().replace(/\s+/g, '');
    if (!code.startsWith(INVITE_PREFIX)) return null;
    const o = JSON.parse(b64urlDecode(code.slice(INVITE_PREFIX.length)));
    const url = normalizeUrl(o.u);
    if (!url || !o.k || !o.g || String(o.g).length < 20) return null;
    return { url, key: String(o.k), groupKey: String(o.g), groupName: String(o.n || 'Mon groupe').slice(0, 40) };
  } catch { return null; }
}

function sbHeaders(g, extra = {}) {
  const h = { apikey: g.key, 'x-group-key': g.groupKey, ...extra };
  if (/^eyJ/.test(g.key)) h.Authorization = 'Bearer ' + g.key; // ancienne clé « anon » (JWT)
  if (g.memberKey) h['x-member-key'] = g.memberKey;
  if (g.adminKey) h['x-admin-key'] = g.adminKey;          // organisateur uniquement, jamais partagée
  return h;
}

/* Erreur compréhensible, avec sa nature (rls = refus des règles d'accès, missing = script SQL à jour ?) */
async function sbError(r) {
  let body = {};
  try { body = await r.json(); } catch {}
  const msg = body.message || body.error || body.msg || '', code = String(body.code || '');
  const e = new Error();
  e.status = r.status; e.code = code;
  if (code === '42501' || /row-level security|violates/i.test(msg)) { e.rls = true; e.message = 'Accès refusé : groupe fermé aux nouveaux membres, membre retiré, ou clé incorrecte.'; }
  else if (code === '23505' || r.status === 409) { e.conflict = true; e.message = 'Cet élément existe déjà.'; }
  else if (/does not exist|PGRST20[25]|schema cache/i.test(msg + code)) { e.missing = true; e.message = 'Table introuvable : exécute le script SQL (à jour) dans Supabase > SQL Editor.'; }
  else if (r.status === 401 || /api key|apikey|jwt/i.test(msg)) e.message = 'Clé API refusée : vérifie la clé « anon » / « publishable » du projet.';
  else e.message = `Erreur ${r.status}${msg ? ' : ' + msg : ''}`;
  return e;
}

/* ---------- Fiche publique ---------- */
function buildPublicProfile({ paused = false } = {}) {
  const t = totals(), lvl = levelFor(t.net), hs = healthScore(t);
  const r = v => Math.round((+v || 0) * 100) / 100;
  const rp = v => +(+v || 0).toPrecision(7);   // cours : précision suffisante même pour les petites cryptos
  return {
    v: 1, paused, net: r(t.net), assets: r(t.assets), debts: r(t.debts), liquid: r(t.liquid), passiveYear: r(t.passiveYear),
    byCat: Object.fromEntries(Object.entries(t.byCat).map(([k, v]) => [k, r(v)])),
    level: { idx: lvl.idx, name: lvl.cur.name, emoji: lvl.cur.emoji },
    health: hs.total, percentile: Math.round(frenchPercentile(t.net) * 10) / 10,
    accounts: state.accounts.map(a => ({
      name: a.name, cat: a.cat, emoji: a.emoji || '', value: r(a.value), rate: +a.rate || 0, cap: a.cap || null, cash: a.cash || 0,
      holdings: (a.holdings || []).map(h => ({ kind: h.kind, symbol: h.symbol, ticker: h.ticker, name: h.name, qty: +h.qty || 0, price: rp(h.price), change: h.change ?? null, pru: h.pru || null })),
    })),
    goals: state.goals.map(g => ({ name: g.name, emoji: g.emoji, target: g.target, current: r(goalCurrent(g, t)), deadline: g.deadline || '', doneAt: g.doneAt || null })),
    snapshots: sortedSnapshots().slice(-36).map(s => ({ date: s.date, net: Math.round(s.net) })),
    log: typeof publicCompLog === 'function' ? publicCompLog() : [],
    feed: typeof publicFeed === 'function' ? publicFeed() : [],
    reactions: typeof publicReactions === 'function' ? publicReactions() : {},
    appVersion: APP_VERSION,
    badges: Object.keys(state.badges),
    pricesAt: state.flags.lastPriceRefresh || null,
  };
}

/* ---------- Requêtes ---------- */
async function sbPublish(g, { paused = false } = {}) {
  const body = {
    id: g.memberId, group_hash: await sha256hex(g.groupKey), member_hash: await sha256hex(g.memberKey),
    name: g.name, emoji: g.emoji, data: buildPublicProfile({ paused }), updated_at: new Date().toISOString(),
  };
  const r = await fetch(`${g.url}/rest/v1/${TABLE}?on_conflict=id`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: sbHeaders(g, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await sbError(r);
}
async function sbFetchMembers(g) {
  const r = await fetch(`${g.url}/rest/v1/${TABLE}?select=id,name,emoji,data,updated_at&order=updated_at.desc`, {
    headers: sbHeaders(g), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw await sbError(r);
  return r.json();
}
async function sbDeleteMe(g) {
  const r = await fetch(`${g.url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(g.memberId)}`, {
    method: 'DELETE', headers: sbHeaders(g), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw await sbError(r);
}

/* ---------- Organisation du groupe (script SQL v2) ---------- */
const sbJSON = (g, method, path, body, prefer = 'return=minimal') => fetch(`${g.url}/rest/v1/${path}`, {
  method, signal: AbortSignal.timeout(15000),
  headers: sbHeaders(g, { 'Content-Type': 'application/json', Prefer: prefer }),
  body: body ? JSON.stringify(body) : undefined,
});
async function sbGroupInfo(g) {
  const r = await fetch(`${g.url}/rest/v1/patrimoine_groups?select=admin_member_id,locked`, { headers: sbHeaders(g), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw await sbError(r);
  return (await r.json())[0] || null;
}
async function sbBans(g) {
  const r = await fetch(`${g.url}/rest/v1/patrimoine_bans?select=member_id`, { headers: sbHeaders(g), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw await sbError(r);
  return r.json();
}
async function sbClaimAdmin(g, adminKey) {
  const r = await sbJSON({ ...g, adminKey }, 'POST', 'patrimoine_groups',
    { group_hash: await sha256hex(g.groupKey), admin_hash: await sha256hex(adminKey), admin_member_id: g.memberId });
  if (!r.ok) throw await sbError(r);
}
async function sbKick(g, memberId) {
  // 1) exclusion durable (l'app du membre ne pourra plus renvoyer sa fiche)  2) suppression de sa fiche
  const r1 = await sbJSON(g, 'POST', 'patrimoine_bans', { group_hash: await sha256hex(g.groupKey), member_id: memberId });
  if (!r1.ok) { const e = await sbError(r1); if (!e.conflict) throw e; }
  const r2 = await sbJSON(g, 'DELETE', `${TABLE}?id=eq.${encodeURIComponent(memberId)}`);
  if (!r2.ok) throw await sbError(r2);
}
async function sbSetLocked(g, locked) {
  const r = await sbJSON(g, 'PATCH', `patrimoine_groups?group_hash=eq.${await sha256hex(g.groupKey)}`, { locked }, 'return=representation');
  if (!r.ok) throw await sbError(r);
  if (!(await r.json()).length) { const e = new Error("Seul l'organisateur peut modifier ce réglage."); e.rls = true; throw e; }
}

const isGroupAdmin = () => !!(state.group?.adminKey);

/* Le créateur du groupe en devient l'organisateur (une seule fois, au premier lancement) */
async function claimAdmin({ silent = true } = {}) {
  const g = state.group;
  if (!g || g.adminKey || g.kicked) return false;
  const key = randomKey(32);
  try {
    await sbClaimAdmin(g, key);
    g.adminKey = key; persist();
    sync.group = { admin_member_id: g.memberId, locked: false };
    if (!silent) toast('👑 Tu es maintenant l\'organisateur du groupe', 'Toi seul peux retirer un membre ou fermer le groupe.');
    return true;
  } catch (e) {
    if (!silent) toast('⚠️ Impossible de devenir organisateur', esc(e.conflict ? 'Ce groupe a déjà un organisateur.' : e.message));
    return false;
  }
}

async function kickMember(memberId) {
  const g = state.group;
  if (!isGroupAdmin()) throw new Error("Seul l'organisateur peut retirer un membre.");
  await sbKick(g, memberId);
  await pullMembers();
  if ((sync.members || []).some(m => m.id === memberId)) throw new Error("La fiche n'a pas pu être supprimée (droits d'organisateur refusés).");
}

async function setGroupLocked(locked) {
  await sbSetLocked(state.group, locked);
  sync.group = { ...(sync.group || {}), locked };
}

/* Mon app a-t-elle été exclue du groupe ? */
async function checkKicked(g) {
  try {
    const bans = await sbBans(g);
    if (bans.some(b => b.member_id === g.memberId)) { g.kicked = true; persist(); return true; }
  } catch {}
  return false;
}

/* ---------- Actions ---------- */
async function pushProfile({ silent = true, pausedFlag = false } = {}) {
  const g = state.group;
  if (g?.kicked) return false;
  if (!g || (g.paused && !pausedFlag)) return false;
  // Un envoi est déjà en cours : on réessaie juste après au lieu d'abandonner
  if (sync.busy) { clearTimeout(sync.timer); sync.timer = setTimeout(() => pushProfile({ silent }), 3000); return false; }
  sync.busy = true;
  try {
    await sbPublish(g, { paused: pausedFlag });
    g.lastPush = new Date().toISOString(); sync.lastError = null; sync.dirty = false; persist();
    if (!silent) toast('📤 Fiche partagée avec le groupe');
    return true;
  } catch (e) {
    sync.lastError = e.message || 'Connexion impossible';
    sync.dirty = true; // sera renvoyée automatiquement
    if (e.rls && await checkKicked(g)) { sync.dirty = false; sync.lastError = null; if (currentView === 'friends' && !modalOpen()) rerender(); }
    else if (!silent) toast('⚠️ Partage impossible', esc(sync.lastError));
    return false;
  } finally { sync.busy = false; updateSyncStatus(); }
}

/* Pause / reprise : les amis voient la mention « en pause » sur ta fiche */
async function setSharingPaused(paused) {
  const g = state.group;
  if (!g) return;
  if (paused) {
    await pushProfile({ pausedFlag: true });
    g.paused = true; persist();
    toast('⏸️ Partage en pause', 'Tes amis ne reçoivent plus tes mises à jour.');
  } else {
    g.paused = false; persist();
    await pushProfile({ silent: false });
  }
  updateSyncStatus();
}

async function pullMembers({ silent = true } = {}) {
  const g = state.group;
  if (!g) return null;
  try {
    const rows = await sbFetchMembers(g);
    // Organisation du groupe : organisateur, fermeture (script SQL v2 ; absent = ancienne version)
    try { sync.group = await sbGroupInfo(g); sync.v2 = true; }
    catch (e) { if (e.missing) { sync.v2 = false; sync.group = null; } }
    // Ma fiche a disparu alors que je l'avais envoyée : ai-je été retiré ?
    if (g.lastPush && !rows.some(r => r.id === g.memberId) && !g.kicked) await checkKicked(g);
    sync.members = rows; sync.lastError = null;
    g.lastPull = new Date().toISOString();
    state.friendsCache = rows; persist();
    return rows;
  } catch (e) {
    sync.lastError = e.message || 'Connexion impossible';
    if (!silent) toast('⚠️ Groupe inaccessible', esc(sync.lastError));
    return null;
  } finally { updateSyncStatus(); }
}

/* Appelé à chaque sauvegarde locale : partage différé de 5 s */
function onStateSaved() {
  if (!state.group || state.group.paused) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(() => pushProfile(), 5000);
}

async function createGroup({ url, key, groupName, name, emoji }) {
  url = normalizeUrl(url);
  if (!url) throw new Error('URL invalide : elle doit ressembler à https://xxxx.supabase.co');
  if (!key || key.length < 20) throw new Error('Clé API manquante ou trop courte.');
  const g = {
    url, key: key.trim(), groupKey: randomKey(), groupName: (groupName || 'Les amis du patrimoine').slice(0, 40),
    memberId: crypto.randomUUID(), memberKey: randomKey(), name: name.slice(0, 40), emoji: emoji || '🙂', owner: true,
  };
  await sbFetchMembers(g);   // vérifie URL, clé et présence de la table
  await sbPublish(g);
  state.group = g; save(); checkAchievements();
  await claimAdmin();        // le créateur devient l'organisateur
  return makeInvite(g);
}

async function joinGroup(code, name, emoji) {
  const inv = readInvite(code);
  if (!inv) throw new Error("Code d'invitation invalide : il doit commencer par « MP1. ». Copie-le en entier.");
  const g = { ...inv, memberId: crypto.randomUUID(), memberKey: randomKey(), name: name.slice(0, 40), emoji: emoji || '🙂' };
  await sbFetchMembers(g);
  try { await sbPublish(g); }
  catch (e) {
    if (e.rls) throw new Error("Ce groupe n'accepte plus de nouveaux membres (ou tu en as été retiré). Demande à son organisateur.");
    throw e;
  }
  state.group = g;
  if (typeof addFeed === 'function') addFeed('join', 'a rejoint le groupe 👋', { emoji: '🎉' });
  save(); checkAchievements();
}

async function leaveGroup() {
  const g = state.group;
  if (!g) return;
  try { await sbDeleteMe(g); } catch (e) { toast('⚠️ Fiche non supprimée en ligne', esc(e.message)); }
  delete state.group; delete state.friendsCache; sync.members = null; save();
}

function startSocialLoop() {
  if (state.group) {
    pushProfile().then(() => pullMembers()).then(() => {
      // Groupe créé avant l'arrivée du rôle d'organisateur : son créateur le revendique automatiquement
      const g = state.group;
      if (g && g.owner && !g.adminKey && sync.v2 && !sync.group) claimAdmin({ silent: false });
    });
    if (state.group.paused) setTimeout(() => toast('⏸️ Ton partage avec le groupe est en pause', 'Onglet 👥 Amis → « Reprendre le partage » pour que tes amis voient tes mises à jour.'), 1500);
  }
  // Quand on revient sur la fenêtre de l'app : nouvelles du groupe tout de suite
  addEventListener('focus', async () => {
    const g = state.group;
    if (!g || (g.lastPull && Date.now() - new Date(g.lastPull) < 20000)) return;
    const rows = await pullMembers();
    if (rows && currentView === 'friends' && !modalOpen() && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) rerender();
  });
  setInterval(async () => {
    const g = state.group;
    if (!g) return;
    // Renvoi automatique si le dernier envoi a échoué ou date de plus de 15 min
    if (!g.paused && (sync.dirty || !g.lastPush || Date.now() - new Date(g.lastPush) > 15 * 60 * 1000)) pushProfile();
    const rows = await pullMembers();
    if (rows && currentView === 'friends' && !modalOpen() && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) rerender();
  }, 60 * 1000);
}

function updateSyncStatus() {
  document.querySelectorAll('[data-sync]').forEach(e => e.innerHTML = syncStatusHTML());
}
function syncStatusHTML() {
  const g = state.group;
  if (!g) return '';
  if (g.kicked) return '<span class="down">🚫 Retiré du groupe</span>';
  if (g.paused) return '<span class="faint">⏸️ Partage en pause</span>';
  if (sync.lastError) return `<span class="down" title="${esc(sync.lastError)}">🔴 ${esc(sync.lastError)}</span>`;
  return `<span class="up">🟢 Synchronisé</span> <span class="faint">· envoyé ${agoText(g.lastPush)}</span>`;
}
