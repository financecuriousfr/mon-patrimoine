/* =========================================================
   Vues : tableau de bord, patrimoine, projection
   ========================================================= */
let tickerTimer = null;
const projOpts = { years: 25, real: false };

function compareSnapshot() {
  const today = todayISO();
  const past = sortedSnapshots().filter(s => s.date < today);
  return past[past.length - 1] || null;
}

function deltaPill(diff, base) {
  if (diff == null) return '';
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
  const p = base ? ` (${diff >= 0 ? '+' : '−'}${fmtPct.format(Math.abs(diff / Math.abs(base) * 100))} %)` : '';
  return `<span class="pill ${cls} money">${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${signed(diff)}${p}</span>`;
}

/* ---------- Courbe du tableau de bord (périodes, cours en direct) ---------- */
function updateDashLive({ animate = false } = {}) {
  const evo = document.getElementById('evo');
  if (!evo) return;
  const d = myCurveData();
  const st = document.getElementById('evoStatus');
  if (st) st.innerHTML = histStatusHTML(keysOf([d]));
  if (!animate && chartBusy(evo)) return;
  // Le tracé animé ne rejoue pas à chaque actualisation des cours, seulement au changement de période
  if (animate) { animate = updateDashLive.sig !== chartPeriod; updateDashLive.sig = chartPeriod; }
  const pts = curvePoints(d);
  if (pts.length < 2) {
    evo.innerHTML = `<div class="empty-chart"><div>📈<br>Ta courbe apparaîtra ici après ta première photo${holdingsOf(d).length ? '' : ' ou ta première ligne suivie 📡'}.<br>
      <button class="btn btn-sm mt" data-act="snapshot">📸 Prendre une photo</button></div></div>`;
    return;
  }
  lineChart(evo, { series: [{ name: 'Patrimoine net', color: '#7c5cff', area: true, pulse: true, points: pts }], height: 230, animate, ...periodFormats() });
}

/* ---------- Bienvenue ---------- */
function renderWelcome(v) {
  // Lancé par le raccourci : on attend la sauvegarde sur le disque avant de conclure que tout est vide
  if (typeof fileStore !== 'undefined' && LOCAL_KEY && !fileStore.ready) {
    v.innerHTML = fileStore.failed
      ? `<div class="card empty"><div class="big">⚠️</div>
          <h2>Impossible de lire ta sauvegarde</h2>
          <p>${fileStore.denied ? 'Cette fenêtre est une <b>ancienne fenêtre</b> rouverte par Edge.' : 'Le relais local ne répond pas.'}
            Tes données sont en sécurité dans le fichier <b>donnees.json</b> sur ton PC.</p>
          <div class="row wrap" style="justify-content:center"><button class="btn btn-primary" onclick="startFileStore()">🔄 Réessayer</button></div>
          <p class="small faint mt">Si ça persiste : ferme cette fenêtre et relance le raccourci « Mon Patrimoine ».</p></div>`
      : `<div class="card empty"><div class="big">💾</div><h2>Chargement de tes données…</h2>
          <p class="faint">Lecture de ta sauvegarde sur le disque.</p></div>`;
    return;
  }
  v.innerHTML = `
  <div class="card empty">
    <div class="big">🌱</div>
    <h2>Bienvenue dans ton patrimoine${state.profile.name ? ', ' + esc(state.profile.name) : ''} !</h2>
    <p>Ajoute tes comptes, livrets, placements, biens et crédits : l'app calcule ton patrimoine net, le projette dans le futur,
      te compare aux ménages français et transforme ta progression en jeu. Tout reste <b>sur ton ordinateur</b>.</p>
    <div class="row wrap" style="justify-content:center">
      <button class="btn btn-primary" data-act="add">＋ Ajouter mon premier compte</button>
      <button class="btn" data-act="demo">🎲 Explorer avec des données d'exemple</button>
    </div>
    <div class="row wrap" style="justify-content:center;margin-top:10px">
      <button class="btn btn-ghost btn-sm" onclick="openRestoreModal()">☁️ J'ai une clé de secours : restaurer ma sauvegarde</button>
    </div>
    <p class="small faint mt">Astuce : dans les montants tu peux taper <kbd>12,5k</kbd>, <kbd>1.2M</kbd> ou même <kbd>1200+350</kbd>.</p>
  </div>
  <div class="card mt">
    <h3>Ajout rapide</h3>
    <div class="quick-add">${TEMPLATES.map((t, i) => `<button class="chip" data-tpl="${i}">${t.emoji} ${esc(t.name)}</button>`).join('')}</div>
  </div>`;
}

