// Çalıştır: node prototype/route-geometry.test.mjs
// Ağ erişimi kullanılmaz. Rotalar gerçek data/routes.json'dan (pathFull) okunur; sentetik çizgiler açıkça ÖRNEK diye işaretli.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  routeBearings, angleDiffDeg, normalizeDeg,
  DEFAULT_BEARING_WINDOW_M, DEFAULT_BEARING_STEP_M, VARIABLE_R_THRESHOLD,
} from './route-geometry.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const data = JSON.parse(readFileSync(new URL('../data/routes.json', import.meta.url), 'utf8'));
const byId = (id) => {
  const r = data.routes.find((x) => x.id === id);
  assert.ok(r?.pathFull, `${id} data/routes.json içinde pathFull ile olmalı`);
  return r;
};
const NEMRUT = byId('tr-guneydogu-anadolu-01');
const EGE = byId('tr-ege-01');
const IC_ANADOLU = byId('tr-ic-anadolu-01');

// ---- Testin kendi bağımsız ölçümü (modülden ayrı yazıldı): parça listesi ve iki nokta arası kiriş yönü ----
const toRad = (d) => (d * Math.PI) / 180;
function hav(a, b) {
  const s = Math.sin(toRad(b[1] - a[1]) / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(toRad(b[0] - a[0]) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
}
function initialBearing(a, b) { // büyük daire başlangıç yönü
  const [l1, p1, l2, p2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
}
function segList(coords) {
  const out = []; let s = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const len = hav(coords[i], coords[i + 1]);
    if (len > 0) out.push({ s0: s, len, a: coords[i], b: coords[i + 1], brg: initialBearing(coords[i], coords[i + 1]) });
    s += len;
  }
  return { segs: out, total: s };
}
function pointAt({ segs }, s) {
  const g = segs.find((x) => s <= x.s0 + x.len) ?? segs.at(-1);
  const t = Math.min(1, Math.max(0, (s - g.s0) / g.len));
  return [g.a[0] + t * (g.b[0] - g.a[0]), g.a[1] + t * (g.b[1] - g.a[1])];
}
const segsIn = ({ segs }, a, b, minLen = 5) => segs.filter((g) => g.s0 < b && g.s0 + g.len > a && g.len >= minLen);

test('pencereler: sM = k·50 m, son pencere çizgi sonunu aşmaz, R ∈ [0,1], bearing ∈ [0,360)', () => {
  assert.equal(DEFAULT_BEARING_WINDOW_M, 200);
  assert.equal(DEFAULT_BEARING_STEP_M, 50);
  assert.equal(VARIABLE_R_THRESHOLD, 0.7);
  for (const r of data.routes.filter((x) => x.pathFull)) {
    const c = r.pathFull.coordinates;
    const { total } = segList(c);
    const w = routeBearings(c);
    assert.equal(w.length, Math.floor((total - 200) / 50 + 1e-9) + 1, `${r.id}: pencere sayısı`);
    w.forEach((x, k) => {
      assert.equal(x.sM, k * 50);
      assert.ok(x.R >= 0 && x.R <= 1, `${r.id} R aralık dışı`);
      assert.ok(x.bearingDeg >= 0 && x.bearingDeg < 360, `${r.id} bearing aralık dışı`);
      assert.equal(x.variable, x.R < 0.7);
    });
    assert.ok(w.at(-1).sM + 200 <= total + 1e-6 && w.at(-1).sM + 250 > total, `${r.id}: son pencere sona yakın`);
  }
});

test('düz kesim (gerçek pathFull): R ≥ 0,99 olan her pencerede yön, pencere uçlarını birleştiren kirişle ±2° içinde', () => {
  let checked = 0;
  for (const r of data.routes.filter((x) => x.pathFull)) {
    const c = r.pathFull.coordinates;
    const sl = segList(c);
    for (const x of routeBearings(c)) {
      if (x.R < 0.99) continue;
      const chord = initialBearing(pointAt(sl, x.sM), pointAt(sl, x.sM + 200));
      assert.ok(angleDiffDeg(x.bearingDeg, chord) < 2, `${r.id} sM=${x.sM}: ${x.bearingDeg.toFixed(1)} vs kiriş ${chord.toFixed(1)}`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `yeterli düz pencere bulunmalı (${checked})`);
});

test('düz kesim: İç Anadolu (Erciyes) pathFull üzerinde en az 1 km kesintisiz R > 0,99 kesim var ve orada R ≈ 1', () => {
  const w = routeBearings(IC_ANADOLU.pathFull.coordinates);
  let run = 0, best = 0, bestEnd = -1;
  w.forEach((x, i) => { run = x.R > 0.99 ? run + 1 : 0; if (run > best) { best = run; bestEnd = i; } });
  assert.ok(best * 50 >= 1000, `en uzun düz kesim ${best * 50} m`);
  const stretch = w.slice(bestEnd - best + 1, bestEnd + 1);
  const meanR = stretch.reduce((s, x) => s + x.R, 0) / stretch.length;
  assert.ok(meanR > 0.995, `ortalama R ${meanR}`);
  assert.ok(stretch.every((x) => !x.variable));
});

test('firkete (gerçek pathFull, Nemrut ve Bozdağ/Ege): variable pencereler var ve gerçekten yön dönüşü içeriyor', () => {
  for (const r of [NEMRUT, EGE]) {
    const c = r.pathFull.coordinates;
    const sl = segList(c);
    const w = routeBearings(c);
    const v = w.filter((x) => x.variable);
    assert.ok(v.length >= 20, `${r.id}: variable pencere sayısı ${v.length}`);
    assert.ok(Math.min(...w.map((x) => x.R)) < 0.3, `${r.id}: en az bir sıkı firkete (R < 0,3) beklenir`);
    let uTurn = 0;
    for (const x of v) {
      // bağımsız kontrol 1 (zorunlu koşul): tüm parça yönleri θ genişliğinde bir yayda ise R ≥ cos(θ/2);
      // R < 0,7 → yön yayılımı > 91°. Penceredeki parça yönlerinin en geniş farkı ≥ 90° olmalı.
      const s = segsIn(sl, x.sM, x.sM + 200, 0);
      let spread = 0;
      for (const g of s) for (const h of s) spread = Math.max(spread, angleDiffDeg(g.brg, h.brg));
      assert.ok(spread >= 90, `${r.id} sM=${x.sM}: yön yayılımı ${spread.toFixed(0)}°`);
      // bağımsız kontrol 2: pencerenin ilk ve son 50 m kirişleri arasında ≥ 90° dönüş (firkete/U viraj)
      const head = initialBearing(pointAt(sl, x.sM), pointAt(sl, x.sM + 50));
      const tail = initialBearing(pointAt(sl, x.sM + 150), pointAt(sl, x.sM + 200));
      if (angleDiffDeg(head, tail) >= 90) uTurn++;
    }
    assert.ok(uTurn / v.length >= 0.5, `${r.id}: variable pencerelerin çoğu firkete olmalı (${uTurn}/${v.length})`);
  }
});

test('variable oranı rota-uzmani ölçümüyle uyumlu (200 m): İç Anadolu en düşük, Nemrut en yüksek; her biri ±1,5 puan', () => {
  // rota-uzmani 2026-11-03 Aşama 3: İç Anadolu 1,5 · Marmara 5,2 · Karadeniz 5,6 · Akdeniz 5,9 · Ege 7,6 · Nemrut 9,3 (%)
  const ref = { 'tr-ic-anadolu-01': 1.5, 'tr-marmara-01': 5.2, 'tr-karadeniz-01': 5.6, 'tr-akdeniz-01': 5.9, 'tr-ege-01': 7.6, 'tr-guneydogu-anadolu-01': 9.3 };
  const pct = {};
  for (const [id, p] of Object.entries(ref)) {
    const w = routeBearings(byId(id).pathFull.coordinates);
    pct[id] = (100 * w.filter((x) => x.variable).length) / w.length;
    assert.ok(Math.abs(pct[id] - p) <= 1.5, `${id}: %${pct[id].toFixed(1)} (rota-uzmani %${p})`);
  }
  assert.equal(Object.entries(pct).sort((a, b) => a[1] - b[1])[0][0], 'tr-ic-anadolu-01');
  assert.equal(Object.entries(pct).sort((a, b) => b[1] - a[1])[0][0], 'tr-guneydogu-anadolu-01');
});

test('359°/1° geçişi (gerçek pathFull): kuzeye giden düz pencerede (parçalar 330°–30°) yön kuzeyde, açı ortalaması ise belirgin yanlış verirdi', () => {
  let found = 0;
  for (const r of [EGE, NEMRUT]) {
    const c = r.pathFull.coordinates;
    const sl = segList(c);
    for (const x of routeBearings(c)) {
      if (x.R < 0.95) continue;
      const s = segsIn(sl, x.sM, x.sM + 200);
      const hasHigh = s.some((g) => g.brg > 350), hasLow = s.some((g) => g.brg < 10);
      if (!hasHigh || !hasLow || s.some((g) => g.brg >= 30 && g.brg <= 330)) continue;
      found++;
      assert.ok(angleDiffDeg(x.bearingDeg, 0) < 30, `${r.id} sM=${x.sM}: ${x.bearingDeg}`);
      const naive = s.reduce((t, g) => t + g.brg, 0) / s.length; // yanlış yöntem: açıların aritmetik ortalaması
      assert.ok(angleDiffDeg(naive, 0) > angleDiffDeg(x.bearingDeg, 0) + 30, `${r.id} sM=${x.sM}: naif ortalama ${naive.toFixed(0)}° kuzeyden belirgin sapmalı`);
    }
  }
  assert.ok(found >= 3, `kuzey geçişli düz pencere bulunmalı (${found})`);
});

test('359°/1° geçişi (ÖRNEK sentetik çizgi): 100 m 359° + 100 m 1° → 0°, R ≈ 1', () => {
  // ÖRNEK: gerçek bir yol değildir; yalnızca açı sarması için.
  const dLat = 100 / 111195; // ~100 m enlem
  const k = Math.cos(toRad(40));
  const p0 = [33, 40];
  const p1 = [p0[0] - (dLat * Math.tan(toRad(1))) / k, p0[1] + dLat];
  const p2 = [p1[0] + (dLat * Math.tan(toRad(1))) / k, p1[1] + dLat];
  const w = routeBearings([p0, p1, p2], { windowM: 200, stepM: 50 });
  assert.equal(w.length, 1);
  assert.ok(angleDiffDeg(w[0].bearingDeg, 0) < 0.1, `yön ${w[0].bearingDeg}`);
  assert.ok(w[0].R > 0.999);
  assert.equal(w[0].variable, false);
});

test('ÖRNEK sentetik U dönüşü: 100 m kuzey + 100 m güney → R ≈ 0, bearing null, variable', () => {
  const d = 100 / 111195;
  const w = routeBearings([[33, 40], [33, 40 + d], [33, 40]]);
  assert.ok(w[0].R < 1e-3);
  assert.equal(w[0].bearingDeg, null);
  assert.equal(w[0].variable, true);
});

test('kısa çizgi, yinelenen nokta, Kemaliye path ve hatalı girdi', () => {
  const d = 50 / 111195;
  const kisa = routeBearings([[33, 40], [33, 40], [33 + d / Math.cos(toRad(40)), 40]]); // ÖRNEK: 50 m doğu, yinelenen nokta
  assert.equal(kisa.length, 1);
  assert.ok(angleDiffDeg(kisa[0].bearingDeg, 90) < 0.5);
  const kem = data.routes.find((x) => x.id === 'tr-dogu-anadolu-01');
  assert.ok(routeBearings(kem.path.coordinates).length > 0, 'pathFull olmayan rotada path ile çalışır (yaklaşık)');
  assert.throws(() => routeBearings([[33, 40]]), TypeError);
  assert.throws(() => routeBearings([[40, 33, 0], ['x', 1]]), TypeError);
  assert.throws(() => routeBearings([[33, 40], [33, 40]]), TypeError);
  assert.throws(() => routeBearings(NEMRUT.pathFull.coordinates, { windowM: 0 }), TypeError);
  assert.throws(() => routeBearings(NEMRUT.pathFull.coordinates, { stepM: -1 }), TypeError);
});

test('pencere uzunluğu seçeneği: 400 m pencerede variable oranı 200 m\'den yüksek, 100 m\'de düşük (Nemrut)', () => {
  const c = NEMRUT.pathFull.coordinates;
  const frac = (o) => { const w = routeBearings(c, o); return w.filter((x) => x.variable).length / w.length; };
  assert.ok(frac({ windowM: 400 }) > frac({ windowM: 200 }));
  assert.ok(frac({ windowM: 100 }) < frac({ windowM: 200 }));
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   - ${t.name}`); }
  catch (e) { failed++; console.log(`FAIL - ${t.name}\n       ${e.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} test geçti`);
if (failed) process.exit(1);
