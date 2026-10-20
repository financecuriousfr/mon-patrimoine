/* =========================================================
   Sauvegarde fiable : les données vivent dans un fichier sur le disque
   (%LOCALAPPDATA%\MonPatrimoine\donnees.json), via le relais local.
   Le stockage du navigateur ne sert plus que de cache : s'il est vidé
   ou revient en arrière, l'app recharge le fichier à l'ouverture.
   ========================================================= */
/* La clé arrive par l'adresse (#cle=…). Une fenêtre restaurée par Edge peut porter une
   ancienne clé : on garde donc aussi la dernière clé valide, et on essaie les deux. */
const KEY_STORE = 'monpatrimoine.cle';
const storedKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
/* Servie par le relais (http://127.0.0.1:47615) : même origine, aucune clé nécessaire */
const SERVED = location.origin === RELAY;
let LOCAL_KEY = SERVED ? 'meme-origine' : (location.hash.match(/cle=([\w-]+)/) || [])[1] || storedKey();
const fileStore = { ready: false, ok: false, timer: null };
const journal = m => { if (SERVED) fetch(`${RELAY}/journal?m=${encodeURIComponent(m)}`).catch(() => {}); };
function keyWorked(k) {
  LOCAL_KEY = k;
  if (SERVED) return;
  try { localStorage.setItem(KEY_STORE, k); } catch {}
  // L'adresse de la fenêtre est corrigée : si Edge la restaure plus tard, elle aura la bonne clé
  if (!location.hash.includes('cle=' + k)) history.replaceState(null, '', location.pathname + location.search + '#cle=' + k);
}

function fileUrl() {
  const p = (new URLSearchParams(location.search).get('profil') || '').replace(/[^\w-]/g, '');
  return `${RELAY}/donnees${p ? '?profil=' + encodeURIComponent(p) : ''}`;
}
async function fileGet() {
  const keys = SERVED ? [LOCAL_KEY] : [...new Set([LOCAL_KEY, storedKey()].filter(Boolean))];
  for (const k of keys) {
    const r = await fetch(fileUrl(), { headers: SERVED ? {} : { 'x-cle-locale': k }, signal: AbortSignal.timeout(4000) });
    if (r.status === 403) continue;                // clé périmée : on essaie la suivante
    if (r.status !== 404 && !r.ok) throw new Error('HTTP ' + r.status);
    keyWorked(k);
    return r.status === 404 ? null : r.json();
  }
  throw Object.assign(new Error('Clé locale refusée'), { denied: true });
}
async function filePut() {
  const r = await fetch(fileUrl(), {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: SERVED ? { 'Content-Type': 'application/json' } : { 'x-cle-locale': LOCAL_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  fileStore.ok = r.ok;
}
const isEmptyState = s => !s || (!(s.accounts || []).length && !s.group && !(s.snapshots || []).length);

/* Au démarrage : on prend la version la plus récente entre le fichier et le navigateur */
async function startFileStore() {
  if (!LOCAL_KEY || fileStore.loading) return;  // ancien lanceur : pas de fichier
  fileStore.loading = true; fileStore.failed = false;
  if (isEmptyState(state) && currentView === 'dashboard') rerender();
  let file, tries = 0;
  for (;;) {                                      // le relais démarre en même temps que l'app
    try { file = await fileGet(); break; }
    catch (e) {
      if (e.denied || ++tries > 40) {             // fenêtre périmée, ou ~25 s sans réponse : on le dit clairement
        fileStore.loading = false; fileStore.failed = true; fileStore.denied = !!e.denied;
        if (currentView === 'dashboard') rerender();
        return;
      }
      await new Promise(r => setTimeout(r, 600));
    }
  }
  fileStore.loading = false;
  const fileNewer = file && !isEmptyState(file) &&
    (isEmptyState(state) || String(file.savedAt || '') > String(state.savedAt || ''));
  if (fileNewer) {
    state = migrate(file);
    persist();
    applyTheme(); applyPrivacy();
    go(currentView);
    if (state.group) { pushProfile(); pullMembers().then(r => { if (r && currentView === 'friends') rerender(); }); }
    toast('💾 Données rechargées depuis ta sauvegarde', state.group ? `Connecté en tant que ${esc(state.group.name)}` : '');
  }
  fileStore.ready = true;
  journal(`app ${APP_VERSION} ouverte : fichier ${file ? (file.accounts || []).length + ' comptes' : 'absent'}, ` +
    `${fileNewer ? 'rechargé' : 'déjà à jour'} → ${state.profile.name || 'sans nom'}, ${state.accounts.length} comptes, groupe ${state.group ? 'oui' : 'non'}`);
  if (!fileNewer && currentView === 'dashboard' && isEmptyState(state)) rerender();
  filePut().catch(() => {});
}

/* Plusieurs fenêtres de l'app ouvertes : quand l'une enregistre, les autres
   reprennent ses données au lieu de les écraser avec un état périmé */
addEventListener('storage', e => {
  if (e.key !== STORE_KEY || !e.newValue) return;
  try {
    const s = JSON.parse(e.newValue);
    if (String(s.savedAt || '') < String(state.savedAt || '')) return;
    state = migrate(s);
    if (!modalOpen()) go(currentView); else updateBrand();
  } catch {}
});

/* Avant chaque enregistrement : si une autre fenêtre a enregistré plus récent, on part de sa version */
function adoptNewerStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (String(s.savedAt || '') > String(state.savedAt || '') && !isEmptyState(s) && isEmptyState(state)) state = migrate(s);
  } catch {}
}

/* Après chaque modification : écriture du fichier (regroupée) */
function onFileSave() {
  if (!fileStore.ready) return;
  clearTimeout(fileStore.timer);
  fileStore.timer = setTimeout(() => filePut().catch(() => {}), 800);
}
