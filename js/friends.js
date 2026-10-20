/* =========================================================
   Vue « Amis » : classement, course, fiches détaillées
   Toutes les données venant des autres membres sont échappées.
   ========================================================= */
const MEMBER_COLORS = ['#7c5cff', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#fb923c', '#60a5fa', '#a3e635', '#e879f9', '#f87171'];
let friendsTab = 'net';
const N = x => (Number.isFinite(+x) ? +x : 0);

function groupMembers() {
  const g = state.group;
  const rows = (sync.members || state.friendsCache || []).filter(r => r && r.id !== g.memberId && r.data);
  const me = { id: g.memberId, name: g.name, emoji: g.emoji, data: buildPublicProfile(), updated_at: new Date().toISOString(), me: true };
  const all = [me, ...rows];
  const byId = [...all].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // net : patrimoine recalculé avec les cours en direct (même si le membre n'a pas ouvert son app)
  return all.map(m => ({ ...m, net: liveNetOf(m.data), color: MEMBER_COLORS[byId.indexOf(m) % MEMBER_COLORS.length] }));
}

/* ---------- Patrimoine cumulé du groupe ---------- */
let raceMode = 'valeur';
function groupTotalInner(members, curves) {
  const total = members.reduce((s, m) => s + m.net, 0);
  const tc = curves.total;
  const first = tc.length > 1 ? tc[0] : null;
  const diff = first ? total - first.y : null;
  const sinceTxt = first && +first.x > Date.now() - CHART_PERIODS[chartPeriod].ms + CHART_PERIODS[chartPeriod].step * 2
    ? `depuis le ${DF.day.format(first.x)}` : CHART_PERIODS[chartPeriod].since;
  const pos = members.filter(m => m.net > 0), posSum = pos.reduce((s, m) => s + m.net, 0);
  const sorted = [...members].sort((a, b) => b.net - a.net);
  return `
    <div class="gt-main">
      <div class="hero-label">💰 PATRIMOINE CUMULÉ DU GROUPE</div>
      <div class="gt-value money">${eur(total)}</div>
      <div class="gt-delta">${diff != null ? `${deltaPill(diff, first.y)} <span class="small muted">${sinceTxt}</span>` : '<span class="small faint">variation disponible dès que l\'historique est chargé</span>'}</div>
      <div class="small faint">${members.length} membre${members.length > 1 ? 's' : ''} · moyenne <b class="money">${eur(total / Math.max(1, members.length))}</b> par personne</div>
    </div>
    <div class="gt-split">
      <div class="gt-bar">${sorted.filter(m => m.net > 0).map(m =>
        `<i style="width:${m.net / posSum * 100}%;background:${m.color}" title="${esc(m.name)} : ${eur(m.net)}"></i>`).join('')}</div>
      <div class="gt-legend">${sorted.map(m => `<div class="gt-row"><i style="background:${m.color}"></i><span>${esc(m.emoji || '')} ${esc(m.name)}</span>
        <b class="money">${eur(m.net)}</b><span class="muted small">${posSum && m.net > 0 ? fmtPct.format(m.net / posSum * 100) : 0} %</span></div>`).join('')}</div>
    </div>`;
}

/* Rafraîchissement en place (cours en direct, nouvel historique) sans tout redessiner */
function updateFriendsLive() {
  const el = document.getElementById('raceChart');
  if (!el || !state.group || state.group.kicked) return;
  const members = groupMembers();
  const curves = groupCurves(members);
  const gt = document.getElementById('groupTotal');
  if (gt) gt.innerHTML = groupTotalInner(members, curves);
  if (!chartBusy(el)) drawRace(el, members, curves);
  const note = document.querySelector('.chart-note');
  if (note) note.textContent = periodCaption() + (curves.extended && raceMode === 'total'
    ? ' · avant le début de son historique, un membre compte pour sa première valeur connue' : '');
  const st = document.getElementById('raceStatus');
  if (st) st.innerHTML = histStatusHTML(keysOf(members.map(m => m.data)));
  members.forEach(m => {
    const n = document.querySelector(`.member[data-member="${CSS.escape(String(m.id))}"] .m-net`);
    if (n) n.textContent = eur(m.net);
  });
  refreshDuel(); refreshRecap();
  if (friendsTab === 'net') document.querySelectorAll('.board-row').forEach(r => {
    const m = members.find(x => String(x.id) === r.dataset.member);
    const s = r.querySelector('.score b');
    if (m && s) s.textContent = eur(m.net);
  });
}

/* Progression sur ~30 jours à partir des photos */
function memberProgress(d) {
  const snaps = (Array.isArray(d.snapshots) ? d.snapshots : []).filter(s => s && s.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!snaps.length) return null;
  const limit = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const past = snaps.filter(s => s.date <= limit);
  const ref = past.length ? past[past.length - 1] : snaps[0];
  if (ref.date >= todayISO()) return null;
  const diff = N(d.net) - N(ref.net);
  return { diff, pct: N(ref.net) ? diff / Math.abs(N(ref.net)) * 100 : 0, since: ref.date };
}
function goalsStats(d) {
  const goals = Array.isArray(d.goals) ? d.goals : [];
  const done = goals.filter(x => x && (x.doneAt || N(x.current) >= N(x.target) && N(x.target) > 0)).length;
  const avg = goals.length ? goals.reduce((s, x) => s + clamp(N(x.current) / Math.max(1, N(x.target)), 0, 1), 0) / goals.length * 100 : 0;
  return { done, total: goals.length, avg };
}
const nameOf = m => `<span>${esc(m.emoji || '🙂')} ${esc(m.name)}${m.me ? ' <span class="pill">toi</span>' : ''}</span>`;

/* ---------- Pas encore de groupe ---------- */
function renderFriendsSetup(v) {
  const p = state.profile;
  v.innerHTML = `
  <div class="card hero-friends">
    <div class="big">👥</div>
    <div><h2 style="margin:0 0 6px">Compare ton patrimoine avec tes amis</h2>
    <p class="muted" style="margin:0;line-height:1.5">Chaque membre voit le patrimoine détaillé, les placements, les objectifs, la courbe et les succès des autres,
      avec un classement et une « course au patrimoine ». Les fiches se mettent à jour toutes seules.</p></div>
  </div>
  <div class="grid g2 mt">
    <div class="card">
      <h3>🔗 J'ai reçu un code d'invitation</h3>
      <label class="field">Code d'invitation<textarea class="input" id="jCode" rows="3" placeholder="MP1.eyJ1Ijoi…"></textarea></label>
      <div class="form-grid mt">
        <label class="field">Ton prénom (visible par le groupe)<input class="input" id="jName" value="${esc(p.name)}" maxlength="40"></label>
        <label class="field">Ton emoji<input class="input" id="jEmoji" value="😎" maxlength="4"></label>
      </div>
      <button class="btn btn-primary mt w100" id="jGo">Rejoindre le groupe</button>
    </div>
    <div class="card">
      <h3>🛠️ Je crée le groupe <span class="small faint">(l'organisateur, une seule fois)</span></h3>
      <ol class="steps">
        <li>Crée un compte gratuit sur <b>supabase.com</b>, puis <b>New project</b> (région <i>Europe</i>, garde le mot de passe pour toi).</li>
        <li>Menu <b>SQL Editor</b> → <b>New query</b> → colle le script ci-dessous → <b>Run</b>.
          <div><button class="btn btn-sm mt" id="cSql">📋 Copier le script SQL</button></div></li>
        <li>Menu <b>Project Settings → API</b> (ou <i>API Keys</i>) : copie l'<b>URL du projet</b> et la clé <b>anon</b> / <b>publishable</b> (jamais la clé secrète).</li>
        <li>Colle-les ici :</li>
      </ol>
      <div class="form-grid">
        <label class="field full">URL du projet<input class="input" id="cUrl" placeholder="https://abcdefgh.supabase.co"></label>
        <label class="field full">Clé anon / publishable<input class="input" id="cKey" placeholder="eyJhbGciOi… ou sb_publishable_…"></label>
        <label class="field">Nom du groupe<input class="input" id="cGroup" value="Les amis du patrimoine" maxlength="40"></label>
        <label class="field">Ton prénom<input class="input" id="cName" value="${esc(p.name)}" maxlength="40"></label>
      </div>
      <button class="btn btn-primary mt w100" id="cGo">Créer le groupe et obtenir le code d'invitation</button>
    </div>
  </div>
  <div class="card mt small muted" style="line-height:1.6">
    🔐 <b>Confidentialité.</b> Partagé avec les membres : comptes, montants, lignes de bourse, objectifs, courbe et succès.
    Jamais partagé : les notes de tes comptes, tes réglages et tes sauvegardes. Seules les personnes qui ont le code peuvent lire le groupe,
    et chacun ne peut modifier que sa propre fiche. L'organisateur, propriétaire du projet Supabase, peut techniquement tout voir depuis sa console.
  </div>`;

  const $ = s => v.querySelector(s);
  $('#cSql').onclick = () => copyText(SUPABASE_SQL, '📋 Script SQL copié', 'Colle-le dans Supabase > SQL Editor puis clique sur Run.');
  $('#jGo').onclick = async () => {
    const name = $('#jName').value.trim();
    if (!$('#jCode').value.trim()) return shake($('#jCode'));
    if (!name) return shake($('#jName'));
    await busyButton($('#jGo'), async () => {
      await joinGroup($('#jCode').value, name, $('#jEmoji').value.trim());
      if (!state.profile.name) { state.profile.name = name; save(); }
      await pullMembers();
      toast('🎉 Bienvenue dans le groupe !', esc(state.group.groupName)); confetti.burst(150); rerender();
    });
  };
  $('#cGo').onclick = async () => {
    const name = $('#cName').value.trim();
    if (!$('#cUrl').value.trim()) return shake($('#cUrl'));
    if (!$('#cKey').value.trim()) return shake($('#cKey'));
    if (!name) return shake($('#cName'));
    await busyButton($('#cGo'), async () => {
      await createGroup({ url: $('#cUrl').value, key: $('#cKey').value, groupName: $('#cGroup').value.trim(), name, emoji: '👑' });
      if (!state.profile.name) { state.profile.name = name; save(); }
      await pullMembers();
      confetti.burst(150); rerender(); openInviteModal();
    });
  };
}

async function busyButton(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '⏳ Connexion…';
  try { await fn(); }
  catch (e) { toast('⚠️ ' + esc(e.message || 'Connexion impossible'), 'Vérifie les informations et ta connexion internet.'); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

async function copyText(text, title, sub) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(title, sub || '');
}

/* ---------- Groupe actif ---------- */
function renderKicked(v) {
  const g = state.group;
  v.innerHTML = `<div class="card empty">
    <div class="big">🚫</div>
    <h2>Tu as été retiré du groupe « ${esc(g.groupName)} »</h2>
    <p>Son organisateur t'a retiré : ta fiche n'est plus partagée et tu ne vois plus celles des autres membres.
      Tes données restent intactes sur ton ordinateur.</p>
    <button class="btn btn-primary" id="kOk">OK, retirer ce groupe de mon app</button>
  </div>`;
  v.querySelector('#kOk').onclick = () => { delete state.group; delete state.friendsCache; sync.members = null; sync.group = null; save(); rerender(); };
}

function renderFriends(v) {
  if (!state.group) return renderFriendsSetup(v);
  if (state.group.kicked) return renderKicked(v);
  const g = state.group;
  const members = groupMembers();
  const curves = groupCurves(members);
  const rows = leaderboardRows(members);
  const admin = members.find(m => m.id === sync.group?.admin_member_id);
  const amAdmin = isGroupAdmin();
  const locked = !!sync.group?.locked;

  v.innerHTML = `
  ${g.paused ? `<div class="card paused-banner row between wrap">
    <div><b>⏸️ Ton partage est en pause</b><div class="small">Tes amis ne reçoivent plus tes mises à jour : ils voient ta fiche telle qu'elle était au moment de la pause.</div></div>
    <button class="btn btn-primary" data-fact="pause">▶️ Reprendre le partage</button>
  </div>` : ''}
  <div class="card row between wrap friends-head ${g.paused ? 'mt' : ''}">
    <div class="row"><div style="font-size:34px">👥</div>
      <div><div style="font-weight:800;font-size:18px">${esc(g.groupName)}</div>
      <div class="small muted">${members.length} membre${members.length > 1 ? 's' : ''} · <span data-sync>${syncStatusHTML()}</span></div>
      ${admin || locked ? `<div class="small muted" style="margin-top:2px">${admin ? `👑 Organisateur : <b>${esc(admin.name)}</b>${admin.me ? ' (toi)' : ''}` : ''}${locked ? `${admin ? ' · ' : ''}🔒 groupe fermé aux nouveaux membres` : ''}</div>` : ''}</div></div>
    <div class="row wrap">
      <button class="btn" data-fact="refresh">🔄 Actualiser</button>
      <button class="btn btn-primary" data-fact="invite">📨 Inviter des amis</button>
    </div>
  </div>

  <div class="grid g2 mt">
    <div class="card group-total" id="groupTotal">${groupTotalInner(members, curves)}</div>
    <div class="card">
      <h3>🏆 Classement</h3>
      <div class="seg" style="margin-bottom:12px">
        ${[['net', '💎 Patrimoine'], ['progress', '🚀 Progression 30 j'], ['badges', '🏅 Succès'], ['goals', '🎯 Objectifs']]
          .map(([k, l]) => `<button data-tab="${k}" class="${friendsTab === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="board">${rows.map((r, i) => `
        <button class="board-row ${r.m.me ? 'me' : ''}" data-member="${esc(r.m.id)}">
          <span class="rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
          <span class="who">${nameOf(r.m)}<span class="small faint">${esc(r.m.data.level?.emoji || '')} ${esc(r.m.data.level?.name || '')}</span></span>
          <span class="score">${r.label}</span>
        </button>`).join('')}</div>
    </div>
  </div>

  <div class="card mt">
    <h3>🏁 La course au patrimoine <span class="actions">${periodSegHTML()}</span></h3>
    <div class="row between wrap" style="margin-bottom:10px;gap:10px">
      <div class="seg seg-sm">${[['valeur', '💶 Valeur'], ['pct', '📈 Variation %'], ['total', 'Σ Total du groupe']]
        .map(([k, l]) => `<button data-race="${k}" class="${raceMode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="small" id="raceStatus">${histStatusHTML(keysOf(members.map(m => m.data)))}</span>
    </div>
    <div id="raceChart"></div>
    <div class="race-legend" id="raceLegend">${raceLegendHTML(members)}</div>
    <div class="small faint chart-note">${periodCaption()}</div>
  </div>

  <div class="grid g2 mt">
    <div class="card"><h3>📰 Fil du groupe</h3><div id="feedBox" class="feed">${feedHTML(members)}</div></div>
    <div class="card recap" id="recapBox">${recapHTML(members)}</div>
  </div>

  <div class="card mt"><h3>⚔️ Duel de portefeuilles</h3><div id="duelBox">${duelHTML(members)}</div></div>

  <div class="members mt">${members.map(m => memberCardHTML(m)).join('')}</div>

  <div class="card mt">
    <h3>⚙️ Ma participation</h3>
    <div class="row wrap">
      <label class="field" style="flex:1;min-width:180px">Nom affiché<input class="input" id="gName" value="${esc(g.name)}" maxlength="40"></label>
      <label class="field" style="width:90px">Emoji<input class="input" id="gEmoji" value="${esc(g.emoji)}" maxlength="4"></label>
      <button class="btn" data-fact="pause">${g.paused ? '▶️ Reprendre le partage' : '⏸️ Mettre le partage en pause'}</button>
      <button class="btn" data-fact="push">📤 Envoyer ma fiche maintenant</button>
      <button class="btn btn-danger" data-fact="leave">🚪 Quitter le groupe</button>
    </div>
    ${amAdmin ? `<div class="admin-box">
      <div><b>👑 Tu es l'organisateur</b><div class="small muted">Toi seul peux retirer un membre (bouton « Retirer » sur sa fiche) et fermer le groupe.
        Une fois tous tes amis inscrits, ferme-le : un membre retiré ne pourra pas revenir avec l'ancien code.</div></div>
      <button class="btn ${locked ? '' : 'btn-primary'}" data-fact="lock">${locked ? '🔓 Rouvrir aux nouveaux membres' : '🔒 Fermer le groupe aux nouveaux membres'}</button>
    </div>
    <div class="admin-box">
      <div><b>🔄 Mises à jour automatiques</b><div class="small muted">Quand ton app passe à une nouvelle version, elle l'envoie au groupe et les apps de tes amis l'installent toutes seules.
        Il faut juste qu'ils aient installé une fois la version avec mises à jour automatiques (dernier zip).</div>
        <div class="row wrap" style="gap:6px;margin-top:8px">${membersVersionsHTML(members)}</div></div>
      ${WEB_MODE ? '' : `<button class="btn" data-fact="publish">📦 Renvoyer la version ${esc(APP_VERSION)}</button>`}
    </div>` : sync.v2 && !sync.group ? `<div class="admin-box">
      <div><b>Ce groupe n'a pas encore d'organisateur</b><div class="small muted">L'organisateur est le seul à pouvoir retirer un membre ou fermer le groupe.</div></div>
      <button class="btn" data-fact="claim">👑 Devenir organisateur</button>
    </div>` : sync.v2 === false && g.owner ? `<div class="admin-box"><div class="small muted">ℹ️ Pour pouvoir retirer des membres, mets à jour le script SQL dans Supabase (onglet Amis → il sera proposé à la création d'un groupe).</div></div>` : ''}
  </div>`;

  drawRace(document.getElementById('raceChart'), members, curves);
  bindFriendsEvents(v);
  bindGroupLife(v);
  const allKeys = keysOf(members.map(m => m.data));
  ensureHistory(allKeys);
  if (chartPeriod !== 'semaine') ensureHistory(allKeys, 'semaine');   // pour le récap

  // Données fraîches en arrière-plan
  if (!sync.busy && (!g.lastPull || Date.now() - new Date(g.lastPull) > 30000)) {
    pullMembers().then(r => { if (r && currentView === 'friends' && !modalOpen()) VIEWS.friends.render($view); });
  }
}

function leaderboardRows(members) {
  const rows = members.map(m => {
    const d = m.data, pr = memberProgress(d), gs = goalsStats(d), nb = Array.isArray(d.badges) ? d.badges.length : 0;
    if (friendsTab === 'progress') return { m, val: pr ? pr.pct : -Infinity, label: pr ? `<span class="${pr.diff >= 0 ? 'up' : 'down'}">${pr.pct >= 0 ? '+' : '−'}${fmtPct.format(Math.abs(pr.pct))} %</span> <span class="small faint money">${signed(pr.diff)}</span>` : '<span class="faint small">pas assez de photos</span>' };
    if (friendsTab === 'badges') return { m, val: nb, label: `<b>${nb}</b> <span class="small faint">/ ${BADGES.length}</span>` };
    if (friendsTab === 'goals') return { m, val: gs.done * 1000 + gs.avg, label: gs.total ? `<b>${gs.done}/${gs.total}</b> <span class="small faint">· ${Math.round(gs.avg)} % en moyenne</span>` : '<span class="faint small">aucun objectif</span>' };
    return { m, val: m.net, label: `<b class="money">${eur(m.net)}</b>` };
  });
  return rows.sort((a, b) => b.val - a.val);
}

function raceLegendHTML(members) {
  return raceMode === 'total' ? '<span><i style="background:#7c5cff"></i>Σ Total du groupe</span>'
    : members.map(m => `<span><i style="background:${m.color}"></i>${esc(m.emoji || '')} ${esc(m.name)}</span>`).join('');
}

/* La course : valeur de chacun, variation en % depuis le début de la période, ou total du groupe */
function drawRace(el, members, curves = groupCurves(members)) {
  let series;
  if (raceMode === 'total') series = [{ name: 'Σ Total du groupe', color: '#7c5cff', area: true, width: 3, pulse: true, points: curves.total }];
  else series = curves.series.map(({ m, points }) => {
    let pts = points;
    if (raceMode === 'pct') {
      const v0 = points.length ? points[0].y : 0;
      pts = v0 > 0 ? points.map(p => ({ x: p.x, y: (p.y / v0 - 1) * 100 })) : [];
    }
    return { name: `${m.emoji || ''} ${m.name}`, color: m.color, width: m.me ? 3.5 : 2.5, pulse: true, points: pts };
  });
  series = series.filter(s => s.points.length >= 2);
  if (!series.length) {
    el.innerHTML = `<div class="empty-chart">${raceMode === 'total' ? 'Le total apparaît dès que chaque membre a une courbe sur cette période 📈'
      : 'La course démarre quand chacun aura pris au moins une photo de son patrimoine 📸'}</div>`;
    return;
  }
  // L'animation de tracé ne rejoue que si l'on change de période ou de mode (pas à chaque cours en direct)
  const sig = chartPeriod + raceMode, animate = drawRace.sig !== sig;
  drawRace.sig = sig;
  const pctF = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtPct.format(Math.abs(v))} %`;
  lineChart(el, {
    series, height: 280, animate, ...periodFormats(),
    zero: raceMode === 'pct',
    ...(raceMode === 'pct' ? { yFmt: pctF, tipFmt: pctF } : {}),
  });
}

function memberCardHTML(m) {
  const d = m.data, pr = memberProgress(d), gs = goalsStats(d);
  const snaps = Array.isArray(d.snapshots) ? d.snapshots : [];
  const spark = snaps.slice(-12).map(s => N(s.net)).concat(m.net);
  return `
  <button class="card member ${m.me ? 'me' : ''}" data-member="${esc(m.id)}" style="--mc:${m.color}">
    <div class="row"><div class="m-emo">${esc(m.emoji || '🙂')}</div>
      <div style="min-width:0;text-align:left"><div class="m-name">${esc(m.name)} ${m.me ? '<span class="pill">toi</span>' : ''}${m.id === sync.group?.admin_member_id ? ' <span class="pill" title="Organisateur du groupe">👑</span>' : ''}</div>
      <div class="small muted">${esc(d.level?.emoji || '')} Niv. ${N(d.level?.idx)} · ${esc(d.level?.name || '')}</div></div></div>
    <div class="m-net money">${eur(m.net)}</div>
    <div class="row between small">${pr ? `<span class="${pr.diff >= 0 ? 'up' : 'down'} money">${pr.diff >= 0 ? '▲' : '▼'} ${signed(pr.diff)} (30 j)</span>` : '<span class="faint">—</span>'}
      <span class="muted">❤️ ${N(d.health)}/100</span></div>
    ${sparkSVG(spark, m.color)}
    <div class="row between small muted"><span>🎯 ${gs.done}/${gs.total} objectifs</span><span>🏅 ${Array.isArray(d.badges) ? d.badges.length : 0} succès</span></div>
    ${memberStatusHTML(m)}
  </button>`;
}

/* État de la fiche : en direct, en pause, ancienne ou vide */
function memberStatusHTML(m) {
  const d = m.data;
  if (m.me) return state.group.paused
    ? '<div class="small m-warn">⏸️ ton partage est en pause</div>'
    : '<div class="small faint" style="text-align:left">ta fiche en direct</div>';
  const noAccounts = !Array.isArray(d.accounts) || !d.accounts.length;
  const ageDays = (Date.now() - new Date(m.updated_at)) / 864e5;
  if (d.paused) return `<div class="small m-warn">⏸️ partage en pause (${agoText(m.updated_at)})</div>`;
  if (noAccounts) return `<div class="small m-warn">🌱 n'a pas encore ajouté de comptes · ${agoText(m.updated_at)}</div>`;
  if (ageDays > 2) return `<div class="small m-warn">⚠️ pas de nouvelles depuis ${Math.floor(ageDays)} jours</div>`;
  return `<div class="small faint" style="text-align:left">mis à jour ${agoText(m.updated_at)}</div>`;
}

function sparkSVG(vals, color) {
  if (vals.length < 2) return '<div style="height:40px"></div>';
  const mn = Math.min(...vals), mx = Math.max(...vals), W = 200, H = 40;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * W).toFixed(1)},${(H - 4 - (mx === mn ? .5 : (v - mn) / (mx - mn)) * (H - 8)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:40px;display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function bindFriendsEvents(v) {
  v.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { friendsTab = b.dataset.tab; rerender(); });
  v.querySelectorAll('[data-race]').forEach(b => b.onclick = () => {
    raceMode = b.dataset.race;
    v.querySelectorAll('[data-race]').forEach(x => x.classList.toggle('on', x === b));
    v.querySelector('#raceLegend').innerHTML = raceLegendHTML(groupMembers());
    updateFriendsLive();
  });
  bindPeriodSeg(v, () => { const n = v.querySelector('.chart-note'); if (n) n.textContent = periodCaption(); updateFriendsLive(); });
  v.querySelectorAll('[data-member]').forEach(b => b.onclick = () => openMemberModal(b.dataset.member));
  const act = {
    refresh: async () => { const r = await pullMembers({ silent: false }); if (r) { toast('🔄 Groupe actualisé'); rerender(); } },
    invite: openInviteModal,
    push: () => pushProfile({ silent: false }),
    pause: () => {
      if (state.group.paused) return setSharingPaused(false).then(rerender);
      confirmModal('Mettre ton partage en pause ?', 'Tes amis verront la mention « en pause » sur ta fiche et ne recevront plus tes mises à jour jusqu\'à ce que tu reprennes le partage.',
        () => setSharingPaused(true).then(rerender), '⏸️ Mettre en pause', false);
    },
    leave: () => confirmModal('Quitter le groupe ?', 'Ta fiche sera supprimée du groupe en ligne. Tes données locales restent intactes, et tu pourras revenir avec le code d\'invitation.' +
      (isGroupAdmin() ? '<br><br>⚠️ <b>Tu es l\'organisateur</b> : en quittant, tu perds ce rôle et plus personne ne pourra retirer un membre ni fermer le groupe.' : ''),
      async () => { await leaveGroup(); toast('🚪 Tu as quitté le groupe'); rerender(); }, 'Quitter'),
    claim: async () => { if (await claimAdmin({ silent: false })) { await pullMembers(); rerender(); } },
    publish: async () => { try { await publishRelease({ silent: false }); } catch (e) { toast('⚠️ Envoi impossible', esc(e.message)); } },
    lock: async () => {
      const lock = !sync.group?.locked;
      try {
        await setGroupLocked(lock);
        toast(lock ? '🔒 Groupe fermé aux nouveaux membres' : '🔓 Groupe rouvert', lock ? 'Les membres actuels continuent normalement. Le code d\'invitation ne permet plus de rejoindre.' : 'Le code d\'invitation permet à nouveau de rejoindre le groupe.');
        rerender();
      } catch (e) { toast('⚠️ Réglage impossible', esc(e.message)); }
    },
  };
  v.querySelectorAll('[data-fact]').forEach(b => b.onclick = () => act[b.dataset.fact]());
  const saveMe = () => {
    const n = v.querySelector('#gName').value.trim(), e = v.querySelector('#gEmoji').value.trim();
    if (!n) return shake(v.querySelector('#gName'));
    state.group.name = n.slice(0, 40); state.group.emoji = e || '🙂'; save();
    toast('✅ Profil de groupe mis à jour'); rerender();
  };
  v.querySelector('#gName').onchange = saveMe; v.querySelector('#gEmoji').onchange = saveMe;
}

function openInviteModal() {
  const g = state.group;
  const code = makeInvite(g);
  const msg = `Rejoins mon groupe « ${g.groupName} » sur Mon Patrimoine 💰\n1) Décompresse le zip que je t'envoie et lance « Installer Mon Patrimoine »\n2) Ouvre l'app → onglet 👥 Amis → colle ce code :\n\n${code}`;
  const m = modal(`
    <h2>📨 Inviter des amis</h2>
    <p class="muted small" style="margin-top:0;line-height:1.5">Envoie ce code (par WhatsApp, SMS, mail…) avec le zip de l'app. Il permet de lire tout le groupe : ne le partage qu'avec des personnes de confiance.</p>
    <textarea class="input" rows="4" readonly id="iCode">${esc(code)}</textarea>
    <div class="modal-foot">
      <button class="btn left" id="iMsg">💬 Copier le message complet</button>
      <button class="btn btn-primary" id="iCopy">📋 Copier le code</button>
    </div>`);
  m.querySelector('#iCopy').onclick = () => copyText(code, '📋 Code copié', 'Colle-le dans ton message à tes amis.');
  m.querySelector('#iMsg').onclick = () => copyText(msg, '💬 Message copié', 'Il contient les instructions et le code.');
  m.querySelector('#iCode').onclick = e => e.target.select();
}

/* ---------- Fiche détaillée d'un membre ---------- */
function openMemberModal(id) {
  const mem = groupMembers().find(x => x.id === id);
  if (!mem) return;
  const d = mem.data;
  const byCat = d.byCat && typeof d.byCat === 'object' ? d.byCat : {};
  const assets = N(d.assets);
  const accounts = Array.isArray(d.accounts) ? d.accounts.filter(a => a && typeof a === 'object') : [];
  const goals = Array.isArray(d.goals) ? d.goals.filter(Boolean) : [];
  const badgeSet = new Set(Array.isArray(d.badges) ? d.badges : []);
  const catOf = a => (CATS[a.cat] ? a.cat : 'autres');

  const accHTML = Object.keys(CATS).map(k => {
    const list = accounts.filter(a => catOf(a) === k);
    if (!list.length) return '';
    return `<div class="mcat"><div class="cat-head"><span class="dot" style="background:${CATS[k].color}"></span><h4>${CATS[k].emoji} ${CATS[k].label}</h4>
      <span class="total money" style="${CATS[k].debt ? 'color:var(--red)' : ''}">${eur(list.reduce((s, a) => s + N(a.value), 0))}</span></div>
      ${list.map(a => {
        const hs = Array.isArray(a.holdings) ? a.holdings.filter(Boolean) : [];
        return `<div class="macc"><span>${esc(a.emoji || CATS[k].emoji)} ${esc(a.name)} ${hs.length ? '<span class="pill">📡 direct</span>' : ''}
            ${N(a.rate) ? `<span class="small faint">${N(a.rate) > 0 ? '+' : ''}${pct(N(a.rate))}${CATS[k].debt ? '' : '/an'}</span>` : ''}</span><b class="money">${eur(N(a.value))}</b></div>
          ${hs.length ? `<div class="lines nolink">${hs.map(h => `<div class="line">
            <span class="tick">${esc(h.kind === 'crypto' ? String(h.ticker || h.symbol || '').toUpperCase() : h.symbol)}</span>
            <span class="lname">${esc(h.name || '')}</span>
            <span class="muted money">${N(h.qty).toLocaleString('fr-FR', { maximumFractionDigits: 8 })} × ${eur2(N(h.price))}</span>
            <b class="money">${eur(N(h.qty) * N(h.price))}</b>
            <span class="lchg">${changeSpan(h.change == null ? null : N(h.change))}</span>
            <span class="lpl">${plHTML({ pru: N(h.pru), price: N(h.price), qty: N(h.qty) })}</span></div>`).join('')}
            ${N(a.cash) ? `<div class="line"><span class="tick">€</span><span class="lname">Espèces</span><span></span><b class="money">${eur(N(a.cash))}</b><span></span><span></span></div>` : ''}</div>` : ''}`;
      }).join('')}</div>`;
  }).join('');

  const m = modal(`
    <div class="row between"><div class="row"><div style="font-size:44px">${esc(mem.emoji || '🙂')}</div>
      <div><h2 style="margin:0">${esc(mem.name)} ${mem.me ? '<span class="pill">toi</span>' : ''}</h2>
      <div class="small muted">${esc(d.level?.emoji || '')} Niveau ${N(d.level?.idx)} · ${esc(d.level?.name || '')} · ${mem.me ? 'ta fiche en direct' : 'mis à jour ' + agoText(mem.updated_at)}</div></div></div>
      <div class="row">${isGroupAdmin() && !mem.me ? '<button class="btn btn-danger btn-sm" id="mKick">🚫 Retirer du groupe</button>' : ''}
      <button class="icon-btn" id="mClose">✕</button></div></div>
    <div class="grid g4 mt">
      <div class="card kpi"><span class="k-label">💎 Patrimoine net</span><span class="k-value money" id="mNet">${eur(mem.net)}</span><span class="k-sub">devant ~${Math.round(N(d.percentile))} % des ménages</span></div>
      <div class="card kpi"><span class="k-label">📦 Actifs</span><span class="k-value money">${eur(assets)}</span></div>
      <div class="card kpi"><span class="k-label">🧾 Dettes</span><span class="k-value money" style="color:${N(d.debts) ? 'var(--red)' : 'inherit'}">${eur(N(d.debts))}</span></div>
      <div class="card kpi"><span class="k-label">❤️ Santé</span><span class="k-value">${N(d.health)}/100</span><span class="k-sub">revenu passif ≈ ${eur(N(d.passiveYear) / 12)}/mois</span></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><h3>Répartition</h3><div class="donut-wrap"><div id="mDonut"></div><div class="legend" id="mLegend"></div></div></div>
      <div class="card"><h3>Évolution</h3>${periodSegHTML()}<div id="mEvo" style="margin-top:10px"></div>
        <div class="small" id="mStatus" style="margin-top:6px"></div></div>
    </div>
    <div class="card mt"><h3>💼 Patrimoine détaillé</h3>${accHTML || '<div class="faint">Aucun compte.</div>'}</div>
    <div class="grid g2 mt">
      <div class="card"><h3>🎯 Objectifs</h3>${goals.length ? goals.map(x => {
        const pr = clamp(N(x.current) / Math.max(1, N(x.target)), 0, 1);
        return `<div style="margin-bottom:12px"><div class="row between small"><span>${esc(x.emoji || '🎯')} <b>${esc(x.name)}</b></span>
          <span class="money muted">${compact(N(x.current))} / ${compact(N(x.target))}</span></div>
          <div class="progress" style="margin-top:6px"><i style="width:${pr * 100}%;${pr >= 1 ? 'background:var(--green)' : ''}"></i></div>
          ${x.deadline ? `<div class="small faint" style="margin-top:4px">📆 ${fmtDate(x.deadline, true)}</div>` : ''}</div>`;
      }).join('') : '<div class="faint">Aucun objectif.</div>'}</div>
      <div class="card"><h3>🏅 Succès (${badgeSet.size}/${BADGES.length})</h3>
        <div class="mini-badges">${BADGES.map(b => `<span class="${badgeSet.has(b.id) ? '' : 'locked'}" title="${esc(b.name)} — ${esc(b.desc)}">${b.emoji}</span>`).join('')}</div></div>
    </div>`, { cls: 'wide' });
  m.querySelector('#mClose').onclick = closeModal;
  m.querySelector('#mKick')?.addEventListener('click', () => confirmModal(`Retirer ${esc(mem.name)} du groupe ?`,
    `Sa fiche sera supprimée du groupe et son app ne pourra plus partager ni voir les fiches des membres. Ses données restent sur son ordinateur.
     ${sync.group?.locked ? '' : '<br><br>💡 S\'il a gardé le code d\'invitation, il pourrait revenir sous un autre nom : pense à <b>fermer le groupe</b> aux nouveaux membres (onglet Amis, en bas).'}`,
    async () => {
      try { await kickMember(mem.id); toast(`🚫 ${esc(mem.name)} a été retiré du groupe`); rerender(); }
      catch (e) { toast('⚠️ Impossible de retirer ce membre', esc(e.message)); }
    }, 'Retirer du groupe'));

  const segs = ASSET_CATS.map(k => ({ key: k, label: CATS[k].label, value: Math.max(0, N(byCat[k])), color: CATS[k].color })).filter(s => s.value > 0);
  donutChart(m.querySelector('#mDonut'), segs, { center: compact(assets), sub: 'actifs bruts' });
  m.querySelector('#mLegend').innerHTML = segs.sort((a, b) => b.value - a.value).map(s => `
    <div class="legend-item"><i style="background:${s.color}"></i><span>${CATS[s.key].emoji} ${s.label}</span>
    <b class="money">${compact(s.value)}</b><span class="muted small">${assets ? fmtPct.format(s.value / assets * 100) : 0} %</span></div>`).join('');
  memberModalId = id;
  drawMemberEvo(true);
  bindPeriodSeg(m, () => drawMemberEvo(true));
  ensureHistory(keysOf([d]));
}

/* Courbe de la fiche ouverte, tenue à jour avec les cours en direct */
let memberModalId = null;
function drawMemberEvo(animate = false) {
  const evo = document.getElementById('mEvo');
  if (!evo) { memberModalId = null; return; }
  const mem = groupMembers().find(x => x.id === memberModalId);
  if (!mem) return;
  const pts = curvePoints(mem.data);
  if (pts.length >= 2) {
    if (animate || !chartBusy(evo)) lineChart(evo, { series: [{ name: 'Patrimoine net', color: mem.color, area: true, pulse: true, points: pts }], height: 220, animate, ...periodFormats() });
  } else evo.innerHTML = '<div class="empty-chart">Pas encore d\'historique sur cette période.</div>';
  const n = document.getElementById('mNet'); if (n) n.textContent = eur(mem.net);
  const st = document.getElementById('mStatus'); if (st) st.innerHTML = histStatusHTML(keysOf([mem.data]));
}
function updateMemberLive() { if (memberModalId) drawMemberEvo(false); }
