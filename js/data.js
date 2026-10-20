/* =========================================================
   Mon Patrimoine — données, stockage, calculs
   ========================================================= */
const STORE_KEY = 'monpatrimoine.v1';
/* Version en ligne (téléphone) : servie en https par GitHub Pages, sans relais local */
const WEB_MODE = location.protocol === 'https:' || new URLSearchParams(location.search).has('web');
const WEB_URL = 'https://financecuriousfr.github.io/mon-patrimoine/';
const WEB_RELAY = 'https://dusgoveoivsnzipzucni.supabase.co/functions/v1/cours';
if (WEB_MODE) document.documentElement.classList.add('web');
const APP_VERSION = '2026.10.20-15'; // garder identique à version.txt

const CATS = {
  cash:   { label: 'Comptes courants',      emoji: '💳', color: '#60a5fa', liquid: true },
  livrets:{ label: 'Livrets & épargne',     emoji: '🐷', color: '#34d399', liquid: true },
  bourse: { label: 'Bourse (PEA, CTO)',     emoji: '📈', color: '#a78bfa' },
  av:     { label: 'Assurance-vie & PER',   emoji: '🛡️', color: '#f472b6' },
  immo:   { label: 'Immobilier',            emoji: '🏠', color: '#fbbf24' },
  crypto: { label: 'Crypto',                emoji: '🪙', color: '#fb923c' },
  autres: { label: 'Biens & autres',        emoji: '🚗', color: '#94a3b8' },
  dette:  { label: 'Dettes & crédits',      emoji: '🧾', color: '#f87171', debt: true },
};
const ASSET_CATS = Object.keys(CATS).filter(k => !CATS[k].debt);

/* Modèles d'ajout rapide — taux par défaut modifiables (Livret A/LDDS 1,7 % et LEP 2,5 % au 01/08/2026) */
/* kw : mots-clés pour la recherche (sans accents) */
const TEMPLATES = [
  { name: 'Compte courant', cat: 'cash', emoji: '💳', rate: 0, kw: 'banque courant cheque carte cb depot especes' },
  { name: 'Livret A', cat: 'livrets', emoji: '🐷', rate: 1.7, cap: 22950, kw: 'livret epargne precaution' },
  { name: 'LDDS', cat: 'livrets', emoji: '🌍', rate: 1.7, cap: 12000, kw: 'livret developpement durable solidaire epargne' },
  { name: 'LEP', cat: 'livrets', emoji: '💚', rate: 2.5, cap: 10000, kw: 'livret epargne populaire' },
  { name: 'PEL / CEL', cat: 'livrets', emoji: '🏡', rate: 1.75, kw: 'plan compte epargne logement livret' },
  { name: 'PEA', cat: 'bourse', emoji: '📈', rate: 6, cap: 150000, kw: 'plan epargne actions bourse etf' },
  { name: 'Compte-titres', cat: 'bourse', emoji: '📊', rate: 6, kw: 'cto compte titres bourse actions etf trading' },
  { name: 'Assurance-vie', cat: 'av', emoji: '🛡️', rate: 3.5, kw: 'assurance vie av fonds euros unites de compte' },
  { name: 'PER', cat: 'av', emoji: '🏖️', rate: 5, kw: 'plan epargne retraite' },
  { name: 'Résidence principale', cat: 'immo', emoji: '🏠', rate: 2, kw: 'maison appartement appart logement immobilier rp' },
  { name: 'Locatif', cat: 'immo', emoji: '🏢', rate: 3, kw: 'location investissement locatif appartement immobilier lmnp' },
  { name: 'SCPI', cat: 'immo', emoji: '🏬', rate: 4.5, kw: 'pierre papier immobilier' },
  { name: 'Bitcoin', cat: 'crypto', emoji: '₿', rate: 0, kw: 'btc crypto', track: { kind: 'crypto', symbol: 'bitcoin', ticker: 'btc', name: 'Bitcoin' } },
  { name: 'Ethereum', cat: 'crypto', emoji: '💠', rate: 0, kw: 'eth crypto', track: { kind: 'crypto', symbol: 'ethereum', ticker: 'eth', name: 'Ethereum' } },
  { name: 'Or physique', cat: 'autres', emoji: '🥇', rate: 3, kw: 'lingot piece napoleon metal precieux' },
  { name: 'Véhicule', cat: 'autres', emoji: '🚗', rate: -12, kw: 'voiture auto moto scooter' },
  { name: 'Crédit immo', cat: 'dette', emoji: '🏦', rate: 3.2, payment: 900, kw: 'pret immobilier emprunt dette credit' },
  { name: 'Crédit conso', cat: 'dette', emoji: '🧾', rate: 6, payment: 200, kw: 'pret consommation emprunt dette credit auto' },
  { name: 'Prêt étudiant', cat: 'dette', emoji: '🎓', rate: 1.5, payment: 150, kw: 'pret etudiant emprunt dette credit' },
  { name: 'Portefeuille crypto', cat: 'crypto', emoji: '🪙', rate: 0, kw: 'crypto wallet binance coinbase portefeuille' },
  { name: 'Objet de valeur', cat: 'autres', emoji: '💍', rate: 0, kw: 'montre bijou art collection tableau' },
];

