/* =========================================================
   Vie du groupe : fil d'actu + réactions, récap de la semaine, duel de portefeuilles
   Tout passe par les fiches des membres (chacun publie ses événements et ses
   réactions dans sa propre fiche) : rien de plus à configurer côté serveur.
   ========================================================= */
const REACTIONS = ['🔥', '😂', '💀', '🤡', '👏'];

/* ---------- Mes événements ---------- */
function addFeed(kind, text, { emoji = '', id = null, minGapMs = 0 } = {}) {
  const feed = state.feed || (state.feed = []);
  const now = Date.now();
  if (minGapMs && feed.some(e => e.kind === kind && now - e.t < minGapMs)) return null;
  const ev = { id: id || Math.random().toString(36).slice(2, 10), t: now, kind, text: String(text).slice(0, 160), emoji };
  const i = id ? feed.findIndex(e => e.id === id) : -1;
  if (i >= 0) feed[i] = { ...feed[i], ...ev, t: feed[i].t }; else feed.push(ev);
  if (feed.length > 80) feed.splice(0, feed.length - 80);
  return ev;
}
const publicFeed = () => (state.feed || []).slice(-40);
const publicReactions = () => Object.fromEntries(Object.entries(state.reactions || {}).slice(-300));

/* Changements de composition (appelé par le journal) : versements, achats, ventes */
const holdingNames = () => {
  const n = {};
  state.accounts.forEach(a => (a.holdings || []).forEach(h => { n[hKey(h)] = h.name || holdingLabel(h); }));
  return n;
};
function feedCompositionChange(prev, next) {
  if (!prev) return;
  const db = next.b - prev.b;
  // Saisies rapprochées (moins de 3 min) : un seul message avec le total
  const feed = state.feed || [], lastMoney = feed[feed.length - 1]?.kind === 'money' && Date.now() - feed[feed.length - 1].t < 180e3 ? feed[feed.length - 1] : null;
  const sum = (lastMoney?.amount || 0) + db;
  if (lastMoney || Math.abs(db) >= 100) {
    if (Math.abs(sum) < 100 && lastMoney) feed.pop();
    else if (Math.abs(sum) >= 100) {
      const ev = addFeed('money', sum > 0 ? `a ajouté ${eur(sum)} à son patrimoine` : `a retiré ${eur(-sum)} de son patrimoine`,
        { emoji: sum > 0 ? '💸' : '🏧', id: lastMoney?.id });
      if (ev) (state.feed.find(e => e.id === ev.id) || {}).amount = sum;
    }
  }
  const names = holdingNames(), keys = new Set([...Object.keys(prev.q || {}), ...Object.keys(next.q || {})]);
  for (const k of keys) {
    const a = +(prev.q || {})[k] || 0, b = +(next.q || {})[k] || 0, name = names[k] || k.split(':')[1];
    if (Math.abs(b - a) < 1e-9) continue;
    if (!a) addFeed('buy', `a acheté du ${name}`, { emoji: '🛒' });
    else if (!b) addFeed('sell', `a tout vendu : ${name}`, { emoji: '🏃' });
    else if (b > a) addFeed('buy', `a renforcé ${name}`, { emoji: '➕' });
    else addFeed('sell', `a vendu une partie de ${name}`, { emoji: '➖' });
  }
}

/* Grosse journée sur les marchés (une seule entrée par jour, mise à jour si ça bouge encore plus) */
function feedMarketDay() {
  if (!state.accounts.length) return;
  const ms = marketSummary();
  if (!ms.lines.length || Math.abs(ms.dayPct) < 3 || Math.abs(ms.day) < 50) return;
  const id = 'jour-' + todayISO(), cur = (state.feed || []).find(e => e.id === id);
  if (cur && Math.abs(cur.pct || 0) >= Math.abs(ms.dayPct)) return;
  const ev = addFeed('day', ms.day > 0 ? `prend ${changeTxt(ms.dayPct)} aujourd'hui (${signed(ms.day)}) sur ses placements`
    : `se prend ${changeTxt(ms.dayPct)} aujourd'hui (${signed(ms.day)}) sur ses placements`, { emoji: ms.day > 0 ? '🚀' : '💀', id });
  if (ev) { (state.feed.find(e => e.id === id) || {}).pct = ms.dayPct; save({ auto: true }); }
}
const changeTxt = p => `${p >= 0 ? '+' : '−'}${fmtPct.format(Math.abs(p))} %`;

