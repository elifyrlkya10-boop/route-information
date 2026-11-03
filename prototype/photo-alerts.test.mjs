// Çalıştır: node prototype/photo-alerts.test.mjs
// Ağ erişimi kullanılmaz. Rota ve fotoğraf noktası verisi gerçek dosyalardan (data/routes.json, data/photo-spots.json)
// yalnızca okunur. Simüle sürücü konumları ÖRNEKTİR: rota çizgisi üzerinde hesapla üretilmiş noktalardır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  projectOnRoute, routeLengthMeters, haversineMeters, routeLine, hazardsAheadOnRoute, buildVoiceAlert, orderAnnouncements,
} from './hazards.js';
import {
  photoSpotsAheadOnRoute, createPhotoAlertTracker, buildPhotoVoiceAlert, toPhotoAnnouncement, DETOUR_ANNOUNCE_MIN_KM,
} from './photo-alerts.js';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const routesDoc = readJson('../data/routes.json');
const ROUTES = routesDoc.routes ?? routesDoc;
const SPOTS = readJson('../data/photo-spots.json').photoSpots;
const route = (id) => ROUTES.find((r) => r.id === id);
const spot = (id) => SPOTS.find((s) => s.id === id);

/** Çizgi üzerinde, başından alongM metre ilerideki nokta (ÖRNEK sürücü konumu üretmek için). */
function pointAt(coords, alongM) {
  let cum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lon: coords[i][0], lat: coords[i][1] };
    const b = { lon: coords[i + 1][0], lat: coords[i + 1][1] };
    const seg = haversineMeters(a, b);
    if (cum + seg >= alongM || i === coords.length - 2) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (alongM - cum) / seg)) : 0;
      return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
    }
    cum += seg;
  }
  throw new Error('unreachable');
}

/** Sürücüyü çizgi boyunca fromM'den toM'e stepM adımlarla sürer; her adımda izleyiciye `ahead` verilir. */
function drive(r, fromM, toM, stepM, tracker, opts = {}) {
  const { coordinates: coords } = routeLine(r);
  const announced = [];
  const dir = toM >= fromM ? 1 : -1;
  for (let m = fromM; dir > 0 ? m <= toM : m >= toM; m += dir * stepM) {
    const res = photoSpotsAheadOnRoute(pointAt(coords, m), r, SPOTS, opts);
    for (const s of tracker.update(res.ahead)) {
      const e = res.ahead.find((x) => x.spot.id === s.id);
      announced.push({ id: s.id, atM: m, aheadM: e.aheadM });
    }
  }
  return announced;
}

test('veri: 12 nokta, her biri bir rotaya bağlı, approachPoint ve detourKm var', () => {
  assert.equal(SPOTS.length, 12);
  for (const s of SPOTS) {
    assert.ok(route(s.routeId), `${s.id}: rota yok`);
    assert.ok(Number.isFinite(s.approachPoint?.lat) && Number.isFinite(s.approachPoint?.lon), `${s.id}: approachPoint`);
    assert.ok(Number.isFinite(s.detourKm), `${s.id}: detourKm`);
  }
});

test('12 noktada approachPoint path üzerinde (< 5 m; Python betiğiyle JS hesabı tutarlı)', () => {
  for (const s of SPOTS) {
    const p = projectOnRoute(s.approachPoint, route(s.routeId).path.coordinates);
    assert.ok(p.offsetM < 5, `${s.id}: path offset ${p.offsetM.toFixed(1)} m`);
  }
});

test('12 noktada approachPoint bildirim çizgisine (pathFull ?? path) 100 m içinde; hiçbiri detached değil', () => {
  for (const s of SPOTS) {
    const r = route(s.routeId);
    const { coordinates: coords, geometry: source } = routeLine(r);
    assert.equal(source, r.pathFull ? 'pathFull' : 'path');
    const p = projectOnRoute(s.approachPoint, coords);
    assert.ok(p.offsetM < 100, `${s.id}: ${source} offset ${p.offsetM.toFixed(1)} m`);
    // Rota başında duran sürücüye göre detached listesi boş olmalı.
    const res = photoSpotsAheadOnRoute(pointAt(coords, 0), r, [s]);
    assert.deepEqual(res.detached, [], s.id);
  }
});

test('rotası değişmiş (kopmuş) approachPoint sessizce atlanmaz, detached olarak raporlanır', () => {
  const r = route('tr-marmara-01');
  const kopuk = { ...spot('ps-tr-marmara-01-02'), approachPoint: { ...spot('ps-tr-marmara-01-02').location } };
  const res = photoSpotsAheadOnRoute(pointAt(routeLine(r).coordinates, 0), r, [kopuk]);
  assert.equal(res.detached.length, 1);
  assert.equal(res.detached[0].id, 'ps-tr-marmara-01-02');
  assert.ok(res.detached[0].offsetM > 2000);
  assert.deepEqual(res.spots, []);
});

