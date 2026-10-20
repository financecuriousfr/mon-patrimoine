/* =========================================================
   Contrôleur : navigation, modales, actions, raccourcis
   ========================================================= */
const VIEWS = {
  dashboard: { title: 'Tableau de bord', render: renderDashboard },
  accounts: { title: 'Mon patrimoine', render: renderAccounts },
  projection: { title: 'Projection dans le futur', render: renderProjection },
  goals: { title: 'Objectifs', render: renderGoals },
  friends: { title: 'Entre amis', render: renderFriends },
  badges: { title: 'Succès & niveaux', render: renderBadges },
  history: { title: 'Historique', render: renderHistory },
  settings: { title: 'Réglages', render: renderSettings },
};
let currentView = 'dashboard';
const $view = document.getElementById('view');

function go(name, arg) {
  if (!VIEWS[name]) return;
  currentView = name;
  $view.classList.remove('no-anim');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const tabbed = ['dashboard', 'accounts', 'friends'].includes(name);
  document.querySelectorAll('#tabbar [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name || (b.dataset.tab === 'more' && !tabbed)));
  document.getElementById('viewTitle').textContent = VIEWS[name].title;
  $view.scrollTop = 0;
  VIEWS[name].render($view, arg);
  updateBrand();
}
function rerender(keepScroll = true) {
  const top = $view.scrollTop;
  // Actualisation sur place : pas d'animation d'entrée (sinon l'écran « clignote »)
  $view.classList.add('no-anim');
  VIEWS[currentView].render($view);
  if (keepScroll) $view.scrollTop = top;
  updateBrand();
}
function updateBrand() {
  const l = levelFor(totals().net);
  document.getElementById('brandLevel').textContent = `${l.cur.emoji} Niv. ${l.idx} · ${l.cur.name}`;
  // Qui est connecté, visible en permanence
  const u = document.getElementById('brandUser');
  if (u) {
    const g = state.group;
    u.innerHTML = g && !g.kicked
      ? `👤 <b>${esc(g.name)}</b> · 👥 ${esc(g.groupName)}`
      : `👤 ${esc(state.profile.name || 'Moi')} · <span class="faint">pas de groupe</span>`;
    u.title = g ? 'Connecté au groupe d\'amis' : 'Pas connecté à un groupe d\'amis (onglet Amis)';
  }
}

/* ---------- Thème & confidentialité ---------- */
function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.getElementById('btnTheme').textContent = state.settings.theme === 'dark' ? '☀️' : '🌙';
}
function applyPrivacy() {
  document.body.classList.toggle('privacy', !!state.settings.privacy);
  document.getElementById('btnPrivacy').textContent = state.settings.privacy ? '🙈' : '👁️';
}
function togglePrivacy() {
  state.settings.privacy = !state.settings.privacy; save(); applyPrivacy();
  toast(state.settings.privacy ? '🙈 Montants masqués' : '👁️ Montants visibles', state.settings.privacy ? 'Survole un montant pour le voir. Touche M pour basculer.' : '');
  if (currentView === 'settings') rerender();
}

/* ---------- Toasts & modales ---------- */
function toast(title, sub = '', cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = `<b>${title}</b>${sub ? `<small>${sub}</small>` : ''}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.transition = '.4s'; el.style.opacity = 0; el.style.transform = 'translateX(30px)'; }, 3800);
  setTimeout(() => el.remove(), 4300);
}
let modalOnClose = null;
function modal(html, { cls = '', onClose } = {}) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="overlay"><div class="modal ${cls}">${html}</div></div>`;
  const ov = root.firstElementChild;
  ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
  modalOnClose = onClose || null;
  const first = ov.querySelector('[autofocus]');
  if (first) setTimeout(() => { first.focus(); first.select?.(); }, 30);
  return ov.querySelector('.modal');
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
  const f = modalOnClose; modalOnClose = null;
  if (f) f();
}
const modalOpen = () => !!document.querySelector('#modalRoot .overlay');
function confirmModal(title, text, onYes, yesLabel = 'Confirmer', danger = true) {
  const m = modal(`<h2>${title}</h2><p class="muted" style="line-height:1.5">${text}</p>
    <div class="modal-foot"><button class="btn" id="cNo">Annuler</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cYes" autofocus>${yesLabel}</button></div>`);
  m.querySelector('#cNo').onclick = closeModal;
  m.querySelector('#cYes').onclick = () => { closeModal(); onYes(); };
}