/* Nouveau record personnel (au plus une fois par jour) */
function feedRecord() {
  if (!state.accounts.length) return false;
  const net = totals().net, max = state.flags.maxNet || 0;
  if (!max) { state.flags.maxNet = net; persist(); return false; }
  if (net > max * 1.01 && net - max >= 50) {
    state.flags.maxNet = net;
    addFeed('record', `bat son record : ${eur(net)} 🏆`, { emoji: '📈', id: 'record-' + todayISO() });
    return true;
  }
  if (net > max) { state.flags.maxNet = net; persist(); }
  return false;
}

/* ---------- Fil du groupe ---------- */
function groupFeed(members) {
  const items = [];
  members.forEach(m => (Array.isArray(m.data.feed) ? m.data.feed : []).forEach(e => {
    if (e && e.id && Number.isFinite(+e.t)) items.push({ ...e, key: `${m.id}:${e.id}`, m });
  }));
  return items.sort((a, b) => b.t - a.t).slice(0, 40);
}
function reactionsFor(key, members) {
  const out = {};
  members.forEach(m => {
    const r = m.me ? (state.reactions || {})[key] : m.data.reactions?.[key];
    if (REACTIONS.includes(r)) (out[r] || (out[r] = [])).push(m);
  });
  return out;
}
let feedExpanded = false;
function feedHTML(members) {
  const all = groupFeed(members);
  if (!all.length) return '<div class="faint small">Rien pour l\'instant : les achats, versements, niveaux et grosses journées de chacun apparaîtront ici.</div>';
  const mine = state.reactions || {};
  const items = feedExpanded ? all : all.slice(0, 10);
  return items.map(e => {
    const rs = reactionsFor(e.key, members);
    return `<div class="feed-item">
      <div class="feed-emo">${esc(e.emoji || '•')}</div>
      <div class="feed-body"><div><b>${esc(e.m.emoji || '')} ${esc(e.m.name)}</b> ${esc(e.text)}</div>
        <div class="feed-meta"><span class="faint small">${agoText(new Date(+e.t).toISOString())}</span>
        <span class="reacts">${REACTIONS.map(r => {
          const who = rs[r] || [];
          return `<button class="react ${mine[e.key] === r ? 'on' : ''} ${who.length ? 'has' : ''}" data-react="${esc(e.key)}" data-emoji="${r}" title="${esc(who.map(x => x.name).join(', ') || 'Réagir')}">${r}${who.length ? ` <b>${who.length}</b>` : ''}</button>`;
        }).join('')}<button class="react react-add" data-react-open aria-label="Réagir">😀<small>＋</small></button></span></div></div>
    </div>`;
  }).join('') + (all.length > items.length ? `<button class="btn feed-more" data-feed-more>Voir les ${all.length - items.length} autres</button>` : '');
}
function toggleReaction(key, emoji) {
  const r = state.reactions || (state.reactions = {});
  if (r[key] === emoji) delete r[key]; else r[key] = emoji;
  save();
  clearTimeout(sync.timer);
  pushProfile();   // tes amis la voient à leur prochaine actualisation (≤ 1 min)
}

