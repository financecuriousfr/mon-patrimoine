/* =========================================================
   Graphiques SVG maison (100 % hors-ligne) + effets
   ========================================================= */
const SVGNS = 'http://www.w3.org/2000/svg';

function niceStep(raw) {
  if (raw <= 0 || !isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/* Tracé lissé (Hermite monotone, Fritsch-Carlson) : courbe douce, sans angles,
   qui ne dépasse jamais les points réels (pas de bosse inventée) */
function smoothPath(pts) {
  const n = pts.length, f = v => v.toFixed(1);
  if (n < 3) return pts.map((p, j) => (j ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join('');
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] > 1e-6 ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const s = 3 / Math.sqrt(h); t[i] = s * a * m[i]; t[i + 1] = s * b * m[i]; }
  }
  let d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (dx[i] <= 1e-6) { d += 'L' + f(x1) + ' ' + f(y1); continue; }
    const h = dx[i] / 3;
    d += `C${f(x0 + h)} ${f(y0 + t[i] * h)} ${f(x1 - h)} ${f(y1 - t[i + 1] * h)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

/* Graphique en cours de lecture (survol ou doigt posé il y a moins de 4 s) : ne pas le redessiner */
const chartBusy = el => !!el && (el.matches(':hover') || Date.now() - (+el.dataset.tipAt || 0) < 4000);

/* Courbe(s) avec infobulle. opts: {series, height, yFmt, xFmt, tipDate, tipFmt, zero, hlines, animate, smooth} */
function lineChart(el, opts) {
  const { series, height = 260, xFmt = d => fmtDate(d), zero = false, hlines = [], animate = true, smooth = true, tipFmt = eur } = opts;
  // Téléphone : graphique moins haut, marges réduites
  const phone = innerWidth <= 860;
  const W = Math.max(phone ? 260 : 320, el.clientWidth || 640), H = phone ? Math.min(height, 230) : height;
  const P = phone ? { l: 50, r: 10, t: 12, b: 26 } : { l: 58, r: 14, t: 14, b: 28 };
  const all = series.flatMap(s => s.points);
  if (!all.length) { el.innerHTML = ''; return; }
  const xs = all.map(p => +p.x), ys = all.map(p => p.y).concat(hlines.map(h => h.y));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 864e5 * 15; x1 += 864e5 * 15; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (zero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  if (y0 === y1) { y0 -= Math.abs(y0 || 1000) * .1; y1 += Math.abs(y1 || 1000) * .1; }
  const step = niceStep((y1 - y0) / 4);
  y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
  // Petits écarts (vue « jour ») : montants précis plutôt que « 22 k€ » répété
  const yFmt = opts.yFmt || (step >= 1000 ? compact : y => fmtNum.format(y) + ' €');
  const sx = x => P.l + (x - x0) / (x1 - x0) * (W - P.l - P.r);
  const sy = y => P.t + (1 - (y - y0) / (y1 - y0)) * (H - P.t - P.b);

  let g = '';
  for (let y = y0; y <= y1 + step / 2; y += step) {
    g += `<line class="grid-line" x1="${P.l}" x2="${W - P.r}" y1="${sy(y)}" y2="${sy(y)}"/>`;
    g += `<text x="${P.l - 8}" y="${sy(y) + 4}" text-anchor="end">${yFmt(y)}</text>`;
  }
  const nT = Math.min(6, Math.max(2, Math.floor((W - 80) / 110)));
  for (let i = 0; i <= nT; i++) {
    const x = x0 + (x1 - x0) * i / nT;
    g += `<text x="${sx(x)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nT ? 'end' : 'middle'}">${xFmt(new Date(x))}</text>`;
  }
  let hl = '';
  for (const h of hlines) {
    if (h.y < y0 || h.y > y1) continue;
    hl += `<line x1="${P.l}" x2="${W - P.r}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${h.color}" stroke-dasharray="6 5" stroke-width="1.5" opacity=".8"/>
           <text x="${W - P.r - 4}" y="${sy(h.y) - 6}" text-anchor="end" fill="${h.color}" font-size="11" font-weight="700">${esc(h.label)}</text>`;
  }
  let paths = '';
  series.forEach((s, i) => {
    const pts = s.points.map(p => [sx(+p.x), sy(p.y)]);
    const d = smooth ? smoothPath(pts) : pts.map((p, j) => (j ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    if (s.area) {
      const base = sy(Math.max(y0, Math.min(0, y1)));
      paths += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
        <path d="${d}L${pts[pts.length - 1][0]} ${base}L${pts[0][0]} ${base}Z" fill="url(#${gid})"/>`;
    }
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.5}" stroke-linejoin="round" stroke-linecap="round"
      ${s.dash ? 'stroke-dasharray="5 5" opacity=".75"' : animate ? 'pathLength="1" class="draw"' : ''}/>`;
    if (s.pulse && pts.length) { const [lx, ly] = pts[pts.length - 1]; paths += `<circle cx="${lx}" cy="${ly}" r="4" fill="${s.color}"/><circle class="pulse" cx="${lx}" cy="${ly}" r="4" fill="none" stroke="${s.color}" stroke-width="2"/>`; }
    if (s.dots) pts.forEach(p => paths += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--surface)" stroke="${s.color}" stroke-width="2"/>`);
  });

  el.classList.add('chart');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">
    <style>.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:drawl 1.1s ease forwards}@keyframes drawl{to{stroke-dashoffset:0}}
      .pulse{transform-box:fill-box;transform-origin:center;animation:pulse 2s ease-out infinite}@keyframes pulse{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(3.2)}}</style>
    <g class="axis">${g}</g>${hl}${paths}
    <line class="cursor" y1="${P.t}" y2="${H - P.b}" stroke="var(--muted)" stroke-width="1" opacity="0"/>
    <g class="cdots"></g>
    <rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent"/>
  </svg><div class="chart-tip"></div>`;

  const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip');
  const cursor = svg.querySelector('.cursor'), cdots = svg.querySelector('.cdots');
  const nearest = (pts, xv) => pts.reduce((b, p) => (Math.abs(+p.x - xv) < Math.abs(+b.x - xv) ? p : b), pts[0]);
  // Souris : survol ; doigt : toucher ou glisser horizontalement sur la courbe (le défilement vertical reste possible)
  const hit = svg.querySelector('.hit');
  hit.style.touchAction = 'pan-y';
  let hideT = null;
  const show = ev => {
    clearTimeout(hideT);
    el.dataset.tipAt = Date.now();   // l'actualisation en direct attend que l'infobulle soit lue
    const r = svg.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / r.width * W;
    const xv = x0 + (mx - P.l) / (W - P.l - P.r) * (x1 - x0);
    // Point le plus proche dans chaque courbe (les courbes peuvent avoir des dates différentes) ;
    // une courbe qui ne couvre pas cet instant n'apparaît pas dans l'infobulle
    const tol = (x1 - x0) * 0.02;
    const hits = series.filter(s => s.points.length && xv >= +s.points[0].x - tol && xv <= +s.points[s.points.length - 1].x + tol)
      .map(s => ({ s, p: nearest(s.points, xv) }));
    if (!hits.length) return;
    const anchor = hits.reduce((b, h) => (Math.abs(+h.p.x - xv) < Math.abs(+b.p.x - xv) ? h : b), hits[0]);
    const px = sx(+anchor.p.x);
    cursor.setAttribute('x1', px); cursor.setAttribute('x2', px); cursor.setAttribute('opacity', '.5');
    let rows = '', dots = '';
    hits.forEach(({ s, p }) => {
      dots += `<circle cx="${sx(+p.x)}" cy="${sy(p.y)}" r="5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      rows += `<div class="t-row"><i style="background:${s.color}"></i>${esc(s.name || '')} <b class="money" style="margin-left:auto">${tipFmt(p.y)}</b></div>`;
    });
    cdots.innerHTML = dots;
    tip.innerHTML = `<div class="muted small" style="margin-bottom:4px">${(opts.tipDate || (d => fmtDate(d, true)))(new Date(+anchor.p.x))}</div>${rows}`;
    tip.style.opacity = 1;
    const tx = px / W * r.width;
    // Au doigt, l'infobulle passe du côté opposé pour ne pas être cachée sous le pouce
    const left = ev.pointerType === 'touch' && tx > r.width / 2 ? tx - tip.offsetWidth - 16 : tx + 12;
    tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(0, left)) + 'px';
    tip.style.top = '8px';
  };
  const hide = () => { tip.style.opacity = 0; cursor.setAttribute('opacity', 0); cdots.innerHTML = ''; };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') hide(); });
  // Au doigt : l'infobulle reste lisible 2,5 s après avoir levé le doigt
  const later = ev => { if (ev.pointerType !== 'mouse') { clearTimeout(hideT); hideT = setTimeout(hide, 2500); } };
  hit.addEventListener('pointerup', later);
  hit.addEventListener('pointercancel', later);
}

