/* =========================================================
   Vues : objectifs, succès, historique, réglages
   ========================================================= */
function upStreak() {
  const s = sortedSnapshots();
  let n = 0;
  for (let i = s.length - 1; i > 0 && s[i].net > s[i - 1].net; i--) n++;
  return n;
}

const BADGES = [
  { id: 'first', emoji: '👣', name: 'Premier pas', desc: 'Ajouter ton premier compte', check: () => state.accounts.length > 0 },
  { id: 'green', emoji: '🍀', name: 'Dans le vert', desc: 'Avoir un patrimoine net positif', check: t => state.accounts.length > 0 && t.net > 0 },
  { id: 'photo', emoji: '📸', name: 'Photographe', desc: 'Prendre ta première photo du patrimoine', check: () => state.snapshots.length >= 1 },
  { id: 'regular', emoji: '📅', name: 'Régulier', desc: '6 photos dans ton historique', check: () => state.snapshots.length >= 6 },
  { id: 'rise', emoji: '🚀', name: 'Ascension', desc: '3 hausses consécutives entre tes photos', check: () => upStreak() >= 3 },
  { id: 'express', emoji: '⚡', name: 'Éclair', desc: 'Terminer une mise à jour express', check: () => !!state.flags.express },
  { id: 'para', emoji: '🪂', name: 'Parachute', desc: '3 mois de dépenses en liquidités', check: t => t.liquid >= 3 * (+state.profile.monthlyExpenses || Infinity) },
  { id: 'bunker', emoji: '🏰', name: 'Bunker', desc: '6 mois de dépenses en liquidités', check: t => t.liquid >= 6 * (+state.profile.monthlyExpenses || Infinity) },
  { id: 'livretA', emoji: '🐷', name: 'Cochon repu', desc: 'Remplir un Livret A jusqu\'au plafond', check: () => state.accounts.some(a => /livret a\b/i.test(a.name) && a.cap && a.value >= a.cap) },
  { id: 'divers', emoji: '🎨', name: 'Diversifié', desc: '4 catégories d\'actifs pesant chacune plus de 5 %', check: t => t.assets > 0 && ASSET_CATS.filter(k => t.byCat[k] / t.assets > .05).length >= 4 },
  { id: 'investor', emoji: '📈', name: 'Investisseur', desc: 'Bourse + assurance-vie ≥ 25 % des actifs', check: t => t.assets > 0 && (t.byCat.bourse + t.byCat.av) / t.assets >= .25 },
  { id: 'k10', emoji: '🔟', name: '5 chiffres', desc: '10 000 € de patrimoine net', check: t => t.net >= 1e4 },
  { id: 'k100', emoji: '💯', name: '6 chiffres', desc: '100 000 € de patrimoine net', check: t => t.net >= 1e5 },
  { id: 'median', emoji: '🗼', name: 'Au-dessus de la médiane', desc: 'Dépasser la médiane des ménages français (148 100 €)', check: t => t.net >= 148100 },
  { id: 'top10', emoji: '🏅', name: 'Top 10 %', desc: 'Dépasser 750 400 € de patrimoine net', check: t => t.net >= 750400 },
  { id: 'million', emoji: '💎', name: 'Millionnaire', desc: '1 000 000 € de patrimoine net', check: t => t.net >= 1e6 },
  { id: 'goal', emoji: '🎯', name: 'Dans le mille', desc: 'Atteindre un de tes objectifs', check: () => state.goals.some(g => g.doneAt) },
  { id: 'team', emoji: '🤝', name: 'Esprit d\'équipe', desc: 'Rejoindre ou créer un groupe d\'amis', check: () => !!state.group },
  { id: 'saver', emoji: '💾', name: 'Prévoyant', desc: 'Exporter une sauvegarde de tes données', check: () => !!state.lastBackup },
  { id: 'nodebt', emoji: '🕊️', name: 'Libre comme l\'air', desc: 'Aucune dette et plus de 10 000 € de patrimoine', check: t => t.debts === 0 && t.net > 1e4 },
  { id: 'score80', emoji: '❤️', name: 'Santé de fer', desc: 'Score de santé financière ≥ 80', check: t => healthScore(t).total >= 80 },
];

