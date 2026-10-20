/* =========================================================
   Cours en direct : actions/ETF via le relais local,
   crypto via CoinGecko (accès direct)
   ========================================================= */
// Servie par le relais : même adresse que la page ; ouverte en fichier (ancien mode) : relais par défaut
// Version en ligne (téléphone) : relais des cours hébergé chez Supabase
const RELAY = WEB_MODE ? WEB_RELAY : location.protocol.startsWith('http') ? location.origin : 'http://127.0.0.1:47615';
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const market = { online: null, busy: false };

const isTracked = a => Array.isArray(a.holdings) && a.holdings.length > 0;
const round2 = v => Math.round(v * 100) / 100;

function holdingsValue(a) {
  return (a.holdings || []).reduce((s, h) => s + (+h.qty || 0) * (+h.price || 0), 0) + (+a.cash || 0);
}
function recomputeTracked() {
  state.accounts.forEach(a => { if (isTracked(a)) a.value = round2(holdingsValue(a)); });
}

async function relayPing() {
  try {
    const r = await fetch(RELAY + '/ping', { signal: AbortSignal.timeout(1500) });
    market.online = r.ok && (await r.json()).app === 'mon-patrimoine';
  } catch { market.online = false; }
  return market.online;
}

async function fetchStockQuotes(symbols) {
  if (!symbols.length) return { quotes: {}, errors: {} };
  const r = await fetch(`${RELAY}/quote?symbols=${encodeURIComponent(symbols.join(','))}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('relais HTTP ' + r.status);
  market.online = true;
  return r.json();
}

async function fetchCryptoQuotes(ids) {
  if (!ids.length) return { quotes: {}, errors: {} };
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=eur&include_24hr_change=true`,
    { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('CoinGecko HTTP ' + r.status);
  const j = await r.json(), quotes = {}, errors = {};
  ids.forEach(id => {
    if (j[id]?.eur != null) quotes[id] = { priceEUR: j[id].eur, price: j[id].eur, currency: 'EUR', changePct: j[id].eur_24h_change || 0, time: Date.now() };
    else errors[id] = 'Identifiant inconnu';
  });
  return { quotes, errors };
}

/* Met à jour tous les cours. Retourne { updated, failed } */
async function refreshPrices({ silent = false } = {}) {
  if (market.busy) return null;
  const lines = state.accounts.filter(isTracked).flatMap(a => a.holdings.map(h => ({ a, h })));
  if (!lines.length) { if (!silent) toast('Aucune ligne suivie', 'Ajoute des lignes (actions, ETF, crypto) à un compte avec le bouton 📡.'); return null; }
  market.busy = true;
  if (!silent) toast('🔄 Actualisation des cours…');
  const stocks = [...new Set(lines.filter(l => l.h.kind === 'stock').map(l => l.h.symbol))];
  const cryptos = [...new Set(lines.filter(l => l.h.kind === 'crypto').map(l => l.h.symbol))];
  const [st, cr] = await Promise.allSettled([fetchStockQuotes(stocks), fetchCryptoQuotes(cryptos)]);
  if (st.status === 'rejected' && stocks.length) market.online = false;
  const now = new Date().toISOString();
  let updated = 0;
  const failed = [];
  for (const { a, h } of lines) {
    const res = h.kind === 'stock' ? st : cr;
    const q = res.status === 'fulfilled' ? res.value.quotes[h.symbol] : null;
    if (q) {
      h.price = q.priceEUR; h.nativePrice = q.price; h.currency = q.currency; h.change = q.changePct; h.priceAt = now;
      a.updatedAt = now; updated++;
    } else failed.push(h);
  }
  recomputeTracked();
  if (updated) state.flags.lastPriceRefresh = now;
  save({ auto: true });
  market.busy = false;

  if (!silent) {
    if (updated) toast(`✅ ${updated} cours mis à jour`, failed.length ? `${failed.length} introuvable(s) : ${failed.map(h => h.symbol).join(', ')}` : 'Valeurs recalculées en euros.');
    else if (st.status === 'rejected' && stocks.length) toast('⚠️ Cours des actions indisponibles', WEB_MODE ? 'Vérifie ta connexion, puis réessaie.' : 'Ferme l\'app et relance-la depuis le raccourci du bureau.');
    else toast('⚠️ Cours indisponibles', 'Vérifie ta connexion internet.');
  }
  return { updated, failed };
}

/* Recherche d'instruments. kind : 'stock' | 'crypto' */
async function searchInstruments(q, kind) {
  q = q.trim();
  if (q.length < 2) return [];
  if (kind === 'crypto') {
    const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    return (j.coins || []).slice(0, 8).map(c => ({ symbol: c.id, ticker: c.symbol, name: c.name, exchange: c.market_cap_rank ? `#${c.market_cap_rank}` : '', type: 'Crypto' }));
  }
  const r = await fetch(`${RELAY}/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000) });
  market.online = true;
  const j = await r.json();
  return (j.results || []).map(x => ({ ...x, ticker: x.symbol }));
}

/* Synthèse pour le tableau de bord */
function marketSummary() {
  const lines = state.accounts.filter(isTracked).flatMap(a => a.holdings.map(h => ({ ...h, account: a.name, value: (+h.qty || 0) * (+h.price || 0) })));
  let value = 0, day = 0, cost = 0, plValue = 0;
  for (const l of lines) {
    value += l.value;
    if (l.change) day += l.value - l.value / (1 + l.change / 100);
    if (+l.pru > 0) { cost += l.pru * l.qty; plValue += l.value; }
  }
  return {
    lines, value, day, dayPct: value - day ? day / (value - day) * 100 : 0,
    pl: plValue - cost, plPct: cost ? (plValue / cost - 1) * 100 : 0, hasPru: cost > 0,
    movers: [...lines].filter(l => l.change != null && l.value > 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 4),
    last: state.flags.lastPriceRefresh,
  };
}

function holdingLabel(h) {
  return h.kind === 'crypto' ? (h.ticker || h.symbol).toUpperCase() : h.symbol;
}
function changeSpan(chg) {
  if (chg == null || isNaN(chg)) return '<span class="faint">—</span>';
  const cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'muted';
  return `<span class="${cls}">${chg > 0 ? '▲' : chg < 0 ? '▼' : ''} ${fmtPct.format(Math.abs(chg))} %</span>`;
}
function agoText(iso) {
  if (!iso) return 'jamais';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

/* ---------- Affichage ---------- */
const TRACKABLE = ['bourse', 'av', 'crypto', 'autres'];

function accountDayPct(a) {
  let v = 0, prev = 0;
  for (const h of a.holdings || []) {
    const val = (+h.qty || 0) * (+h.price || 0);
    v += val; prev += h.change != null ? val / (1 + h.change / 100) : val;
  }
  return prev ? (v / prev - 1) * 100 : null;
}

function plHTML(h) {
  if (!(+h.pru > 0) || !h.price) return '';
  const pl = (h.price - h.pru) * h.qty, p = (h.price / h.pru - 1) * 100;
  return `<span class="money ${pl >= 0 ? 'up' : 'down'}" title="Plus-value latente (PRU ${eur2(h.pru)})">${signed(pl)} (${p >= 0 ? '+' : '−'}${fmtPct.format(Math.abs(p))} %)</span>`;
}

function holdingsListHTML(a) {
  const qf = q => (+q || 0).toLocaleString('fr-FR', { maximumFractionDigits: 8 });
  return `<div class="lines" data-holdings="${a.id}" title="Gérer les lignes">${a.holdings.map(h => `
    <div class="line">
      <span class="tick">${esc(holdingLabel(h))}</span>
      <span class="lname">${esc(h.name || '')}</span>
      <span class="muted money">${qf(h.qty)} × ${h.price ? eur2(h.price) : '—'}</span>
      <b class="money">${eur((+h.qty || 0) * (+h.price || 0))}</b>
      <span class="lchg">${changeSpan(h.change)}</span>
      <span class="lpl">${plHTML(h)}</span>
    </div>`).join('')}</div>`;
}

function relayStatusHTML() {
  const needRelay = state.accounts.some(a => isTracked(a) && a.holdings.some(h => h.kind === 'stock'));
  if (!needRelay) return '<span class="up">🟢 Cours en direct</span>';
  if (market.online === null) return '<span class="faint">⏳ connexion au relais…</span>';
  return market.online ? '<span class="up">🟢 Cours en direct</span>'
    : WEB_MODE ? '<span class="down">🔴 Cours des actions indisponibles</span>'
    : '<span class="down" title="Ferme l\'app puis relance-la depuis le raccourci du bureau">🔴 Relais actions arrêté</span>';
}
function updateRelayStatus() {
  document.querySelectorAll('[data-relay]').forEach(e => e.innerHTML = relayStatusHTML());
}

function marketCardHTML() {
  const ms = marketSummary();
  if (!ms.lines.length) return '';
  return `
  <div class="card mt">
    <h3>📡 Tes placements en direct
      <span class="actions"><span class="small" data-relay>${relayStatusHTML()}</span><span class="small faint">· cours ${agoText(ms.last)}</span>
      <button class="btn btn-sm" data-act="prices">🔄 Actualiser</button></span></h3>
    <div class="grid g4">
      <div class="kpi"><span class="k-label">Valeur suivie</span><span class="k-value money">${eur(ms.value)}</span><span class="k-sub">${ms.lines.length} ligne(s)</span></div>
      <div class="kpi"><span class="k-label">Aujourd'hui</span><span class="k-value money ${ms.day >= 0 ? 'up' : 'down'}">${signed(ms.day)}</span><span class="k-sub">${changeSpan(ms.dayPct)}</span></div>
      <div class="kpi"><span class="k-label">Plus-value latente</span>${ms.hasPru
        ? `<span class="k-value money ${ms.pl >= 0 ? 'up' : 'down'}">${signed(ms.pl)}</span><span class="k-sub">${ms.plPct >= 0 ? '+' : '−'}${fmtPct.format(Math.abs(ms.plPct))} % sur les lignes avec PRU</span>`
        : `<span class="k-value faint">—</span><span class="k-sub">Renseigne ton prix de revient (PRU) dans 📡</span>`}</div>
      <div class="kpi"><span class="k-label">Plus fortes variations</span><div class="movers">${ms.movers.map(m =>
        `<span class="chip">${esc(holdingLabel(m))} ${changeSpan(m.change)}</span>`).join('') || '<span class="faint small">—</span>'}</div></div>
    </div>
  </div>`;
}

/* Rafraîchissement automatique au démarrage puis toutes les 5 min */
function startMarketLoop() {
  const tick = async () => {
    const last = state.flags.lastPriceRefresh ? new Date(state.flags.lastPriceRefresh).getTime() : 0;
    if (!state.accounts.some(isTracked) || Date.now() - last < AUTO_REFRESH_MS - 5000) {
      await relayPing(); updateRelayStatus(); return;
    }
    const res = await refreshPrices({ silent: true });
    updateRelayStatus();
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (res?.updated && !modalOpen() && !typing && ['dashboard', 'accounts'].includes(currentView) && !chartBusy(document.getElementById('evo'))) rerender();
  };
  tick();
  setInterval(tick, 60 * 1000);
}