test('Sarıalan: ileri sürüşte tek bildirim, yarıçap içinde', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const tracker = createPhotoAlertTracker();
  const lenM = routeLengthMeters(routeLine(r).coordinates);
  const ann = drive(r, 0, lenM, 25, tracker).filter((a) => a.id === s.id);
  assert.equal(ann.length, 1, JSON.stringify(ann));
  assert.ok(ann[0].aheadM <= s.notifyRadiusM && ann[0].aheadM > s.notifyRadiusM - 30, `aheadM ${ann[0].aheadM}`);
});

test('Sarıalan: geçip geri dönen ve yeniden yaklaşan sürücü yeniden bildirim alır', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  const tracker = createPhotoAlertTracker({ rearmM: 500 });
  const start = apAlong - 2000;
  const ileri1 = drive(r, start, apAlong + 200, 25, tracker).filter((a) => a.id === s.id);
  // Geri dönüş: rota yönü 'forward' kalır, sürücü çizgi üzerinde geriye gider; nokta ileride uzaklaşır → yeniden kurulur.
  const geri = drive(r, apAlong + 200, start, 25, tracker).filter((a) => a.id === s.id);
  const ileri2 = drive(r, start, apAlong + 200, 25, tracker).filter((a) => a.id === s.id);
  assert.equal(ileri1.length, 1);
  assert.equal(ileri2.length, 1);
  // Geri giderken nokta yeniden yarıçap içinde "ileride" görünür ama zaten bildirilmiştir; ancak
  // notifyRadiusM + rearmM (700 + 500 m) ötesine uzaklaşınca yeniden kurulur ve ikinci yaklaşmada bildirilir.
  assert.equal(geri.length, 0, JSON.stringify(geri));
});

test('Sarıalan: yarıçap + rearm sınırını aşmadan geri-ileri salınım tekrar bildirim üretmez', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  const tracker = createPhotoAlertTracker({ rearmM: 500 });
  let n = 0;
  for (const off of [900, 650, 400, 1100, 600, 300, 1150, 500]) { // hepsi < 700 + 500
    const res = photoSpotsAheadOnRoute(pointAt(coords, apAlong - off), r, SPOTS);
    n += tracker.update(res.ahead).filter((x) => x.id === s.id).length;
  }
  assert.equal(n, 1);
});

test('ters yön: aheadM doğru, ileri yönde geride kalan nokta ters yönde ileride', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  const d = pointAt(coords, apAlong + 400); // noktayı 400 m geçmiş (ileri yöne göre)
  const fwd = photoSpotsAheadOnRoute(d, r, SPOTS);
  assert.ok(!fwd.spots.some((e) => e.spot.id === s.id), 'ileri yönde geride kalmalı');
  const rev = photoSpotsAheadOnRoute(d, r, SPOTS, { direction: 'reverse' });
  const e = rev.spots.find((x) => x.spot.id === s.id);
  assert.ok(e, 'ters yönde ileride olmalı');
  assert.ok(Math.abs(e.aheadM - 400) < 5, `aheadM ${e.aheadM}`);
  // Ters yönde tüm rotayı süren sürücü de tek bildirim alır.
  const tracker = createPhotoAlertTracker();
  const lenM = routeLengthMeters(coords);
  const ann = drive(r, lenM, 0, 25, tracker, { direction: 'reverse' }).filter((a) => a.id === s.id);
  assert.equal(ann.length, 1);
});

test('rota dışı sürücü bildirim almaz (sapma yoluna giren dahil)', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  // Sapma yolunda: approachPoint ile nokta arasında (~1,1 km rotadan uzak, ÖRNEK konum).
  const sapma = { lat: (s.approachPoint.lat + s.location.lat) / 2, lon: (s.approachPoint.lon + s.location.lon) / 2 };
  const res = photoSpotsAheadOnRoute(sapma, r, SPOTS);
  assert.equal(res.offRoute, true);
  assert.deepEqual(res.spots, []);
  assert.deepEqual(res.ahead, []);
  const tracker = createPhotoAlertTracker();
  assert.deepEqual(tracker.update(res.ahead), []);
  // Noktanın kendisinde duran sürücü de rota dışıdır.
  assert.equal(photoSpotsAheadOnRoute(s.location, r, SPOTS).offRoute, true);
});