/* Vérifie succès, niveaux et objectifs ; célèbre les nouveautés */
function checkAchievements({ silent = false } = {}) {
  const t = totals();
  const news = [];
  state.goals.forEach(g => {
    if (!g.doneAt && goalCurrent(g, t) >= g.target) {
      g.doneAt = new Date().toISOString(); news.push({ emoji: g.emoji, name: `Objectif atteint : ${g.name}`, desc: 'Bravo ! 🎉' });
      addFeed('goal', `a atteint son objectif « ${g.name} »`, { emoji: g.emoji || '🎯' });
    }
  });
  BADGES.forEach(b => {
    if (!state.badges[b.id] && b.check(t)) {
      state.badges[b.id] = new Date().toISOString(); news.push(b);
      addFeed('badge', `a débloqué le succès « ${b.name} »`, { emoji: b.emoji });
    }
  });
  const lvl = levelFor(t.net);
  if (lvl.idx > (state.flags.maxLevel || 0)) {
    if (state.flags.maxLevel) {
      news.push({ emoji: lvl.cur.emoji, name: `Niveau ${lvl.idx} : ${lvl.cur.name} !`, desc: 'Tu passes au niveau supérieur' });
      addFeed('level', `passe au niveau ${lvl.cur.emoji} ${lvl.cur.name}`, { emoji: '⬆️' });
    }
    state.flags.maxLevel = lvl.idx;
  }
  save({ auto: true });
  if (silent || !news.length) return news;
  if (news.length > 3) toast(`🏆 ${news.length} succès débloqués !`, news.slice(0, 4).map(n => n.emoji + ' ' + n.name).join(' · '), 'badge-toast');
  else news.forEach((n, i) => setTimeout(() => toast(`${n.emoji} ${n.name}`, n.desc, 'badge-toast'), i * 400));
  confetti.burst();
  return news;
}

/* ---------- Objectifs ---------- */
function scopeLabel(g) {
  if (!g.scope || g.scope === 'net') return 'Patrimoine net';
  if (g.scope.startsWith('cat:')) return CATS[g.scope.slice(4)]?.label || '—';
  const a = state.accounts.find(x => x.id === g.scope.slice(4));
  return a ? a.name : 'Compte supprimé';
}

function renderGoals(v) {
  const t = totals(), p = state.profile;
  v.innerHTML = `
  <div class="row between"><p class="muted" style="margin:0">Fixe des caps motivants : l'app calcule le temps restant et l'effort mensuel nécessaire.</p>
    <button class="btn btn-primary" data-act="add-goal">＋ Nouvel objectif</button></div>
  <div class="grid g3 mt">${state.goals.map(g => {
    const cur = goalCurrent(g, t), rest = Math.max(0, g.target - cur), pr = clamp(cur / g.target, 0, 1);
    let eta = '';
    if (rest <= 0) eta = '✅ Atteint' + (g.doneAt ? ` le ${fmtDate(g.doneAt, true)}` : '');
    else {
      if (g.deadline) {
        const months = Math.max(1, (new Date(g.deadline) - new Date()) / (864e5 * 30.44));
        eta += `📆 Échéance ${fmtDate(g.deadline, true)} → <b class="money">${eur(rest / months)}</b>/mois nécessaires<br>`;
      }
      const ms = +p.monthlySavings || 0;
      eta += ms > 0 ? `⏱️ Au rythme de ${eur(ms)}/mois : ≈ ${fmtMonths(rest / ms)}` : '⏱️ Indique ton épargne mensuelle dans Réglages';
    }
    return `<div class="card goal ${rest <= 0 ? 'done' : ''}">
      <div class="goal-top"><div class="goal-emo">${esc(g.emoji)}</div>
        <div style="flex:1;min-width:0"><b>${esc(g.name)}</b><div class="small muted">${esc(scopeLabel(g))}</div></div>
        <button class="icon-btn" data-edit-goal="${g.id}" title="Modifier">✏️</button></div>
      <div class="row between"><b class="money" style="font-size:20px">${eur(cur)}</b><span class="muted money">/ ${eur(g.target)}</span></div>
      <div class="progress"><i style="width:${pr * 100}%;${rest <= 0 ? 'background:var(--green)' : ''}"></i></div>
      <div class="row between small"><b>${fmtPct.format(pr * 100)} %</b><span class="muted money">${rest > 0 ? 'reste ' + eur(rest) : ''}</span></div>
      <div class="small muted" style="line-height:1.6">${eta}</div>
    </div>`;
  }).join('')}</div>
  ${state.goals.length ? '' : `<div class="card empty mt"><div class="big">🎯</div><h2>Aucun objectif pour l'instant</h2>
    <p>Exemples : « Épargne de précaution 10 000 € », « Apport immobilier 40 000 € », « Premier million ».</p>
    <button class="btn btn-primary" data-act="add-goal">＋ Créer mon premier objectif</button></div>`}`;
}

