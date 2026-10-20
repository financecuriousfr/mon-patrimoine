/* =========================================================
   Courbes en quasi direct
   - Périodes : jour, semaine, mois, année, 5 ans
   - Cours passés via le relais local (Yahoo + CoinGecko), cours en direct toutes les 30 s
   - Courbe d'un membre à l'instant t = « base » (tout ce qui ne bouge pas avec
     les marchés : livrets, biens, espèces, dettes…) + Σ quantité × cours à t.
     La base suit le journal de composition (ajouts, ventes, achats…) ;
     avant ce journal, elle passe par les photos réelles du patrimoine.
   ========================================================= */
const CHART_PERIODS = {
  jour:    { label: 'Jour',    since: 'sur 24 h',      ms: 864e5,        step: 5 * 60e3,   ttl: 3 * 60e3,   cgDays: 1 },
  semaine: { label: 'Semaine', since: 'sur 7 jours',   ms: 7 * 864e5,    step: 30 * 60e3,  ttl: 10 * 60e3,  cgDays: 7 },
  mois:    { label: 'Mois',    since: 'sur 30 jours',  ms: 30 * 864e5,   step: 2 * 3600e3, ttl: 30 * 60e3,  cgDays: 30 },
  annee:   { label: 'Année',   since: 'sur 1 an',      ms: 365 * 864e5,  step: 864e5,      ttl: 6 * 3600e3, cgDays: 365 },
  '5ans':  { label: '5 ans',   since: 'sur 5 ans',     ms: 1826 * 864e5, step: 7 * 864e5,  ttl: 6 * 3600e3, cgDays: 365 },
};
// Jour / semaine : seuls les marchés font bouger la courbe (pas d'étalement des versements entre deux photos)
const SHORT_PERIODS = new Set(['jour', 'semaine']);
const LIVE_MS = 30e3;

let chartPeriod = (() => { try { return localStorage.getItem('monpatrimoine.periode'); } catch { return null; } })();
if (!CHART_PERIODS[chartPeriod]) chartPeriod = 'mois';

const hist = { series: {}, at: {}, loading: {}, failed: {}, live: {}, liveAt: 0, notifyT: null };
const num = x => (Number.isFinite(+x) ? +x : 0);
const histKey = (key, per) => key + '|' + per;

/* ---------- Formats de dates selon la période ---------- */
const _dtf = o => new Intl.DateTimeFormat('fr-FR', o);
const DF = {
  hm: _dtf({ hour: '2-digit', minute: '2-digit' }), wd: _dtf({ weekday: 'short', day: 'numeric' }),
  dm: _dtf({ day: 'numeric', month: 'short' }), my: _dtf({ month: 'short', year: '2-digit' }),
  full: _dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  day: _dtf({ day: 'numeric', month: 'short', year: 'numeric' }),
};
function periodFormats(per = chartPeriod) {
  const x = { jour: DF.hm, semaine: DF.wd, mois: DF.dm, annee: DF.my, '5ans': DF.my }[per] || DF.dm;
  const tip = SHORT_PERIODS.has(per) || per === 'mois' ? DF.full : DF.day;
  return { xFmt: d => x.format(d), tipDate: d => tip.format(d) };
}

/* ---------- Lignes suivies d'une fiche ---------- */
const hKey = h => `${h.kind === 'crypto' ? 'crypto' : 'stock'}:${h.symbol}`;
function holdingsOf(d) {
  const out = [];
  for (const a of Array.isArray(d?.accounts) ? d.accounts : []) {
    for (const h of Array.isArray(a?.holdings) ? a.holdings : []) {
      if (h && h.symbol && num(h.qty) > 0) out.push({ key: hKey(h), qty: num(h.qty), price: num(h.price) });
    }
  }
  return out;
}
const keysOf = ds => [...new Set(ds.flatMap(d => holdingsOf(d).map(h => h.key)))];

/* Ma fiche complète (historique entier, journal entier) */
function myCurveData() {
  return { net: totals().net, accounts: state.accounts, snapshots: sortedSnapshots(), log: state.compLog || [] };
}
/* Toutes les fiches visibles : moi + le groupe */
function visibleProfiles() {
  const ds = [myCurveData()];
  if (state.group && !state.group.kicked) (sync.members || state.friendsCache || []).forEach(r => r?.data && ds.push(r.data));
  return ds;
}

/* ---------- Cours passés ----------
   Une seule requête par période : le relais renvoie tout de suite ce qu'il connaît,
   et la liste des séries encore en chargement, qu'on redemande 2,5 s plus tard. */