test('pathFull seçimi: gerçek yoldaki sürücü path\'e göre rota dışı görünür, pathFull\'a göre değil', () => {
  // path ile pathFull arasındaki 150–330 m yanal fark: pathFull üzerindeki en uzak noktayı bul.
  let worst = { off: 0, pt: null, id: null };
  for (const r of ROUTES.filter((x) => x.pathFull)) {
    const f = r.pathFull.coordinates;
    for (let i = 0; i < f.length; i += 5) {
      const pt = { lon: f[i][0], lat: f[i][1] };
      const off = projectOnRoute(pt, r.path.coordinates).offsetM;
      if (off > worst.off) worst = { off, pt, id: r.id };
    }
  }
  assert.ok(worst.off > 100, `en büyük yanal fark ${worst.off.toFixed(0)} m`);
  const r = route(worst.id);
  assert.equal(photoSpotsAheadOnRoute(worst.pt, r, SPOTS).offRoute, false);
  assert.equal(photoSpotsAheadOnRoute(worst.pt, { ...r, pathFull: undefined }, SPOTS).offRoute, true);
});

test('Kemaliye (yalnız path): mesafe lengthKm ile ölçeklenir, routeApproximate=true', () => {
  const r = route('tr-dogu-anadolu-01');
  assert.equal(r.pathFull, undefined);
  const line = routeLine(r);
  assert.equal(line.geometry, 'path');
  assert.ok(Math.abs(line.scale - (r.lengthKm * 1000) / routeLengthMeters(r.path.coordinates)) < 1e-12);
  const s = spot('ps-tr-dogu-anadolu-01-01');
  const apAlong = projectOnRoute(s.approachPoint, line.coordinates).distanceAlongM;
  const res = photoSpotsAheadOnRoute(pointAt(line.coordinates, apAlong - 500), r, SPOTS);
  assert.equal(res.routeApproximate, true);
  const e = res.spots.find((x) => x.spot.id === s.id);
  assert.ok(e);
  assert.ok(Math.abs(e.aheadM - 500 * line.scale) < 2, `aheadM ${e.aheadM}`);
  // pathFull olan rotalarda ölçek 1.
  assert.equal(routeLine(route('tr-akdeniz-01')).scale, 1);
});

test('safeStop false olan nokta önerilmez; başka rotanın noktası dönmez', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  const d = pointAt(coords, apAlong - 300);
  const guvensiz = { ...s, id: 'ORNEK-guvensiz', safeStop: false };
  const baskaRota = { ...s, id: 'ORNEK-baska', routeId: 'tr-ege-01' };
  const res = photoSpotsAheadOnRoute(d, r, [guvensiz, baskaRota, s]);
  assert.deepEqual(res.spots.map((e) => e.spot.id), [s.id]);
  assert.equal(buildPhotoVoiceAlert(guvensiz, 300, 'tr'), null);
});

test('sesli metin tr/en; detourKm >= 0,5 ise sapma eklenir', () => {
  const sar = spot('ps-tr-marmara-01-02'); // detourKm 2.2
  assert.equal(buildPhotoVoiceAlert(sar, 690, 'tr'), 'Fotoğraf noktası 700 metre ileride: Sarıalan Yaylası. Rotadan yaklaşık 2,2 kilometre sapma.');
  assert.equal(buildPhotoVoiceAlert(sar, 690, 'en'), 'Photo spot in 700 meters: Sarıalan Plateau. About 2.2 kilometer detour off the route.');
  const kir = spot('ps-tr-marmara-01-01'); // detourKm 0.0
  assert.equal(buildPhotoVoiceAlert(kir, 20, 'tr'), 'Fotoğraf noktası hemen ileride: Kirazlıyayla – Bursa Ovası Manzarası.');
  const tek = spot('ps-tr-ic-anadolu-01-02'); // detourKm 0.2 (< 0,5)
  assert.ok(!/sapma/.test(buildPhotoVoiceAlert(tek, 500, 'tr')));
  assert.equal(DETOUR_ANNOUNCE_MIN_KM, 0.5);
  const sak = spot('ps-tr-akdeniz-01-01'); // detourKm 0.5 (sınır dahil)
  assert.match(buildPhotoVoiceAlert(sak, 1000, 'tr'), /1 kilometre ileride: .*Rotadan yaklaşık 0,5 kilometre sapma\.$/);
  // Bilinmeyen dil İngilizceye düşer.
  assert.match(buildPhotoVoiceAlert(sar, 300, 'de'), /^Photo spot in 300 meters/);
});

test('12 noktanın her biri kendi rotasında baştan sona sürüşte tam bir kez bildirilir', () => {
  for (const r of ROUTES) {
    const tracker = createPhotoAlertTracker();
    const lenM = routeLengthMeters(routeLine(r).coordinates);
    const ann = drive(r, 0, lenM, 50, tracker);
    const beklenen = SPOTS.filter((s) => s.routeId === r.id && s.safeStop === true).map((s) => s.id).sort();
    assert.deepEqual(ann.map((a) => a.id).sort(), beklenen, r.id);
  }
});