/* ---------- Récap de la semaine ---------- */
function weekRecap(members) {
  const per = 'semaine';
  const curves = groupCurves(members, per);
  const perf = curves.series.map(s => {
    const p = s.points;
    if (p.length < 2) return null;
    const a = p[0].y, b = p[p.length - 1].y;
    return { m: s.m, diff: b - a, pct: a > 0 ? (b / a - 1) * 100 : 0, start: a, end: b };
  }).filter(Boolean);
  const byPct = [...perf].sort((x, y) => y.pct - x.pct);
  // Placements : variation sur 7 jours de chaque ligne détenue dans le groupe
  const owners = {};
  members.forEach(m => holdingsOf(m.data).forEach(h => { (owners[h.key] || (owners[h.key] = new Set())).add(m.name); }));
  const lines = Object.keys(owners).map(k => {
    const s = hist.series[histKey(k, per)];
    if (!s || s.length < 2) return null;
    const t0 = Date.now() - CHART_PERIODS[per].ms, p0 = priceAt(k, per, t0), p1 = s[s.length - 1][1];
    return p0 > 0 ? { key: k, pct: (p1 / p0 - 1) * 100, owners: [...owners[k]] } : null;
  }).filter(Boolean).sort((a, b) => b.pct - a.pct);
  const nameOfKey = k => {
    for (const m of members) for (const a of m.data.accounts || []) for (const h of a.holdings || []) if (hKey(h) === k) return h.name || h.ticker || h.symbol;
    return k.split(':')[1];
  };
  // Classement : début de semaine vs maintenant
  const rankAt = i => [...perf].sort((x, y) => (i ? y.end - x.end : y.start - x.start)).map(x => x.m.id);
  const r0 = rankAt(0), r1 = rankAt(1);
  const overtakes = [];
  r1.forEach((id, i) => { const before = r0.indexOf(id); if (before > i) { const passed = r0[i]; overtakes.push([perf.find(x => x.m.id === id).m, perf.find(x => x.m.id === passed)?.m]); } });
  // Fil : plus gros versement, événement le plus applaudi
  const weekAgo = Date.now() - 7 * 864e5;
  const evs = groupFeed(members).filter(e => e.t > weekAgo);
  const money = evs.filter(e => e.kind === 'money' && /ajouté/.test(e.text))[0];
  const starred = evs.map(e => ({ e, n: Object.values(reactionsFor(e.key, members)).reduce((s, l) => s + l.length, 0) })).sort((a, b) => b.n - a.n)[0];
  const totalDiff = curves.total.length > 1 ? curves.total[curves.total.length - 1].y - curves.total[0].y : null;
  return { mvp: byPct[0], loser: byPct.length > 1 ? byPct[byPct.length - 1] : null, best: lines[0], worst: lines.length > 1 ? lines[lines.length - 1] : null,
    nameOfKey, overtakes, money, starred: starred?.n ? starred : null, totalDiff };
}
function recapHTML(members) {
  const r = weekRecap(members);
  const who = m => `${esc(m.emoji || '')} <b>${esc(m.name)}</b>`;
  const row = (ico, title, body) => body ? `<div class="recap-row"><div class="recap-ico">${ico}</div><div><div class="small muted">${title}</div><div>${body}</div></div></div>` : '';
  const sunday = new Date().getDay() === 0;
  return `<div class="recap-head"><b>${sunday ? '🗓️ Le récap du dimanche' : '🗓️ Le récap des 7 derniers jours'}</b>
      <span class="small faint">${DF.dm.format(Date.now() - 7 * 864e5)} → ${DF.dm.format(Date.now())}</span></div>
    <div class="recap-grid">
      ${row('🏆', 'MVP de la semaine', r.mvp && `${who(r.mvp.m)} ${changeSpan(r.mvp.pct)} <span class="small muted money">${signed(r.mvp.diff)}</span>`)}
      ${row('💀', 'Le boulet de la semaine', r.loser && `${who(r.loser.m)} ${changeSpan(r.loser.pct)} <span class="small muted money">${signed(r.loser.diff)}</span>`)}
      ${row('🚀', 'Meilleur placement du groupe', r.best && `<b>${esc(r.nameOfKey(r.best.key))}</b> ${changeSpan(r.best.pct)} <span class="small faint">chez ${esc(r.best.owners.join(', '))}</span>`)}
      ${row('📉', 'Pire placement', r.worst && r.worst.pct < 0 && `<b>${esc(r.nameOfKey(r.worst.key))}</b> ${changeSpan(r.worst.pct)} <span class="small faint">chez ${esc(r.worst.owners.join(', '))}</span>`)}
      ${row('🔀', 'Classement', r.overtakes.length ? r.overtakes.map(([a, b]) => `${who(a)} passe devant ${b ? who(b) : '—'}`).join('<br>') : 'Rien n\'a bougé, chacun reste à sa place')}
      ${row('💰', 'Total du groupe', r.totalDiff != null && `<span class="money ${r.totalDiff >= 0 ? 'up' : 'down'}">${signed(r.totalDiff)}</span> en 7 jours`)}
      ${row('💸', 'Plus gros versement', r.money && `${who(r.money.m)} ${esc(r.money.text)}`)}
      ${row('🔥', 'Le moment de la semaine', r.starred && `${who(r.starred.e.m)} ${esc(r.starred.e.text)} <span class="small faint">(${r.starred.n} réaction${r.starred.n > 1 ? 's' : ''})</span>`)}
    </div>`;
}
/* Le dimanche soir (ou au premier lancement de la semaine suivante) : le récap s'ouvre tout seul, une fois */
function maybeShowSundayRecap() {
  if (!state.group || state.group.kicked || modalOpen()) return;
  const d = new Date();
  if (!(d.getDay() === 0 && d.getHours() >= 18) && d.getDay() !== 1) return;
  const sunday = new Date(d); sunday.setDate(d.getDate() - (d.getDay() === 0 ? 0 : 1));
  const week = sunday.toISOString().slice(0, 10);
  if (state.flags.recapWeek === week) return;
  ensureHistory(keysOf(groupMembers().map(m => m.data)), 'semaine');
  setTimeout(() => {
    if (modalOpen()) return;
    state.flags.recapWeek = week; persist();
    const m = modal(`<div class="recap">${recapHTML(groupMembers())}</div>
      <div class="modal-foot"><button class="btn btn-primary" id="rOk">Bien reçu 👌</button></div>`, { cls: 'wide' });
    m.querySelector('#rOk').onclick = closeModal;
  }, 6000);
}

