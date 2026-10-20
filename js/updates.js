/* =========================================================
   Mises à jour automatiques via le groupe
   - L'organisateur : à l'ouverture, si son app est plus récente que la dernière
     version publiée, elle la publie dans le groupe (fichiers de l'app).
   - Les membres : l'app vérifie au démarrage puis toutes les 30 min, télécharge
     la nouvelle version, le relais local l'installe et l'app redémarre.
   ========================================================= */
const RELEASE_NOTES = `📱 L'app sur ton téléphone ! Bouton « 📱 Sur mon téléphone » (menu de gauche) : scanne le QR code
🔄 Synchronisation automatique entre ton PC et ton téléphone (chiffrée)
👆 Graphiques lisibles au doigt, fil du groupe plus compact
⚡ Plus de « clignotement » de l'écran quand les cours se mettent à jour`;
const UPD = { busy: false, lastCheck: 0, available: null, blocked: false };
const RELEASES = 'patrimoine_releases';

const relayHeaders = (extra = {}) => (typeof SERVED !== 'undefined' && SERVED) ? extra : { 'x-cle-locale': LOCAL_KEY, ...extra };

async function sbLatestRelease(g, withFiles = false) {
  const cols = withFiles ? 'version,notes,files' : 'version,notes,created_at';
  const r = await fetch(`${g.url}/rest/v1/${RELEASES}?select=${cols}&order=version.desc&limit=1`,
    { headers: sbHeaders(g), signal: AbortSignal.timeout(withFiles ? 90000 : 15000) });
  if (!r.ok) throw await sbError(r);
  return (await r.json())[0] || null;
}

/* ---------- Organisateur : publication ---------- */
async function publishRelease({ silent = true } = {}) {
  const g = state.group;
  if (!g || !isGroupAdmin()) return false;
  const r = await fetch(`${RELAY}/maj/paquet`, { headers: relayHeaders(), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Relais sans mises à jour (relance l\'app)');
  const pkg = await r.json();
  // On ne publie que ce qui tourne vraiment (fichiers du disque = version de cette fenêtre)
  if (pkg.version !== APP_VERSION) throw new Error(`Les fichiers (${pkg.version}) ne correspondent pas à cette fenêtre (${APP_VERSION}) : relance l'app`);
  const res = await sbJSON(g, 'POST', RELEASES, { group_hash: await sha256hex(g.groupKey), version: pkg.version, notes: RELEASE_NOTES, files: pkg.files });
  if (!res.ok) { const e = await sbError(res); if (!e.conflict) throw e; }
  // Ménage : on garde les 3 dernières versions publiées
  try {
    const list = await (await fetch(`${g.url}/rest/v1/${RELEASES}?select=version&order=version.desc`, { headers: sbHeaders(g) })).json();
    const old = (list || []).slice(3).map(x => x.version);
    if (old.length) await sbJSON(g, 'DELETE', `${RELEASES}?version=in.(${old.map(encodeURIComponent).join(',')})`);
  } catch {}
  if (!silent) toast(`📦 Version ${pkg.version} envoyée au groupe`, 'Les apps de tes amis vont l\'installer toutes seules.');
  return true;
}

/* ---------- Membres : vérification et installation ---------- */
async function checkForUpdate({ manual = false } = {}) {
  const g = state.group;
  if (!g || g.kicked || UPD.busy) return;
  UPD.busy = true; UPD.lastCheck = Date.now();
  try {
    const latest = await sbLatestRelease(g);
    if (isGroupAdmin() && (!latest || latest.version < APP_VERSION)) {
      try { await publishRelease({ silent: false }); } catch (e) { console.warn('Publication', e); }
      return;
    }
    if (!latest || latest.version <= APP_VERSION) { if (manual) toast('✅ Ton app est à jour', `Version ${APP_VERSION}`); return; }
    UPD.available = latest.version;
    // Pas pendant une saisie : on réessaie dans une minute
    if (modalOpen() || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { setTimeout(() => checkForUpdate(), 60e3); return; }
    await installRelease(g);
  } catch (e) {
    if (!e.missing && manual) toast('⚠️ Vérification impossible', esc(e.message));
  } finally { UPD.busy = false; updateUpdateBanner(); }
}

async function installRelease(g) {
  toast('⬇️ Mise à jour en cours…', `Version ${UPD.available}`);
  const rel = await sbLatestRelease(g, true);
  if (!rel?.files) throw new Error('Paquet introuvable');
  const r = await fetch(`${RELAY}/maj/appliquer`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: relayHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ version: rel.version, files: rel.files }),
  });
  if (r.status === 404 || r.status === 405) { UPD.blocked = true; return; }   // relais PowerShell : installation manuelle
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Installation refusée');
  try { localStorage.setItem('monpatrimoine.nouveautes', JSON.stringify({ version: rel.version, notes: rel.notes || '' })); } catch {}
  showUpdateOverlay(rel.version);
  // Le relais redémarre avec les nouveaux fichiers : on attend qu'il réponde, puis on recharge
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    await new Promise(res => setTimeout(res, 700));
    try { const p = await (await fetch(`${RELAY}/ping`, { signal: AbortSignal.timeout(1500) })).json(); if (p.appVersion === rel.version || !p.appVersion) break; } catch {}
  }
  location.reload();
}

