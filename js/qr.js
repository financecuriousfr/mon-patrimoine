/* =========================================================
   Générateur de QR code (mode octets, correction M), sans dépendance.
   Adapté de l'algorithme de référence de Project Nayuki (licence MIT).
   qrSVG(texte) → <svg> prêt à afficher.
   ========================================================= */
const QR = (() => {
  // Correction d'erreur M : codes par bloc et nombre de blocs, versions 1 à 40
  const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_M = 0;
  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC[ver] * BLOCKS[ver];

  // Reed-Solomon dans GF(256), polynôme 0x11D
  function rsMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = rsMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = rsMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, divisor) {
    const r = divisor.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift(); r.push(0);
      divisor.forEach((c, i) => { r[i] ^= rsMul(c, f); });
    }
    return r;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 40; ver++) {
      const ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 40) throw new Error('Texte trop long pour un QR code');
    // Flux de bits : mode octets, longueur, données, terminaison, remplissage
    const bb = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bb.length));
    put(0, (8 - bb.length % 8) % 8);
    for (let pad = 0xEC; bb.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bb.length; i += 8) data.push(parseInt(bb.slice(i, i + 8).join(''), 2));

    // Blocs + correction, entrelacés
    const nb = BLOCKS[ver], eccLen = ECC[ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });

    // Matrice
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (x, y) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2;
      const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      pos.forEach((py, i) => pos.forEach((px, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const drawFormat = mask => {
      const d = FORMAT_M << 3 | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = (d << 10 | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(bits, i));
      setF(8, 7, bit(bits, 6)); setF(8, 8, bit(bits, 7)); setF(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(bits, i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = ver << 12 | rem;
      for (let i = 0; i < 18; i++) { const c = bit(bits, i), a = size - 11 + i % 3, b = Math.floor(i / 3); setF(a, b, c); setF(b, a, c); }
    }
    // Placement en zigzag
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fn[y][x] && k < all.length * 8) { mod[y][x] = bit(all[k >>> 3], 7 - (k & 7)); k++; }
      }
    }
    // Masque : on garde le plus lisible
    const maskFn = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x]; };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const s = penalty(mod, size);
      if (s < bestScore) { bestScore = s; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { size, mod };
  }

  function penalty(mod, size) {
    let p = 0, dark = 0;
    const lines = [];
    for (let i = 0; i < size; i++) { lines.push(mod[i]); lines.push(mod.map(r => r[i])); }
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else { if (run >= 5) p += 3 + run - 5; run = 1; }
      }
      const s = line.map(b => (b ? 1 : 0)).join('');
      for (let i = s.indexOf('1011101'); i >= 0; i = s.indexOf('1011101', i + 1)) {
        if (s.slice(Math.max(0, i - 4), i) === '0000' || s.slice(i + 7, i + 11) === '0000' || i < 4 || i + 11 > size) p += 40;
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (mod[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
    }
    const total = size * size;
    return p + 10 * (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
  }

  /* SVG net (marge de 4 modules, fond blanc obligatoire pour la lecture) */
  function svg(text, px = 260) {
    const { size, mod } = encode(text);
    const n = size + 8;
    let d = '';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" style="background:#fff;border-radius:12px">
      <rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { encode, svg };
})();
