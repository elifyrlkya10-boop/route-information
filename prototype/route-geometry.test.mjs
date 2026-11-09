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
const PELION = byId('gr-thessalia-01');
const ANDALUCIA = byId('es-andalucia-01');
const RASTRO = byId('br-santa-catarina-01');

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

// Veri revizyonu: aşağıdaki sayısal beklentiler (oranlar, pencere sayıları) bu geometriye aittir
// (rota-uzmani 2026-11-05 Aşama 1: Nemrut güneye taşındı, Bozdağ çıkıntısı kalktı; 2026-11-07: ilk Yunanistan
// rotası gr-thessalia-01 eklendi, Türkiye geometrisi değişmedi; 2026-11-08 Aşama 1: Pelion başlangıcı Γρηγορίου Λαμπράκη
// doğu şeridine alındı, pathFull'un ilk 0,396 km'si kalktı, eski km − 0,40 = yeni km; 2026-11-09 Aşama 1: ilk İspanya
// rotası es-andalucia-01 eklendi, diğer rotaların geometrisi değişmedi; 2026-11-10 Aşama 1: ilk Brezilya rotası
// br-santa-catarina-01 eklendi, diğer rotaların geometrisi değişmedi). Oran referansı pathFull olan HER rotaya ait
// olduğundan karma da her rota için tutulur. Geometri değişirse test hata mesajında revizyon farkını gösterir;
// beklentiler yeni veriye göre güncellenmeli.
const REF_REVISION = {
  'tr-marmara-01': '222ccde2eeeafa1e6bd31d63852fc74a2f4bfbaf7f799d883a41044fb89fc88a',
  'tr-ege-01': '83dce96f3fcf36cec9f711b86b41af46715f32ccb3837c6a0929b19575771d3a',
  'tr-akdeniz-01': 'a5eea9f154005096f75cfbbece326d621c67fa10c472223275c775faf17acca4',
  'tr-ic-anadolu-01': '4d33b887f775b3189acf4c1d0d576a39bf7def64c76be718c53640a5f5ae5603',
  'tr-karadeniz-01': '1d8374534393145ca16a32b3311ae5a4615c90acf68fdd86edefc30a2329b294',
  'tr-guneydogu-anadolu-01': '3ef5856ff1f860eedab05cb7c3ba07f8fc07bf56ad18daccaec61e007025614f',
  'gr-thessalia-01': 'e06b56502d0d486059fed42b382db92a6d6c72f68bc358831153eb3ff9b7f1e4', // rota-uzmani 2026-11-08
  'es-andalucia-01': '90ff0306362241e16f9134c1428dfc87f514a370a57eb68dc0679210bb3b1b61', // rota-uzmani 2026-11-09
  'br-santa-catarina-01': 'f58eb0ff44cb2d145443b13b4df2e00de313fad77d4a67c05cff92f88caee4e7', // rota-uzmani 2026-11-10
};
const revNote = (r) => (REF_REVISION[r.id] && r.geometryRevision?.pathFullSha256 !== REF_REVISION[r.id]
  ? ` [UYARI: ${r.id} pathFull revizyonu değişmiş (${r.geometryRevision?.pathFullSha256?.slice(0, 12) ?? 'yok'}); test beklentileri eski geometriye ait]` : '');
const KARADENIZ = byId('tr-karadeniz-01');
const PATHFULL_ROUTES = data.routes.filter((x) => x.pathFull);