/* ---------- Insights automatiques ---------- */
function buildInsights(t) {
  const p = state.profile, out = [];
  const exp = +p.monthlyExpenses || 0, infl = +p.inflation || 2;
  if (t.byCat.cash > Math.max(3000, exp * 2)) {
    out.push({ ico: '💤', title: `${eur(t.byCat.cash)} dorment sur tes comptes courants`,
      text: `Avec ${pct(infl)} d'inflation, ils perdent ≈ <b class="money">${eur(t.byCat.cash * infl / 100)}</b> de pouvoir d'achat par an. Garde 1 mois de dépenses et place le reste.` });
  }
  if (exp > 0) {
    const months = t.liquid / exp;
    if (months < 3) out.push({ ico: '🛟', title: `Épargne de précaution : ${fmtPct.format(months)} mois`,
      text: `Vise 3 à 6 mois de dépenses, soit <b class="money">${eur(exp * 3)}</b> à <b class="money">${eur(exp * 6)}</b> en liquidités.` });
    else if (months > 12 && t.assets > 0) out.push({ ico: '🐢', title: `${fmtPct.format(months)} mois de dépenses en liquidités`,
      text: `C'est très prudent ! Au-delà de 6–12 mois, une partie pourrait viser un meilleur rendement long terme.` });
  }
  const la = state.accounts.find(a => /livret a\b/i.test(a.name) && a.cap);
  if (la && la.value >= la.cap) {
    const ldds = state.accounts.find(a => /ldds/i.test(a.name));
    if (!ldds || (ldds.cap && ldds.value < ldds.cap)) out.push({ ico: '🐷', title: 'Livret A plein',
      text: `Prochaine étape exonérée d'impôt : le LDDS (plafond 12 000 €), et le LEP (10 000 €) si tu es éligible.` });
  }
  state.accounts.filter(a => a.cat === 'livrets' && +a.rate > 0 && +a.rate < infl && a.value > 1000).slice(0, 1).forEach(a =>
    out.push({ ico: '📉', title: `${esc(a.name)} : rendement réel négatif`, text: `${pct(a.rate)} brut contre ${pct(infl)} d'inflation : ton épargne y perd ≈ ${pct(infl - a.rate)} par an en pouvoir d'achat.` }));
  for (const k of ASSET_CATS) {
    const share = t.assets ? t.byCat[k] / t.assets : 0;
    if (share > 0.7 && t.assets > 5000) {
      out.push({ ico: '⚖️', title: `${CATS[k].label} = ${fmtPct.format(share * 100)} % de tes actifs`,
        text: k === 'immo' ? `Classique quand on est propriétaire. Pense à construire une poche financière liquide à côté.` : `Ton patrimoine est très concentré : diversifier réduit le risque.` });
      break;
    }
  }
  const conso = state.accounts.filter(a => a.cat === 'dette' && +a.rate >= 5 && a.value > 0);
  if (conso.length && t.byCat.livrets > conso[0].value) out.push({ ico: '✂️', title: `Crédit à ${pct(conso[0].rate)} vs livrets`,
    text: `Rembourser « ${esc(conso[0].name)} » par anticipation rapporterait plus que tes livrets — vérifie les frais de remboursement.` });
  const last = lastSnapshot();
  const days = last ? (Date.now() - new Date(last.date)) / 864e5 : Infinity;
  if (days > 30) out.push({ ico: '📸', title: last ? `Dernière photo il y a ${Math.floor(days)} jours` : 'Aucune photo de ton patrimoine',
    text: `Une photo par mois suffit pour suivre ta courbe. Lance la <b>mise à jour express</b> (touche U) : ça prend 1 minute.` });
  const bdays = state.lastBackup ? (Date.now() - new Date(state.lastBackup)) / 864e5 : Infinity;
  if (bdays > 30 && state.accounts.length) out.push({ ico: '💾', title: 'Pense à ta sauvegarde',
    text: `Tes données sont stockées localement. Exporte un fichier de sauvegarde depuis Réglages (ou <kbd>Ctrl</kbd>+<kbd>S</kbd>).` });
  const snaps = sortedSnapshots();
  if (snaps.length >= 3) {
    let streak = 0;
    for (let i = snaps.length - 1; i > 0 && snaps[i].net > snaps[i - 1].net; i--) streak++;
    if (streak >= 2) out.push({ ico: '🔥', title: `${streak} hausses d'affilée !`, text: `Ton patrimoine progresse à chaque photo. Continue comme ça.` });
  }
  if (!out.length) out.push({ ico: '✨', title: 'Rien à signaler', text: 'Ton patrimoine est bien tenu. Reviens le mois prochain pour une nouvelle photo !' });
  return out.slice(0, 5);
}