/* ---------- Lignes suivies en direct ---------- */
function openHoldingsModal(id) {
  const a = state.accounts.find(x => x.id === id);
  if (!a) return;
  a.holdings = a.holdings || [];
  const wasManual = !isTracked(a) ? a.value : null;
  let kind = a.cat === 'crypto' ? 'crypto' : 'stock';
  let results = [], searchT = null, seq = 0;
  const m = modal(`
    <h2>📡 Cours en direct — ${esc(a.emoji || CATS[a.cat].emoji)} ${esc(a.name)}</h2>
    <p class="small muted" style="margin-top:0;line-height:1.5">Valeur du compte = Σ (quantité × cours) + espèces. Actions, ETF et fonds : Yahoo Finance (via le relais local) · crypto : CoinGecko. Les cours en devises sont convertis en euros.</p>
    <div class="hold-wrap"><table class="tbl holdings"><thead><tr><th>Ligne</th><th class="r">Quantité</th><th class="r">PRU (€)</th><th class="r">Cours</th><th class="r">Valeur</th><th class="r">+/− value</th><th></th></tr></thead>
      <tbody id="hBody"></tbody></table></div>
    <div class="row between wrap mt">
      <label class="row small muted" style="gap:8px">💶 Espèces non investies <input class="input money" id="hCash" style="width:130px" value="${a.cash ? fmtNum.format(a.cash) : ''}" placeholder="0"></label>
      <div>Total du compte : <b class="money" id="hTotal" style="font-size:18px"></b></div>
    </div>
    <div class="search-box mt">
      <div class="row wrap">
        <div class="seg"><button data-k="stock">📈 Actions, ETF, fonds</button><button data-k="crypto">🪙 Crypto</button></div>
        <input class="input" id="hSearch" style="flex:1;min-width:220px" placeholder="Ajouter une ligne : nom, ticker ou ISIN…" autocomplete="off">
      </div>
      <div id="hResults" class="results"></div>
    </div>
    ${wasManual ? `<p class="small faint">Valeur saisie à la main jusqu'ici : ${eur(wasManual)}. Dès la première ligne ajoutée, la valeur sera calculée automatiquement.</p>` : ''}
    <div class="modal-foot"><button class="btn left" id="hRefresh">🔄 Actualiser les cours</button><button class="btn btn-primary" id="hDone">Terminé</button></div>`,
    { cls: 'wide', onClose: () => { if (!a.holdings.length) delete a.holdings; recomputeTracked(); save(); checkAchievements(); rerender(); } });
  const $ = s => m.querySelector(s);
  const qf = q => (+q || 0).toLocaleString('fr-FR', { maximumFractionDigits: 8, useGrouping: false });

  const renderTotal = () => { $('#hTotal').textContent = eur(a.holdings.length ? holdingsValue(a) : a.value); };
  const renderLines = () => {
    $('#hBody').innerHTML = a.holdings.length ? a.holdings.map(h => `
      <tr data-h="${h.id}">
        <td><b>${esc(holdingLabel(h))}</b><div class="small muted">${esc(h.name || '')}${h.currency && h.currency !== 'EUR' && h.nativePrice ? ` · ${h.nativePrice.toLocaleString('fr-FR')} ${h.currency}` : ''}</div></td>
        <td class="r"><input class="input num" data-f="qty" value="${h.qty ? qf(h.qty) : ''}" placeholder="0" style="width:110px;text-align:right"></td>
        <td class="r"><input class="input num" data-f="pru" value="${h.pru ? qf(h.pru) : ''}" placeholder="optionnel" style="width:100px;text-align:right"></td>
        <td class="r money">${h.price ? eur2(h.price) : '<span class="faint">…</span>'}<div class="small">${changeSpan(h.change)}</div></td>
        <td class="r money"><b>${eur((+h.qty || 0) * (+h.price || 0))}</b></td>
        <td class="r small">${plHTML(h) || '<span class="faint">—</span>'}</td>
        <td class="r"><button class="btn btn-sm btn-ghost" data-del="${h.id}" title="Retirer la ligne">✕</button></td>
      </tr>`).join('') : `<tr><td colspan="7" class="center muted" style="padding:22px">Aucune ligne pour l'instant — recherche un titre ci-dessous 👇</td></tr>`;
    renderTotal();
  };
  const renderResults = (msg) => {
    $('#hResults').innerHTML = msg ? `<div class="small muted" style="padding:8px 4px">${msg}</div>`
      : results.map((r, i) => `<button class="res" data-i="${i}"><b>${esc(r.kind === 'crypto' ? (r.ticker || '').toUpperCase() : r.symbol)}</b>
          <span>${esc(r.name)}</span><span class="faint small">${esc([r.exchange, r.type].filter(Boolean).join(' · '))}</span></button>`).join('');
  };
  const setKind = k => {
    kind = k;
    m.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    $('#hSearch').placeholder = k === 'crypto' ? 'Ajouter une crypto : bitcoin, solana, XRP…' : 'Ajouter une ligne : nom, ticker ou ISIN (LVMH, CW8, FR0010315770…)';
    results = []; renderResults(); doSearch(); $('#hSearch').focus();
  };
  const doSearch = () => {
    clearTimeout(searchT);
    const q = $('#hSearch').value;
    if (q.trim().length < 2) { results = []; return renderResults(); }
    searchT = setTimeout(async () => {
      const my = ++seq;
      renderResults('🔎 Recherche…');
      try {
        const r = await searchInstruments(q, kind);
        if (my !== seq) return;
        results = r.map(x => ({ ...x, kind }));
        renderResults(results.length ? '' : 'Aucun résultat. Essaie le ticker (ex : MC.PA) ou le code ISIN.');
      } catch {
        if (my !== seq) return;
        renderResults(kind === 'stock' ? '🔴 Le relais des cours ne répond pas. Ferme l\'app puis relance-la depuis le raccourci du bureau.' : '⚠️ CoinGecko ne répond pas — vérifie ta connexion internet.');
      }
    }, 350);
  };
  const addLine = async r => {
    const exist = a.holdings.find(h => h.kind === r.kind && h.symbol === r.symbol);
    const h = exist || { id: uid(), kind: r.kind, symbol: r.symbol, ticker: r.ticker, name: r.name, qty: 0 };
    if (!exist) a.holdings.push(h);
    $('#hSearch').value = ''; results = []; renderResults(); renderLines();
    m.querySelector(`tr[data-h="${h.id}"] [data-f="qty"]`)?.focus();
    try {
      const res = r.kind === 'crypto' ? await fetchCryptoQuotes([r.symbol]) : await fetchStockQuotes([r.symbol]);
      const q = res.quotes[r.symbol];
      if (q) {
        Object.assign(h, { price: q.priceEUR, nativePrice: q.price, currency: q.currency, change: q.changePct, priceAt: new Date().toISOString() });
        recomputeTracked(); save();
        const focused = document.activeElement, f = focused?.dataset?.f, hid = focused?.closest('tr')?.dataset.h, val = focused?.value;
        renderLines();
        if (f) { const el = m.querySelector(`tr[data-h="${hid}"] [data-f="${f}"]`); if (el) { el.value = val; el.focus(); } }
      }
    } catch { toast('⚠️ Cours indisponible pour ' + r.symbol); }
  };

  $('#hBody').addEventListener('change', e => {
    const f = e.target.dataset.f; if (!f) return;
    const h = a.holdings.find(x => x.id === e.target.closest('tr').dataset.h);
    const v = parseFloat(e.target.value.replace(/\s/g, '').replace(',', '.'));
    if (e.target.value.trim() && (isNaN(v) || v < 0)) return shake(e.target);
    h[f] = isNaN(v) ? (f === 'qty' ? 0 : undefined) : v;
    a.updatedAt = new Date().toISOString();
    recomputeTracked(); save();
    const row = e.target.closest('tr');
    row.children[4].innerHTML = `<b>${eur((+h.qty || 0) * (+h.price || 0))}</b>`;
    row.children[5].innerHTML = plHTML(h) || '<span class="faint">—</span>';
    renderTotal();
  });
  $('#hBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.f) e.target.blur(); });
  $('#hBody').addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (!del) return;
    a.holdings = a.holdings.filter(h => h.id !== del.dataset.del);
    recomputeTracked(); save(); renderLines();
  });
  $('#hCash').addEventListener('change', e => {
    const v = parseAmount(e.target.value || '0');
    if (isNaN(v)) return shake(e.target);
    a.cash = v || undefined; e.target.value = v ? fmtNum.format(v) : '';
    recomputeTracked(); save(); renderTotal();
  });
  $('#hSearch').addEventListener('input', doSearch);
  $('#hSearch').addEventListener('keydown', e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); addLine(results[0]); } });
  $('#hResults').addEventListener('click', e => { const b = e.target.closest('.res'); if (b) addLine(results[+b.dataset.i]); });
  m.querySelectorAll('.seg button').forEach(b => b.onclick = () => setKind(b.dataset.k));
  $('#hRefresh').onclick = async () => { await refreshPrices(); renderLines(); };
  $('#hDone').onclick = closeModal;

  setKind(kind);
  renderLines();
  const empty = a.holdings.find(h => !h.qty);
  if (empty) setTimeout(() => m.querySelector(`tr[data-h="${empty.id}"] [data-f="qty"]`)?.focus(), 40);
  if (a.holdings.some(h => !h.price)) refreshPrices({ silent: true }).then(() => m.isConnected && renderLines());
}