/* ---------- Succès ---------- */
function renderBadges(v) {
  const t = totals(), lvl = levelFor(t.net);
  const got = Object.keys(state.badges).length;
  v.innerHTML = `
  <div class="card">
    <h3>🌱 Niveaux de patrimoine <span class="small">${lvl.next ? `${eur(lvl.next.min - t.net)} avant ${lvl.next.emoji} ${lvl.next.name}` : '👑 Niveau max'}</span></h3>
    <div class="levels">${LEVELS.map((l, i) => `<div class="lvl ${i === lvl.idx ? 'cur' : i > lvl.idx ? 'locked' : ''}">
      <div class="e">${l.emoji}</div><b>${l.name}</b><div class="faint">${isFinite(l.min) ? (l.min ? compact(l.min) : '0 €') : '< 0 €'}</div></div>`).join('')}</div>
  </div>
  <div class="row between mt"><h3 style="margin:0">🏆 Succès débloqués : ${got} / ${BADGES.length}</h3>
    <div style="width:240px" class="progress"><i style="width:${got / BADGES.length * 100}%"></i></div></div>
  <div class="badges mt">${BADGES.map(b => {
    const d = state.badges[b.id];
    return `<div class="badge ${d ? '' : 'locked'}"><div class="b-emo">${b.emoji}</div><div class="b-name">${b.name}</div>
      <div class="b-desc">${b.desc}</div>${d ? `<div class="b-date">✓ ${fmtDate(d, true)}</div>` : '<div class="b-date faint">🔒 À débloquer</div>'}</div>`;
  }).join('')}</div>`;
}

/* ---------- Historique ---------- */
function renderHistory(v) {
  const snaps = sortedSnapshots();
  v.innerHTML = `
  <div class="row between wrap">
    <p class="muted" style="margin:0">Chaque photo fige ton patrimoine à une date. Une par mois suffit (la mise à jour express en prend une automatiquement).</p>
    <div class="row"><button class="btn" data-act="add-past">🕰️ Ajouter un point passé</button><button class="btn btn-primary" data-act="snapshot">📸 Photo maintenant</button></div>
  </div>
  <div class="card mt"><h3>📈 Courbe</h3><div id="histChart"></div></div>
  <div class="card mt"><h3>🗂️ ${snaps.length} photo(s)</h3>
    ${snaps.length ? `<table class="tbl"><thead><tr><th>Date</th><th class="r">Patrimoine net</th><th class="r">Variation</th><th class="r">Actifs</th><th class="r">Dettes</th><th></th></tr></thead><tbody>
    ${snaps.map((s, i) => {
      const prev = snaps[i - 1];
      const d = prev ? s.net - prev.net : null;
      return `<tr><td>${fmtDate(s.date, true)}</td><td class="r money"><b>${eur(s.net)}</b></td>
        <td class="r">${d == null ? '<span class="faint">—</span>' : `<span class="money ${d >= 0 ? 'up' : 'down'}">${signed(d)}</span>`}</td>
        <td class="r money muted">${s.assets != null ? eur(s.assets) : '—'}</td><td class="r money muted">${s.debts != null ? eur(s.debts) : '—'}</td>
        <td class="r"><button class="btn btn-sm btn-ghost" data-del-snap="${s.date}" title="Supprimer">🗑️</button></td></tr>`;
    }).reverse().join('')}</tbody></table>` : '<div class="empty-chart">Aucune photo pour le moment.</div>'}
  </div>`;
  const hc = document.getElementById('histChart');
  if (snaps.length >= 2) {
    const series = [{ name: 'Net', color: '#7c5cff', area: true, dots: snaps.length < 30, points: snaps.map(s => ({ x: new Date(s.date), y: s.net })) }];
    if (snaps.every(s => s.assets != null)) series.push({ name: 'Actifs', color: '#22d3ee', dash: true, width: 2, points: snaps.map(s => ({ x: new Date(s.date), y: s.assets })) });
    if (snaps.every(s => s.debts != null) && snaps.some(s => s.debts > 0)) series.push({ name: 'Dettes', color: '#f87171', dash: true, width: 2, points: snaps.map(s => ({ x: new Date(s.date), y: s.debts })) });
    lineChart(hc, { series, height: 280, zero: true });
  } else hc.innerHTML = '<div class="empty-chart">Il faut au moins 2 photos pour tracer une courbe.</div>';
}

