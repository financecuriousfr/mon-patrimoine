/* =========================================================
   Installation sur l'écran d'accueil (version en ligne)
   - Android (Chrome, Samsung Internet, Edge) : l'app pose la question elle-même,
     et sur « Installer » le téléphone affiche sa confirmation d'installation.
   - iPhone / iPad : Apple n'autorise pas l'installation par un site ; l'app montre
     pas à pas où toucher (Partager → « Sur l'écran d'accueil »).
   ========================================================= */
const inst = { prompt: null };
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canInstall = () => WEB_MODE && !isStandalone() && (!!inst.prompt || isIOS());

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();            // on garde la main : c'est l'app qui pose la question, au bon moment
  inst.prompt = e;
});
addEventListener('appinstalled', () => {
  inst.prompt = null;
  state.flags.installed = true; persist();
  toast('✅ App installée', 'Retrouve « Patrimoine » sur ton écran d\'accueil.');
  confetti.burst(100);
});

/* La question, posée une fois (puis de nouveau 5 jours après un « Plus tard ») */
function askInstall({ force = false } = {}) {
  if (!canInstall()) return false;
  const later = state.flags.installLater || 0;
  if (!force && (state.flags.installed || Date.now() - later < 5 * 864e5)) return false;
  if (!force && modalOpen()) return false;
  const m = modal(`
    <div class="install-ask">
      <img src="icon-192.png" alt="" class="install-icon">
      <h2>Installer l'app sur ton téléphone ?</h2>
      <p class="muted">Une icône « Patrimoine » sur ton écran d'accueil : l'app s'ouvre en plein écran, en un geste, comme une vraie app.</p>
    </div>
    <div class="modal-foot"><button class="btn" id="insLater">Plus tard</button><button class="btn btn-primary" id="insGo">📲 Installer</button></div>`, { cls: 'sheet' });
  m.querySelector('#insLater').onclick = () => { state.flags.installLater = Date.now(); persist(); closeModal(); };
  m.querySelector('#insGo').onclick = () => { closeModal(); doInstall(); };
  return true;
}

async function doInstall() {
  if (inst.prompt && !isIOS()) {
    // Android : la fenêtre d'installation du téléphone s'ouvre
    const p = inst.prompt; inst.prompt = null;
    try {
      await p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome === 'accepted') { state.flags.installed = true; persist(); }
      else { state.flags.installLater = Date.now(); persist(); toast('Pas de souci', 'Tu pourras l\'installer plus tard : menu ☰ Plus → 📲 Installer l\'app.'); }
    } catch { showIOSGuide(); }
    return;
  }
  if (isIOS()) return showIOSGuide();
  toast('📲 Installation', 'Dans le menu de ton navigateur, choisis « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».');
}

/* iPhone : flèche animée vers le bouton Partager + étapes */
function showIOSGuide() {
  const ipad = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  document.getElementById('iosGuide')?.remove();
  const d = document.createElement('div');
  d.id = 'iosGuide';
  d.className = `ios-guide ${ipad ? 'top' : 'bottom'}`;
  d.innerHTML = `
    <div class="ios-card">
      <button class="icon-btn ios-close" aria-label="Fermer">✕</button>
      <div class="ios-title">📲 Installer en 3 touches</div>
      <ol>
        <li>Touche <b>Partager</b> <span class="ios-share">⬆︎</span> ${safari ? (ipad ? 'en haut à droite' : 'en bas de l\'écran <span class="muted">(iPhone récent : dans le menu <b>⋯</b> à côté de l\'adresse)</span>') : 'dans la barre d\'adresse'}</li>
        <li>Fais défiler et choisis <b>« Sur l'écran d'accueil »</b> <span class="ios-share">＋</span></li>
        <li>Touche <b>Ajouter</b> en haut à droite</li>
      </ol>
    </div>
    <div class="ios-arrow">${ipad ? '⬆' : '⬇'}</div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.querySelector('.ios-close').onclick = close;
  d.addEventListener('click', e => { if (e.target === d) close(); });
  state.flags.installLater = Date.now(); persist();
}

/* Version en ligne : on propose l'installation peu après l'arrivée (si le patrimoine est déjà là) */
function startInstallOffer() {
  if (!WEB_MODE || isStandalone()) return;
  setTimeout(() => { if (state.accounts.length) askInstall(); }, 9000);
}