test('bozuk pathFull: sessizce path\'e düşülmez, hata verilir (ortak routeLine kuralı)', () => {
  const r = route('tr-marmara-01');
  const d = pointAt(r.path.coordinates, 0);
  for (const pathFull of [{ type: 'Point', coordinates: [29.0, 40.0] }, 'bozuk']) {
    assert.throws(() => photoSpotsAheadOnRoute(d, { ...r, pathFull }, SPOTS), /route\.pathFull/, JSON.stringify(pathFull));
  }
  // Tek noktalı LineString de reddedilir (hata metni hazards.js'te 'lineCoords: ...').
  assert.throws(() => photoSpotsAheadOnRoute(d, { ...r, pathFull: { type: 'LineString', coordinates: [[29.0, 40.0]] } }, SPOTS), TypeError);
  // Sağlam pathFull'da çizgi kaynağı ve ölçek sonuçta görünür.
  const ok = photoSpotsAheadOnRoute(d, r, SPOTS);
  assert.equal(ok.lineSource, 'pathFull');
  assert.equal(ok.scale, 1);
});

test('toPhotoAnnouncement: {kind: photo, id, aheadM, text}; güvenli durulamayan nokta null', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  const e = photoSpotsAheadOnRoute(pointAt(coords, apAlong - 690), r, SPOTS).spots.find((x) => x.spot.id === s.id);
  assert.ok(e);
  const a = toPhotoAnnouncement(e, 'tr');
  assert.deepEqual(Object.keys(a).sort(), ['aheadM', 'id', 'kind', 'text']);
  assert.equal(a.kind, 'photo');
  assert.equal(a.id, s.id);
  assert.equal(a.aheadM, e.aheadM);
  assert.equal(a.text, buildPhotoVoiceAlert(s, e.aheadM, 'tr'));
  assert.match(toPhotoAnnouncement(e).text, /^Photo spot in 700 meters: Sarıalan Plateau\./);
  assert.equal(toPhotoAnnouncement({ ...e, spot: { ...s, id: 'ORNEK-guvensiz', safeStop: false } }, 'tr'), null);
  assert.throws(() => toPhotoAnnouncement(null), TypeError);
});

test('aynı anda gelen tehlike + fotoğraf: orderAnnouncements önce tehlikeyi okutur (fotoğraf daha yakın olsa da)', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  // ÖRNEK tehlike: rota çizgisi üzerinde, fotoğraf noktasının 300 m ötesinde (uydurma, isSample: true).
  const hazard = {
    id: 'ORNEK-gravel-sarialan', routeId: r.id, type: 'gravel', location: pointAt(coords, apAlong + 300),
    note: { en: 'Sample hazard for tests', tr: 'Test için örnek tehlike' },
    reportedBy: 'ORNEK', reportedAt: '2026-11-03T00:00:00Z', isSample: true,
  };
  const driver = pointAt(coords, apAlong - 650);
  const photoRes = photoSpotsAheadOnRoute(driver, r, SPOTS);
  const hazRes = hazardsAheadOnRoute(driver, r, [hazard], { includeSamples: true });
  // Aynı konum güncellemesinde ikisi de tetiklenir.
  const photoTracker = createPhotoAlertTracker();
  const nowPhotos = photoTracker.update(photoRes.ahead);
  assert.deepEqual(nowPhotos.map((x) => x.id), [s.id]);
  assert.equal(hazRes.hazards.length, 1);
  const h = hazRes.hazards[0];
  const photoEntry = photoRes.ahead.find((x) => x.spot.id === s.id);
  assert.ok(photoEntry.aheadM < h.aheadM, 'fotoğraf noktası tehlikeden daha yakın olmalı (sınama koşulu)');
  const items = [
    toPhotoAnnouncement(photoEntry, 'tr'),
    { kind: 'hazard', id: h.hazard.id, aheadM: h.aheadM, text: buildVoiceAlert(h.hazard, h.aheadM, 'tr', { ahead: true }) },
  ];
  const ordered = orderAnnouncements(items);
  assert.deepEqual(ordered.map((x) => x.kind), ['hazard', 'photo']);
  assert.equal(ordered[0].text, 'Dikkat, 950 metre ileride taşlı yol.');
  assert.match(ordered[1].text, /^Fotoğraf noktası 650 metre ileride: Sarıalan Yaylası\./);
  // Girdi değişmez.
  assert.deepEqual(items.map((x) => x.kind), ['photo', 'hazard']);
});

test('isSample: true olan (örnek) fotoğraf noktası yalnızca includeSamples ile değerlendirilir', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  const ornek = { ...s, id: 'ORNEK-sarialan', isSample: true };
  const d = pointAt(coords, apAlong - 300);
  assert.deepEqual(photoSpotsAheadOnRoute(d, r, [ornek]).spots, []);
  assert.deepEqual(photoSpotsAheadOnRoute(d, r, [ornek], { includeSamples: true }).spots.map((e) => e.spot.id), [ornek.id]);
});

for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}\n`, err);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} test geçti`);