function shake(el) {
  el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 250, iterations: 2 });
  el.style.borderColor = 'var(--red)'; setTimeout(() => el.style.borderColor = '', 1200);
}

/* ---------- Objectifs ---------- */
function openGoalModal(id) {
  const g = id ? state.goals.find(x => x.id === id) : null;
  const d = g ? { ...g } : { id: uid(), name: '', emoji: '🎯', target: 10000, scope: 'net', deadline: '' };
  const m = modal(`
    <h2>${g ? '✏️ Modifier' : '🎯 Nouvel'} objectif</h2>
    <div class="form-grid">
      <label class="field">Nom<input class="input" id="gName" value="${esc(d.name)}" placeholder="Apport immobilier" autofocus></label>
      <label class="field">Emoji<input class="input" id="gEmoji" value="${esc(d.emoji)}" maxlength="4"></label>
      <label class="field">Montant cible (€)<input class="input money" id="gTarget" value="${fmtNum.format(d.target)}"></label>
      <label class="field">Échéance (optionnelle)<input class="input" id="gDeadline" type="date" value="${esc(d.deadline || '')}"></label>
      <label class="field full">Ce qui compte pour cet objectif<select class="input" id="gScope">
        <option value="net">💎 Patrimoine net total</option>
        <optgroup label="Une catégorie">${Object.entries(CATS).filter(([, c]) => !c.debt).map(([k, c]) => `<option value="cat:${k}">${c.emoji} ${c.label}</option>`).join('')}</optgroup>
        ${state.accounts.length ? `<optgroup label="Un compte précis">${state.accounts.filter(a => !CATS[a.cat].debt).map(a => `<option value="acc:${a.id}">${esc(a.emoji || CATS[a.cat].emoji)} ${esc(a.name)}</option>`).join('')}</optgroup>` : ''}
      </select></label>
    </div>
    <div class="row wrap mt">${['🛟 Épargne de précaution|10000|cat:livrets', '🏡 Apport immobilier|40000|net', '🚀 100 k€|100000|net', '💎 Premier million|1000000|net', '🏖️ Tour du monde|15000|net']
      .map(s => `<button class="chip" data-sugg="${s}">${s.split('|')[0]}</button>`).join('')}</div>
    <div class="modal-foot">
      ${g ? '<button class="btn btn-danger left" id="gDel">🗑️ Supprimer</button>' : ''}
      <button class="btn" id="gCancel">Annuler</button><button class="btn btn-primary" id="gSave">Enregistrer</button>
    </div>`);
  const $ = s => m.querySelector(s);
  $('#gScope').value = d.scope || 'net';
  m.querySelectorAll('[data-sugg]').forEach(b => b.onclick = () => {
    const [label, target, scope] = b.dataset.sugg.split('|');
    const [emo, ...rest] = label.split(' ');
    $('#gEmoji').value = emo; $('#gName').value = rest.join(' '); $('#gTarget').value = fmtNum.format(+target); $('#gScope').value = scope;
  });
  $('#gCancel').onclick = closeModal;
  if (g) $('#gDel').onclick = () => { state.goals = state.goals.filter(x => x.id !== g.id); save(); closeModal(); toast('🗑️ Objectif supprimé'); rerender(); };
  const submit = () => {
    const name = $('#gName').value.trim(), target = parseAmount($('#gTarget').value);
    if (!name) return shake($('#gName'));
    if (!(target > 0)) return shake($('#gTarget'));
    const goal = { ...d, name, target, emoji: $('#gEmoji').value.trim() || '🎯', scope: $('#gScope').value, deadline: $('#gDeadline').value };
    if (g && (g.target !== target || g.scope !== goal.scope)) delete goal.doneAt;
    if (g) state.goals[state.goals.findIndex(x => x.id === g.id)] = goal; else state.goals.push(goal);
    save(); closeModal(); toast('🎯 Objectif enregistré'); checkAchievements();
    if (currentView !== 'goals' && currentView !== 'dashboard') go('goals'); else rerender();
  };
  $('#gSave').onclick = submit;
  m.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit(); });
}

