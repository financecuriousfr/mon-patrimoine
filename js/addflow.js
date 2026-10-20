/* =========================================================
   Ajout / modification d'un élément — parcours guidé
   1) Choisir  : une recherche unique (comptes, biens, actions,
                 ETF, cryptos) ou des tuiles par familles
   2) Détails  : uniquement ce qui sert pour ce choix,
                 avec retour immédiat (montant compris, plafond,
                 fin de crédit, part détenue…)
   3) Réussite : impact sur le patrimoine, enchaînement rapide
   ========================================================= */
const ADD_GROUPS = [
  { label: '💶 Épargne & comptes', names: ['Compte courant', 'Livret A', 'LDDS', 'LEP', 'PEL / CEL'] },
  { label: '📈 Placements', names: ['PEA', 'Compte-titres', 'Assurance-vie', 'PER', 'Portefeuille crypto'] },
  { label: '🏠 Biens', names: ['Résidence principale', 'Locatif', 'SCPI', 'Or physique', 'Véhicule', 'Objet de valeur'] },
  { label: '🧾 Dettes', names: ['Crédit immo', 'Crédit conso', 'Prêt étudiant'] },
];
const UNIQUE_TPL = ['Livret A', 'LDDS', 'LEP', 'PEA'];          // un seul par personne (réglementation)
const SUGGEST_ORDER = ['Compte courant', 'Livret A', 'Assurance-vie', 'PEA', 'Résidence principale', 'Crédit immo', 'LDDS', 'LEP', 'PER', 'Véhicule', 'Portefeuille crypto'];
const LIVE_DEFAULT = ['bourse', 'crypto'];
const POPULAR = {
  stock: [
    ['CW8.PA', 'Amundi MSCI World', 'ETF Monde'], ['WPEA.PA', 'iShares MSCI World PEA', 'ETF Monde · PEA'],
    ['ESE.PA', 'BNP Paribas Easy S&P 500', 'ETF USA · PEA'], ['PUST.PA', 'Amundi PEA Nasdaq-100', 'ETF Tech · PEA'],
    ['PAEEM.PA', 'Amundi PEA Émergents', 'ETF Émergents · PEA'], ['MC.PA', 'LVMH', 'Action · Paris'],
    ['TTE.PA', 'TotalEnergies', 'Action · Paris'], ['AIR.PA', 'Airbus', 'Action · Paris'],
    ['AAPL', 'Apple', 'Action · USA'], ['NVDA', 'NVIDIA', 'Action · USA'],
  ],
  crypto: [['bitcoin', 'btc', 'Bitcoin'], ['ethereum', 'eth', 'Ethereum'], ['solana', 'sol', 'Solana'],
           ['ripple', 'xrp', 'XRP'], ['binancecoin', 'bnb', 'BNB'], ['cardano', 'ada', 'Cardano']],
};

const tplIndex = name => TEMPLATES.findIndex(t => t.name === name);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const numIn = v => { const x = parseFloat(String(v).replace(/[\s  €]/g, '').replace(',', '.')); return isNaN(x) ? NaN : x; };
const existingFor = name => { const nn = norm(name); return state.accounts.filter(a => a.tpl === name || (!a.tpl && norm(a.name).startsWith(nn))); };

function tplSubtitle(t) {
  if (CATS[t.cat].debt) return `taux ≈ ${pct(t.rate)}`;
  if (t.cap) return `plafond ${compact(t.cap)} · ${pct(t.rate)}`;
  if (t.track || ['bourse', 'av', 'crypto'].includes(t.cat)) return '📡 cours en direct';
  return t.rate ? `≈ ${t.rate > 0 ? '+' : ''}${pct(t.rate)}/an` : CATS[t.cat].label;
}
function searchTemplates(q) {
  const nq = norm(q).trim();
  if (!nq) return [];
  const toks = nq.split(/\s+/);
  return TEMPLATES.map((t, i) => {
    const n = norm(t.name), hay = `${n} ${t.kw || ''} ${norm(CATS[t.cat].label)}`;
    return { i, s: n.startsWith(nq) ? 3 : n.includes(nq) ? 2 : toks.every(k => hay.includes(k)) ? 1 : 0 };
  }).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, 6).map(x => x.i);
}
function suggestions(n = 4) {
  return SUGGEST_ORDER.filter(name => !existingFor(name).length).slice(0, n).map(tplIndex);
}
/* Fin d'un crédit : nombre de mensualités, date et intérêts restants */
function loanInfo(C, ratePct, P) {
  if (!(C > 0) || !(P > 0)) return null;
  const r = (+ratePct || 0) / 1200;
  if (r > 0 && P <= C * r) return { error: true };
  const n = r > 0 ? Math.ceil(-Math.log(1 - r * C / P) / Math.log(1 + r)) : Math.ceil(C / P);
  const end = new Date(); end.setMonth(end.getMonth() + n);
  return { n, end, interest: Math.max(0, n * P - C) };
}

/* ---------- Point d'entrée ---------- */
function openAccountModal(id, tplIdx, { scopeAccountId } = {}) {
  const ctx = { added: [], netBefore: totals().net, scope: null };
  ctx.m = modal('', { cls: 'add-flow', onClose: () => { if (ctx.added.length) rerender(); } });
  const acc = id ? state.accounts.find(a => a.id === id) : null;
  if (acc) return afDetails(ctx, { acc });
  const scoped = scopeAccountId && state.accounts.find(a => a.id === scopeAccountId);
  if (scoped) { ctx.scope = { account: scoped, kind: scoped.cat === 'crypto' ? 'crypto' : 'stock' }; return afPick(ctx, ''); }
  if (tplIdx != null) return afFromTemplate(ctx, tplIdx, '');
  afPick(ctx, '');
}
function afFromTemplate(ctx, i, back) {
  const t = TEMPLATES[i];
  if (t.track) return afInstrument(ctx, { ...t.track }, back);
  afDetails(ctx, { tpl: i, back });
}
const scopeAccount = ctx => ctx.scope && (ctx.scope.account || ctx.scope.draft);