/* ---------- Réglages ---------- */
function renderSettings(v) {
  const p = state.profile;
  v.innerHTML = `
  <div class="grid g2">
    <div class="card">
      <h3>👤 Profil</h3>
      <div class="form-grid">
        <label class="field">Prénom<input class="input" data-prof="name" value="${esc(p.name)}" placeholder="Optionnel"></label>
        <label class="field">Année de naissance<input class="input" data-prof="birthYear" type="number" min="1920" max="2025" value="${esc(p.birthYear)}"></label>
        <label class="field">Dépenses mensuelles<input class="input money" data-prof="monthlyExpenses" data-amount value="${fmtNum.format(p.monthlyExpenses)}"></label>
        <label class="field">Épargne mensuelle<input class="input money" data-prof="monthlySavings" data-amount value="${fmtNum.format(p.monthlySavings)}"></label>
        <label class="field">Inflation estimée (%)<input class="input" data-prof="inflation" type="number" step="0.1" value="${esc(p.inflation)}"></label>
        <label class="field">Rendement nouvelle épargne (%)<input class="input" data-prof="futureRate" type="number" step="0.5" value="${esc(p.futureRate)}"></label>
      </div>
      <p class="small faint">Les dépenses servent au fonds d'urgence, au runway et à l'objectif FIRE (25 × dépenses annuelles).</p>
    </div>
    <div class="card">
      <h3>💾 Données</h3>
      <p class="small muted" style="line-height:1.5;margin-top:0">${WEB_MODE ? 'Tes données sont enregistrées <b>sur ce téléphone</b> et synchronisées (chiffrées) avec ton PC.' : 'Tes données sont enregistrées <b>sur cet ordinateur</b> (fichier de sauvegarde).'}
        Seule ta fiche est partagée avec ton groupe d'amis, et la sauvegarde en ligne est chiffrée.
        Dernier export : <b>${state.lastBackup ? fmtDate(state.lastBackup, true) : 'jamais'}</b>.</p>
      <div class="row wrap">
        <button class="btn btn-primary" data-act="export">⬇️ Exporter (JSON)</button>
        <button class="btn" data-act="import">⬆️ Importer</button>
        <button class="btn" data-act="csv">📄 Export CSV</button>
      </div>
      <div class="row wrap mt">
        <button class="btn" data-act="demo">🎲 Charger l'exemple</button>
        <button class="btn btn-danger" data-act="reset">🗑️ Tout effacer</button>
      </div>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
    </div>
    <div class="card">
      <h3>☁️ Sauvegarde en ligne chiffrée</h3>
      <div id="backupCard">${backupCardInner()}</div>
    </div>
    <div class="card pc-only">
      <h3>📱 Sur ton téléphone</h3>
      <p class="small muted" style="margin-top:0;line-height:1.5">Retrouve ton patrimoine sur ton téléphone, synchronisé avec ce PC (dans les deux sens),
        avec les cours en direct et ton groupe d'amis. Scanne le QR code avec l'appareil photo de ton téléphone.</p>
      <button class="btn btn-primary" id="phoneOpen">📱 Afficher le QR code</button>
    </div>
    <div class="card">
      <h3>🎨 Apparence</h3>
      <div class="row wrap">
        <button class="btn ${state.settings.theme === 'dark' ? 'btn-primary' : ''}" data-theme-set="dark">🌙 Sombre</button>
        <button class="btn ${state.settings.theme === 'light' ? 'btn-primary' : ''}" data-theme-set="light">☀️ Clair</button>
        <button class="btn" data-act="privacy">${state.settings.privacy ? '👁️ Afficher les montants' : '🙈 Masquer les montants'}</button>
      </div>
    </div>
    <div class="card">
      <h3>ℹ️ À propos</h3>
      <p class="small muted" style="line-height:1.6;margin:0">Comparaison France : INSEE, « Distribution du patrimoine des ménages », début 2024.
      Taux par défaut des livrets : Livret A / LDDS 1,7 %, LEP 2,5 % (au 1er août 2026) — modifiables pour chaque compte.
      Les projections sont des estimations pédagogiques, pas des conseils en investissement.<br><span class="faint">Version ${APP_VERSION}</span></p>
      ${state.group && !WEB_MODE ? '<button class="btn btn-sm mt" id="updCheck">🔄 Vérifier les mises à jour</button>' : ''}
    </div>
  </div>`;
  bindBackupCard(v);
  v.querySelector('#updCheck')?.addEventListener('click', () => checkForUpdate({ manual: true }));
  v.querySelector('#phoneOpen')?.addEventListener('click', openPhoneModal);
}