/* ---------- Photos ---------- */
function doSnapshot() {
  if (!state.accounts.length) return toast('Ajoute d\'abord un compte');
  const s = takeSnapshot();
  toast('📸 Photo enregistrée', `${fmtDate(s.date, true)} : ${eur(s.net)}`);
  checkAchievements(); rerender();
}
function openPastModal() {
  const m = modal(`<h2>🕰️ Ajouter un point passé</h2>
    <p class="small muted" style="margin-top:0">Tu connais ton patrimoine d'il y a quelques mois ? Ajoute-le pour enrichir ta courbe.</p>
    <div class="form-grid">
      <label class="field">Date<input class="input" type="date" id="pDate" max="${todayISO()}" value="${todayISO().slice(0, 8)}01"></label>
      <label class="field">Patrimoine net (€)<input class="input money" id="pNet" placeholder="45 000" autofocus></label>
      <label class="field">Actifs bruts (optionnel)<input class="input money" id="pAssets"></label>
      <label class="field">Dettes (optionnel)<input class="input money" id="pDebts"></label>
    </div>
    <div class="modal-foot"><button class="btn" id="pCancel">Annuler</button><button class="btn btn-primary" id="pSave">Ajouter</button></div>`);
  const $ = s => m.querySelector(s);
  $('#pCancel').onclick = closeModal;
  $('#pSave').onclick = () => {
    const date = $('#pDate').value, net = parseAmount($('#pNet').value);
    if (!date || date > todayISO()) return shake($('#pDate'));
    if (isNaN(net) || !$('#pNet').value.trim()) return shake($('#pNet'));
    const a = $('#pAssets').value.trim() ? parseAmount($('#pAssets').value) : null;
    const dbt = $('#pDebts').value.trim() ? parseAmount($('#pDebts').value) : null;
    const snap = { date, net, assets: a ?? (dbt != null ? net + dbt : null), debts: dbt ?? (a != null ? a - net : null), byCat: {} };
    state.snapshots = state.snapshots.filter(s => s.date !== date).concat(snap);
    state.snapshots = sortedSnapshots(); save(); closeModal(); toast('🕰️ Point ajouté', fmtDate(date, true)); checkAchievements(); rerender();
  };
}