function storeSeries(key, per, pts) {
  pts = (Array.isArray(pts) ? pts : []).filter(p => Array.isArray(p) && p[1] > 0).sort((a, b) => a[0] - b[0]);
  if (!pts.length) return;
  const live = hist.live[key];
  if (live && live.t > pts[pts.length - 1][0]) pts.push([live.t, live.p]);
  const id = histKey(key, per);
  hist.series[id] = pts; hist.at[id] = Date.now(); delete hist.failed[id];
}
const histSync = {};   // période -> { busy, at, timer, noRelay }
async function syncHistory(keys, per = chartPeriod, force = false) {
  const s = histSync[per] || (histSync[per] = {});
  if (s.busy || !keys.length) return;
  if (!force && s.at && Date.now() - s.at < 60e3 && !keys.some(k => !hist.series[histKey(k, per)] && !hist.failed[histKey(k, per)])) return;
  s.busy = true; clearTimeout(s.timer);
  keys.forEach(k => { if (!hist.series[histKey(k, per)]) hist.loading[histKey(k, per)] = true; });
  let pending = [];
  try {
    if (s.noRelay) throw new Error('relais sans historique');
    const r = await fetch(`${RELAY}/history?period=${per}&keys=${encodeURIComponent(keys.join(','))}`, { signal: AbortSignal.timeout(20000) });
    if (r.status === 404 || r.status === 400) { s.noRelay = true; throw new Error('relais sans historique'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    for (const k in j.series || {}) storeSeries(k, per, j.series[k]);
    pending = (j.pending || []).filter(k => keys.includes(k));
    // Relais en ligne : les petites cryptos sont à demander directement à CoinGecko
    const direct = (j.direct || []).filter(k => keys.includes(k) && !hist.series[histKey(k, per)]);
    if (direct.length) directCryptoHistory(direct, per);
    Object.keys(j.failed || {}).forEach(k => { hist.failed[histKey(k, per)] = Date.now(); });
    s.at = Date.now();
  } catch {
    // Relais ancien ou PowerShell : les cryptos directement chez CoinGecko, une à la fois
    if (s.noRelay) await directCryptoHistory(keys.filter(k => k.startsWith('crypto:') && !hist.series[histKey(k, per)]), per);
    keys.forEach(k => { if (!hist.series[histKey(k, per)]) hist.failed[histKey(k, per)] = Date.now(); });
    s.at = Date.now();
  } finally {
    keys.forEach(k => { if (!pending.includes(k)) delete hist.loading[histKey(k, per)]; });
    s.busy = false;
    notifyHistory();
    if (pending.length) s.timer = setTimeout(() => syncHistory(keys, per, true), 2500);
  }
}
const directBusy = new Set();
async function directCryptoHistory(keys, per) {
  keys = keys.filter(k => !directBusy.has(histKey(k, per))).slice(0, 10);
  keys.forEach(k => { directBusy.add(histKey(k, per)); hist.loading[histKey(k, per)] = true; });
  for (const key of keys) {
    try {
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(key.slice(7))}/market_chart?vs_currency=eur&days=${CHART_PERIODS[per].cgDays}`,
        { signal: AbortSignal.timeout(20000) });
      if (r.ok) storeSeries(key, per, (await r.json()).prices);
      else hist.failed[histKey(key, per)] = Date.now();
    } catch { hist.failed[histKey(key, per)] = Date.now(); }
    delete hist.loading[histKey(key, per)]; directBusy.delete(histKey(key, per));
    notifyHistory();
    await new Promise(r => setTimeout(r, 2500));
  }
}
function ensureHistory(keys, per = chartPeriod) { syncHistory(keys, per); }

/* Dernier cours connu à l'instant t (avant le début de l'historique : premier cours connu) */
function priceAt(key, per, t) {
  const s = hist.series[histKey(key, per)];
  if (!s || !s.length) return null;
  if (t <= s[0][0]) return s[0][1];
  let lo = 0, hi = s.length - 1;
  if (t >= s[hi][0]) return s[hi][1];
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid][0] <= t) lo = mid; else hi = mid - 1; }
  return s[lo][1];
}

/* ---------- Cours en direct ----------
   Actions et grandes cryptos (paires Yahoo en euros) toutes les 30 s via le relais ;
   petites cryptos via CoinGecko toutes les 60 s (API publique limitée) */
const YAHOO_CRYPTO = {
  bitcoin: 'BTC-EUR', ethereum: 'ETH-EUR', solana: 'SOL-EUR', 'usd-coin': 'USDC-EUR', tether: 'USDT-EUR', ripple: 'XRP-EUR',
  cardano: 'ADA-EUR', dogecoin: 'DOGE-EUR', binancecoin: 'BNB-EUR', polkadot: 'DOT-EUR', chainlink: 'LINK-EUR', 'avalanche-2': 'AVAX-EUR',
  litecoin: 'LTC-EUR', tron: 'TRX-EUR', 'shiba-inu': 'SHIB-EUR', stellar: 'XLM-EUR', 'bitcoin-cash': 'BCH-EUR', cosmos: 'ATOM-EUR',
  uniswap: 'UNI-EUR', 'ethereum-classic': 'ETC-EUR', monero: 'XMR-EUR',
};
let lastCgLive = 0;
async function liveTick(keys) {
  const allCryptos = keys.filter(k => k.startsWith('crypto:')).map(k => k.slice(7));
  const viaYahoo = allCryptos.filter(c => YAHOO_CRYPTO[c]);
  const stocks = keys.filter(k => k.startsWith('stock:')).map(k => k.slice(6)).concat(viaYahoo.map(c => YAHOO_CRYPTO[c]));
  const cgDue = Date.now() - lastCgLive > 58e3;
  const cryptos = cgDue ? allCryptos.filter(c => !YAHOO_CRYPTO[c] || !market.online) : [];
  if (cryptos.length) lastCgLive = Date.now();
  const [st, cr] = await Promise.allSettled([fetchStockQuotes(stocks), fetchCryptoQuotes(cryptos)]);
  if (st.status === 'fulfilled') viaYahoo.forEach(c => { const q = st.value.quotes[YAHOO_CRYPTO[c]]; if (q) st.value.quotes['§' + c] = q; });
  const now = Date.now();
  const put = (key, q) => {
    if (!q || !(q.priceEUR > 0)) return;
    hist.live[key] = { t: now, p: q.priceEUR };
    for (const per in CHART_PERIODS) {
      const s = hist.series[histKey(key, per)];
      if (s && now > s[s.length - 1][0]) s.push([now, q.priceEUR]);
    }
  };
  if (st.status === 'fulfilled') {
    keys.filter(k => k.startsWith('stock:')).forEach(k => put(k, st.value.quotes[k.slice(6)]));
    viaYahoo.forEach(c => put('crypto:' + c, st.value.quotes['§' + c]));
  }
  if (cr.status === 'fulfilled') cryptos.forEach(c => put('crypto:' + c, cr.value.quotes[c]));
  if (st.status === 'fulfilled' || cr.status === 'fulfilled') hist.liveAt = now;
}

/* Patrimoine net d'une fiche, recalculé avec les cours en direct */
function liveNetOf(d) {
  let net = num(d.net);
  for (const h of holdingsOf(d)) {
    const l = hist.live[h.key];
    if (l && h.price > 0) net += h.qty * (l.p - h.price);
  }
  return net;
}

/* ---------- Journal de composition (le mien) ----------
   Une entrée à chaque changement qui n'est pas dû aux marchés :
   b = patrimoine net − valeur des lignes suivies, q = quantités par ligne */
function currentComposition() {
  const q = {};
  let inv = 0;
  for (const a of state.accounts) for (const h of a.holdings || []) {
    if (!h.symbol || !(+h.qty > 0)) continue;
    const k = hKey(h);
    q[k] = (q[k] || 0) + (+h.qty);
    inv += (+h.qty) * (+h.price || 0);
  }
  return { b: Math.round((totals().net - inv) * 100) / 100, q };
}
function recordComposition() {
  if (!Array.isArray(state.accounts) || !state.accounts.length) return false;
  const { b, q } = currentComposition();
  const log = state.compLog || (state.compLog = []);
  const last = log[log.length - 1];
  const keys = Object.keys(q);
  const sameQ = last && keys.length === Object.keys(last.q || {}).length && keys.every(k => Math.abs(q[k] - (last.q[k] || 0)) < 1e-9);
  if (last && sameQ && Math.abs(b - last.b) < 1) return false;
  const now = Date.now();
  if (last && typeof feedCompositionChange === 'function') feedCompositionChange(last, { b, q });
  // Plusieurs modifications à la suite (saisie en cours) : une seule marche sur la courbe
  if (last && log.length > 1 && now - last.t < 120e3) Object.assign(last, { t: now, b, q });
  else log.push({ t: now, b, q });
  if (log.length > 400) log.splice(0, log.length - 400);
  return true;
}
function publicCompLog() {
  const since = Date.now() - 400 * 864e5;
  return (state.compLog || []).filter(e => e.t > since).slice(-150);
}

/* ---------- Modèle de courbe d'une fiche ---------- */
function buildModel(d, per) {
  const now = Date.now();
  const H = holdingsOf(d);
  const fallback = {};
  H.forEach(h => { fallback[h.key] = hist.live[h.key]?.p ?? h.price; });
  const P = (k, t) => priceAt(k, per, t) ?? fallback[k] ?? 0;
  const I = (q, t) => { let s = 0; for (const k in q) s += num(q[k]) * P(k, t); return s; };
  const curQ = {};
  H.forEach(h => { curQ[h.key] = (curQ[h.key] || 0) + h.qty; });
  const netNow = liveNetOf(d);
  const bNow = netNow - I(curQ, now);
  const sameQ = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Math.abs(num(a[k]) - num(b[k])) < 1e-9);

  const log = (Array.isArray(d.log) ? d.log : [])
    .filter(e => e && Number.isFinite(+e.t) && +e.t <= now && e.q && typeof e.q === 'object')
    .map(e => ({ t: +e.t, b: num(e.b), q: e.q })).sort((a, b) => a.t - b.t);
  // L'état actuel fait foi pour la fin de la courbe
  if (log.length && sameQ(log[log.length - 1].q, curQ)) log[log.length - 1].b = bNow;
  else if (log.length) log.push({ t: now - 1000, b: bNow, q: curQ });

  const t0 = log.length ? log[0].t : now, q0 = log.length ? log[0].q : curQ, b0 = log.length ? log[0].b : bNow;
  let anchors = [];
  if (!SHORT_PERIODS.has(per)) {
    anchors = (Array.isArray(d.snapshots) ? d.snapshots : [])
      .filter(s => s && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
      .map(s => ({ t: new Date(s.date + 'T12:00:00').getTime(), net: num(s.net) }))
      .filter(a => a.t < t0 - 3600e3).sort((a, b) => a.t - b.t);
    anchors.forEach(a => { a.b = a.net - I(q0, a.t); });
  }
  anchors.push({ t: t0, b: b0 });
  // Avant la première donnée réelle : 30 jours de reconstitution par les cours au plus
  const from = SHORT_PERIODS.has(per) ? -Infinity : anchors[0].t - (H.length ? 30 * 864e5 : 0);

  function at(t) {
    if (t < from) return null;
    if (log.length && t >= log[0].t) {
      let lo = 0, hi = log.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (log[mid].t <= t) lo = mid; else hi = mid - 1; }
      return log[lo].b + I(log[lo].q, t);
    }
    let b;
    const last = anchors[anchors.length - 1];
    if (t <= anchors[0].t) b = anchors[0].b;
    else if (t >= last.t) b = last.b;
    else {
      let i = 1;
      while (i < anchors.length - 1 && anchors[i].t < t) i++;
      const A = anchors[i - 1], B = anchors[i];
      b = B.t === A.t ? B.b : A.b + (B.b - A.b) * Math.min(1, (t - A.t) / (B.t - A.t));
    }
    return b + I(q0, t);
  }
  return { at, steps: log.slice(1).map(e => e.t), anchors: anchors.slice(0, -1).map(a => a.t), keys: Object.keys(curQ) };
}

/* Instants calculés : grille régulière + changements (marches nettes) + photos */
function gridTimes(per, steps = [], anchors = []) {
  const P = CHART_PERIODS[per], now = Date.now(), start = now - P.ms;
  const ts = [];
  for (let t = Math.ceil(start / P.step) * P.step; t < now; t += P.step) ts.push(t);
  ts.push(now);
  steps.forEach(t => { if (t > start && t < now) ts.push(t - Math.min(P.step / 3, 60e3), t); });
  anchors.forEach(t => { if (t > start && t < now) ts.push(t); });
  return [...new Set(ts)].sort((a, b) => a - b);
}

function curvePoints(d, per = chartPeriod) {
  const m = buildModel(d, per);
  return gridTimes(per, m.steps, m.anchors).map(t => ({ x: new Date(t), y: m.at(t) })).filter(p => p.y != null && Number.isFinite(p.y));
}

/* Courbes de tous les membres sur une même grille, et leur total */
function groupCurves(members, per = chartPeriod) {
  const models = members.map(m => ({ m, model: buildModel(m.data, per) }));
  const grid = gridTimes(per, models.flatMap(x => x.model.steps), models.flatMap(x => x.model.anchors));
  const ok = y => y != null && Number.isFinite(y);
  const rows = models.map(({ m, model }) => {
    const ys = grid.map(t => model.at(t));
    return { m, ys, first: ys.findIndex(ok) };
  });
  // Total : dès qu'au moins un membre a des données ; avant le début de son historique,
  // un membre compte pour sa première valeur connue
  const total = [];
  let extended = false;
  const start = Math.min(...rows.map(r => (r.first < 0 ? Infinity : r.first)));
  grid.forEach((t, i) => {
    if (i < start) return;
    let s = 0;
    for (const r of rows) {
      if (r.first < 0) continue;
      const y = ok(r.ys[i]) ? r.ys[i] : r.ys[r.first];
      if (!ok(r.ys[i])) extended = true;
      s += y;
    }
    total.push({ x: new Date(t), y: s });
  });
  return {
    series: rows.map(r => ({ m: r.m, points: grid.map((t, i) => ({ x: new Date(t), y: r.ys[i] })).filter(p => ok(p.y)) })),
    total, extended,
  };
}

/* ---------- Interface ---------- */
function periodSegHTML() {
  return `<div class="seg seg-sm period-seg">${Object.entries(CHART_PERIODS).map(([k, p]) =>
    `<button data-period="${k}" class="${chartPeriod === k ? 'on' : ''}">${p.label}</button>`).join('')}</div>`;
}
function bindPeriodSeg(root, onChange) {
  root.querySelectorAll('[data-period]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    chartPeriod = b.dataset.period;
    try { localStorage.setItem('monpatrimoine.periode', chartPeriod); } catch {}
    document.querySelectorAll('[data-period]').forEach(x => x.classList.toggle('on', x.dataset.period === chartPeriod));
    ensureHistory(keysOf(visibleProfiles()));
    onChange();
  });
}
function histStatusHTML(keys, per = chartPeriod) {
  if (!keys.length) return '<span class="faint">Ajoute des lignes suivies 📡 (actions, ETF, crypto) pour voir la courbe bouger en direct</span>';
  const ok = keys.filter(k => hist.series[histKey(k, per)]).length;
  const loading = keys.filter(k => hist.loading[histKey(k, per)]).length;
  if (loading) return `<span class="faint">⏳ Historique des cours… ${ok}/${keys.length}</span>`;
  const s = hist.liveAt ? Math.round((Date.now() - hist.liveAt) / 1000) : null;
  return (s == null ? '<span class="faint">⏳ connexion aux cours…</span>'
    : `<span class="live-dot"></span><span class="up">En direct</span> <span class="faint">· cours ${s < 5 ? "à l'instant" : `il y a ${s} s`}</span>`)
    + (ok < keys.length ? ` <span class="faint">· ${keys.length - ok} ligne(s) sans historique</span>` : '');
}
function periodCaption(per = chartPeriod) {
  return SHORT_PERIODS.has(per)
    ? 'Ton patrimoine au fil des cours (actions, ETF, crypto), avec tes changements enregistrés'
    : 'La courbe passe par les photos du patrimoine et suit les cours entre deux';
}

/* Redessine les graphiques visibles quand de nouveaux cours arrivent */
function notifyHistory() {
  clearTimeout(hist.notifyT);
  hist.notifyT = setTimeout(refreshLiveCharts, 300);
}
function refreshLiveCharts() {
  if (currentView === 'friends' && typeof updateFriendsLive === 'function') updateFriendsLive();
  if (currentView === 'dashboard' && typeof updateDashLive === 'function') updateDashLive();
  if (typeof updateMemberLive === 'function') updateMemberLive();
}

let kickLive = () => {};   // relance immédiate des cours en direct (ex. : juste après une restauration)
function startLiveCharts() {
  const tick = async () => {
    if (document.hidden) return;
    const keys = keysOf(visibleProfiles());
    if (!keys.length) return;
    await liveTick(keys);
    ensureHistory(keys);
    refreshLiveCharts();
  };
  kickLive = tick;
  setTimeout(tick, 1200);
  setInterval(tick, LIVE_MS);
  addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  // Première entrée du journal (après le rechargement de la sauvegarde)
  setTimeout(() => { if (recordComposition()) save({ auto: true }); }, 6000);
}