test('firkete (gerçek pathFull): her rotada variable pencereler gerçekten yön dönüşü içeriyor; Bozdağ ve Karadeniz sıkı firketeli, Nemrut (güney) daha az', () => {
  // Rota başına en az beklentiler (2026-11-05 geometrisi). Nemrut güney yaklaşımı (Karadut) kuzey yoluna göre
  // çok daha az firketeli: 15 variable pencere, en düşük R 0,41 — bu yüzden onun eşiği ayrı ve gerçek değere göre.
  const expect = {
    'tr-ege-01': { minVariable: 20, maxMinR: 0.3 },
    'tr-karadeniz-01': { minVariable: 20, maxMinR: 0.3 },
    'tr-guneydogu-anadolu-01': { minVariable: 10, maxMinR: 0.5 },
    // Pelion (2026-11-08 geometrisi): 133 variable pencere, en düşük R 0,092. Bu sayıya Volos şehir içi kavşaklar
    // (km 0–5,4; 15 pencere) dahildir; firkete sayımı şehir içi hariç ayrı testte.
    'gr-thessalia-01': { minVariable: 100, maxMinR: 0.15 },
    // Sierra de Grazalema (2026-11-09 geometrisi): 56 variable pencere, en düşük R 0,128 (testin kendi ölçümü, rota-uzmani ile aynı).
    'es-andalucia-01': { minVariable: 45, maxMinR: 0.2 },
    // Serra do Rio do Rastro (2026-11-10 geometrisi): 55 variable pencere, en düşük R 0,088 (sM 18950; testin kendi
    // ölçümü, rota-uzmani ile aynı).
    'br-santa-catarina-01': { minVariable: 45, maxMinR: 0.15 },
  };
  for (const r of PATHFULL_ROUTES) {
    const c = r.pathFull.coordinates;
    const sl = segList(c);
    const w = routeBearings(c);
    const v = w.filter((x) => x.variable);
    const e = expect[r.id];
    if (e) {
      assert.ok(v.length >= e.minVariable, `${r.id}: variable pencere sayısı ${v.length} (beklenen ≥ ${e.minVariable})${revNote(r)}`);
      const minR = Math.min(...w.map((x) => x.R));
      assert.ok(minR < e.maxMinR, `${r.id}: en düşük R ${minR.toFixed(3)} (beklenen < ${e.maxMinR})${revNote(r)}`);
    }
    if (!v.length) continue;
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

test('Bozdağ (Ege) eski yapay U dönüşü kalktı: kavşak çevresinde (pathFull km 26,5–27,5) variable pencere yok', () => {
  // rota-uzmani 2026-11-04: km 26,64–26,92'deki gidip-dönen çıkıntı firkete örneği sayılmamalı. 2026-11-05'te
  // ara nokta kavşak node 2122980385'e (yeni pathFull km 26,98) alındı. Çıkıntı geri gelirse burada variable çıkar.
  const v = routeBearings(EGE.pathFull.coordinates).filter((x) => x.variable && x.sM + 200 > 26500 && x.sM < 27500);
  assert.deepEqual(v.map((x) => x.sM), [], `Ege kavşak çevresinde variable pencere: ${v.map((x) => `${x.sM}(R ${x.R.toFixed(2)})`).join(', ')}${revNote(EGE)}`);
});

test('variable oranı (200 m) rota-uzmani ölçümüyle uyumlu (±0,5 puan); Türkiye içinde Nemrut en düşük, Ege en yüksek; Pelion > 2 × Türkiye en yüksek', () => {
  // rota-uzmani 2026-11-05 Aşama 1 (Türkiye, yeni geometri): Marmara 5,97 · Ege 7,32 · Akdeniz 5,47 · İç Anadolu 1,96 · Karadeniz 5,35 · Nemrut 1,73 (%)
  // rota-uzmani 2026-11-08 Aşama 1 (Yunanistan, yeni başlangıç): Pelion (gr-thessalia-01) 14,81 (898 pencerenin 133'ü;
  // 2026-11-07 geometrisinde 15,12, 906 pencerenin 137'si).
  // rota-uzmani 2026-11-09 Aşama 1 (İspanya): Sierra de Grazalema (es-andalucia-01) 8,87 (631 pencerenin 56'sı; testin
  // kendi ölçümü %8,875, aynı).
  // rota-uzmani 2026-11-10 Aşama 1 (Brezilya): Serra do Rio do Rastro (br-santa-catarina-01) 8,73 (630 pencerenin 55'i;
  // testin kendi ölçümü %8,730, aynı).
  // Eski referans (2026-11-03, kuzey Nemrut 9,3 · Ege 7,6) eski geometriye aitti. Değerler bu modülle aynı yöntemden
  // geldiği için tolerans ±0,5 puan.
  // Sıralama beklentisi ülke başınadır: "Türkiye içinde en düşük/en yüksek" iddiası, yeni ülke rotaları eklendikçe
  // bozulmamalı (Türkiye verisi değişmeden bu test kırılmasın); ülkeler arası karşılaştırma ayrı, açık bir iddia.
  const ref = {
    tr: { 'tr-ic-anadolu-01': 1.96, 'tr-marmara-01': 5.97, 'tr-karadeniz-01': 5.35, 'tr-akdeniz-01': 5.47, 'tr-ege-01': 7.32, 'tr-guneydogu-anadolu-01': 1.73 },
    gr: { 'gr-thessalia-01': 14.81 },
    es: { 'es-andalucia-01': 8.87 },
    br: { 'br-santa-catarina-01': 8.73 },
  };
  const all = Object.assign({}, ...Object.values(ref));
  const pct = {};
  for (const [id, p] of Object.entries(all)) {
    const r = byId(id);
    const w = routeBearings(r.pathFull.coordinates);
    pct[id] = (100 * w.filter((x) => x.variable).length) / w.length;
    assert.ok(Math.abs(pct[id] - p) <= 0.5, `${id}: %${pct[id].toFixed(2)} (rota-uzmani %${p})${revNote(r)}`);
  }
  assert.deepEqual(Object.keys(all).sort(), PATHFULL_ROUTES.map((r) => r.id).sort(), 'pathFull olan her rota referansta olmalı');
  assert.deepEqual(Object.keys(REF_REVISION).sort(), PATHFULL_ROUTES.map((r) => r.id).sort(), 'pathFull olan her rotanın karması REF_REVISION\'da olmalı');
  for (const [cc, ids] of Object.entries(ref)) {
    assert.ok(Object.keys(ids).every((id) => id.startsWith(`${cc}-`)), `${cc}: id öneki ülkeyle uyumlu`);
  }
  const trOrder = Object.keys(ref.tr).sort((a, b) => pct[a] - pct[b]);
  assert.equal(trOrder[0], 'tr-guneydogu-anadolu-01', `Türkiye en düşük: ${trOrder[0]}`);
  assert.equal(trOrder.at(-1), 'tr-ege-01', `Türkiye en yüksek: ${trOrder.at(-1)}`);
  // Yunanistan, İspanya ve Brezilya: her birinde tek rota var, ülke içi sıralama yok. İspanya ve Brezilya için ülkeler
  // arası bir sıralama
  // iddiası eklenmedi (rota-uzmani'nın "Pelion'dan düşük, Ege'den yüksek" gözlemi ölçüldü: 8,87 < 14,81 ve > 7,32, ama
  // başka ülkenin verisine bağlı sıralama, o ülkenin verisi değişince ilgisiz yere kırılır); İspanya'nın kendi geometrisine
  // dayanan beklentileri ayrı testte. Brezilya için de aynı gerekçeyle eklenmedi (rota-uzmani 2026-11-10: "Pelion'dan
  // düşük, Grazalema'dan biraz düşük"; ölçüldü: 8,73 < 14,81 ve < 8,87 — Grazalema farkı 0,15 puan, ±0,5 toleransın
  // içinde, iddia olarak zaten anlamsız). Rio do Rastro'nun beklentileri kendi testinde. Ayrı beklenti: Pelion projedeki en virajlı rota
  // (rota-uzmani 2026-11-07) ve en virajlı Türkiye rotasının (Ege) en az iki katı.
  const trMax = Math.max(...Object.keys(ref.tr).map((id) => pct[id]));
  assert.ok(pct['gr-thessalia-01'] > 2 * trMax, `Pelion %${pct['gr-thessalia-01'].toFixed(2)} > 2 × Türkiye en yüksek %${trMax.toFixed(2)}${revNote(PELION)}`);
});

test('Pelion (gerçek pathFull): firketeler dağ kesiminde (km 5,4 sonrası), şehir içi kavşaklar sayılmadan; way 223719457 firketeli, Portaria–Hania geniş virajlı', () => {
  // Firkete tanımı (testin kendi ölçümü): variable pencere VE pencerenin ilk/son 50 m kirişleri arasında ≥ 150° dönüş;
  // aralarında ≤ 200 m olan pencereler tek firkete sayılır. Volos şehir içi (km 0–5,4; rota-uzmani: "kavşaklar,
  // firkete değil") geometrik olarak benzer U şekilleri verir: sıkı (≥ 150°) pencereler sM 4500 ve 4850–5050, pencere sonu
  // dahil km ~4,5–5,25 (4,50–4,70 ve 4,85–5,25). rota-uzmani'nın "4,4–5,1" aralığı aynı iki kümenin variable pencere
  // BAŞLANGIÇLARIYDI (sM 4400…5150, pencere sonu hariç; rota-uzmani 2026-11-09 cevabı). Bu yüzden geometriyle değil
  // rota-uzmani'nın km sınıflandırmasıyla hariç tutulur. Hariç tutulmasaydı firkete sayısı 2 fazla çıkardı.
  // Sınır 5.800 m kalsaydı km 5,55–5,75'teki 4 dağ tırmanışı penceresi şehir içi sayılırdı (rota-uzmani 2026-11-08).
  const CITY_END_M = 5400;
  const c = PELION.pathFull.coordinates;
  const sl = segList(c);
  const w = routeBearings(c);
  const tight = (from, to) => w.filter((x) => x.variable && x.sM >= from && x.sM + 200 <= to && angleDiffDeg(
    initialBearing(pointAt(sl, x.sM), pointAt(sl, x.sM + 50)),
    initialBearing(pointAt(sl, x.sM + 150), pointAt(sl, x.sM + 200)),
  ) >= 150);
  const clusters = (arr) => arr.reduce((n, x, i) => n + (i === 0 || x.sM - arr[i - 1].sM > 200 ? 1 : 0), 0);
  const mountain = clusters(tight(CITY_END_M, sl.total));
  const city = clusters(tight(0, CITY_END_M));
  // 2026-11-08 geometrisi (testin kendi ölçümü): dağ kesiminde 28 firkete, şehir içinde 2 U şekilli kavşak kümesi.
  assert.ok(mountain >= 20, `Pelion dağ kesimi firkete sayısı ${mountain}${revNote(PELION)}`);
  assert.ok(city > 0 && city < mountain / 4, `şehir içi U şekilleri ${city} (sayıma girmiyor)${revNote(PELION)}`);
  // Aynı ölçüyle her Türkiye rotası (şehir içi ayrımı yapılmadan, tüm çizgi) Pelion dağ kesiminden az firketeli.
  for (const r of PATHFULL_ROUTES.filter((x) => x.id.startsWith('tr-'))) {
    const rc = r.pathFull.coordinates, rsl = segList(rc);
    const t = routeBearings(rc).filter((x) => x.variable && angleDiffDeg(
      initialBearing(pointAt(rsl, x.sM), pointAt(rsl, x.sM + 50)),
      initialBearing(pointAt(rsl, x.sM + 150), pointAt(rsl, x.sM + 200)),
    ) >= 150);
    assert.ok(clusters(t) < mountain, `${r.id}: ${clusters(t)} firkete, Pelion dağ kesimi ${mountain}${revNote(r)}`);
  }
  // rota-uzmani: way 223719457 firketeler km ~8,1–9,3 → en az 2 sıkı firkete (R < 0,3).
  const way = tight(8100, 9300);
  assert.ok(clusters(way) >= 2 && way.some((x) => x.R < 0.3), `km 8,1–9,3 firkete ${clusters(way)}${revNote(PELION)}`);
  // Best Biking Roads sürücü yorumu: Portaria–Hania arası geniş virajlar. km 13,8–25,0 kesiminde variable oranı
  // tırmanışın (km 5,4–13,8) ve Hania inişinin (km 25,6–39,1) yarısından az olmalı.
  const frac = (a, b) => { const s = w.filter((x) => x.sM >= a && x.sM < b); return s.filter((x) => x.variable).length / s.length; };
  const climb = frac(5400, 13800), mid = frac(13800, 25000), descent = frac(25600, 39100);
  assert.ok(mid < climb / 2 && mid < descent / 2, `variable oranı: tırmanış %${(100 * climb).toFixed(1)}, orta %${(100 * mid).toFixed(1)}, iniş %${(100 * descent).toFixed(1)}${revNote(PELION)}`);
});

test('Sierra de Grazalema (gerçek pathFull): firketeler, Palomas–Zahara inişi en virajlı kesim; Zahara içinde variable yok, El Bosque kenarında yalnız km 0,40–0,70', () => {
  // rota-uzmani 2026-11-09: A-372 km 0–15,23 → Puerto del Boyar → km 17,21 CA-9104 → km 20,46 Puerto de las Palomas →
  // firketeli iniş → km 31,0–31,75 Zahara. Şehir içi hariç tutma gerekmiyor (Pelion'daki CITY_END_M benzeri yok):
  // Zahara içinde variable pencere yok; El Bosque kenarındaki tek küme (sM 400–500) A-372'nin kendi way'inde
  // (1475076054) gerçek bir kıvrım, gidip-dönme değil. O way'de OSM fixme="Corregir geometría" var; bu yüzden küme
  // burada açıkça sınırlanır: büyür ya da yer değiştirirse test kırılır ve geometri yeniden gözden geçirilir.
  const c = ANDALUCIA.pathFull.coordinates;
  const sl = segList(c);
  const w = routeBearings(c);
  const turn = (x) => angleDiffDeg(
    initialBearing(pointAt(sl, x.sM), pointAt(sl, x.sM + 50)),
    initialBearing(pointAt(sl, x.sM + 150), pointAt(sl, x.sM + 200)),
  );
  // Firkete tanımı Pelion testiyle aynı: variable VE ilk/son 50 m kirişleri arasında ≥ 150°; ≤ 200 m arayla tek firkete.
  const tight = (from, to) => w.filter((x) => x.variable && x.sM >= from && x.sM + 200 <= to && turn(x) >= 150);
  const clusters = (arr) => arr.reduce((n, x, i) => n + (i === 0 || x.sM - arr[i - 1].sM > 200 ? 1 : 0), 0);
  // 2026-11-09 geometrisi (testin kendi ölçümü, rota-uzmani ile aynı): 9 firkete, sM 450 · 6600–6650 · 8750 ·
  // 16400–16650 · 21300–21350 · 21850–21950 · 22350–22500 · 23150–23200 · 25950–26000; 5'i Palomas inişinde.
  const all = clusters(tight(0, sl.total));
  const descent = clusters(tight(20460, 31000));
  assert.ok(all >= 7, `firkete sayısı ${all}${revNote(ANDALUCIA)}`);
  assert.ok(descent >= 4, `Palomas–Zahara inişi firkete sayısı ${descent}${revNote(ANDALUCIA)}`);
  // İniş firketeleri (km 21,25–23,90): en az bir sıkı pencere R < 0,3.
  assert.ok(tight(21250, 23900).some((x) => x.R < 0.3), `km 21,25–23,90 sıkı firkete yok${revNote(ANDALUCIA)}`);
  // Kesim oranları (pencere tamamen kesim içinde; rota-uzmani'nın tanımı): A-372 %5,65 · Boyar–Palomas %5,94 · iniş %13,57.
  const frac = (a, b) => { const s = w.filter((x) => x.sM >= a && x.sM + 200 <= b); return s.filter((x) => x.variable).length / s.length; };
  const a372 = frac(0, 15230), mid = frac(15230, 20460), down = frac(20460, sl.total);
  assert.ok(down > 2 * a372 && down > 2 * mid, `variable oranı: A-372 %${(100 * a372).toFixed(2)}, Boyar–Palomas %${(100 * mid).toFixed(2)}, iniş %${(100 * down).toFixed(2)}${revNote(ANDALUCIA)}`);
  // Zahara içi (km 30,9–31,75): pencereye değen hiçbir variable pencere yok.
  const zahara = w.filter((x) => x.variable && x.sM + 200 > 30900);
  assert.deepEqual(zahara.map((x) => x.sM), [], `Zahara içinde variable pencere${revNote(ANDALUCIA)}`);
  // El Bosque kenarı (km 0–1,7): variable pencereler yalnız km 0,40–0,70 içinde (sM 400–500, en düşük R 0,31).
  const bosque = w.filter((x) => x.variable && x.sM < 1700);
  assert.ok(bosque.length > 0 && bosque.every((x) => x.sM >= 400 && x.sM + 200 <= 700),
    `El Bosque kenarı variable: ${bosque.map((x) => `${x.sM}(R ${x.R.toFixed(2)})`).join(', ')}${revNote(ANDALUCIA)}`);
});

test('Serra do Rio do Rastro (gerçek pathFull): firketeler beton serra kesiminde; Lauro Müller–Guatá, zirve ve plato variable değil', () => {
  // rota-uzmani 2026-11-10: SC-390 Lauro Müller (km 0) → Guatá km 3,96–4,38 → vadi km 4,38–14,92 → serra tırmanışı
  // (beton) km 14,92–21,35 → zirve/mirante km 21,35–23,04 → plato km 23,04–31,65 (Bom Jardim da Serra girişi).
  // Şehir içi hariç tutma gerekmiyor: Lauro Müller, Guatá ve Bom Jardim girişinde variable pencere yok (aşağıda sınanıyor).
  const c = RASTRO.pathFull.coordinates;
  const sl = segList(c);
  const w = routeBearings(c);
  const turn = (x) => angleDiffDeg(
    initialBearing(pointAt(sl, x.sM), pointAt(sl, x.sM + 50)),
    initialBearing(pointAt(sl, x.sM + 150), pointAt(sl, x.sM + 200)),
  );
  // Firkete tanımı Pelion/Grazalema testleriyle aynı: variable VE ilk/son 50 m kirişleri arasında ≥ 150°; ≤ 200 m arayla tek firkete.
  const tight = (from, to) => w.filter((x) => x.variable && x.sM >= from && x.sM + 200 <= to && turn(x) >= 150);
  const clusters = (arr) => arr.reduce((n, x, i) => n + (i === 0 || x.sM - arr[i - 1].sM > 200 ? 1 : 0), 0);
  // 2026-11-10 geometrisi (testin kendi ölçümü, rota-uzmani ile aynı): 9 firkete, sM 8900 · 11700 · 17650–17700 ·
  // 17950–18000 · 18650 · 18900–18950 · 19550 · 20050–20100 · 20400–20950; 7'si serrada, 2'si vadide.
  const SERRA = [14920, 21350];
  const all = clusters(tight(0, sl.total));
  const serra = clusters(tight(...SERRA));
  assert.ok(all >= 7, `firkete sayısı ${all}${revNote(RASTRO)}`);
  assert.ok(serra >= 5 && serra > all / 2, `serra firkete sayısı ${serra} / ${all}${revNote(RASTRO)}`);
  assert.ok(tight(...SERRA).some((x) => x.R < 0.3), `serrada sıkı firkete yok${revNote(RASTRO)}`);
  // Kesim oranları (pencere tamamen kesim içinde; rota-uzmani'nın (a) tanımı): vadi %6,28 · serra %33,60.
  const frac = (a, b) => { const s = w.filter((x) => x.sM >= a && x.sM + 200 <= b); return s.filter((x) => x.variable).length / s.length; };
  const vadi = frac(4380, 14920), serraFrac = frac(...SERRA);
  assert.ok(serraFrac > 3 * vadi && serraFrac > 0.25, `variable oranı: vadi %${(100 * vadi).toFixed(2)}, serra %${(100 * serraFrac).toFixed(2)}${revNote(RASTRO)}`);
  // Lauro Müller–Guatá (km 0–4,38), zirve (km 21,35–23,04) ve plato (km 23,04–sonu): pencereye değen variable pencere yok.
  // Not: serranın son variable penceresi sM 21100 (pencere sonu km 21,30), yani zirve sınırı 21,35'ten önce biter.
  const touching = (a, b) => w.filter((x) => x.variable && x.sM + 200 > a && x.sM < b).map((x) => x.sM);
  assert.deepEqual(touching(0, 4380), [], `Lauro Müller–Guatá variable${revNote(RASTRO)}`);
  assert.deepEqual(touching(21350, sl.total), [], `zirve/plato variable${revNote(RASTRO)}`);
});

test('güney yarımküre / batı boylamı (gerçek pathFull, Rio do Rastro): yön işaret hatası yok — ayna simetrisi ve kiriş yönü', () => {
  // Rota lat < 0, lon < 0. routeBearings yerel düzlemde dLon·cos(lat) kullanır; cos çift fonksiyon olduğundan işaretten
  // bağımsız olmalı. Kanıt: aynı çizgiyi ekvatora göre aynalarsak (lat → −lat) yön 180° − θ, başlangıç meridyenine
  // göre aynalarsak (lon → −lon) yön 360° − θ olur, R değişmez. Aynalanmış çizgiler ÖRNEKTİR (gerçek yol değil).
  const c = RASTRO.pathFull.coordinates;
  assert.ok(c.every(([lon, lat]) => lat < 0 && lon < 0), 'rota güney yarımkürede ve batı boylamında');
  const w = routeBearings(c);
  const kuzey = routeBearings(c.map(([lon, lat]) => [lon, -lat]));
  const dogu = routeBearings(c.map(([lon, lat]) => [-lon, lat]));
  assert.equal(kuzey.length, w.length);
  assert.equal(dogu.length, w.length);
  w.forEach((x, i) => {
    assert.ok(Math.abs(kuzey[i].R - x.R) < 1e-9 && Math.abs(dogu[i].R - x.R) < 1e-9, `sM=${x.sM} R`);
    if (x.bearingDeg === null) return;
    assert.ok(angleDiffDeg(kuzey[i].bearingDeg, 180 - x.bearingDeg) < 1e-6, `sM=${x.sM}: lat aynası ${kuzey[i].bearingDeg} vs ${180 - x.bearingDeg}`);
    assert.ok(angleDiffDeg(dogu[i].bearingDeg, 360 - x.bearingDeg) < 1e-6, `sM=${x.sM}: lon aynası ${dogu[i].bearingDeg} vs ${360 - x.bearingDeg}`);
  });
  // Mutlak yön (bağımsız): Lauro Müller (−49,405) → Bom Jardim (−49,611) batıya gider. Plato düz kesimi (km 25,55–25,85)
  // testin büyük daire kirişiyle ±2° içinde ve batıda (225°–315°).
  const sl = segList(c);
  const p = w.find((x) => x.sM === 25550);
  assert.ok(p && p.R > 0.99, 'plato km 25,55 düz pencere');
  const chord = initialBearing(pointAt(sl, p.sM), pointAt(sl, p.sM + 200));
  assert.ok(angleDiffDeg(p.bearingDeg, chord) < 2 && chord > 225 && chord < 315, `plato yönü ${p.bearingDeg.toFixed(1)}, kiriş ${chord.toFixed(1)}`);
  const genel = initialBearing(c[0], c.at(-1));
  assert.ok(genel > 270 && genel < 315, `başlangıç → bitiş yönü ${genel.toFixed(1)} (batı-kuzeybatı)`);
});

test('359°/1° geçişi (gerçek pathFull, tüm rotalar): sağlam seçilmiş kuzey pencerelerinde yön kuzeyde, açı ortalaması belirgin yanlış', () => {
  // Pencere seçimi (rota-uzmani 2026-11-04 önerisi, kırılgan pencereleri eler — ör. eski Ege sM=45950, sınıra taşan tek 38 m parça):
  //   - pencereye değen TÜM parçalar (kısa olanlar dahil) 330°–30° yayında,
  //   - >350° parçalar ve <10° parçalar ayrı ayrı pencere uzunluğunun ≥ %20'sini (40 m) kaplıyor,
  //   - bu sayılan parçalar pencerenin tamamen İÇİNDE (sınıra taşan parça sayılmaz).
  // Ek sağlamlık: aynı pencere 10 m ileri/geri kaydırılınca da yön kuzeyde kalmalı.
  const WIN = 200, MIN_COVER = 0.2 * WIN;
  let found = 0;
  const perRoute = {};
  for (const r of PATHFULL_ROUTES) {
    const c = r.pathFull.coordinates;
    const sl = segList(c);
    const fine = new Map(routeBearings(c, { windowM: WIN, stepM: 10 }).map((x) => [x.sM, x]));
    for (const x of routeBearings(c, { windowM: WIN })) {
      if (x.R < 0.95) continue;
      const a = x.sM, b = x.sM + WIN;
      const touching = sl.segs.filter((g) => g.s0 < b && g.s0 + g.len > a);
      if (touching.some((g) => g.brg >= 30 && g.brg <= 330)) continue;
      const inside = touching.filter((g) => g.s0 >= a - 1e-6 && g.s0 + g.len <= b + 1e-6);
      const cover = (f) => inside.filter(f).reduce((t, g) => t + g.len, 0);
      if (cover((g) => g.brg > 350) < MIN_COVER || cover((g) => g.brg < 10) < MIN_COVER) continue;
      found++;
      perRoute[r.id] = (perRoute[r.id] ?? 0) + 1;
      assert.ok(angleDiffDeg(x.bearingDeg, 0) < 30, `${r.id} sM=${x.sM}: ${x.bearingDeg}`);
      for (const d of [-10, 10]) {
        const y = fine.get(x.sM + d);
        if (y) assert.ok(angleDiffDeg(y.bearingDeg, 0) < 30, `${r.id} sM=${x.sM + d} (kaydırılmış): ${y.bearingDeg}`);
      }
      const s = segsIn(sl, a, b);
      const naive = s.reduce((t, g) => t + g.brg, 0) / s.length; // yanlış yöntem: açıların aritmetik ortalaması
      assert.ok(angleDiffDeg(naive, 0) > angleDiffDeg(x.bearingDeg, 0) + 30, `${r.id} sM=${x.sM}: naif ortalama ${naive.toFixed(0)}° kuzeyden belirgin sapmalı`);
    }
  }
  // 2026-11-05 geometrisi: Ege 9, Marmara 1 pencere (Nemrut güney yolunda böyle pencere yok).
  assert.ok(found >= 5, `sağlam kuzey geçişli düz pencere bulunmalı (${found}: ${JSON.stringify(perRoute)})${revNote(EGE)}`);
  assert.ok((perRoute['tr-ege-01'] ?? 0) >= 3, `Ege'de en az 3 sağlam pencere (${perRoute['tr-ege-01'] ?? 0})${revNote(EGE)}`);
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
