/* =========================================================
   Sauvegarde en ligne chiffrée
   - Tout l'état de l'app est chiffré ICI (AES-GCM 256) avant l'envoi.
   - La clé vient d'un secret aléatoire qui ne quitte jamais le PC… sauf dans
     la « clé de secours » que l'utilisateur garde de son côté.
   - Avec la clé de secours, on récupère tout sur un autre PC (même le groupe).
   ========================================================= */
const BACKUP_TABLE = 'patrimoine_backups';
const KIT_PREFIX = 'MPS1.';
const bk = { timer: null, busy: false, error: null };

const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function backupKeys(secret) {
  const idHex = await sha256hex('id:' + secret);
  const raw = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('enc:' + secret)));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { idHex, keyHash: await sha256hex(idHex), key };
}
const backupConf = () => (state.backup?.secret && state.backup.url && state.backup.key ? state.backup : null);
/* Format compact (QR code plus petit) : MPS2.<projet Supabase>.<clé publique>.<secret> */
function makeKit(b) {
  const ref = (String(b.url).match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/) || [])[1];
  if (ref && !String(b.key).includes('.')) return `MPS2.${ref}.${b.key}.${b.secret}`;
  return KIT_PREFIX + b64urlEncode(JSON.stringify({ u: b.url, k: b.key, s: b.secret }));
}
function readKit(code) {
  try {
    code = String(code || '').trim().replace(/\s+/g, '');
    const m2 = code.match(/^MPS2\.([a-z0-9]+)\.([\w-]+)\.([\w-]{30,})$/);
    if (m2) return { url: `https://${m2[1]}.supabase.co`, key: m2[2], secret: m2[3] };
    if (!code.startsWith(KIT_PREFIX)) return null;
    const o = JSON.parse(b64urlDecode(code.slice(KIT_PREFIX.length)));
    const url = normalizeUrl(o.u);
    return url && o.k && String(o.s || '').length >= 30 ? { url, key: String(o.k), secret: String(o.s) } : null;
  } catch { return null; }
}
function bkHeaders(b, idHex, extra = {}) {
  const h = { apikey: b.key, 'x-backup-key': idHex, ...extra };
  if (/^eyJ/.test(b.key)) h.Authorization = 'Bearer ' + b.key;
  return h;
}

/* Activée automatiquement dès qu'on fait partie d'un groupe (le serveur du groupe sert de coffre) */
function ensureBackup() {
  const g = state.group;
  if (state.backup || !g || g.kicked || !state.accounts.length) return;
  state.backup = { secret: randomKey(32), url: g.url, key: g.key, created: new Date().toISOString(), shown: false };
  save({ auto: true });
}

/* ---------- Synchronisation PC ⇄ téléphone ----------
   La sauvegarde chiffrée sert de point de rendez-vous. Sa date (updated_at) est celle de la
   dernière VRAIE modification (editAt) : les mises à jour automatiques (cours, photo du jour…)
   ne prennent jamais le pas sur une saisie faite sur l'autre appareil. */