/* ---------- Étape 1 : choisir ---------- */
function afPick(ctx, q0) {
  const m = ctx.m, scope = ctx.scope, sAcc = scopeAccount(ctx);
  const kindOnly = scope ? scope.kind : null;
  m.innerHTML = `
    <div class="af-head"><h2>${scope ? `＋ Ajouter un ${kindOnly === 'crypto' ? 'crypto-actif' : 'titre'} dans « ${esc(sAcc.name)} »` : '＋ Que veux-tu ajouter ?'}</h2>
      <span class="af-step">${scope ? 'Titres' : 'Étape 1 / 2'}</span></div>
    <div class="af-search"><span aria-hidden="true">🔎</span>
      <input id="afQ" value="${esc(q0)}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="afBody" aria-autocomplete="list"
        aria-label="Rechercher" placeholder="${scope ? (kindOnly === 'crypto' ? 'Bitcoin, Solana, XRP…' : 'Nom, ticker ou ISIN : CW8, LVMH, Apple, FR0010315770…') : 'Livret A, maison, PEA, Apple, CW8, Bitcoin…'}"></div>
    <div id="afBody" class="af-body" role="listbox" aria-label="Résultats"></div>
    <div class="modal-foot"><span class="small faint left desk-only">↑ ↓ pour choisir · Entrée pour valider</span>
      ${ctx.added.length ? '<button class="btn btn-primary" id="afCancel">Terminé</button>' : '<button class="btn" id="afCancel">Annuler</button>'}</div>`;
  const $ = s => m.querySelector(s);
  let items = [], active = 0, seq = 0, timer = null;
  const remote = { stock: [], crypto: [], stockErr: false, loading: false };

  const tile = i => {
    const t = TEMPLATES[i], owned = existingFor(t.name).length;
    return `<button class="af-tile ${owned ? 'owned' : ''}" data-tpl-pick="${i}"><span class="e">${t.emoji}</span><b>${esc(t.name)}</b>
      <small>${owned ? `✓ déjà ajouté${owned > 1 ? ` (${owned})` : ''}` : tplSubtitle(t)}</small></button>`;
  };
  const popTile = (kind, p) => kind === 'crypto'
    ? `<button class="af-tile" data-pop="${kind}:${p[0]}"><span class="e tick">${esc(p[1].toUpperCase())}</span><b>${esc(p[2])}</b><small>Crypto</small></button>`
    : `<button class="af-tile" data-pop="${kind}:${p[0]}"><span class="e tick">${esc(p[0].replace('.PA', ''))}</span><b>${esc(p[1])}</b><small>${esc(p[2])}</small></button>`;

  const renderHome = () => {
    items = [];
    $('#afQ').setAttribute('aria-expanded', 'false');
    if (scope) {
      $('#afBody').innerHTML = `<div class="af-glabel">⭐ Populaires</div>
        <div class="af-tiles">${POPULAR[kindOnly].map(p => popTile(kindOnly, p)).join('')}</div>
        <div class="af-tip">💡 Le plus fiable : le <b>code ISIN</b> (12 caractères, ex. FR0010315770) affiché dans ton appli bancaire.</div>`;
      return;
    }
    $('#afBody').innerHTML = ADD_GROUPS.map(g => `
      <div class="af-group"><div class="af-glabel">${g.label}</div>
      <div class="af-tiles">${g.names.map(n => tile(tplIndex(n))).join('')}</div></div>`).join('') + `
      <div class="af-tip">💡 Tape directement une action, un ETF ou une crypto (<b>Apple</b>, <b>CW8</b>, un code ISIN, <b>Solana</b>…) : sa valeur suivra le marché.
        <button class="btn btn-sm btn-ghost" data-custom>✏️ Autre chose…</button></div>`;
  };

  const renderResults = () => {
    const q = $('#afQ').value.trim();
    const st = remote.stock, cr = remote.crypto;
    // Un modèle « Bitcoin » ferait doublon avec la crypto Bitcoin des résultats
    const tpls = scope ? [] : searchTemplates(q).filter(i => !(TEMPLATES[i].track && cr.some(r => r.symbol === TEMPLATES[i].track.symbol)));
    items = [...tpls.map(i => ({ type: 'tpl', i })), ...st.map(r => ({ type: 'inst', r: { ...r, kind: 'stock' } })),
             ...cr.map(r => ({ type: 'inst', r: { ...r, kind: 'crypto' } })), ...(scope ? [] : [{ type: 'custom' }])];
    active = items.length ? clamp(active, 0, items.length - 1) : 0;
    let k = 0, html = '';
    const row = inner => { const i = k++; return `<button class="af-row ${i === active ? 'on' : ''}" data-k="${i}" id="afOpt${i}" role="option" aria-selected="${i === active}">${inner}</button>`; };
    if (tpls.length) html += '<div class="af-glabel">Comptes & biens</div>' + tpls.map(i => {
      const t = TEMPLATES[i], owned = existingFor(t.name).length;
      return row(`<span class="af-ico">${t.emoji}</span><span class="af-main"><b>${esc(t.name)}</b><small>${owned ? '✓ déjà dans ton patrimoine' : tplSubtitle(t)}</small></span><span class="af-tag">${CATS[t.cat].label}</span>`);
    }).join('');
    if (st.length) html += '<div class="af-glabel">Actions, ETF & fonds <span class="faint">· cours en direct</span></div>' + st.map(r =>
      row(`<span class="af-ico tick">${esc(r.symbol)}</span><span class="af-main"><b>${esc(r.name)}</b><small>${esc([r.exchange, r.others ? `+${r.others} autre${r.others > 1 ? 's' : ''} cotation${r.others > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '))}</small></span><span class="af-tag">${esc(r.type || '')}</span>`)).join('');
    else if (remote.stockErr && kindOnly !== 'crypto') html += '<div class="af-glabel">Actions, ETF & fonds</div><div class="af-note">🔴 Le relais des cours ne répond pas : relance l\'app depuis le raccourci du bureau pour chercher des actions.</div>';
    if (cr.length) html += '<div class="af-glabel">Cryptos <span class="faint">· cours en direct</span></div>' + cr.map(r =>
      row(`<span class="af-ico tick">${esc(String(r.ticker || '').toUpperCase())}</span><span class="af-main"><b>${esc(r.name)}</b><small>classement ${esc(r.exchange)}</small></span><span class="af-tag">Crypto</span>`)).join('');
    if (remote.loading) html += `<div class="af-note" aria-live="polite">🔎 Recherche ${scope ? '' : 'des actions, ETF et cryptos'}…</div>`;
    else if (scope && !st.length && !cr.length && q.length >= 2) html += '<div class="af-note">Aucun résultat. Essaie le ticker exact (ex. <b>MC.PA</b>) ou le <b>code ISIN</b>.</div>';
    if (!scope) html += '<div class="af-glabel">Pas trouvé ?</div>' + row(`<span class="af-ico">✏️</span><span class="af-main"><b>Ajouter « ${esc(q)} » à la main</b><small>Élément personnalisé : tu choisis la catégorie et la valeur</small></span>`);
    $('#afBody').innerHTML = html;
    $('#afQ').setAttribute('aria-expanded', 'true');
    $('#afQ').setAttribute('aria-activedescendant', items.length ? 'afOpt' + active : '');
    $('#afBody .af-row.on')?.scrollIntoView({ block: 'nearest' });
  };

  const onInput = () => {
    const q = $('#afQ').value.trim();
    active = 0; remote.stock = []; remote.crypto = []; remote.stockErr = false;
    clearTimeout(timer);
    if (!q) { remote.loading = false; return renderHome(); }
    remote.loading = q.length >= 2;
    renderResults();
    if (q.length < 2) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      const wantStock = kindOnly !== 'crypto', wantCrypto = kindOnly !== 'stock';
      const [s, c] = await Promise.allSettled([wantStock ? searchInstruments(q, 'stock') : [], wantCrypto ? searchInstruments(q, 'crypto') : []]);
      if (my !== seq || !m.isConnected) return;
      remote.loading = false;
      remote.stockErr = s.status === 'rejected';
      // Une même société cotée sur plusieurs places : on garde la cotation prioritaire (Paris, Europe, USA…)
      const byName = new Map();
      for (const r of (s.status === 'fulfilled' ? s.value : [])) {
        const key = norm(r.name);
        if (byName.has(key)) byName.get(key).others = (byName.get(key).others || 0) + 1; else byName.set(key, { ...r });
      }
      remote.stock = [...byName.values()].slice(0, 6);
      // Cryptos : on écarte les « actions tokenisées » et jetons dérivés, et les projets très confidentiels
      const nq = norm(q);
      remote.crypto = (c.status === 'fulfilled' ? c.value : []).filter(r => {
        const rank = +String(r.exchange || '').replace('#', '');
        const exact = norm(r.ticker) === nq || norm(r.name) === nq;
        return !/tokeni[sz]ed|xstock|wrapped|bridged|staked|ondo/i.test(r.name) && (exact || (rank > 0 && rank <= 500));
      }).slice(0, 4);
      renderResults();
    }, 300);
  };
  const choose = it => {
    const q = $('#afQ').value.trim();
    if (!it) return;
    if (it.type === 'tpl') return afFromTemplate(ctx, it.i, q);
    if (it.type === 'inst') return afInstrument(ctx, it.r, q);
    afDetails(ctx, { custom: q, back: q });
  };

  $('#afQ').addEventListener('input', onInput);
  $('#afQ').addEventListener('keydown', e => {
    if (!$('#afQ').value.trim() || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      renderResults();
    } else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
  });
  $('#afBody').addEventListener('click', e => {
    const t = e.target.closest('[data-tpl-pick]');
    if (t) return afFromTemplate(ctx, +t.dataset.tplPick, '');
    const p = e.target.closest('[data-pop]');
    if (p) {
      const [kind, sym] = p.dataset.pop.split(':');
      const item = POPULAR[kind].find(x => x[0] === sym);
      return afInstrument(ctx, kind === 'crypto'
        ? { kind, symbol: item[0], ticker: item[1], name: item[2] }
        : { kind, symbol: item[0], ticker: item[0], name: item[1], exchange: item[2] }, '');
    }
    if (e.target.closest('[data-custom]')) return afDetails(ctx, { custom: '', back: '' });
    const r = e.target.closest('.af-row');
    if (r) choose(items[+r.dataset.k]);
  });
  $('#afCancel').onclick = closeModal;
  q0 ? onInput() : renderHome();
  setTimeout(() => { const i = $('#afQ'); if (!i) return; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 30);
}

/* ---------- Étape 2a : compte, bien ou dette ---------- */
function afDetails(ctx, { tpl = null, custom = null, acc = null, back = '' }) {
  const m = ctx.m;
  const edit = !!acc;
  let d;
  if (edit) d = { ...acc };
  else if (tpl != null) { const { track, kw, ...t } = TEMPLATES[tpl]; d = { id: uid(), ...t, tpl: t.name, value: 0 }; }
  else d = { id: uid(), name: custom || '', cat: 'autres', emoji: '', rate: 0, value: 0 };
  const isCustom = custom != null;
  const tracked = isTracked(d);
  const canLive = !edit && ['bourse', 'av', 'crypto'].includes(d.cat);
  let mode = canLive && LIVE_DEFAULT.includes(d.cat) ? 'live' : 'manual';
  let share = edit && d.share ? d.share : 100;
  if (![100, 50].includes(share)) share = 'other';
  const fullStart = edit ? (d.share && d.share < 100 ? (d.fullValue ?? d.value * 100 / d.share) : d.value) : 0;
  const payStart = edit && d.payment ? (d.share && d.share < 100 ? d.payment * 100 / d.share : d.payment) : 0;
  const dup = !edit && tpl != null && UNIQUE_TPL.includes(d.name) ? existingFor(d.name) : [];
  const debtStart = !!CATS[d.cat].debt;

  const valueLabel = c => CATS[c].debt ? 'Capital restant dû' : c === 'immo' ? 'Valeur estimée du bien' : c === 'autres' ? 'Valeur estimée' : 'Montant actuel';
  const catSelect = id => `<select class="input" id="${id}">${Object.entries(CATS).map(([k, c]) => `<option value="${k}" ${k === d.cat ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}</select>`;
  const rateField = `<label class="field"><span id="fRateLbl">Rendement annuel estimé (%)</span><input class="input" id="fRate" type="number" step="0.1" value="${d.rate ?? 0}"></label>`;

  m.innerHTML = `
    <div class="af-head"><h2>${edit ? '✏️ Modifier' : '＋ Ajouter'}</h2>${edit ? '' : '<span class="af-step">Étape 2 / 2</span>'}</div>
    <div class="af-chosen"><div class="af-badge" id="afEmo">${esc(d.emoji || CATS[d.cat].emoji)}</div>
      <div class="af-main"><b id="afTitle">${esc(d.name || 'Nouvel élément')}</b><small id="afSub"></small></div>
      ${edit ? '' : '<button class="btn btn-sm btn-ghost" id="afBack">← Changer</button>'}</div>
    ${dup.length ? `<div class="af-info">ℹ️ Tu as déjà ${dup.length > 1 ? 'des comptes' : 'un compte'} « ${esc(dup.map(a => a.name).join(' », « '))} » (${eur(dup.reduce((s, a) => s + a.value, 0))}).
      Un seul ${esc(d.name)} est autorisé par personne : c'est peut-être celui-ci que tu veux mettre à jour.
      <div class="row wrap" style="margin-top:8px"><button class="btn btn-sm btn-primary" id="afEditDup">✏️ Mettre à jour l'existant</button>
      <span class="small faint">ou continue pour en ajouter un autre (ex. celui de ton conjoint).</span></div></div>` : ''}
    ${canLive ? `<div class="af-modes" role="radiogroup" aria-label="Mode de suivi">
      <button class="af-mode" data-mode="live" role="radio"><b>📡 Mes titres en direct</b><small>Tu ajoutes tes titres et leurs quantités : la valeur suit le marché toute seule.</small></button>
      <button class="af-mode" data-mode="manual" role="radio"><b>✍️ Un montant global</b><small>Tu saisis la valeur totale et tu la mets à jour toi-même.</small></button>
    </div>` : ''}
    <div class="form-grid">
      <label class="field ${isCustom ? '' : 'full'}">Nom<input class="input" id="fName" value="${esc(d.name)}" placeholder="Ex : Livret A Crédit Agricole" maxlength="60"></label>
      ${isCustom ? `<label class="field">Catégorie${catSelect('fCatMain')}</label>` : ''}
      <div class="field full" id="wValue"><label for="fValue" id="fValueLbl"></label>
        <input class="input money af-big" id="fValue" value="${fullStart ? fmtNum.format(Math.round(fullStart * 100) / 100) : ''}" placeholder="12 500 · 12,5k · 1200+350" inputmode="decimal" ${tracked ? 'disabled' : ''} autocomplete="off">
        <div class="af-feedback" id="fFeedback" aria-live="polite"></div>
        <button type="button" class="af-link" id="afSurfBtn">📐 Estimer avec la surface</button>
        <div class="af-surf" id="afSurf" hidden>
          <input class="input" id="afM2" inputmode="decimal" placeholder="Surface (m²)"><span>×</span>
          <input class="input" id="afPm2" inputmode="decimal" placeholder="Prix au m² (€)"></div>
      </div>
      <div class="field full" id="wShare"><span>Ma part</span>
        <div class="af-chips" role="radiogroup" aria-label="Ma part">
          ${[100, 50].map(v => `<button type="button" class="af-chip" data-share="${v}" role="radio">${v === 100 ? '100 % (à moi seul)' : '50 % (en couple)'}</button>`).join('')}
          <button type="button" class="af-chip" data-share="other" role="radio">Autre</button>
          <input class="input" id="afShareOther" type="number" min="1" max="99" placeholder="%" style="width:90px" value="${share === 'other' ? d.share : ''}" hidden></div></div>
      ${debtStart ? rateField : ''}
      <label class="field ${debtStart ? '' : 'full'}" id="wPay">Mensualité totale (€)<input class="input money" id="fPay" value="${payStart ? fmtNum.format(Math.round(payStart * 100) / 100) : ''}" placeholder="Ex : 950" inputmode="decimal"></label>
    </div>
    ${tracked ? '<button class="btn btn-sm" id="afHold">📡 Gérer les titres de ce compte</button>' : ''}
    <details class="af-adv" ${edit ? 'open' : ''}><summary>⚙️ Options avancées : ${debtStart ? '' : 'rendement, plafond, '}emoji, note</summary>
      <div class="form-grid">
        ${debtStart ? '' : rateField}
        <label class="field" id="wCap">Plafond (optionnel)<input class="input" id="fCap" value="${d.cap ? fmtNum.format(d.cap) : ''}" placeholder="Ex : 22 950"></label>
        <label class="field">Emoji<input class="input" id="fEmoji" value="${esc(d.emoji)}" maxlength="4" placeholder="${CATS[d.cat].emoji}"></label>
        ${isCustom ? '' : `<label class="field">Catégorie${catSelect('fCat')}</label>`}
        <label class="field full">Note (jamais partagée)<input class="input" id="fNote" value="${esc(d.note || '')}" placeholder="Banque, numéro de contrat…"></label>
      </div>
    </details>
    <div class="modal-foot">
      ${edit ? '<button class="btn btn-danger left" id="fDel">🗑️ Supprimer</button><button class="btn" id="fCancel">Annuler</button>' : '<button class="btn left" id="afBack2">← Retour</button>'}
      <button class="btn btn-primary" id="fSave">${edit ? 'Enregistrer' : 'Ajouter'}</button>
    </div>`;
  const $ = s => m.querySelector(s);
  const catNow = () => ($('#fCatMain') || $('#fCat')).value;
  const shareNow = () => share === 'other' ? clamp(numIn($('#afShareOther').value) || 100, 1, 100) : share;

  /* Retour immédiat sous le montant : interprétation, part, plafond, fin de crédit */
  const feedback = () => {
    const cat = catNow(), raw = $('#fValue').value.trim(), v = parseAmount(raw || '0'), s = ['immo', 'dette'].includes(cat) ? shareNow() : 100;
    const lines = [];
    if (raw && isNaN(v)) lines.push('<span class="down">⚠️ Montant non reconnu — exemples : 12 500 · 12,5k · 1200+350</span>');
    else if (raw) {
      const plain = /^[\d\s  .,€]+$/.test(raw);
      if (!plain) lines.push(`Compris : <b class="money">${eur(v)}</b>`);
      if (s < 100) lines.push(`Compté dans ton patrimoine : <b class="money">${eur(v * s / 100)}</b> (ta part de ${fmtPct.format(s)} %)`);
      const cap = parseAmount($('#fCap').value);
      if (!CATS[cat].debt && cap > 0) lines.push(v > cap
        ? `<span class="warn">⚠️ Au-dessus du plafond de ${eur(cap)} : normal seulement si ce sont des intérêts capitalisés.</span>`
        : `${fmtPct.format(v / cap * 100)} % du plafond · encore ${eur(cap - v)} de versements possibles`);
      if (CATS[cat].debt) {
        const li = loanInfo(v, $('#fRate').value, parseAmount($('#fPay').value));
        if (li?.error) lines.push('<span class="warn">⚠️ Cette mensualité ne couvre même pas les intérêts : vérifie le taux ou la mensualité.</span>');
        else if (li) lines.push(`🏁 Fin estimée : <b>${MONTHS_FR[li.end.getMonth()]} ${li.end.getFullYear()}</b> (dans ${fmtMonths(li.n)}) · intérêts restants ≈ <b class="money">${eur(li.interest * s / 100)}</b>${s < 100 ? ' pour ta part' : ''}`);
      }
    }
    $('#fFeedback').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  };
  const sync = () => {
    const cat = catNow(), debt = !!CATS[cat].debt, live = canLive && mode === 'live';
    m.querySelectorAll('.af-mode').forEach(b => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-checked', b.dataset.mode === mode); });
    m.querySelectorAll('[data-share]').forEach(b => { const on = String(share) === b.dataset.share; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('#afShareOther').hidden = share !== 'other';
    $('#wValue').style.display = live ? 'none' : '';
    $('#wShare').style.display = !live && ['immo', 'dette'].includes(cat) && !tracked ? '' : 'none';
    $('#afSurfBtn').style.display = cat === 'immo' && !tracked ? '' : 'none';
    if (cat !== 'immo') $('#afSurf').hidden = true;
    $('#fValueLbl').textContent = valueLabel(cat) + (['immo', 'dette'].includes(cat) ? ' — montant total (€)' : ' (€)');
    $('#wPay').style.display = debt ? '' : 'none';
    $('#wCap').style.display = debt ? 'none' : '';
    $('#fRateLbl').textContent = debt ? "Taux d'intérêt (%)" : 'Rendement annuel estimé (%)';
    $('#fEmoji').placeholder = CATS[cat].emoji;
    $('#afEmo').textContent = $('#fEmoji').value.trim() || CATS[cat].emoji;
    $('#afTitle').textContent = $('#fName').value.trim() || 'Nouvel élément';
    $('#afSub').textContent = `${CATS[cat].emoji} ${CATS[cat].label}${tracked ? ' · 📡 valeur calculée avec les cours en direct' : ''}`;
    if (!edit) $('#fSave').textContent = live ? 'Continuer → ajouter mes titres' : 'Ajouter';
    feedback();
  };

  m.querySelectorAll('.af-mode').forEach(b => b.onclick = () => { mode = b.dataset.mode; sync(); (mode === 'manual' ? $('#fValue') : $('#fSave')).focus(); });
  m.querySelectorAll('[data-share]').forEach(b => b.onclick = () => {
    share = b.dataset.share === 'other' ? 'other' : +b.dataset.share; sync();
    if (share === 'other') $('#afShareOther').focus();
  });
  ['#fName', '#fEmoji', '#fValue', '#fCap', '#fPay', '#fRate', '#afShareOther'].forEach(s => $(s).addEventListener('input', sync));
  ($('#fCatMain') || $('#fCat')).addEventListener('change', sync);
  $('#afSurfBtn').onclick = () => { $('#afSurf').hidden = !$('#afSurf').hidden; if (!$('#afSurf').hidden) $('#afM2').focus(); };
  const surf = () => { const a = numIn($('#afM2').value), p = numIn($('#afPm2').value); if (a > 0 && p > 0) { $('#fValue').value = fmtNum.format(Math.round(a * p)); sync(); } };
  $('#afM2').addEventListener('input', surf); $('#afPm2').addEventListener('input', surf);
  const goBack = () => afPick(ctx, back);
  $('#afBack')?.addEventListener('click', goBack);
  $('#afBack2')?.addEventListener('click', goBack);
  $('#fCancel')?.addEventListener('click', closeModal);
  $('#afEditDup')?.addEventListener('click', () => afDetails(ctx, { acc: dup[0] }));
  $('#afHold')?.addEventListener('click', () => { closeModal(); openHoldingsModal(d.id); });
  if (edit) $('#fDel').onclick = () => confirmModal('Supprimer cet élément ?', `« ${esc(acc.name)} » sera retiré de ton patrimoine.`, () => {
    state.accounts = state.accounts.filter(a => a.id !== acc.id); save(); toast('🗑️ Élément supprimé'); rerender();
  }, 'Supprimer');

  const submit = () => {
    const live = canLive && mode === 'live';
    const name = $('#fName').value.trim();
    if (!name) { $('#fName').focus(); return shake($('#fName')); }
    const full = tracked ? holdingsValue(d) : live ? 0 : parseAmount($('#fValue').value || '0');
    if (isNaN(full)) { $('#fValue').focus(); return shake($('#fValue')); }
    const cat = catNow(), s = ['immo', 'dette'].includes(cat) && !tracked ? shareNow() : 100;
    const cap = parseAmount($('#fCap').value), pay = parseAmount($('#fPay').value);
    const out = {
      ...d, name, cat, value: Math.round(full * s) / 100, rate: parseFloat($('#fRate').value) || 0,
      emoji: $('#fEmoji').value.trim(), note: $('#fNote').value.trim(),
      cap: !CATS[cat].debt && cap > 0 ? cap : undefined,
      payment: CATS[cat].debt && pay > 0 ? Math.round(pay * s) / 100 : undefined,
      share: s < 100 ? s : undefined, fullValue: s < 100 ? full : undefined,
    };
    if (!TRACKABLE.includes(cat)) { delete out.holdings; delete out.cash; }
    if (!edit || acc.value !== out.value) out.updatedAt = new Date().toISOString();
    if (live) {
      // Le compte n'est créé qu'au premier titre ajouté : rien ne reste « vide » si on abandonne
      ctx.scope = { draft: { ...out, holdings: [] }, kind: cat === 'crypto' ? 'crypto' : 'stock' };
      return afPick(ctx, '');
    }
    if (edit) {
      state.accounts[state.accounts.findIndex(a => a.id === d.id)] = out;
      save(); closeModal(); toast('✅ Modifications enregistrées', eur(out.value)); checkAchievements(); rerender();
      return;
    }
    state.accounts.push(out); save();
    ctx.added.push(out.id);
    afDone(ctx, { emoji: out.emoji || CATS[cat].emoji, title: `${esc(name)} ajouté`, sub: `${eur(out.value)}${s < 100 ? ` (ta part de ${fmtPct.format(s)} %)` : ''} · ${CATS[cat].label}` });
  };
  $('#fSave').onclick = submit;
  m.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
  sync();
  setTimeout(() => {
    const f = !d.name ? $('#fName') : (canLive && mode === 'live') ? $('#fSave') : tracked ? $('#fName') : $('#fValue');
    f?.focus(); f?.select?.();
  }, 30);
}

/* ---------- Étape 2b : une action, un ETF ou une crypto ---------- */
function afInstrument(ctx, inst, back) {
  const m = ctx.m, kind = inst.kind, sAcc = scopeAccount(ctx);
  const cats = kind === 'crypto' ? ['crypto'] : ['bourse', 'av'];
  const accounts = state.accounts.filter(a => cats.includes(a.cat));
  const newTypes = kind === 'crypto' ? ['Portefeuille crypto'] : ['PEA', 'Compte-titres', 'Assurance-vie', 'PER'];
  let target = sAcc ? 'scope' : (accounts.find(isTracked)?.id || `new:${tplIndex(newTypes[0])}`);
  let touched = !!sAcc, quote = null, amountMode = 'qty', pruMode = 'unit';
  const isPea = t => t === `new:${tplIndex('PEA')}` || /\bpea\b/.test(norm((t === 'scope' ? sAcc : accounts.find(a => a.id === t))?.name));
  const label = kind === 'crypto' ? String(inst.ticker || inst.symbol).toUpperCase() : inst.symbol;

  m.innerHTML = `
    <div class="af-head"><h2>＋ ${esc(inst.name)}</h2><span class="af-step">${sAcc ? 'Titres' : 'Étape 2 / 2'}</span></div>
    <div class="af-chosen"><div class="af-badge tick">${esc(label)}</div>
      <div class="af-main"><b>${esc(inst.name)}</b><small id="afPx">${esc(inst.exchange ? inst.exchange + ' · ' : '')}récupération du cours…</small></div>
      <button class="btn btn-sm btn-ghost" id="afBack">← Changer</button></div>
    ${sAcc ? `<div class="af-glabel">Dans</div><div class="af-targets"><span class="af-target on">${esc(sAcc.emoji || CATS[sAcc.cat].emoji)} ${esc(sAcc.name)}
        <small>${ctx.scope.draft ? 'nouveau compte' : isTracked(sAcc) ? `📡 ${sAcc.holdings.length} titre(s) · ${eur(sAcc.value)}` : eur(sAcc.value)}</small></span></div>`
      : `<div class="af-glabel">Dans quel ${kind === 'crypto' ? 'portefeuille' : 'compte'} ?</div><div class="af-targets" id="afTargets" role="radiogroup"></div>`}
    <div class="af-warn" id="afWarn"></div>
    <div class="field">
      <div class="row between wrap"><span class="af-flabel">Ce que je détiens</span>
        <div class="af-seg" role="radiogroup" aria-label="Saisie par"><button type="button" data-am="qty" role="radio">en quantité</button><button type="button" data-am="eur" role="radio">en euros</button></div></div>
      <input class="input af-big num" id="afQty" inputmode="decimal" autocomplete="off" aria-describedby="afCalc">
      <div class="af-feedback" id="afCalc" aria-live="polite"></div>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><div class="row between wrap"><span class="af-flabel">Prix de revient <span class="faint">(optionnel)</span></span>
        <div class="af-seg small" role="radiogroup" aria-label="Prix de revient"><button type="button" data-pm="unit" role="radio">par part</button><button type="button" data-pm="total" role="radio">total investi</button></div></div>
        <input class="input num" id="afPru" inputmode="decimal" placeholder="pour suivre ta plus-value"></div>
      <label class="field" id="wNewName">Nom du nouveau compte<input class="input" id="afNewName" maxlength="60"></label>
    </div>
    <div class="modal-foot"><button class="btn left" id="afBack2">← Retour</button><button class="btn btn-primary" id="afSave">Ajouter</button></div>`;
  const $ = s => m.querySelector(s);

  const qtyNow = () => {
    const raw = $('#afQty').value;
    if (amountMode === 'eur') { const v = parseAmount(raw); return quote && v > 0 ? v / quote.priceEUR : NaN; }
    return numIn(raw);
  };
  const renderTargets = () => {
    if (!sAcc) {
      $('#afTargets').innerHTML = accounts.map(a => `
        <button class="af-target ${target === a.id ? 'on' : ''}" data-t="${a.id}" role="radio" aria-checked="${target === a.id}">${esc(a.emoji || CATS[a.cat].emoji)} ${esc(a.name)}
          <small>${isTracked(a) ? `📡 ${a.holdings.length} titre(s) · ${eur(a.value)}` : `${eur(a.value)} saisis à la main`}</small></button>`).join('') +
        newTypes.map(n => { const i = tplIndex(n), on = target === 'new:' + i; return `
        <button class="af-target new ${on ? 'on' : ''}" data-t="new:${i}" role="radio" aria-checked="${on}">＋ ${TEMPLATES[i].emoji} Nouveau ${n === 'Portefeuille crypto' ? 'portefeuille' : n}
          <small>${n === 'PEA' ? 'actions européennes' : n === 'Compte-titres' ? 'toutes actions et ETF' : n === 'Portefeuille crypto' ? 'regroupe tes cryptos' : 'unités de compte'}</small></button>`; }).join('');
      const isNew = target.startsWith('new:');
      $('#wNewName').style.display = isNew ? '' : 'none';
      if (isNew && !$('#afNewName').dataset.edited) $('#afNewName').value = TEMPLATES[+target.slice(4)].name;
    } else $('#wNewName').style.display = 'none';
    const a = sAcc || accounts.find(x => x.id === target);
    let warn = '';
    if (a && !ctx.scope?.draft && !isTracked(a) && a.value > 0)
      warn = `⚠️ « ${esc(a.name)} » a une valeur saisie à la main (${eur(a.value)}). Elle sera gardée en « espèces » du compte : tu pourras l'ajuster juste après.`;
    if (quote && kind === 'stock' && quote.currency !== 'EUR' && isPea(target))
      warn += `${warn ? '<br>' : ''}ℹ️ Les actions hors Europe (cotées en ${esc(quote.currency)}) ne sont en général pas éligibles au PEA.`;
    $('#afWarn').innerHTML = warn;
  };
  const renderInputs = () => {
    m.querySelectorAll('[data-am]').forEach(b => { b.classList.toggle('on', b.dataset.am === amountMode); b.setAttribute('aria-checked', b.dataset.am === amountMode); b.disabled = b.dataset.am === 'eur' && !quote; });
    m.querySelectorAll('[data-pm]').forEach(b => { b.classList.toggle('on', b.dataset.pm === pruMode); b.setAttribute('aria-checked', b.dataset.pm === pruMode); });
    $('#afQty').placeholder = amountMode === 'eur' ? 'Valeur actuelle (€) — ex : 5 000' : (kind === 'crypto' ? 'Quantité — ex : 0,05' : 'Nombre de parts — ex : 10');
    $('#afPru').placeholder = pruMode === 'total' ? 'Montant total investi (€)' : 'Prix moyen d\'achat par part (€)';
  };
  const renderCalc = () => {
    const raw = $('#afQty').value.trim(), q = qtyNow();
    let html = '';
    if (!quote) html = '<span class="faint">Cours en cours de récupération…</span>';
    else if (!raw) html = `<span class="faint">Cours actuel : ${eur2(quote.priceEUR)}${quote.currency !== 'EUR' ? ` (${quote.price.toLocaleString('fr-FR')} ${esc(quote.currency)})` : ''}</span>`;
    else if (!(q > 0)) html = '<span class="down">⚠️ Valeur non reconnue</span>';
    else html = amountMode === 'eur'
      ? `≈ <b>${q.toLocaleString('fr-FR', { maximumFractionDigits: kind === 'crypto' ? 8 : 4 })}</b> ${kind === 'crypto' ? esc(label) : 'parts'} au cours de ${eur2(quote.priceEUR)}`
      : `= <b class="money">${eur(q * quote.priceEUR)}</b> au cours actuel`;
    const pr = numIn($('#afPru').value);
    if (quote && q > 0 && pr > 0) {
      const unit = pruMode === 'total' ? pr / q : pr, pl = (quote.priceEUR - unit) * q, p = (quote.priceEUR / unit - 1) * 100;
      html += `<br>Plus-value latente : <b class="money ${pl >= 0 ? 'up' : 'down'}">${signed(pl)} (${p >= 0 ? '+' : '−'}${fmtPct.format(Math.abs(p))} %)</b>`;
    }
    $('#afCalc').innerHTML = html;
  };
  if (!sAcc) $('#afTargets').addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    target = b.dataset.t; touched = true; renderTargets(); $('#afQty').focus();
  });
  m.querySelectorAll('[data-am]').forEach(b => b.onclick = () => {
    if (b.disabled) return;
    const q = qtyNow(); amountMode = b.dataset.am;
    // On convertit ce qui est déjà saisi pour ne rien perdre
    if (q > 0 && quote) $('#afQty').value = amountMode === 'eur' ? fmtNum.format(Math.round(q * quote.priceEUR)) : String(Math.round(q * 1e6) / 1e6).replace('.', ',');
    renderInputs(); renderCalc(); $('#afQty').focus();
  });
  m.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { pruMode = b.dataset.pm; renderInputs(); renderCalc(); $('#afPru').focus(); });
  $('#afNewName').addEventListener('input', e => { e.target.dataset.edited = '1'; });
  $('#afQty').addEventListener('input', renderCalc);
  $('#afPru').addEventListener('input', renderCalc);
  const goBack = () => afPick(ctx, back || '');
  $('#afBack').onclick = goBack; $('#afBack2').onclick = goBack;

  const submit = () => {
    const qty = qtyNow(), pr = numIn($('#afPru').value);
    if (!(qty > 0)) { $('#afQty').focus(); return shake($('#afQty')); }
    if ($('#afPru').value.trim() && !(pr > 0)) { $('#afPru').focus(); return shake($('#afPru')); }
    const pru = pr > 0 ? (pruMode === 'total' ? pr / qty : pr) : undefined;
    const now = new Date().toISOString();
    let acc, converted = false, created = false;
    if (sAcc && ctx.scope.draft) {
      acc = ctx.scope.draft; state.accounts.push(acc); created = true;
      ctx.scope = { account: acc, kind: ctx.scope.kind };
    } else if (sAcc) acc = sAcc;
    else if (target.startsWith('new:')) {
      const { track, kw, ...t } = TEMPLATES[+target.slice(4)];
      acc = { id: uid(), ...t, tpl: t.name, name: $('#afNewName').value.trim() || t.name, value: 0, holdings: [], updatedAt: now };
      state.accounts.push(acc); created = true;
    } else acc = state.accounts.find(a => a.id === target);
    if (!isTracked(acc)) { converted = !created && acc.value > 0; if (converted) acc.cash = (+acc.cash || 0) + acc.value; acc.holdings = acc.holdings || []; }
    const line = acc.holdings.find(h => h.kind === kind && h.symbol === inst.symbol);
    if (line) {
      if (pru) line.pru = line.pru ? (line.pru * line.qty + pru * qty) / (line.qty + qty) : pru;
      line.qty = Math.round(((+line.qty || 0) + qty) * 1e10) / 1e10;
    } else {
      acc.holdings.push({ id: uid(), kind, symbol: inst.symbol, ticker: inst.ticker || inst.symbol, name: inst.name, qty: Math.round(qty * 1e10) / 1e10, pru,
        ...(quote ? { price: quote.priceEUR, nativePrice: quote.price, currency: quote.currency, change: quote.changePct, priceAt: now } : {}) });
    }
    acc.updatedAt = now;
    recomputeTracked(); save();
    if (!quote) refreshPrices({ silent: true }).then(r => { if (r?.updated) rerender(); });
    ctx.added.push(acc.id);
    afDone(ctx, {
      emoji: '📈', account: acc,
      title: `${qty.toLocaleString('fr-FR', { maximumFractionDigits: kind === 'crypto' ? 8 : 4 })} × ${esc(inst.name)} ajouté`,
      sub: `dans « ${esc(acc.name)} »${quote ? ' · ' + eur(qty * quote.priceEUR) : ''}${created ? ' · nouveau compte créé' : ''}`,
      warn: converted ? `La valeur saisie à la main (${eur(acc.cash)}) est gardée en « espèces » : ajuste-la quand tous tes titres seront ajoutés.` : '',
    });
  };
  $('#afSave').onclick = submit;
  m.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));

  renderTargets(); renderInputs(); renderCalc();
  setTimeout(() => $('#afQty')?.focus(), 30);

  (kind === 'crypto' ? fetchCryptoQuotes([inst.symbol]) : fetchStockQuotes([inst.symbol])).then(res => {
    if (!m.isConnected || !$('#afPx')) return;
    quote = res.quotes[inst.symbol] || null;
    const ex = inst.exchange ? esc(inst.exchange) + ' · ' : '';
    $('#afPx').innerHTML = quote ? `${ex}<b class="money">${eur2(quote.priceEUR)}</b> ${changeSpan(quote.changePct)}` : `${ex}cours indisponible pour l'instant`;
    // Action hors zone euro : on propose plutôt un compte-titres qu'un PEA
    if (quote && !touched && kind === 'stock' && quote.currency !== 'EUR' && isPea(target)) {
      const cto = accounts.find(a => isTracked(a) && a.cat === 'bourse' && !isPea(a.id));
      target = cto ? cto.id : `new:${tplIndex('Compte-titres')}`;
    }
    renderTargets(); renderInputs(); renderCalc();
  }).catch(() => { if (m.isConnected && $('#afPx')) $('#afPx').textContent = 'cours indisponible pour l\'instant (relais arrêté ?)'; });
}