/* Niveaux ludiques */
const LEVELS = [
  { min: -Infinity, name: 'Puceau endetté', emoji: '😭' },
  { min: 0, name: 'Puceau', emoji: '🐣' },
  { min: 1000, name: 'Premier bisou', emoji: '💋' },
  { min: 5000, name: 'Pelle roulée', emoji: '👅' },
  { min: 10000, name: 'Dépucelé', emoji: '🍒' },
  { min: 25000, name: "Coup d'un soir", emoji: '🌙' },
  { min: 50000, name: 'Tombeur', emoji: '😏' },
  { min: 100000, name: 'Étalon', emoji: '🐎' },
  { min: 250000, name: 'Bête de sexe', emoji: '🦍' },
  { min: 500000, name: 'Dieu du sexe', emoji: '🔥' },
  { min: 1000000, name: 'Légende du lit', emoji: '👑' },
  { min: 2500000, name: 'Baiseur planétaire', emoji: '🪐' },
  { min: 5000000, name: 'Baiseur intergalactique', emoji: '🚀' },
];

/* INSEE — distribution du patrimoine NET des ménages, début 2024 (France hors Mayotte) */
const INSEE_NET = [
  [10, 4600], [20, 13200], [30, 34100], [40, 77900], [50, 148100], [60, 224200],
  [70, 317400], [80, 457900], [90, 750400], [95, 1151500], [99, 2728900],
];

const DEFAULT_STATE = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  profile: { name: '', birthYear: 1995, monthlyExpenses: 1800, monthlySavings: 400, inflation: 2, futureRate: 5 },
  settings: { theme: 'dark', privacy: false },
  accounts: [],
  snapshots: [],
  goals: [],
  badges: {},
  flags: { maxLevel: 0 },
  lastBackup: null,
});

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_STATE();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('Lecture impossible', e);
    // On conserve une copie brute pour ne jamais perdre de données
    try { if (raw) localStorage.setItem(STORE_KEY + '.backup-' + Date.now(), raw); } catch {}
    return DEFAULT_STATE();
  }
}
/* Complète un état chargé/importé et convertit les anciens formats */
function migrate(s) {
  const d = DEFAULT_STATE();
  const out = { ...d, ...s, profile: { ...d.profile, ...s.profile }, settings: { ...d.settings, ...s.settings }, flags: { ...d.flags, ...s.flags } };
  out.accounts = (out.accounts || []).map(a => {
    if (a.coin && !a.holdings) {
      const qty = +a.qty || 0;
      const { coin, qty: _q, price, ...rest } = a;
      return qty > 0 ? { ...rest, holdings: [{ id: uid(), kind: 'crypto', symbol: coin, ticker: coin, name: a.name, qty, price: price || (a.value / qty) }] } : rest;
    }
    return a;
  });
  return out;
}
/* Écriture seule (utilisée aussi pour les métadonnées de synchro) */
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; }
  catch (e) { console.error(e); toast('⚠️ Sauvegarde impossible', 'Le stockage local est indisponible.'); return false; }
}
/* Sauvegarde + prévient les abonnés (ex : partage avec le groupe d'amis) */
/* auto : enregistrement automatique (cours, photo du jour, succès…) ; sinon c'est une vraie
   modification de l'utilisateur, datée dans editAt pour la synchro entre PC et téléphone */