/* ---------- Duel de portefeuilles ---------- */
let duelWith = null;
function duelHTML(members) {
  const me = members.find(m => m.me), others = members.filter(m => !m.me);
  if (!me || !others.length) return '<div class="faint small">Il faut au moins un autre membre pour un duel.</div>';
  if (!others.some(o => o.id === duelWith)) {
    // Par défaut : le rival le plus proche au classement
    duelWith = [...others].sort((a, b) => Math.abs(a.net - me.net) - Math.abs(b.net - me.net))[0].id;
  }
  const op = others.find(o => o.id === duelWith);
  const per = chartPeriod, t0 = Date.now() - CHART_PERIODS[per].ms;
  const linesOf = m => {
    const map = {};
    for (const a of m.data.accounts || []) for (const h of a.holdings || []) {
      if (!h || !h.symbol || !(+h.qty > 0)) continue;
      const k = hKey(h), live = hist.live[k]?.p ?? (+h.price || 0);
      const x = map[k] || (map[k] = { key: k, name: h.name || h.ticker || h.symbol, qty: 0, value: 0, cost: 0, costQty: 0 });
      x.qty += +h.qty; x.value += +h.qty * live;
      if (+h.pru > 0) { x.cost += +h.pru * +h.qty; x.costQty += +h.qty; }
    }
    return Object.values(map).map(x => {
      const p0 = priceAt(x.key, per, t0), p1 = hist.live[x.key]?.p ?? (x.qty ? x.value / x.qty : 0);
      return { ...x, pru: x.costQty ? x.cost / x.costQty : null, perf: p0 > 0 ? (p1 / p0 - 1) * 100 : null, start: p0 > 0 ? x.qty * p0 : null };
    });
  };
  const A = linesOf(me), B = linesOf(op);
  const portPerf = L => { const s0 = L.reduce((s, x) => s + (x.start ?? x.value), 0), s1 = L.reduce((s, x) => s + x.value, 0); return s0 > 0 ? (s1 / s0 - 1) * 100 : null; };
  const pa = portPerf(A), pb = portPerf(B);
  let sa = 0, sb = 0;
  if (pa != null && pb != null && pa !== pb) pa > pb ? sa++ : sb++;
  const common = A.filter(x => B.some(y => y.key === x.key)).map(x => ({ a: x, b: B.find(y => y.key === x.key) }));
  common.forEach(c => { if (c.a.pru && c.b.pru && c.a.pru !== c.b.pru) c.a.pru < c.b.pru ? sa++ : sb++; });
  const onlyA = A.filter(x => !B.some(y => y.key === x.key)), onlyB = B.filter(y => !A.some(x => x.key === y.key));
  const bestOf = L => [...L].filter(x => x.perf != null).sort((x, y) => y.perf - x.perf)[0];
  const ba = bestOf(onlyA.length ? onlyA : A), bb = bestOf(onlyB.length ? onlyB : B);
  if (ba && bb && ba.perf !== bb.perf) ba.perf > bb.perf ? sa++ : sb++;
  const head = (m, L, p) => `<div class="duel-side"><div style="font-size:30px">${esc(m.emoji || '🙂')}</div><b>${esc(m.name)}</b>
    <div class="money" style="font-size:20px;font-weight:800">${eur(L.reduce((s, x) => s + x.value, 0))}</div>
    <div class="small muted">investis · ${p == null ? '—' : changeSpan(p)} ${CHART_PERIODS[per].since}</div></div>`;
  const pruCell = (x, win) => x.pru ? `<span class="${win ? 'up' : ''}">${eur2(x.pru)}${win ? ' 🏅' : ''}</span>` : '<span class="faint">—</span>';
  return `
    <div class="row between wrap" style="gap:10px;margin-bottom:12px">
      <label class="small muted">Adversaire <select class="input" id="duelSel" style="width:auto;display:inline-block;margin-left:6px">
        ${others.map(o => `<option value="${esc(o.id)}" ${o.id === duelWith ? 'selected' : ''}>${esc(o.emoji || '')} ${esc(o.name)}</option>`).join('')}</select></label>
      <span class="small faint">Période : ${CHART_PERIODS[per].label.toLowerCase()} (sélecteur de la course)</span>
    </div>
    <div class="duel-top">${head(me, A, pa)}<div class="duel-score">${sa} <span class="faint">–</span> ${sb}<div class="small muted">${sa === sb ? 'égalité' : (sa > sb ? esc(me.name) : esc(op.name)) + ' mène'}</div></div>${head(op, B, pb)}</div>
    <div class="duel-sec"><div class="small muted">🤝 En commun : qui a acheté le moins cher ?</div>
      ${common.length ? `<table class="duel-table"><tr><th></th><th>${esc(me.name)} (prix moyen)</th><th>${esc(op.name)} (prix moyen)</th><th>Variation</th></tr>
        ${common.map(c => `<tr><td><b>${esc(c.a.name)}</b></td><td>${pruCell(c.a, c.a.pru && c.b.pru && c.a.pru < c.b.pru)}</td><td>${pruCell(c.b, c.a.pru && c.b.pru && c.b.pru < c.a.pru)}</td><td>${changeSpan(c.a.perf)}</td></tr>`).join('')}</table>
        ${common.some(c => !c.a.pru || !c.b.pru) ? '<div class="small faint">Prix d\'achat (PRU) manquant chez l\'un des deux : à renseigner dans 📡.</div>' : ''}`
        : '<div class="faint small">Aucune ligne en commun.</div>'}</div>
    <div class="grid g2 duel-sec">
      <div><div class="small muted">🎯 Meilleur pick de ${esc(me.name)}</div>${ba ? `<b>${esc(ba.name)}</b> ${changeSpan(ba.perf)}` : '<span class="faint">—</span>'}
        <div class="small faint">${onlyA.length} ligne(s) que ${esc(op.name)} n'a pas : ${esc(onlyA.map(x => x.name).slice(0, 5).join(', ') || '—')}</div></div>
      <div><div class="small muted">🎯 Meilleur pick de ${esc(op.name)}</div>${bb ? `<b>${esc(bb.name)}</b> ${changeSpan(bb.perf)}` : '<span class="faint">—</span>'}
        <div class="small faint">${onlyB.length} ligne(s) que tu n'as pas : ${esc(onlyB.map(x => x.name).slice(0, 5).join(', ') || '—')}</div></div>
    </div>
    <div class="small faint" style="margin-top:8px">Points : meilleure performance des placements sur la période, meilleur prix d'achat sur chaque ligne commune, meilleur pick.</div>`;
}