/* ---------- Étape 3 : réussite et enchaînement ---------- */
function afDone(ctx, { emoji, title, sub, warn = '', account = null }) {
  const m = ctx.m, net = totals().net, diff = net - ctx.netBefore;
  const multi = account && ['bourse', 'av', 'crypto'].includes(account.cat);
  const sugg = suggestions(4);
  m.innerHTML = `
    <div class="af-done">
      <div class="af-done-ico">${esc(emoji)}</div>
      <h2>${title}</h2>
      <p class="muted" style="margin:4px 0 0">${sub}</p>
      <div class="af-impact"><span class="muted small">Ton patrimoine net</span><b class="money" id="afNet">${eur(ctx.netBefore)}</b>${deltaPill(diff, ctx.netBefore)}</div>
      ${ctx.added.length > 1 ? `<div class="small faint">${ctx.added.length} ajouts pendant cette session</div>` : ''}
      ${warn ? `<div class="af-warn" style="margin-top:12px">${warn}</div>` : ''}
      <div class="af-next">
        ${multi ? `<button class="btn btn-primary" id="afMoreHere">＋ Un autre titre dans « ${esc(account.name)} »</button>` : ''}
        <button class="btn ${multi ? '' : 'btn-primary'}" id="afMore">＋ Ajouter autre chose</button>
        ${warn && account ? '<button class="btn" id="afHoldings">📡 Ajuster les espèces</button>' : ''}
        <button class="btn" id="afEnd">Terminé</button>
      </div>
      ${sugg.length ? `<div class="af-glabel" style="margin-top:22px">Souvent ajoutés ensuite</div>
        <div class="af-sugg">${sugg.map(i => `<button class="chip" data-sugg="${i}">${TEMPLATES[i].emoji} ${esc(TEMPLATES[i].name)}</button>`).join('')}</div>` : ''}
    </div>`;
  const $ = s => m.querySelector(s);
  animateNumber($('#afNet'), net, { from: ctx.netBefore, dur: 900 });
  if (diff > 0 && ctx.added.length === 1) confetti.burst(70);
  rerender(); checkAchievements();
  $('#afMoreHere')?.addEventListener('click', () => { ctx.scope = { account, kind: account.cat === 'crypto' ? 'crypto' : 'stock' }; afPick(ctx, ''); });
  $('#afMore').onclick = () => { ctx.scope = null; afPick(ctx, ''); };
  $('#afHoldings')?.addEventListener('click', () => { closeModal(); openHoldingsModal(account.id); });
  $('#afEnd').onclick = closeModal;
  m.querySelectorAll('[data-sugg]').forEach(b => b.onclick = () => { ctx.scope = null; afFromTemplate(ctx, +b.dataset.sugg, ''); });
  setTimeout(() => ($('#afMoreHere') || $('#afMore'))?.focus(), 30);
}