/* ---------- Mise à jour express ---------- */
function openExpress() {
  const order = Object.keys(CATS);
  if (!state.accounts.length) { toast('Ajoute d\'abord un compte'); return openAccountModal(); }
  // Les comptes suivis en direct se mettent à jour seuls
  const list = state.accounts.filter(a => !isTracked(a)).sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  const nTracked = state.accounts.length - list.length;
  const before = totals().net;
  if (nTracked) refreshPrices({ silent: true });
  if (!list.length) { toast('📡 Tous tes comptes suivent les cours en direct'); takeSnapshot(); return rerender(); }
  let i = 0;
  const m = modal('', { cls: 'express' });
  const step = () => {
    if (i >= list.length) return finish();
    const a = list[i], c = CATS[a.cat];
    const days = a.updatedAt ? Math.floor((Date.now() - new Date(a.updatedAt)) / 864e5) : null;
    m.innerHTML = `
      <div class="row between small muted"><span>⚡ Mise à jour express</span><span>${i + 1} / ${list.length}</span></div>
      <div class="dots" style="margin-top:10px">${list.map((_, j) => `<i class="${j === i ? 'on' : j < i ? 'done' : ''}"></i>`).join('')}</div>
      <div class="ex-card">
        <div class="ex-emo">${esc(a.emoji || c.emoji)}</div>
        <div class="ex-name">${esc(a.name)}</div>
        <div class="ex-prev">${c.emoji} ${c.label} · ${a.share && a.share < 100 ? `ta part (${fmtPct.format(a.share)} %)` : 'valeur actuelle'} <b class="money">${eur(a.value)}</b>${days != null ? ` · ${days <= 0 ? "mise à jour aujourd'hui" : `il y a ${days} j`}` : ''}</div>
        <input class="input ex-input money" id="exVal" value="${fmtNum.format(a.value || 0)}" inputmode="decimal">
        <div class="ex-delta" id="exDelta"></div>
        <div class="ex-quick">
          ${[-1000, -100, 100, 500, 1000].map(n => `<button class="chip" data-q="${n}">${n > 0 ? '+' : '−'}${fmtNum.format(Math.abs(n))}</button>`).join('')}
        </div>
      </div>
      <div class="modal-foot" style="justify-content:space-between">
        <button class="btn btn-ghost" id="exPrev" ${i === 0 ? 'disabled style="opacity:.4"' : ''}>← Précédent</button>
        <button class="btn" id="exSame">= Inchangé</button>
        <button class="btn btn-primary" id="exNext">${i === list.length - 1 ? 'Terminer ✓' : 'Suivant →'}</button>
      </div>
      <div class="small faint desk-only" style="margin-top:12px">Entrée = valider · Échap = quitter (les valeurs déjà validées sont conservées)</div>`;
    const inp = m.querySelector('#exVal'), dl = m.querySelector('#exDelta');
    const showDelta = () => {
      const v = parseAmount(inp.value);
      if (isNaN(v)) { dl.innerHTML = '<span class="down">Montant invalide</span>'; return; }
      const d = v - a.value, good = c.debt ? d < 0 : d > 0;
      dl.innerHTML = d ? `<span class="${good ? 'up' : 'down'} money">${d > 0 ? '▲' : '▼'} ${signed(d)}</span>` : '<span class="faint">inchangé</span>';
    };
    inp.addEventListener('input', showDelta);
    m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const cur = parseAmount(inp.value); inp.value = fmtNum.format((isNaN(cur) ? a.value : cur) + +b.dataset.q); showDelta(); inp.focus();
    });
    const commit = () => {
      const v = parseAmount(inp.value);
      if (isNaN(v)) { shake(inp); return false; }
      if (v !== a.value) { a.value = v; syncShare(a); }
      a.updatedAt = new Date().toISOString();
      save(); return true;
    };
    m.querySelector('#exNext').onclick = () => { if (commit()) { i++; step(); } };
    m.querySelector('#exSame').onclick = () => { inp.value = fmtNum.format(a.value); if (commit()) { i++; step(); } };
    m.querySelector('#exPrev').onclick = () => { if (i > 0) { i--; step(); } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); m.querySelector('#exNext').click(); } });
    showDelta(); setTimeout(() => { inp.focus(); inp.select(); }, 20);
  };
  const finish = () => {
    takeSnapshot();
    state.flags.express = new Date().toISOString(); save();
    const after = totals().net, d = after - before;
    m.innerHTML = `
      <div class="ex-card" style="padding:10px 0">
        <div class="ex-emo">${d > 0 ? '🚀' : d < 0 ? '🌧️' : '✅'}</div>
        <div class="ex-name">Mise à jour terminée !</div>
        <div class="ex-result money" id="exRes">${eur(before)}</div>
        <div>${deltaPill(d, before)}</div>
        <p class="muted small" style="margin-top:14px">📸 Une photo du ${fmtDate(todayISO(), true)} a été ajoutée à ton historique.
          ${nTracked ? `<br>📡 ${nTracked} compte(s) suivi(s) en direct actualisé(s) automatiquement.` : ''}</p>
        <button class="btn btn-primary mt" id="exDone" autofocus>Voir mon tableau de bord</button>
      </div>`;
    animateNumber(m.querySelector('#exRes'), after, { from: before, dur: 1400 });
    if (d > 0) confetti.burst(200);
    m.querySelector('#exDone').onclick = () => { closeModal(); go('dashboard'); };
    m.querySelector('#exDone').focus();
    setTimeout(() => checkAchievements(), 900);
  };
  modalOnClose = () => rerender();
  step();
}