/* Liaisons des cartes du groupe (fil, duel) */
function bindGroupLife(v) {
  v.querySelectorAll('[data-react]').forEach(b => b.onclick = () => {
    toggleReaction(b.dataset.react, b.dataset.emoji);
    const box = document.getElementById('feedBox');
    if (box) { box.innerHTML = feedHTML(groupMembers()); bindGroupLife(box); }
  });
  // Téléphone : le choix des réactions s'ouvre à la demande
  v.querySelectorAll('[data-react-open]').forEach(b => b.onclick = () => b.closest('.feed-item').classList.toggle('open'));
  v.querySelector('[data-feed-more]')?.addEventListener('click', () => {
    feedExpanded = true;
    const box = document.getElementById('feedBox');
    if (box) { box.innerHTML = feedHTML(groupMembers()); bindGroupLife(box); }
  });
  const sel = v.querySelector('#duelSel');
  if (sel) sel.onchange = () => { duelWith = sel.value; refreshDuel(); };
}
function refreshDuel() {
  const box = document.getElementById('duelBox');
  if (!box || box.matches(':focus-within')) return;
  box.innerHTML = duelHTML(groupMembers()); bindGroupLife(box);
}
function refreshRecap() {
  const box = document.getElementById('recapBox');
  if (box) box.innerHTML = recapHTML(groupMembers());
}