function save({ auto = false } = {}) {
  // Une fenêtre vide ne doit jamais écraser des données plus récentes d'une autre fenêtre
  if (typeof adoptNewerStored === 'function') adoptNewerStored();
  state.savedAt = new Date().toISOString();
  if (!auto || !state.editAt) state.editAt = Date.now();
  // Journal de composition (versements, achats, ventes…) pour des courbes exactes
  if (typeof recordComposition === 'function') recordComposition();
  if (!persist()) return;
  if (typeof onStateSaved === 'function') onStateSaved();
  if (typeof onFileSave === 'function') onFileSave();
  if (typeof onBackupSave === 'function') onBackupSave(auto);
}

/* ---------- Utilitaires ---------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const todayISO = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtEUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtEUR2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fmtPct = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const eur = v => fmtEUR.format(Math.round(v || 0));
const eur2 = v => fmtEUR2.format(v || 0);
const pct = v => fmtPct.format(v || 0) + ' %';
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + eur(Math.abs(v));
function compact(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + fmtPct.format(a / 1e6) + ' M€';
  if (a >= 1e3) return s + fmtNum.format(a / 1e3) + ' k€';
  return s + fmtNum.format(a) + ' €';
}
function fmtMonths(m) {
  if (!isFinite(m)) return '∞';
  if (m < 1) return "moins d'un mois";
  const y = Math.floor(m / 12), r = Math.round(m % 12);
  if (y === 0) return `${r} mois`;
  return r ? `${y} an${y > 1 ? 's' : ''} ${r} mois` : `${y} an${y > 1 ? 's' : ''}`;
}
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function fmtDate(iso, long) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return long ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
              : `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

/* Saisie souple : "12 500", "12,5k", "1.2M", "1200+350-50" */
function parseAmount(input) {
  if (typeof input === 'number') return input;
  let s = String(input || '').trim().toLowerCase().replace(/€/g, '').replace(/[\s  ]/g, '');
  if (!s) return 0;
  s = s.replace(/,/g, '.').replace(/(\d+(?:\.\d+)?)k/g, '($1*1000)').replace(/(\d+(?:\.\d+)?)m/g, '($1*1000000)');
  if (!/^[0-9+\-*/().]+$/.test(s)) return NaN;
  try {
    const v = Function('"use strict";return (' + s + ')')();
    return typeof v === 'number' && isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

/* ---------- Calculs ---------- */
/* Bien ou crédit détenu en partie (ex : 50 % en couple) : value = ma part, fullValue = total */
function syncShare(a) {
  if (a.share && a.share < 100) a.fullValue = Math.round(a.value * 100 / a.share * 100) / 100;
}

function totals(accounts = state.accounts) {
  const byCat = {};
  Object.keys(CATS).forEach(k => byCat[k] = 0);
  let assets = 0, debts = 0, yieldYear = 0, debtInterest = 0;
  for (const a of accounts) {
    const v = +a.value || 0;
    byCat[a.cat] = (byCat[a.cat] || 0) + v;
    if (CATS[a.cat]?.debt) { debts += v; debtInterest += v * (+a.rate || 0) / 100; }
    else { assets += v; yieldYear += v * (+a.rate || 0) / 100; }
  }
  const liquid = ASSET_CATS.filter(k => CATS[k].liquid).reduce((s, k) => s + byCat[k], 0);
  return { assets, debts, net: assets - debts, byCat, liquid, yieldYear, debtInterest, passiveYear: yieldYear - debtInterest };
}

function levelFor(net) {
  let idx = 0;
  LEVELS.forEach((l, i) => { if (net >= l.min) idx = i; });
  const cur = LEVELS[idx], next = LEVELS[idx + 1];
  let progress = 1;
  if (next) {
    const lo = isFinite(cur.min) ? cur.min : Math.min(net, -1);
    progress = clamp((net - lo) / (next.min - lo), 0, 1);
  }
  return { idx, cur, next, progress };
}

/* Percentile approximatif parmi les ménages (interpolation linéaire INSEE) */
function frenchPercentile(net) {
  if (net <= 0) return 5;
  const pts = [[5, 0], ...INSEE_NET];
  if (net >= pts[pts.length - 1][1]) return Math.min(99.9, 99 + (net - 2728900) / 5e6);
  for (let i = 1; i < pts.length; i++) {
    const [p1, v1] = pts[i - 1], [p2, v2] = pts[i];
    if (net <= v2) return p1 + (p2 - p1) * (net - v1) / (v2 - v1);
  }
  return 99;
}

function healthScore(t = totals()) {
  const p = state.profile;
  const exp = Math.max(1, +p.monthlyExpenses || 1);
  const months = t.liquid / exp;
  const emergency = clamp(months / 6, 0, 1) * 30;
  const ratio = t.assets > 0 ? t.debts / t.assets : (t.debts > 0 ? 1 : 0);
  const debt = clamp(1 - ratio / 0.8, 0, 1) * 25;
  const shares = ASSET_CATS.map(k => t.assets > 0 ? Math.max(0, t.byCat[k]) / t.assets : 0);
  const hhi = shares.reduce((s, x) => s + x * x, 0);
  const divers = t.assets > 0 ? clamp((1 - hhi) / 0.7, 0, 1) * 25 : 0;
  const avgYield = t.assets > 0 ? t.yieldYear / t.assets * 100 : 0;
  const prod = clamp(avgYield / ((+p.inflation || 2) + 2), 0, 1) * 20;
  return {
    total: Math.round(emergency + debt + divers + prod),
    parts: [
      { label: "Fonds d'urgence", pts: emergency, max: 30, info: `${fmtPct.format(months)} mois de dépenses en liquidités` },
      { label: 'Endettement', pts: debt, max: 25, info: `Dettes = ${fmtPct.format(ratio * 100)} % des actifs` },
      { label: 'Diversification', pts: divers, max: 25, info: `${shares.filter(x => x > 0.05).length} catégorie(s) significative(s)` },
      { label: 'Rendement', pts: prod, max: 20, info: `Rendement moyen estimé ${pct(avgYield)}` },
    ],
    months, avgYield,
  };
}

/* Projection mois par mois. delta = décalage de rendement (scénarios) */
function project({ years = 20, monthly = state.profile.monthlySavings, futureRate = state.profile.futureRate, delta = 0, real = false } = {}) {
  const infl = (+state.profile.inflation || 0) / 100;
  let pots = state.accounts.map(a => ({ v: +a.value || 0, r: (+a.rate || 0) / 100, debt: !!CATS[a.cat]?.debt, pay: +a.payment || 0 }));
  let fresh = 0, contributed = 0;
  const pts = [];
  const now = new Date();
  const net0 = pots.reduce((s, p) => s + (p.debt ? -p.v : p.v), 0);
  pts.push({ m: 0, date: new Date(now), net: net0, contributed: 0 });
  for (let m = 1; m <= years * 12; m++) {
    for (const p of pots) {
      if (p.debt) {
        if (p.v > 0) p.v = Math.max(0, p.v * (1 + p.r / 12) - p.pay);
      } else {
        p.v *= Math.pow(1 + p.r + (p.r !== 0 ? delta : 0), 1 / 12);
      }
    }
    fresh = fresh * Math.pow(1 + futureRate / 100 + delta, 1 / 12) + (+monthly || 0);
    contributed += (+monthly || 0);
    let net = fresh + pots.reduce((s, p) => s + (p.debt ? -p.v : p.v), 0);
    if (real) net /= Math.pow(1 + infl, m / 12);
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    pts.push({ m, date: d, net, contributed });
  }
  return pts;
}

function firstReach(points, target) {
  return points.find(p => p.net >= target) || null;
}

function lastSnapshot() { return state.snapshots[state.snapshots.length - 1] || null; }
function sortedSnapshots() { return [...state.snapshots].sort((a, b) => a.date.localeCompare(b.date)); }

function takeSnapshot({ auto = false } = {}) {
  const t = totals();
  const snap = { date: todayISO(), net: t.net, assets: t.assets, debts: t.debts, byCat: { ...t.byCat }, at: Date.now() };
  if (auto) snap.auto = true;
  const i = state.snapshots.findIndex(s => s.date === snap.date);
  if (i >= 0) state.snapshots[i] = snap; else state.snapshots.push(snap);
  state.snapshots = sortedSnapshots();
  save({ auto });
  return snap;
}

/* Photo automatique : une par jour, tenue à jour (au plus toutes les heures) tant que l'app est ouverte.
   Une photo prise à la main ce jour-là n'est jamais remplacée. */
function autoSnapshot() {
  if (!state.accounts.length) return false;
  if (typeof fileStore !== 'undefined' && typeof LOCAL_KEY !== 'undefined' && LOCAL_KEY && !fileStore.ready) return false;   // sauvegarde pas encore relue
  const cur = state.snapshots.find(s => s.date === todayISO());
  if (cur && !cur.auto) return false;
  if (cur && (Date.now() - (cur.at || 0) < 3600e3 || Math.abs(cur.net - totals().net) < 1)) return false;
  takeSnapshot({ auto: true });
  return true;
}

function goalCurrent(g, t = totals()) {
  if (!g.scope || g.scope === 'net') return t.net;
  if (g.scope.startsWith('cat:')) return t.byCat[g.scope.slice(4)] || 0;
  if (g.scope.startsWith('acc:')) return +(state.accounts.find(a => a.id === g.scope.slice(4))?.value) || 0;
  return 0;
}

/* Données d'exemple pour découvrir l'app */
function demoData() {
  const mk = (tplName, value, extra = {}) => {
    const { track, kw, ...t } = TEMPLATES.find(x => x.name === tplName);
    return { id: uid(), ...t, value, updatedAt: new Date().toISOString(), ...extra };
  };
  const line = (kind, symbol, ticker, name, qty, price, pru) => ({ id: uid(), kind, symbol, ticker, name, qty, price, pru });
  const accounts = [
    mk('Compte courant', 2350, { name: 'Compte courant Boursorama' }),
    mk('Livret A', 22950), mk('LDDS', 6400), mk('LEP', 10000),
    mk('PEA', 31800, { name: 'PEA Bourse', cash: 240, holdings: [
      line('stock', 'CW8.PA', 'CW8.PA', 'Amundi MSCI World', 30, 715, 540),
      line('stock', 'MC.PA', 'MC.PA', 'LVMH', 12, 380, 410),
      line('stock', 'AIR.PA', 'AIR.PA', 'Airbus', 18, 180, 150)] }),
    mk('Assurance-vie', 18500),
    mk('Résidence principale', 245000),
    mk('Bitcoin', 4200, { holdings: [line('crypto', 'bitcoin', 'btc', 'Bitcoin', 0.05, 74000, 52000)] }),
    mk('Véhicule', 9000, { name: 'Clio' }), mk('Crédit immo', 168000, { payment: 980 }),
  ];
  // Prix de départ approximatifs : remplacés par les vrais cours à la première actualisation
  accounts.forEach(a => { if (a.holdings) a.value = Math.round(a.holdings.reduce((s, h) => s + h.qty * h.price, 0) + (a.cash || 0)); });
  const snaps = [];
  const base = new Date();
  let net = 160000;
  for (let i = 11; i >= 1; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 28, 12);
    net += 1400 + Math.round((Math.sin(i * 1.7) + 0.2) * 1800);
    const debts = 168000 + i * 900;
    snaps.push({ date: d.toISOString().slice(0, 10), net, assets: net + debts, debts, byCat: {} });
  }
  return {
    accounts, snapshots: snaps,
    goals: [
      { id: uid(), name: 'Fonds de sécurité', emoji: '🛟', target: 15000, scope: 'cat:livrets', deadline: '' },
      { id: uid(), name: 'Premier million', emoji: '💎', target: 1000000, scope: 'net', deadline: '' },
      { id: uid(), name: 'PEA à 50 k€', emoji: '🚀', target: 50000, scope: 'cat:bourse', deadline: `${base.getFullYear() + 3}-12-31` },
    ],
  };
}

/* Chargement (en dernier : utilise les utilitaires ci-dessus) */
let state = load();