function showUpdateOverlay(v) {
  const d = document.createElement('div');
  d.className = 'update-overlay';
  d.innerHTML = `<div class="card"><div style="font-size:46px">✨</div><h2>Installation de la version ${esc(v)}</h2><p class="muted">L'app redémarre toute seule…</p></div>`;
  document.body.appendChild(d);
}

/* Après une mise à jour : les nouveautés, une seule fois */
function showReleaseNotes() {
  let n = null;
  try { n = JSON.parse(localStorage.getItem('monpatrimoine.nouveautes') || 'null'); } catch {}
  if (!n || n.version !== APP_VERSION) return;
  try { localStorage.removeItem('monpatrimoine.nouveautes'); } catch {}
  const m = modal(`<h2>✨ Mise à jour installée</h2>
    <p class="muted" style="margin-top:0">Version ${esc(APP_VERSION)}, installée automatiquement.</p>
    <div class="notes">${esc(n.notes).split('\n').map(l => `<div>${l}</div>`).join('')}</div>
    <div class="modal-foot"><button class="btn btn-primary" id="nOk">Trop bien 👌</button></div>`);
  m.querySelector('#nOk').onclick = closeModal;
  confetti.burst(120);
}

/* Relais trop ancien (PowerShell) : il faut réinstaller une fois depuis le zip */
function updateUpdateBanner() {
  document.getElementById('updBanner')?.remove();
  if (!UPD.blocked || !UPD.available) return;
  document.querySelector('.main')?.insertAdjacentHTML('afterbegin', `<div class="test-banner" id="updBanner" style="background:var(--accent)">
    ⬇️ La version ${esc(UPD.available)} est disponible, mais ton app ne peut pas l'installer seule. Demande le dernier zip à l'organisateur du groupe (une seule fois).</div>`);
}

/* Versions des membres (pour l'organisateur) */
function membersVersionsHTML(members) {
  return members.map(m => {
    const v = m.me ? APP_VERSION : m.data.appVersion;
    const ok = v && v >= (UPD.available || APP_VERSION);
    return `<span class="pill ${ok ? 'up' : ''}" title="Version de son app">${esc(m.emoji || '')} ${esc(m.name)} · ${v ? esc(v) : 'ancienne version'} ${ok ? '✅' : '⏳'}</span>`;
  }).join(' ');
}

function startUpdates() {
  if (WEB_MODE) return;   // version en ligne : toujours la dernière, rien à installer
  setTimeout(showReleaseNotes, 1500);
  setTimeout(() => checkForUpdate(), 8000);
  setInterval(() => checkForUpdate(), 30 * 60e3);
  addEventListener('focus', () => { if (Date.now() - UPD.lastCheck > 30 * 60e3) checkForUpdate(); });
}