/* Donut interactif. segs: [{label, value, color, key}] */
function donutChart(el, segs, { center = '', sub = '', onClick } = {}) {
  const total = segs.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = 74, C = 2 * Math.PI * R;
  let off = 0, arcs = '';
  segs.filter(s => s.value > 0).forEach(s => {
    const len = s.value / total * C;
    const gap = len > 4 ? 2 : 0;
    arcs += `<circle class="arc" data-key="${s.key}" cx="100" cy="100" r="${R}" fill="none" stroke="${s.color}" stroke-width="26"
      stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)"
      style="cursor:pointer;transition:stroke-width .2s"><title>${esc(s.label)} — ${eur(s.value)} (${fmtPct.format(s.value / total * 100)} %)</title></circle>`;
    off += len;
  });
  if (!total) arcs = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--border)" stroke-width="26"/>`;
  el.innerHTML = `<svg viewBox="0 0 200 200" style="width:100%;max-width:200px;display:block;margin:auto">
    ${arcs}
    <text x="100" y="98" text-anchor="middle" font-size="20" font-weight="800" fill="var(--text)" class="money">${center}</text>
    <text x="100" y="118" text-anchor="middle" font-size="11" fill="var(--muted)">${sub}</text>
  </svg>`;
  el.querySelectorAll('.arc').forEach(a => {
    a.addEventListener('mouseenter', () => a.setAttribute('stroke-width', 32));
    a.addEventListener('mouseleave', () => a.setAttribute('stroke-width', 26));
    if (onClick) a.addEventListener('click', () => onClick(a.dataset.key));
  });
}