async function remoteEditAt(b) {
  const { idHex } = await backupKeys(b.secret);
  const r = await fetch(`${b.url}/rest/v1/${BACKUP_TABLE}?select=updated_at`, { headers: bkHeaders(b, idHex), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw await sbError(r);
  const row = (await r.json())[0];
  return row ? Date.parse(row.updated_at) || 0 : null;   // null : aucune sauvegarde encore
}

/* L'autre appareil a des modifications plus récentes : on les reprend */
function adoptRemoteState(remote, b) {
  const keepBackup = { ...state.backup, ...b };
  const before = JSON.stringify([state.accounts.map(a => [a.id, isTracked(a) ? a.holdings.map(h => h.qty).join() : Math.round(+a.value || 0)]), state.goals.length, state.snapshots.length]);
  state = migrate(remote);
  const changed = before !== JSON.stringify([state.accounts.map(a => [a.id, isTracked(a) ? a.holdings.map(h => h.qty).join() : Math.round(+a.value || 0)]), state.goals.length, state.snapshots.length]);
  state.backup = { ...(state.backup || {}), ...keepBackup, secret: b.secret, url: b.url, key: b.key };
  persist();
  if (typeof onFileSave === 'function') onFileSave();
  applyTheme(); applyPrivacy();
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (!modalOpen() && !typing) rerender();
  // Message seulement si quelque chose de visible a changé (pas pour une simple mise à jour des cours)
  if (changed) toast('🔄 Synchronisé', 'Tes modifications faites sur ton autre appareil sont arrivées.');
}

async function syncNow({ manual = false } = {}) {
  const b = backupConf();
  if (!b || bk.busy) return false;
  bk.busy = true;
  try {
    if (!state.editAt) state.editAt = Date.parse(state.savedAt) || Date.now();
    const remote = await remoteEditAt(b);
    // 1) L'autre appareil a modifié plus récemment : on récupère
    if (remote && remote > state.editAt + 500) {
      // Pas pendant une saisie : on reprendra dans un instant (sinon la saisie en cours serait perdue)
      if (modalOpen() || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return false;
      const { data } = await fetchBackup(b);
      adoptRemoteState(data, b);
      b.at = new Date().toISOString(); bk.error = null;
      return true;
    }
    // 2) Sinon on envoie si quelque chose a changé
    const fingerprint = await sha256hex(JSON.stringify({ ...state, backup: { secret: b.secret }, savedAt: null }));
    if (!manual && fingerprint === b.hash && remote && remote >= state.editAt - 500) return true;
    await pushBackup(b, fingerprint);
    if (manual) toast('☁️ Sauvegarde envoyée', 'Chiffrée : personne d\'autre que toi ne peut la lire.');
    return true;
  } catch (e) {
    bk.error = e.message || 'Synchronisation impossible';
    if (manual) toast('⚠️ Sauvegarde impossible', esc(bk.error));
    return false;
  } finally { bk.busy = false; refreshBackupCard(); }
}
const uploadBackup = syncNow;

async function pushBackup(b, fingerprint) {
  const plain = JSON.stringify(state);
  const { idHex, keyHash, key } = await backupKeys(b.secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const r = await fetch(`${b.url}/rest/v1/${BACKUP_TABLE}?on_conflict=key_hash`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: bkHeaders(b, idHex, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ key_hash: keyHash, data: `v1.${b64u(iv)}.${b64u(ct)}`, updated_at: new Date(state.editAt || Date.now()).toISOString() }),
  });
  if (!r.ok) throw await sbError(r);
  b.at = new Date().toISOString(); b.hash = fingerprint; b.size = plain.length; bk.error = null;
  persist();
}

/* Après chaque enregistrement : vraie modification → envoi en 3 s ; automatique → en 1 min */
function onBackupSave(auto = false) {
  if (!backupConf()) return;
  // Un envoi déjà prévu plus tôt n'est jamais repoussé (un enregistrement automatique ne retarde pas une vraie modification)
  const due = Date.now() + (auto ? 60e3 : 3e3);
  if (bk.timer && bk.due <= due) return;
  clearTimeout(bk.timer);
  bk.due = due;
  bk.timer = setTimeout(async () => {
    bk.timer = null;
    if (!(await syncNow())) bk.retry = setTimeout(() => syncNow(), 15e3);   // occupé ou hors ligne : on réessaie
  }, due - Date.now());
}

async function fetchBackup(kit) {
  const { idHex, key } = await backupKeys(kit.secret);
  const r = await fetch(`${kit.url}/rest/v1/${BACKUP_TABLE}?select=data,updated_at`, { headers: bkHeaders(kit, idHex), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw await sbError(r);
  const row = (await r.json())[0];
  if (!row) throw new Error('Aucune sauvegarde trouvée pour cette clé.');
  const [v, iv, ct] = String(row.data).split('.');
  if (v !== 'v1') throw new Error('Format de sauvegarde inconnu.');
  let plain;
  try { plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, key, unb64u(ct))); }
  catch { throw new Error('Clé de secours incorrecte : impossible de déchiffrer.'); }
  return { data: JSON.parse(plain), at: row.updated_at };
}

/* ---------- Interface ---------- */
function showKitModal(first = false) {
  const b = backupConf();
  if (!b) return;
  const kit = makeKit(b);
  const m = modal(`
    <h2>☁️ ${first ? 'Ta sauvegarde en ligne est activée' : 'Ta clé de secours'}</h2>
    <p class="muted small" style="margin-top:0;line-height:1.55">Ton patrimoine est sauvegardé en ligne, <b>chiffré sur ton PC</b> avant l'envoi : personne ne peut le lire,
      pas même l'organisateur du groupe. Si ton PC tombe en panne ou disparaît, cette clé permet de <b>tout récupérer</b> sur un autre PC
      (comptes, historique, groupe d'amis).</p>
    <textarea class="input" rows="3" readonly id="kCode">${esc(kit)}</textarea>
    <div class="insight mt"><div class="ico">🔐</div><p>Garde-la en lieu sûr : gestionnaire de mots de passe, note sur ton téléphone ou mail à toi-même.
      Ne la donne à personne : elle ouvre ta sauvegarde.</p></div>
    <div class="modal-foot">
      <button class="btn left" id="kCopy">📋 Copier la clé</button>
      <button class="btn btn-primary" id="kOk">C'est noté, je l'ai gardée</button>
    </div>`);
  m.querySelector('#kCode').onclick = e => e.target.select();
  m.querySelector('#kCopy').onclick = () => copyText(kit, '📋 Clé de secours copiée', 'Colle-la dans ton gestionnaire de mots de passe.');
  m.querySelector('#kOk').onclick = () => { b.shown = true; persist(); closeModal(); };
}

/* Restauration (aussi utilisée à la première ouverture sur le téléphone, clé passée par le QR code) */
function openRestoreModal(prefill = '') {
  const here = WEB_MODE ? 'ce téléphone' : 'ce PC';
  const m = modal(`
    <h2>${prefill ? '📱 Ton patrimoine arrive' : '☁️ Restaurer une sauvegarde en ligne'}</h2>
    <p class="muted small" style="margin-top:0">${prefill ? 'Clé de secours reçue par le QR code.' : 'Colle ta clé de secours (elle commence par « MPS »).'}</p>
    <textarea class="input" rows="3" id="rCode" placeholder="MPS1.eyJ1Ijoi…" ${prefill ? 'hidden' : ''}>${esc(prefill)}</textarea>
    <div id="rInfo" class="small mt"></div>
    <div class="modal-foot"><button class="btn left" id="rCancel">Annuler</button><button class="btn btn-primary" id="rGo">Chercher ma sauvegarde</button></div>`);
  m.querySelector('#rCancel').onclick = closeModal;
  const go1 = async () => {
    const raw = m.querySelector('#rCode').value.trim();
    const kit = readKit(raw);
    if (!kit) {
      m.querySelector('#rCode').hidden = false;
      // Erreur fréquente : le code d'invitation du groupe à la place de la clé de secours
      m.querySelector('#rInfo').innerHTML = /^MP1\./.test(raw)
        ? `<div class="m-warn">⚠️ Ça, c'est le <b>code d'invitation du groupe</b>, pas ta clé de secours.<br>
           Ta clé est dans l'app de ton ordi : <b>Réglages → Sauvegarde en ligne chiffrée → 🔑 Ma clé de secours</b> (elle commence par « MPS »).</div>`
        : raw ? '<div class="m-warn">⚠️ Clé non reconnue : elle commence par « MPS1. » ou « MPS2. ». Copie-la en entier.</div>' : '';
      return shake(m.querySelector('#rCode'));
    }
    const btn = m.querySelector('#rGo');
    btn.disabled = true; btn.textContent = '⏳ Déchiffrement…';
    try {
      const { data, at } = await fetchBackup(kit);
      const s = migrate(data);
      m.querySelector('#rInfo').innerHTML = `<div class="restore-ok">✅ <b>${esc(s.profile.name || 'Patrimoine')}</b> · ${eur(s.accounts.reduce((t, a) => t + (CATS[a.cat]?.debt ? -1 : 1) * (+a.value || 0), 0))}<br>
        <span class="muted">${s.accounts.length} compte(s), ${s.snapshots.length} photo(s)${s.group ? `, groupe « ${esc(s.group.groupName)} »` : ''} · sauvegardé le ${fmtDate(at, true)}</span></div>
        ${state.accounts.length ? `<div class="m-warn small mt">⚠️ Les données actuelles de ${here} seront remplacées.</div>` : ''}`;
      btn.disabled = false; btn.textContent = '♻️ Récupérer mon patrimoine';
      btn.onclick = () => {
        state = s;
        state.backup = { ...(state.backup || {}), secret: kit.secret, url: kit.url, key: kit.key, shown: true };
        save({ auto: true }); closeModal();   // garde la date de modification d'origine : rien à renvoyer
        applyTheme(); applyPrivacy(); go('dashboard');
        if (state.group) { pushProfile(); pullMembers(); }
        setTimeout(() => { kickLive(); refreshPrices({ silent: true }).then(() => { if (!modalOpen()) rerender(); }); }, 300);
        toast('♻️ Patrimoine récupéré', WEB_MODE ? 'Tes modifications se synchronisent avec ton PC.' : 'Tout est revenu, groupe compris.'); confetti.burst(120);
        if (WEB_MODE) setTimeout(showInstallTip, 2500);
      };
    } catch (e) {
      m.querySelector('#rInfo').innerHTML = `<span class="down">⚠️ ${esc(e.message)}</span>`;
      m.querySelector('#rCode').hidden = false;
      btn.disabled = false; btn.textContent = 'Chercher ma sauvegarde';
    }
  };
  m.querySelector('#rGo').onclick = go1;
  if (prefill) go1();
}

/* ---------- Ouvrir l'app sur le téléphone (QR code avec la clé, jamais envoyée sur internet) ---------- */
function openPhoneModal() {
  const b = backupConf();
  if (!b) {
    const m = modal(`<h2>📱 Sur ton téléphone</h2>
      <p class="muted" style="line-height:1.55">Pour retrouver ton patrimoine sur ton téléphone, la sauvegarde en ligne chiffrée doit être active :
        elle s'active toute seule dès que tu fais partie d'un groupe d'amis (onglet 👥 Amis).</p>
      <div class="modal-foot"><button class="btn btn-primary" id="pOk">OK</button></div>`);
    m.querySelector('#pOk').onclick = closeModal;
    return;
  }
  syncNow();
  const link = `${WEB_URL}#kit=${makeKit(b)}`;
  const m = modal(`<h2>📱 Ton patrimoine sur ton téléphone</h2>
    <div class="phone-qr">
      <div class="qr-box">${QR.svg(link, 280)}</div>
      <ol class="steps phone-steps">
        <li>Ouvre l'<b>appareil photo</b> de ton téléphone et vise le QR code.</li>
        <li>Touche le lien qui apparaît : ton patrimoine s'affiche, déjà synchronisé.</li>
        <li>Installe l'app : <b>iPhone</b> → bouton Partager <span class="kbdish">⬆️</span> → « Sur l'écran d'accueil ».
          <b>Android</b> → menu <span class="kbdish">⋮</span> → « Installer l'application ».</li>
      </ol>
    </div>
    <div class="insight mt"><div class="ico">🔐</div><p>Ce QR code contient ta clé de secours : ne le montre à personne. Elle reste dans le lien (après le « # ») et n'est jamais envoyée à un serveur.</p></div>
    <div class="modal-foot"><button class="btn left" id="pCopy">📋 Copier le lien</button><button class="btn btn-primary" id="pOk">C'est fait</button></div>`);
  m.querySelector('#pCopy').onclick = () => copyText(link, '📋 Lien copié', 'Envoie-le-toi (il contient ta clé : seulement à toi).');
  m.querySelector('#pOk').onclick = closeModal;
}

/* Conseil d'installation sur l'écran d'accueil (une fois, si pas déjà installée) */
function showInstallTip() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || state.flags.installTip) return;
  state.flags.installTip = true; persist();
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const m = modal(`<h2>📲 Installe l'app sur ton écran d'accueil</h2>
    <p class="muted" style="line-height:1.55">Elle s'ouvrira en plein écran, comme une vraie app, avec son icône.</p>
    <div class="notes">${ios
      ? '<div>1. Touche le bouton <b>Partager</b> ⬆️ en bas de Safari</div><div>2. Choisis <b>« Sur l\'écran d\'accueil »</b></div><div>3. Touche <b>Ajouter</b></div>'
      : '<div>1. Touche le menu <b>⋮</b> en haut à droite de Chrome</div><div>2. Choisis <b>« Installer l\'application »</b> (ou « Ajouter à l\'écran d\'accueil »)</div>'}</div>
    <div class="modal-foot"><button class="btn btn-primary" id="iOk">Compris</button></div>`);
  m.querySelector('#iOk').onclick = closeModal;
}