/* ---------- Cours ---------- */
async function refreshPricesAction() {
  const res = await refreshPrices();
  updateRelayStatus();
  if (res?.updated) { checkAchievements(); if (!modalOpen()) rerender(); }
}

/* ---------- Données ---------- */
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportJSON() {
  state.lastBackup = new Date().toISOString(); save();
  download(`mon-patrimoine-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('💾 Sauvegarde exportée', 'Fichier enregistré dans ton dossier Téléchargements.');
  checkAchievements();
  if (currentView === 'settings') rerender();
}
function exportCSV() {
  const rows = [['Nom', 'Catégorie', 'Valeur (€)', 'Rendement/Taux (%)', 'Plafond', 'Mensualité', 'Mis à jour']];
  state.accounts.forEach(a => rows.push([a.name, CATS[a.cat].label, (CATS[a.cat].debt ? -a.value : a.value).toFixed(2).replace('.', ','),
    String(a.rate ?? '').replace('.', ','), a.cap || '', a.payment || '', a.updatedAt ? a.updatedAt.slice(0, 10) : '']));
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`mon-patrimoine-${todayISO()}.csv`, csv, 'text/csv');
  toast('📄 CSV exporté', 'Ouvrable directement dans Excel.');
}
function importJSON(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result);
      if (!s || !Array.isArray(s.accounts)) throw new Error('format');
      confirmModal('Importer cette sauvegarde ?', `${s.accounts.length} élément(s) et ${(s.snapshots || []).length} photo(s). Tes données actuelles seront remplacées.`, () => {
        state = migrate(s);
        save(); applyTheme(); applyPrivacy(); toast('✅ Sauvegarde importée'); go('dashboard');
        refreshPricesAction();
      }, 'Importer', false);
    } catch { toast('⚠️ Fichier invalide', 'Ce n\'est pas une sauvegarde Mon Patrimoine.'); }
  };
  rd.readAsText(file);
}
function loadDemo() {
  if (state.group) return toast('👥 Tu es dans un groupe d\'amis', 'Quitte d\'abord le groupe (onglet Amis) pour ne pas lui envoyer les données d\'exemple.');
  const apply = () => {
    const keep = { profile: state.profile, settings: state.settings };
    state = { ...DEFAULT_STATE(), ...demoData(), ...keep };
    state.flags.maxLevel = levelFor(totals().net).idx;
    checkAchievements({ silent: true });
    toast('🎲 Exemple chargé', 'Explore librement, puis « Tout effacer » dans Réglages pour démarrer.');
    confetti.burst(120);
    go('dashboard');
    refreshPrices({ silent: true }).then(r => { updateRelayStatus(); if (r?.updated && !modalOpen() && currentView === 'dashboard') rerender(); });
  };
  if (state.accounts.length) confirmModal('Charger l\'exemple ?', 'Tes données actuelles seront remplacées. Exporte une sauvegarde avant si besoin.', apply, 'Charger');
  else apply();
}
function resetAll() {
  confirmModal('Tout effacer ?', `Comptes, historique, objectifs et succès seront supprimés définitivement${state.group ? ', et tu quitteras ton groupe d\'amis' : ''}. Pense à exporter une sauvegarde avant.`, async () => {
    if (state.group) await leaveGroup();
    const settings = state.settings;
    state = DEFAULT_STATE(); state.settings = settings; save(); toast('🧹 Données effacées'); go('dashboard');
  }, 'Tout effacer');
}

/* ---------- Téléphone : barre d'onglets et feuilles d'actions ---------- */
const isPhone = () => matchMedia('(max-width: 860px)').matches;
const tapFeedback = () => { try { navigator.vibrate?.(8); } catch {} };
function openQuickSheet() {
  tapFeedback();
  const items = [
    ['add', '＋', 'Ajouter', 'Un compte, un livret, une action, une crypto…'],
    ['express', '⚡', 'Mise à jour express', 'Tes montants en 30 secondes, un par un'],
    ['snapshot', '📸', 'Prendre une photo', 'Fige ton patrimoine du jour dans l\'historique'],
    ['add-goal', '🎯', 'Nouvel objectif', 'Un montant à atteindre, une date'],
  ];
  const m = modal(`<div class="sheet-list">${items.map(([k, e, t, s]) => `
    <button class="sheet-item ${k === 'add' ? 'primary' : ''}" data-q="${k}"><span class="si-ico">${e}</span><span><b>${t}</b><small>${s}</small></span></button>`).join('')}</div>`, { cls: 'sheet' });
  m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const k = b.dataset.q; closeModal(); setTimeout(() => ACTIONS[k]?.(), 60); });
}
function openMoreSheet() {
  tapFeedback();
  const l = levelFor(totals().net), g = state.group;
  const pages = [['goals', '🎯', 'Objectifs'], ['projection', '🔮', 'Projection'], ['badges', '🏆', 'Succès & niveaux'], ['history', '📸', 'Historique'], ['settings', '⚙️', 'Réglages']];
  const m = modal(`
    <div class="more-head"><div class="more-lvl">${l.cur.emoji}</div>
      <div><b>${esc(state.profile.name || 'Mon patrimoine')}</b><div class="small muted">Niv. ${l.idx} · ${esc(l.cur.name)}${g && !g.kicked ? ` · 👥 ${esc(g.groupName)}` : ''}</div></div></div>
    <div class="sheet-grid">${pages.map(([v, e, t]) => `<button class="sheet-tile ${currentView === v ? 'on' : ''}" data-go="${v}"><span>${e}</span>${t}</button>`).join('')}</div>
    <div class="sheet-list compact">
      ${canInstall() ? '<button class="sheet-item primary" data-t="install"><span class="si-ico">📲</span><span><b>Installer l\'app</b><small>Une icône sur ton écran d\'accueil, en plein écran</small></span></button>' : ''}
      <button class="sheet-item" data-t="privacy"><span class="si-ico">${state.settings.privacy ? '👁️' : '🙈'}</span><span><b>${state.settings.privacy ? 'Afficher les montants' : 'Masquer les montants'}</b><small>Pratique en public</small></span></button>
      <button class="sheet-item" data-t="theme"><span class="si-ico">${state.settings.theme === 'dark' ? '☀️' : '🌙'}</span><span><b>Thème ${state.settings.theme === 'dark' ? 'clair' : 'sombre'}</b></span></button>
    </div>`, { cls: 'sheet' });
  m.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { closeModal(); go(b.dataset.go); });
  m.querySelector('[data-t="install"]')?.addEventListener('click', () => { closeModal(); askInstall({ force: true }); });
  m.querySelector('[data-t="privacy"]').onclick = () => { closeModal(); togglePrivacy(); };
  m.querySelector('[data-t="theme"]').onclick = () => { closeModal(); state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); rerender(); };
}
document.getElementById('tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  const t = b.dataset.tab;
  if (t === 'plus') return openQuickSheet();
  if (t === 'more') return openMoreSheet();
  if (closeModal && modalOpen()) closeModal();
  if (currentView === t) { $view.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  tapFeedback(); go(t);
});

/* ---------- Événements ---------- */
document.getElementById('nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
document.getElementById('btnPhone').onclick = openPhoneModal;
document.getElementById('btnExpress').onclick = openExpress;
document.getElementById('btnPrivacy').onclick = togglePrivacy;
document.getElementById('btnTheme').onclick = () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); rerender(); };
document.getElementById('btnAdd').onclick = () => currentView === 'goals' ? openGoalModal() : openAccountModal();

const ACTIONS = {
  add: () => openAccountModal(), demo: loadDemo, express: openExpress, snapshot: doSnapshot, 'add-goal': () => openGoalModal(),
  'add-past': openPastModal, prices: refreshPricesAction, export: exportJSON, csv: exportCSV, reset: resetAll, privacy: togglePrivacy,
  import: () => document.getElementById('importFile')?.click(),
};
$view.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tpl],[data-edit],[data-holdings],[data-edit-goal],[data-del-snap],[data-view-link],[data-theme-set],.legend-item');
  if (!t) return;
  const ds = t.dataset;
  if (ds.act) ACTIONS[ds.act]?.();
  else if (ds.holdings) openHoldingsModal(ds.holdings);
  else if (ds.tpl != null) openAccountModal(null, +ds.tpl);
  else if (ds.edit) openAccountModal(ds.edit);
  else if (ds.editGoal) openGoalModal(ds.editGoal);
  else if (ds.delSnap) { state.snapshots = state.snapshots.filter(s => s.date !== ds.delSnap); save(); toast('🗑️ Photo supprimée'); rerender(); }
  else if (ds.viewLink) go(ds.viewLink);
  else if (ds.themeSet) { state.settings.theme = ds.themeSet; save(); applyTheme(); rerender(); }
  else if (ds.cat) go('accounts', ds.cat);
});
$view.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'importFile' && t.files[0]) { importJSON(t.files[0]); t.value = ''; return; }
  if (t.dataset.val) {
    const a = state.accounts.find(x => x.id === t.dataset.val);
    const v = parseAmount(t.value);
    if (!a) return;
    if (isNaN(v)) { shake(t); t.value = fmtNum.format(a.value); return; }
    const d = v - a.value;
    a.value = v; syncShare(a); a.updatedAt = new Date().toISOString(); save();
    t.value = fmtNum.format(v);
    const row = t.closest('.acc');
    row.querySelector('.meta').innerHTML = accountMeta(a);
    row.querySelector('.cap').innerHTML = capHTML(a);
    if (d) { const good = CATS[a.cat].debt ? d < 0 : d > 0; row.animate([{ background: good ? 'rgba(52,211,153,.18)' : 'rgba(248,113,113,.18)' }, { background: 'transparent' }], { duration: 1000 }); }
    refreshAccountTotals(); updateBrand(); checkAchievements();
    return;
  }
  if (t.dataset.prof) {
    const k = t.dataset.prof;
    let v = t.value;
    if (t.dataset.amount != null) { v = parseAmount(v); if (isNaN(v)) { shake(t); return; } t.value = fmtNum.format(v); }
    else if (t.type === 'number') v = parseFloat(v) || 0;
    state.profile[k] = v; save(); updateBrand();
    toast('✅ Profil mis à jour');
  }
});
$view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.target.dataset.val || e.target.dataset.prof)) e.target.blur();
});
$view.addEventListener('focusin', e => { if (e.target.dataset.val) setTimeout(() => e.target.select(), 0); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalOpen()) return closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return exportJSON(); }
  if (modalOpen() || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'u') openExpress();
  else if (k === 'n') currentView === 'goals' ? openGoalModal() : openAccountModal();
  else if (k === 'm') togglePrivacy();
  else if (/^[1-8]$/.test(k)) go(Object.keys(VIEWS)[+k - 1]);
});

let resizeT, lastW = innerWidth;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  // Seulement si la largeur change (sur téléphone, le clavier ou la barre d'adresse changent la hauteur)
  resizeT = setTimeout(() => {
    if (innerWidth === lastW) return;
    lastW = innerWidth;
    if (['dashboard', 'projection', 'history', 'friends'].includes(currentView) && !modalOpen()) rerender();
  }, 250);
});

/* ---------- Démarrage ---------- */
/* Profil séparé (ex : « testami ») : bien visible pour ne pas confondre les fenêtres */
const PROFILE_NAME = (new URLSearchParams(location.search).get('profil') || '').replace(/[^\w-]/g, '').slice(0, 30);
if (PROFILE_NAME) {
  document.title = `Mon Patrimoine — 🧪 ${PROFILE_NAME}`;
  document.body.classList.add('test-profile');
  document.querySelector('.brand-name').insertAdjacentHTML('afterend', `<span class="pill test-pill" title="Profil séparé : ses données sont indépendantes de ton profil principal">🧪 profil « ${esc(PROFILE_NAME)} »</span>`);
  document.querySelector('.main').insertAdjacentHTML('afterbegin', `<div class="test-banner">🧪 PROFIL DE TEST « ${esc(PROFILE_NAME)} » — ce n'est <b>pas</b> ton compte principal.
    Pour ton vrai compte, utilise le raccourci « Mon Patrimoine ».</div>`);
}

applyTheme(); applyPrivacy();
go('dashboard');
checkAchievements({ silent: true });
startMarketLoop();
startSocialLoop();
startFileStore();
startLiveCharts();
startUpdates();
startBackup();
startInstallOffer();
// Version en ligne : fonctionne aussi sans réseau (dernière version gardée en cache)
if (WEB_MODE && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

/* Vie du groupe : photo du jour, records, grosses journées, récap du dimanche */
function groupLifeTick() {
  if (autoSnapshot()) checkAchievements();
  if (feedRecord()) save({ auto: true });
  feedMarketDay();
  maybeShowSundayRecap();
}
setTimeout(groupLifeTick, 12000);
setInterval(groupLifeTick, 60e3);