/* Anneau de score */
function ringSVG(value, max = 100, color = 'url(#ringGrad)') {
  const R = 50, C = 2 * Math.PI * R, len = clamp(value / max, 0, 1) * C;
  return `<svg viewBox="0 0 120 120" width="120" height="120">
    <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
    <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="12"/>
    <circle cx="60" cy="60" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${len} ${C}" transform="rotate(-90 60 60)" style="transition:stroke-dasharray 1s"/>
  </svg>`;
}

/* Compteur animé */
const _anim = new WeakMap();
function animateNumber(el, to, { dur = 900, fmt = eur, from } = {}) {
  if (!el) return;
  const start = from ?? (_anim.get(el) ?? 0);
  const t0 = performance.now();
  _anim.set(el, to);
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(start + (to - start) * e);
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* Confettis */
const confetti = (() => {
  const cv = document.getElementById('confetti');
  const ctx = cv.getContext('2d');
  let parts = [], raf = null;
  const colors = ['#7c5cff', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#fb923c'];
  function resize() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; }
  addEventListener('resize', resize); resize();
  function burst(n = 160) {
    const W = cv.width, H = cv.height;
    for (let i = 0; i < n; i++) {
      const side = i % 2;
      parts.push({
        x: side ? W * .15 : W * .85, y: H * .75,
        vx: (side ? 1 : -1) * (Math.random() * 9 + 3) * devicePixelRatio, vy: -(Math.random() * 16 + 10) * devicePixelRatio,
        s: (Math.random() * 7 + 5) * devicePixelRatio, rot: Math.random() * 6, vr: Math.random() * .3 - .15,
        c: colors[i % colors.length], life: 0, shape: Math.random() > .5,
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach(p => {
      p.vy += .45 * devicePixelRatio; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, 1 - p.life / 160);
      if (p.shape) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, p.s / 3, 0, 7); ctx.fill(); }
      ctx.restore();
    });
    parts = parts.filter(p => p.life < 160 && p.y < cv.height + 50);
    raf = parts.length ? requestAnimationFrame(tick) : (ctx.clearRect(0, 0, cv.width, cv.height), null);
  }
  return { burst };
})();