function backupCardInner() {
  const b = backupConf();
  if (!b) return `<p class="small muted" style="margin-top:0;line-height:1.5">La sauvegarde en ligne s'active toute seule quand tu fais partie d'un groupe d'amis
      (le serveur du groupe sert de coffre-fort, ta sauvegarde y est chiffrée).</p>
    <div class="row wrap"><button class="btn" data-bk="restore">♻️ Restaurer avec une clé de secours</button></div>`;
  return `<p class="small muted" style="margin-top:0;line-height:1.5">Chiffrée sur cet appareil avant l'envoi, synchronisée toute seule entre ton PC et ton téléphone.
      Dernière synchro : <b>${b.at ? `${fmtDate(b.at, true)} (${agoText(b.at)})` : 'en attente'}</b>
      ${bk.error ? `<br><span class="down">⚠️ ${esc(bk.error)}</span>` : ''}</p>
    <div class="row wrap">
      <button class="btn btn-primary" data-bk="kit">🔑 Ma clé de secours</button>
      <button class="btn" data-bk="now">☁️ Sauvegarder maintenant</button>
      <button class="btn" data-bk="restore">♻️ Restaurer</button>
    </div>
    ${b.shown ? '' : '<div class="small m-warn mt">⚠️ Tu n\'as pas encore confirmé avoir gardé ta clé de secours.</div>'}`;
}
function bindBackupCard(root) {
  root.querySelectorAll('[data-bk]').forEach(btn => btn.onclick = () => {
    if (btn.dataset.bk === 'kit') showKitModal();
    else if (btn.dataset.bk === 'now') uploadBackup({ manual: true });
    else openRestoreModal();
  });
}
function refreshBackupCard() {
  const c = document.getElementById('backupCard');
  if (c) { c.innerHTML = backupCardInner(); bindBackupCard(c); }
}

function startBackup() {
  // Ouverture depuis le QR code : la clé est dans l'adresse (#kit=…), on l'en retire aussitôt
  const m = location.hash.match(/kit=(MPS[12]\.[\w.-]+)/);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => openRestoreModal(m[1]), 400);
  }
  // Synchronisation : au démarrage, régulièrement, et dès qu'on revient sur l'app
  setTimeout(() => {
    ensureBackup();
    const b = backupConf();
    if (!b) return;
    syncNow();
    if (!b.shown && !WEB_MODE && !modalOpen()) showKitModal(true);
  }, WEB_MODE ? 1500 : 15000);
  setInterval(() => { if (!document.hidden) syncNow(); }, WEB_MODE ? 30e3 : 60e3);
  const wake = () => { if (!document.hidden && backupConf()) syncNow(); };
  addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
}