/* ---------- Tableau de bord ---------- */
function renderDashboard(v) {
  if (!state.accounts.length) return renderWelcome(v);
  const t = totals(), p = state.profile;
  const lvl = levelFor(t.net);
  const ref = compareSnapshot();
  const snaps = sortedSnapshots();
  const first = snaps[0];
  const hs = healthScore(t);
  const perc = frenchPercentile(t.net);
  const exp = Math.max(1, +p.monthlyExpenses || 1);
  const fire = exp * 12 * 25;
  const perSec = t.passiveYear / (365 * 86400);

  v.innerHTML = `
  <div class="hero">
    <div>
      <div class="hero-label">PATRIMOINE NET${p.name ? ' DE ' + esc(p.name).toUpperCase() : ''}</div>
      <div class="hero-value money" id="heroNet">${eur(t.net)}</div>
      <div class="hero-delta">
        ${ref ? `${deltaPill(t.net - ref.net, ref.net)} <span class="small muted">depuis le ${fmtDate(ref.date, true)}</span>` : '<span class="small muted">Prends une photo pour suivre ta progression</span>'}
        ${first && first !== ref ? `<span class="small faint">· ${signed(t.net - first.net)} depuis ${fmtDate(first.date)}</span>` : ''}
      </div>
      <div class="ticker">${perSec >= 0
        ? `💸 Ton patrimoine travaille ≈ <b class="money">${eur2(t.passiveYear / 365)}</b>/jour · gagné depuis l'ouverture : <b class="money" id="tick">+0,000000 €</b>`
        : `⚠️ Tes intérêts d'emprunt dépassent tes rendements : <b class="money" style="color:var(--red)">${eur2(t.passiveYear / 365)}</b>/jour`}</div>
      <div class="hero-actions">
        <button class="btn btn-glow" data-act="express" style="padding:9px 14px">⚡ Mise à jour express</button>
        <button class="btn" data-act="snapshot">📸 Prendre une photo</button>
      </div>
    </div>
    <div class="level-box">
      <div class="row">
        <div class="level-emoji">${lvl.cur.emoji}</div>
        <div><div class="small muted">Niveau ${lvl.idx}</div><div class="level-name">${lvl.cur.name}</div></div>
        <button class="btn btn-sm btn-ghost" style="margin-left:auto" data-view-link="badges">Voir tout →</button>
      </div>
      <div class="progress mt"><i style="width:${lvl.progress * 100}%"></i></div>
      <div class="row between small mt" style="margin-top:8px">
        ${lvl.next ? `<span class="muted">Prochain : ${lvl.next.emoji} ${lvl.next.name}</span><span class="money">encore <b>${eur(lvl.next.min - t.net)}</b></span>`
                   : `<span class="muted">Niveau maximum atteint 👑</span>`}
      </div>
      <div class="row between small" style="margin-top:14px">
        <span class="muted">🏆 Succès</span><b>${Object.keys(state.badges).length} / ${BADGES.length}</b>
      </div>
      <div class="row between small" style="margin-top:6px">
        <span class="muted">🔥 Indépendance financière</span><b class="money">${fmtPct.format(clamp(t.net / fire * 100, 0, 999))} %</b>
      </div>
    </div>
  </div>

  <div class="grid g4 mt">
    <div class="card kpi"><span class="k-label">📦 Actifs bruts</span><span class="k-value money">${eur(t.assets)}</span><span class="k-sub">${state.accounts.filter(a => !CATS[a.cat].debt).length} actif(s)</span></div>
    <div class="card kpi"><span class="k-label">🧾 Dettes</span><span class="k-value money" style="color:${t.debts ? 'var(--red)' : 'inherit'}">${eur(t.debts)}</span><span class="k-sub">${t.assets ? fmtPct.format(t.debts / t.assets * 100) + ' % des actifs' : '—'}</span></div>
    <div class="card kpi"><span class="k-label">🕊️ Liberté (runway)</span><span class="k-value">${fmtMonths(t.liquid / exp)}</span><span class="k-sub">de dépenses couvertes par tes liquidités</span></div>
    <div class="card kpi"><span class="k-label">🌾 Revenu passif estimé</span><span class="k-value money">${eur(t.passiveYear / 12)}<small class="muted" style="font-size:13px">/mois</small></span><span class="k-sub">rendement moyen ${pct(hs.avgYield)}</span></div>
  </div>

  <div class="grid g2 mt">
    <div class="card">
      <h3>Répartition des actifs <span class="actions"><button class="btn btn-sm btn-ghost" data-view-link="accounts">Détails →</button></span></h3>
      <div class="donut-wrap"><div id="donut"></div><div class="legend" id="legend"></div></div>
    </div>
    <div class="card">
      <h3>Évolution du patrimoine net <span class="actions"><button class="btn btn-sm btn-ghost" data-view-link="history">Historique →</button></span></h3>
      <div class="row between wrap" style="gap:8px;margin-bottom:8px">${periodSegHTML()}<span class="small" id="evoStatus"></span></div>
      <div id="evo"></div>
    </div>
  </div>

  <div class="grid g3 mt">
    <div class="card">
      <h3>❤️ Score de santé financière</h3>
      <div class="row" style="gap:18px;align-items:flex-start">
        <div class="score-ring">${ringSVG(hs.total)}<div class="score-val">${hs.total}</div></div>
        <div class="score-lines">${hs.parts.map(x => `
          <div class="score-line" title="${esc(x.info)}"><div class="row between"><span>${x.label}</span><b>${Math.round(x.pts)}/${x.max}</b></div>
          <div class="progress thin"><i style="width:${x.pts / x.max * 100}%"></i></div></div>`).join('')}
        </div>
      </div>
      ${hs.total < 100 ? `<div class="insight" style="margin-top:16px"><div class="ico">👉</div><p>${healthTip(hs)}</p></div>` : ''}
    </div>
    <div class="card">
      <h3>📊 Toi vs les ménages français</h3>
      <div style="font-size:22px;font-weight:800">${perc >= 99 ? 'Top 1 %' : `Devant ~${Math.round(perc)} %`}</div>
      <div class="small muted">des ménages ${perc >= 50 ? '🎉' : ''} (patrimoine net)</div>
      <div class="rank-bar"><div class="rank-marker" style="left:${clamp(perc, 1, 99)}%">📍</div></div>
      <div class="rank-scale"><span style="left:0;transform:none">0</span><span style="left:50%">Médiane<br>148 k€</span><span style="left:90%">Top 10 %<br>750 k€</span></div>
      ${nextTierHTML(t.net)}
      <div class="small faint" style="margin-top:10px">Source : INSEE, distribution du patrimoine net des ménages début 2024. Comparaison indicative (un ménage peut compter plusieurs personnes).</div>
    </div>
    <div class="card">
      <h3>🎈 Ton patrimoine en…</h3>
      <div class="fun-eq">
        <div><div class="e">🥖</div><div class="v money">${compactNum(Math.max(0, t.net) / 1.0)}</div><div class="l">baguettes (≈ 1 €)</div></div>
        <div><div class="e">☕</div><div class="v money">${compactNum(Math.max(0, t.net) / 2)}</div><div class="l">cafés en terrasse (≈ 2 €)</div></div>
        <div><div class="e">🏝️</div><div class="v">${fmtNum.format(Math.max(0, t.net) / (exp / 30.44))}</div><div class="l">jours de vie à ton rythme</div></div>
        <div><div class="e">🔥</div><div class="v money">${compact(fire)}</div><div class="l">objectif FIRE (règle des 4 %)</div></div>
      </div>
    </div>
  </div>

  ${marketCardHTML()}

  <div class="grid g2 mt">
    <div class="card"><h3>💡 Conseils personnalisés</h3><div id="insights"></div></div>
    <div class="card"><h3>🎯 Objectifs <span class="actions"><button class="btn btn-sm btn-ghost" data-view-link="goals">Gérer →</button></span></h3><div id="goalsMini"></div></div>
  </div>`;

  animateNumber(document.getElementById('heroNet'), t.net, { from: ref ? ref.net : 0, dur: 1200 });

  const segs = ASSET_CATS.map(k => ({ key: k, label: CATS[k].label, value: t.byCat[k], color: CATS[k].color })).filter(s => s.value > 0);
  donutChart(document.getElementById('donut'), segs, { center: compact(t.assets), sub: 'actifs bruts', onClick: k => go('accounts', k) });
  document.getElementById('legend').innerHTML = segs.sort((a, b) => b.value - a.value).map(s => `
    <div class="legend-item" data-cat="${s.key}"><i style="background:${s.color}"></i><span>${CATS[s.key].emoji} ${s.label}</span>
    <b class="money">${compact(s.value)}</b><span class="muted small">${fmtPct.format(s.value / t.assets * 100)} %</span></div>`).join('');

  updateDashLive({ animate: true });
  bindPeriodSeg(v, () => updateDashLive({ animate: true }));
  ensureHistory(keysOf([myCurveData()]));

  document.getElementById('insights').innerHTML = buildInsights(t).map(i =>
    `<div class="insight"><div class="ico">${i.ico}</div><div><b>${i.title}</b><p>${i.text}</p></div></div>`).join('');

  const gm = document.getElementById('goalsMini');
  gm.innerHTML = state.goals.length ? state.goals.slice(0, 4).map(g => {
    const cur = goalCurrent(g, t), pr = clamp(cur / g.target, 0, 1);
    return `<div style="margin-bottom:14px"><div class="row between small"><span>${g.emoji} <b>${esc(g.name)}</b></span>
      <span class="money muted">${compact(cur)} / ${compact(g.target)}</span></div>
      <div class="progress" style="margin-top:6px"><i style="width:${pr * 100}%"></i></div></div>`;
  }).join('') : `<div class="empty-chart" style="height:160px"><div>🎯<br>Fixe-toi un objectif motivant.<br><button class="btn btn-sm mt" data-act="add-goal">＋ Nouvel objectif</button></div></div>`;

  clearInterval(tickerTimer);
  const tick = document.getElementById('tick');
  if (tick && perSec > 0) {
    const t0 = performance.now();
    tickerTimer = setInterval(() => {
      if (!tick.isConnected) return clearInterval(tickerTimer);
      const s = (performance.now() - t0) / 1000;
      tick.textContent = '+' + (perSec * s).toLocaleString('fr-FR', { minimumFractionDigits: 6, maximumFractionDigits: 6 }) + ' €';
    }, 80);
  }
}
function healthTip(hs) {
  const weakest = [...hs.parts].sort((a, b) => a.pts / a.max - b.pts / b.max)[0];
  return {
    "Fonds d'urgence": `<b>Piste :</b> constitue 3 à 6 mois de dépenses sur des livrets disponibles.`,
    'Endettement': `<b>Piste :</b> ton endettement pèse sur le score (normal en début de crédit immobilier — il baissera avec les mensualités).`,
    'Diversification': `<b>Piste :</b> répartir tes actifs sur plusieurs catégories réduit le risque.`,
    'Rendement': `<b>Piste :</b> une partie de ton épargne pourrait mieux travailler à long terme (bourse, assurance-vie…).`,
  }[weakest.label];
}
function nextTierHTML(net) {
  const tiers = [[148100, 'la médiane'], [224200, 'le top 40 %'], [317400, 'le top 30 %'], [457900, 'le top 20 %'], [750400, 'le top 10 %'], [1151500, 'le top 5 %'], [2728900, 'le top 1 %']];
  const n = tiers.find(([v]) => v > net);
  return n ? `<div class="insight" style="margin-top:14px"><div class="ico">🎯</div><p>Encore <b class="money">${eur(n[0] - net)}</b> pour atteindre ${n[1]} des ménages français.</p></div>`
           : `<div class="insight" style="margin-top:14px"><div class="ico">👑</div><p>Tu fais partie du top 1 % des ménages français.</p></div>`;
}
function compactNum(n) {
  if (n >= 1e6) return fmtPct.format(n / 1e6) + ' M';
  if (n >= 1e4) return fmtNum.format(n / 1e3) + ' k';
  return fmtNum.format(n);
}

/* ---------- Patrimoine (comptes) ---------- */
function accountMeta(a) {
  const bits = [];
  if (isTracked(a)) bits.push(`📡 ${a.holdings.length} ligne${a.holdings.length > 1 ? 's' : ''} suivie${a.holdings.length > 1 ? 's' : ''} en direct${+a.cash ? ` + ${eur(a.cash)} d'espèces` : ''}`);
  if (+a.rate) bits.push(CATS[a.cat].debt ? `taux ${pct(a.rate)}` : `${a.rate > 0 ? '+' : ''}${pct(a.rate)}/an`);
  if (CATS[a.cat].debt && a.payment) bits.push(`mensualité ${eur(a.payment)}`);
  if (a.share && a.share < 100) bits.push(`ta part : ${fmtPct.format(a.share)} % de ${eur(a.fullValue ?? a.value * 100 / a.share)}`);
  if (a.updatedAt) {
    const d = Math.floor((Date.now() - new Date(a.updatedAt)) / 864e5);
    bits.push(d <= 0 ? "mis à jour aujourd'hui" : `il y a ${d} j`);
  }
  if (a.note) bits.push(esc(a.note));
  return bits.join(' · ');
}

function capHTML(a) {
  if (!a.cap) return '';
  const r = a.value / a.cap * 100;
  return `${fmtPct.format(clamp(r, 0, 999))} % du plafond (${compact(a.cap)})
    <div class="progress thin"><i style="width:${clamp(r, 0, 100)}%;${r >= 100 ? 'background:var(--green)' : ''}"></i></div>`;
}

function renderAccounts(v, focusCat) {
  const t = totals();
  if (!state.accounts.length) return renderWelcome(v);
  const hasTracked = state.accounts.some(isTracked);
  let html = `
  <div class="row wrap between acc-top">
    <div class="row wrap acc-chips">
      <span class="chip">📦 Actifs <b class="money" data-tot="assets">${eur(t.assets)}</b></span>
      <span class="chip">🧾 Dettes <b class="money" data-tot="debts">${eur(t.debts)}</b></span>
      <span class="chip" style="border-color:var(--accent)">💎 Net <b class="money" data-tot="net">${eur(t.net)}</b></span>
    </div>
    <div class="row acc-actions">
      ${hasTracked ? `<span class="small faint">cours ${agoText(state.flags.lastPriceRefresh)}</span><button class="btn" data-act="prices">🔄 <span class="lbl">Actualiser les cours</span></button>` : ''}
      <button class="btn btn-primary desk-only" data-act="add">＋ Ajouter</button>
    </div>
  </div>
  <p class="small faint desk-only">Clique sur un montant pour le modifier directement (<kbd>Entrée</kbd> pour valider). Formats acceptés : 12 500 · 12,5k · 1200+350.</p>
  <p class="small faint phone-only">Touche un montant pour le corriger. Touche un nom pour tout modifier.</p>`;

  for (const k of Object.keys(CATS)) {
    const list = state.accounts.filter(a => a.cat === k);
    if (!list.length) continue;
    const c = CATS[k];
    const share = !c.debt && t.assets ? ` · ${fmtPct.format(t.byCat[k] / t.assets * 100)} %` : '';
    html += `<div class="card cat-block" id="cat-${k}">
      <div class="cat-head"><span class="dot" style="background:${c.color}"></span><h4>${c.emoji} ${c.label}</h4>
      <span class="small muted cat-count">${list.length} élément(s)${share}</span><span class="total money" data-tot="cat-${k}" style="${c.debt ? 'color:var(--red)' : ''}">${eur(t.byCat[k])}</span></div>
      ${list.map(a => `
        <div class="acc" data-id="${a.id}">
          <div class="emo" data-edit="${a.id}">${esc(a.emoji || c.emoji)}</div>
          <div class="acc-info" data-edit="${a.id}"><div class="name">${esc(a.name)}</div><div class="meta">${accountMeta(a)}</div></div>
          <div class="cap">${capHTML(a)}</div>
          <div class="val">${isTracked(a)
            ? `<button class="auto-val" data-holdings="${a.id}" title="Valeur calculée avec les cours en direct — cliquer pour gérer les lignes">
                 <b class="money">${eur(a.value)}</b><span class="small">📡 auto ${changeSpan(accountDayPct(a))}</span></button>`
            : `<input class="input money" data-val="${a.id}" value="${fmtNum.format(a.value || 0)}" inputmode="decimal" aria-label="Valeur de ${esc(a.name)}">`}</div>
          <div class="acc-btns">
            ${TRACKABLE.includes(a.cat) ? `<button class="icon-btn" data-holdings="${a.id}" title="Suivre les cours en direct (actions, ETF, crypto)">📡</button>` : ''}
            <button class="icon-btn" data-edit="${a.id}" title="Modifier">✏️</button>
          </div>
        </div>
        ${isTracked(a) ? holdingsListHTML(a) : ''}`).join('')}
    </div>`;
  }
  html += `<div class="card mt"><h3>Ajout rapide</h3><div class="quick-add">${TEMPLATES.map((tp, i) => `<button class="chip" data-tpl="${i}">${tp.emoji} ${esc(tp.name)}</button>`).join('')}</div></div>`;
  v.innerHTML = html;
  if (focusCat) {
    const el = document.getElementById('cat-' + focusCat);
    if (el) { el.scrollIntoView({ block: 'start' }); el.animate([{ boxShadow: '0 0 0 3px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1400 }); }
  }
}

function refreshAccountTotals() {
  const t = totals();
  const set = (k, val) => document.querySelectorAll(`[data-tot="${k}"]`).forEach(e => e.textContent = eur(val));
  set('assets', t.assets); set('debts', t.debts); set('net', t.net);
  Object.keys(CATS).forEach(k => set('cat-' + k, t.byCat[k]));
}

/* ---------- Projection ---------- */
function renderProjection(v) {
  const p = state.profile;
  v.innerHTML = `
  <div class="grid proj-grid">
    <div class="card">
      <h3>🎛️ Paramètres</h3>
      <label class="field">Horizon<div class="slider-row"><input type="range" min="1" max="40" step="1" id="pjYears" value="${projOpts.years}"><output id="oYears"></output></div></label>
      <label class="field mt">Épargne mensuelle<div class="slider-row"><input type="range" min="0" max="5000" step="50" id="pjSave" value="${p.monthlySavings}"><output id="oSave"></output></div></label>
      <label class="field mt">Rendement de la nouvelle épargne<div class="slider-row"><input type="range" min="0" max="12" step="0.5" id="pjRate" value="${p.futureRate}"><output id="oRate"></output></div></label>
      <label class="row small mt" style="cursor:pointer"><input type="checkbox" id="pjReal" ${projOpts.real ? 'checked' : ''}> Euros constants (corrigé de ${pct(p.inflation)} d'inflation)</label>
      <p class="small faint" style="line-height:1.5">Chaque compte évolue selon son propre rendement estimé (modifiable dans Patrimoine) et les crédits se remboursent avec leur mensualité. Scénarios : ±1,5 pt de rendement.</p>
      <div class="card" style="background:var(--surface2);border:0;margin-top:12px">
        <div class="small muted">Dans <span id="rYears"></span></div>
        <div style="font-size:30px;font-weight:800" class="money" id="rFinal"></div>
        <div class="small mt" style="line-height:1.8">
          <div class="row between"><span class="muted">Aujourd'hui</span><b class="money" id="rNow"></b></div>
          <div class="row between"><span class="muted">Versements cumulés</span><b class="money" id="rContrib"></b></div>
          <div class="row between"><span class="muted">Effet des rendements ✨</span><b class="money up" id="rGrowth"></b></div>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
      <div class="card"><h3>🔮 Trajectoire du patrimoine net
        <span class="actions small"><span class="row"><i style="width:10px;height:3px;background:#34d399;display:inline-block"></i>optimiste <i style="width:10px;height:3px;background:#7c5cff;display:inline-block;margin-left:8px"></i>central <i style="width:10px;height:3px;background:#f87171;display:inline-block;margin-left:8px"></i>prudent</span></span></h3>
        <div id="projChart"></div></div>
      <div class="grid g2">
        <div class="card"><h3>🏁 Jalons (scénario central)</h3><div class="milestones" id="miles"></div></div>
        <div class="card"><h3>🤔 Et si…</h3><div class="milestones" id="whatif"></div></div>
      </div>
    </div>
  </div>`;

  const upd = () => {
    const years = +document.getElementById('pjYears').value;
    const monthly = +document.getElementById('pjSave').value;
    const rate = +document.getElementById('pjRate').value;
    const real = document.getElementById('pjReal').checked;
    projOpts.years = years; projOpts.real = real;
    state.profile.monthlySavings = monthly; state.profile.futureRate = rate; save();
    document.getElementById('oYears').textContent = years + ' ans';
    document.getElementById('oSave').textContent = eur(monthly);
    document.getElementById('oRate').textContent = pct(rate);
    const base = { years, monthly, futureRate: rate, real };
    const mid = project(base), hi = project({ ...base, delta: .015 }), lo = project({ ...base, delta: -.015 });
    const sample = arr => arr.filter((x, i) => i % 3 === 0 || i === arr.length - 1).map(x => ({ x: x.date, y: x.net }));
    const fire = (+p.monthlyExpenses || 0) * 12 * 25;
    lineChart(document.getElementById('projChart'), {
      series: [
        { name: 'Central', color: '#7c5cff', area: true, points: sample(mid) },
        { name: 'Optimiste', color: '#34d399', dash: true, width: 2, points: sample(hi) },
        { name: 'Prudent', color: '#f87171', dash: true, width: 2, points: sample(lo) },
      ],
      height: 300, zero: true, xFmt: d => d.getFullYear(),
      hlines: fire ? [{ y: fire, label: `🔥 FIRE ${compact(fire)}`, color: '#fbbf24' }] : [],
    });
    const end = mid[mid.length - 1];
    document.getElementById('rYears').textContent = `${years} ans (${end.date.getFullYear()})${real ? ' — euros constants' : ''}`;
    animateNumber(document.getElementById('rFinal'), end.net, { dur: 500 });
    document.getElementById('rNow').textContent = eur(mid[0].net);
    document.getElementById('rContrib').textContent = '+' + eur(end.contributed);
    const growth = end.net - mid[0].net - end.contributed;
    const rg = document.getElementById('rGrowth');
    rg.textContent = signed(growth); rg.className = 'money ' + (growth >= 0 ? 'up' : 'down');

    const by = +p.birthYear || 0;
    const age = d => by ? ` · ${d.getFullYear() - by} ans` : '';
    const marks = [[100000, '💯 100 000 €'], [250000, '⛰️ 250 000 €'], [500000, '🌋 500 000 €'], [1000000, '💎 1 million'], [fire, '🔥 Indépendance financière']]
      .filter(([v]) => v > mid[0].net).sort((a, b) => a[0] - b[0]);
    document.getElementById('miles').innerHTML = marks.length ? marks.map(([val, label]) => {
      const hit = firstReach(project({ ...base, years: 60 }), val);
      return `<div class="milestone"><span>${label}</span><b>${hit ? `${MONTHS_FR[hit.date.getMonth()]} ${hit.date.getFullYear()}${age(hit.date)}` : '<span class="muted">pas en vue</span>'}</b></div>`;
    }).join('') : '<div class="milestone">Tous les jalons sont déjà atteints 👑</div>';

    const diff = alt => project({ ...base, ...alt }).at(-1).net - end.net;
    const items = [
      ['💶 +100 €/mois d\'épargne', diff({ monthly: monthly + 100 })],
      ['☕ −2 cafés/semaine (≈ 17 €/mois)', diff({ monthly: monthly + 17 })],
      ['📈 +1 pt de rendement', diff({ delta: .01 })],
      ['⏳ Commencer à épargner dans 5 ans', projectDelayed(base, 5) - end.net],
    ];
    document.getElementById('whatif').innerHTML = items.map(([l, d]) =>
      `<div class="milestone"><span>${l}</span><b class="money ${d >= 0 ? 'up' : 'down'}">${signed(d)}</b></div>`).join('') +
      `<div class="small faint">Impact sur le patrimoine dans ${years} ans.</div>`;
  };
  ['pjYears', 'pjSave', 'pjRate', 'pjReal'].forEach(id => document.getElementById(id).addEventListener('input', upd));
  upd();
}

/* Patrimoine final si l'on n'épargne rien pendant `delay` ans puis normalement */
function projectDelayed(base, delay) {
  const pts = project({ ...base, monthly: 0 });
  const idx = Math.min(pts.length - 1, delay * 12);
  const restMonths = base.years * 12 - idx;
  if (restMonths <= 0) return pts.at(-1).net;
  const r = Math.pow(1 + base.futureRate / 100, 1 / 12);
  let fresh = 0;
  for (let i = 0; i < restMonths; i++) fresh = fresh * r + base.monthly;
  const infl = base.real ? Math.pow(1 + (+state.profile.inflation || 0) / 100, base.years) : 1;
  return pts.at(-1).net + fresh / infl;
}
