// Çalıştır: node prototype/photo-alerts.test.mjs
// Ağ erişimi kullanılmaz. Rota ve fotoğraf noktası verisi gerçek dosyalardan (data/routes.json, data/photo-spots.json)
// yalnızca okunur. Simüle sürücü konumları ÖRNEKTİR: rota çizgisi üzerinde hesapla üretilmiş noktalardır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  projectOnRoute, routeLengthMeters, haversineMeters, routeLine, hazardsAheadOnRoute, buildVoiceAlert, orderAnnouncements,
} from './hazards.js';
import {
  photoSpotsAheadOnRoute, createPhotoAlertTracker, buildPhotoVoiceAlert, toPhotoAnnouncement, DETOUR_ANNOUNCE_MIN_KM,
  SPOT_MAX_OFFSET_M, sameGeometryRevision,
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
function drive(r, fromM, toM, stepM, tracker, opts = {}, spots = SPOTS) {
  const { coordinates: coords } = routeLine(r);
  const announced = [];
  const dir = toM >= fromM ? 1 : -1;
  for (let m = fromM; dir > 0 ? m <= toM : m >= toM; m += dir * stepM) {
    const res = photoSpotsAheadOnRoute(pointAt(coords, m), r, spots, opts);
    for (const s of tracker.update(res.ahead)) {
      const e = res.ahead.find((x) => x.spot.id === s.id);
      announced.push({ id: s.id, atM: m, aheadM: e.aheadM });
    }
  }
  return announced;
}

/** Rota id'sindeki ülke kodu -> ülke dili (docs/urun-dokumani.md: başlık ve açıklamalar ülke dili + İngilizce). */
const COUNTRY_LANG = { tr: 'tr', gr: 'el', es: 'es', br: 'pt' };
const LANG_FIELDS = ['title', 'description', 'safeStopInfo'];

test(`veri: ${SPOTS.length} nokta (data/photo-spots.json), id'ler tekil, her biri bir rotaya bağlı, approachPoint ve detourKm var`, () => {
  // Sayı kaynak veriden gelir; boş ya da kopya id'li veri geçmez.
  assert.ok(SPOTS.length > 0);
  assert.equal(new Set(SPOTS.map((s) => s.id)).size, SPOTS.length, 'id tekrarı');
  for (const s of SPOTS) {
    assert.ok(route(s.routeId), `${s.id}: rota yok`);
    assert.match(s.id, new RegExp(`^ps-${s.routeId}-\\d{2}$`), `${s.id}: id kuralı ps-<routeId>-<nn>`);
    assert.ok(Number.isFinite(s.approachPoint?.lat) && Number.isFinite(s.approachPoint?.lon), `${s.id}: approachPoint`);
    assert.ok(Number.isFinite(s.detourKm), `${s.id}: detourKm`);
  }
  // Her rotanın noktası kendi rotasında: map-data/harita ile aynı küme, başka rotaya bağlı nokta kalmaz.
  const routeIds = new Set(ROUTES.map((r) => r.id));
  assert.equal(SPOTS.filter((s) => routeIds.has(s.routeId)).length, SPOTS.length);
});

test('veri: title, description, safeStopInfo en az ülke dili + en (Türkçe zorunlu değil; yalnız TR rotalarında)', () => {
  for (const s of SPOTS) {
    const country = s.routeId.split('-')[0];
    const own = COUNTRY_LANG[country];
    assert.ok(own, `${s.id}: ülke dili tanımsız (${country})`);
    for (const f of LANG_FIELDS) {
      for (const l of new Set([own, 'en'])) {
        assert.equal(typeof s[f]?.[l], 'string', `${s.id}.${f}.${l}`);
        assert.ok(s[f][l].trim().length > 0, `${s.id}.${f}.${l} boş`);
      }
    }
  }
  // Türkçesi olmayan nokta gerçekten var (aşağıdaki dil yedeği testleri boşa çalışmasın).
  assert.ok(SPOTS.some((s) => s.title.tr === undefined), 'Türkçesi olmayan nokta yok');
});

test(`${SPOTS.length} noktada approachPoint bildirim çizgisi (pathFull ?? path) üzerinde (< 5 m; Python betiğiyle JS hesabı tutarlı)`, () => {
  for (const s of SPOTS) {
    const r = route(s.routeId);
    const { coordinates: coords, geometry: source } = routeLine(r);
    assert.equal(source, r.pathFull ? 'pathFull' : 'path');
    const p = projectOnRoute(s.approachPoint, coords);
    assert.ok(p.offsetM < 5, `${s.id}: ${source} offset ${p.offsetM.toFixed(1)} m`);
  }
});

test(`spotMaxOffsetM varsayılanı ${SPOT_MAX_OFFSET_M} m; ${SPOTS.length} noktanın hiçbiri detached ya da stale değil`, () => {
  assert.equal(SPOT_MAX_OFFSET_M, 50);
  for (const s of SPOTS) {
    const r = route(s.routeId);
    // Rota başında duran sürücüye göre detached ve stale listeleri boş olmalı.
    const res = photoSpotsAheadOnRoute(pointAt(routeLine(r).coordinates, 0), r, [s]);
    assert.deepEqual(res.detached, [], s.id);
    assert.deepEqual(res.stale, [], s.id);
  }
});

test('geometryRevision: her nokta rotadaki nesnenin aynen kopyasını taşır; karma JS JSON.stringify ile aynı', () => {
  const sha = (g) => (g ? createHash('sha256').update(JSON.stringify(g.coordinates), 'utf8').digest('hex') : null);
  for (const r of ROUTES) {
    assert.deepEqual(Object.keys(r.geometryRevision), ['date', 'pathSha256', 'pathFullSha256'], r.id);
    assert.equal(r.geometryRevision.pathSha256, sha(r.path), r.id);
    assert.equal(r.geometryRevision.pathFullSha256, sha(r.pathFull), r.id); // pathFull yoksa null (bkz. ÖRNEK yalnız-path testi)
  }
  for (const s of SPOTS) {
    assert.deepEqual(s.geometryRevision, route(s.routeId).geometryRevision, s.id);
    assert.deepEqual(Object.keys(s.geometryRevision), ['date', 'pathSha256', 'pathFullSha256'], s.id);
    assert.ok(sameGeometryRevision(s.geometryRevision, route(s.routeId).geometryRevision), s.id);
  }
});

test('geometryRevision eşleşmezse nokta bildirilmez, stale olarak raporlanır', () => {
  const r = route('tr-marmara-01');
  const s = spot('ps-tr-marmara-01-02');
  const { coordinates: coords } = routeLine(r);
  const apAlong = projectOnRoute(s.approachPoint, coords).distanceAlongM;
  const d = pointAt(coords, apAlong - 300);
  assert.deepEqual(photoSpotsAheadOnRoute(d, r, SPOTS).spots.map((e) => e.spot.id), [s.id]);
  // Rota geometrisi değişmiş gibi: rotadaki karma farklı (ÖRNEK değer).
  const yeni = { ...r, geometryRevision: { ...r.geometryRevision, date: '2099-01-01', pathFullSha256: 'ORNEK' } };
  const res = photoSpotsAheadOnRoute(d, yeni, SPOTS);
  assert.deepEqual(res.spots, []);
  assert.deepEqual(res.ahead, []);
  assert.deepEqual(res.stale.map((x) => x.id).sort(), ['ps-tr-marmara-01-01', 'ps-tr-marmara-01-02']);
  assert.deepEqual(res.stale[0].routeRevision, yeni.geometryRevision);
  // Noktada alan yoksa da stale (spotRevision: null).
  const { geometryRevision: _g, ...alansiz } = s;
  const res2 = photoSpotsAheadOnRoute(d, r, [alansiz]);
  assert.deepEqual(res2.stale, [{ id: s.id, spotRevision: null, routeRevision: r.geometryRevision }]);
  assert.deepEqual(res2.spots, []);
  // Rota alanı taşımıyorsa kontrol yapılmaz (eski veri).
  const { geometryRevision: _r, ...eskiRota } = r;
  assert.deepEqual(photoSpotsAheadOnRoute(d, eskiRota, [alansiz]).spots.map((e) => e.spot.id), [s.id]);
  // Rota dışı sürücüde de stale görünür (veri durumu sürücüye bağlı değil).
  const off = photoSpotsAheadOnRoute(s.location, yeni, SPOTS);
  assert.equal(off.offRoute, true);
  assert.equal(off.stale.length, 2);
  assert.equal(sameGeometryRevision(null, r.geometryRevision), false);
});

test('detourRoadKm (karar 6A): varsa sayı ve kuş uçuşundan kısa değil; Bozdağ kavşağı ve yol mesafesi', () => {
  for (const s of SPOTS) {
    if (s.detourRoadKm === undefined) continue;
    assert.ok(Number.isFinite(s.detourRoadKm) && s.detourRoadKm >= 0, s.id);
    // Yol, kuş uçuşundan kısa olamaz. Pay: iki yuvarlama (0,1) + OSRM'in noktayı yola bağladığı mesafe (betikte <= 150 m).
    assert.ok(s.detourRoadKm >= s.detourKm - 0.25, `${s.id}: yol ${s.detourRoadKm} < kuş uçuşu ${s.detourKm}`);
  }
  const b = spot('ps-tr-ege-01-02');
  assert.deepEqual(b.approachPoint, { lat: 38.34286, lon: 28.07658 }); // OSM node 2122980385 (35-30 kavşağı)
  assert.equal(b.detourRoadKm, 9.4);
  assert.equal(buildPhotoVoiceAlert(b, 1000, 'tr'),
    'Fotoğraf noktası 1 kilometre ileride: Bozdağ Kayak Merkezi Sırtı. Rotadan yolla yaklaşık 9,4 kilometre sapma.');
  assert.equal(buildPhotoVoiceAlert(b, 1000, 'en'),
    'Photo spot in 1 kilometer: Bozdağ Ski Centre Ridge. About 9.4 kilometer detour off the route by road.');
  // Ege rotasında baştan sona sürüşte Bozdağ kavşakta bir kez bildirilir.
  const r = route('tr-ege-01');
  const ann = drive(r, 0, routeLengthMeters(routeLine(r).coordinates), 50, createPhotoAlertTracker()).filter((a) => a.id === b.id);
  assert.equal(ann.length, 1);
});

test('karar 2A: Cendere bu rotadan erişilmiyor (bildirilmez, unreachable); Ziyaretçi Merkezi rota üzerinde', () => {
  const r = route('tr-guneydogu-anadolu-01');
  const c = spot('ps-tr-guneydogu-anadolu-01-01');
  const z = spot('ps-tr-guneydogu-anadolu-01-02');
  assert.equal(c.reachableFromRoute, false);
  assert.equal(z.reachableFromRoute, undefined);
  const { coordinates: coords } = routeLine(r);
  const cAlong = projectOnRoute(c.approachPoint, coords).distanceAlongM;
  const res = photoSpotsAheadOnRoute(pointAt(coords, Math.max(0, cAlong - 300)), r, SPOTS);
  assert.deepEqual(res.unreachable, [{ id: c.id }]);
  assert.ok(!res.ahead.some((e) => e.spot.id === c.id));
  assert.equal(buildPhotoVoiceAlert(c, 300, 'tr'), null);
  assert.equal(toPhotoAnnouncement({ spot: c, aheadM: 300 }, 'tr'), null);
  // Ziyaretçi merkezi: rotadan ~45 m; sapma söylenmez.
  assert.ok(z.detourKm < DETOUR_ANNOUNCE_MIN_KM);
  assert.equal(buildPhotoVoiceAlert(z, 400, 'tr'), 'Fotoğraf noktası 400 metre ileride: Nemrut Dağı Ziyaretçi Merkezi (Güney Girişi).');
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

// Yalnız path olan (pathFull'suz) rota: 2026-11-11'de Kemaliye pathFull aldı, katalogda böyle rota kalmadı. Davranış
// (lengthKm ile ölçek, lineSource 'path', routeApproximate, null === null eskime kuralı, tam bir kez bildirim) aşağıdaki
// ÖRNEK rota ve ÖRNEK noktayla sınanmaya devam eder. Bunlar gerçek rota/nokta DEĞİLDİR; koordinatlar uydurmadır.
const shaCoords = (g) => (g ? createHash('sha256').update(JSON.stringify(g.coordinates), 'utf8').digest('hex') : null);
const ORNEK_PATH = { type: 'LineString', coordinates: [[30.0, 40.0], [30.01, 40.004], [30.02, 40.002], [30.035, 40.008]] };
const ORNEK_LINE_M = routeLengthMeters(ORNEK_PATH.coordinates);
const ORNEK_YALNIZ_PATH_ROTA = {
  id: 'ORNEK-yalniz-path',
  name: { tr: 'ÖRNEK yalnız-path rota', en: 'SAMPLE path-only route' },
  lengthKm: Math.round((ORNEK_LINE_M * 1.25) / 100) / 10, // çizgiden ~%25 uzun: ölçek belirgin olsun
  path: ORNEK_PATH,
  geometryRevision: { date: '2000-01-01', pathSha256: shaCoords(ORNEK_PATH), pathFullSha256: null },
  verification: { status: 'doğrulanmalı', notes: 'ÖRNEK' },
};
const ORNEK_AP = pointAt(ORNEK_PATH.coordinates, ORNEK_LINE_M * 0.6);
const ORNEK_YALNIZ_PATH_NOKTA = {
  id: 'ORNEK-yalniz-path-01',
  routeId: ORNEK_YALNIZ_PATH_ROTA.id,
  location: { lat: ORNEK_AP.lat, lon: ORNEK_AP.lon },
  title: { tr: 'ÖRNEK nokta', en: 'SAMPLE spot' },
  description: { tr: 'ÖRNEK', en: 'SAMPLE' },
  safeStop: true,
  safeStopInfo: { tr: 'ÖRNEK', en: 'SAMPLE' },
  notifyRadiusM: 700,
  approachPoint: { lat: ORNEK_AP.lat, lon: ORNEK_AP.lon },
  detourKm: 0.0,
  detourRoadKm: 0.0,
  geometryRevision: { ...ORNEK_YALNIZ_PATH_ROTA.geometryRevision },
  verification: { status: 'doğrulanmalı', notes: 'ÖRNEK' },
};

test('yalnız path (ÖRNEK rota): mesafe lengthKm ile ölçeklenir, lineSource path, routeApproximate=true, null === null stale değil', () => {
  const r = ORNEK_YALNIZ_PATH_ROTA;
  const s = ORNEK_YALNIZ_PATH_NOKTA;
  assert.equal(r.pathFull, undefined);
  assert.equal(r.geometryRevision.pathFullSha256, null);
  const line = routeLine(r);
  assert.equal(line.geometry, 'path');
  assert.ok(Math.abs(line.scale - (r.lengthKm * 1000) / routeLengthMeters(r.path.coordinates)) < 1e-12);
  assert.ok(line.scale > 1.2 && line.scale < 1.3, `scale ${line.scale}`);
  const apAlong = projectOnRoute(s.approachPoint, line.coordinates).distanceAlongM;
  const res = photoSpotsAheadOnRoute(pointAt(line.coordinates, apAlong - 500), r, [s]);
  assert.equal(res.lineSource, 'path');
  assert.equal(res.scale, line.scale);
  assert.equal(res.routeApproximate, true);
  assert.deepEqual(res.stale, []); // iki tarafta pathFullSha256 null: eşit (sameGeometryRevision)
  assert.deepEqual(res.detached, []);
  const e = res.spots.find((x) => x.spot.id === s.id);
  assert.ok(e);
  assert.ok(Math.abs(e.aheadM - 500 * line.scale) < 2, `aheadM ${e.aheadM}`);
  // Durum "doğrulanmalı" değilse yalnız path olsa da routeApproximate false.
  const dogrulandi = { ...r, verification: { status: 'doğrulandı', notes: 'ÖRNEK' } };
  assert.equal(photoSpotsAheadOnRoute(pointAt(line.coordinates, apAlong - 500), dogrulandi, [s]).routeApproximate, false);
  // Noktada pathFullSha256 dolu, rotada null: eşit değil, stale (ÖRNEK karma).
  const kirli = { ...s, geometryRevision: { ...s.geometryRevision, pathFullSha256: 'ORNEK' } };
  const res2 = photoSpotsAheadOnRoute(pointAt(line.coordinates, apAlong - 500), r, [kirli]);
  assert.deepEqual(res2.spots, []);
  assert.deepEqual(res2.stale.map((x) => x.id), [s.id]);
  // Baştan sona sürüşte tam bir kez, yarıçap içinde (aheadM ölçekli yol mesafesi).
  const ann = drive(r, 0, ORNEK_LINE_M, 50, createPhotoAlertTracker(), {}, [s]);
  assert.deepEqual(ann.map((a) => a.id), [s.id]);
  assert.ok(ann[0].aheadM <= s.notifyRadiusM && ann[0].aheadM > 0, `aheadM ${ann[0].aheadM}`);
  // pathFull olan rotalarda ölçek 1.
  assert.equal(routeLine(route('tr-akdeniz-01')).scale, 1);
});

test('Kemaliye (gerçek, geometryRevision 2026-11-11): pathFull üzerinde, ölçek 1, nokta Taş Yol başında (km ~3,04), stale değil, bir kez bildirilir', () => {
  const r = route('tr-dogu-anadolu-01');
  const s = spot('ps-tr-dogu-anadolu-01-01');
  assert.ok(r.pathFull && r.pathFull.type === 'LineString');
  assert.equal(r.geometryRevision.pathFullSha256, shaCoords(r.pathFull));
  assert.deepEqual(s.geometryRevision, r.geometryRevision);
  const line = routeLine(r);
  assert.equal(line.geometry, 'pathFull');
  assert.equal(line.scale, 1);
  const lineM = routeLengthMeters(line.coordinates);
  assert.ok(Math.abs(lineM / 1000 - r.lengthKm) / r.lengthKm < 0.01, `çizgi ${lineM.toFixed(0)} m, lengthKm ${r.lengthKm}`);
  const p = projectOnRoute(s.approachPoint, line.coordinates);
  assert.ok(p.offsetM < 5, `offset ${p.offsetM.toFixed(1)} m`);
  assert.ok(Math.abs(p.distanceAlongM - 3040) < 50, `approachPoint km ${(p.distanceAlongM / 1000).toFixed(2)}`);
  const res = photoSpotsAheadOnRoute(pointAt(line.coordinates, p.distanceAlongM - 500), r, SPOTS);
  assert.equal(res.lineSource, 'pathFull');
  assert.equal(res.scale, 1);
  // photo-alerts kuralı: routeApproximate = lineSource 'path' && durum 'doğrulanmalı'. Kemaliye artık pathFull'lu,
  // bu yüzden false (hazards.js'te durum 'doğrulanmalı' olduğu için true; kurallar farklı, bkz. rapor 2026-11-11).
  assert.equal(r.verification.status, 'doğrulanmalı');
  assert.equal(res.routeApproximate, false);
  assert.deepEqual(res.stale, []);
  assert.deepEqual(res.detached, []);
  const e = res.spots.find((x) => x.spot.id === s.id);
  assert.ok(e);
  assert.ok(Math.abs(e.aheadM - 500) < 2, `aheadM ${e.aheadM}`);
  const ann = drive(r, 0, lineM, 50, createPhotoAlertTracker());
  assert.deepEqual(ann.map((a) => a.id), [s.id]);
  assert.ok(ann[0].aheadM <= s.notifyRadiusM, `aheadM ${ann[0].aheadM}`);
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
  const sar = spot('ps-tr-marmara-01-02'); // detourKm 2.2 (kuş uçuşu), detourRoadKm 2.5 (yol)
  assert.equal(sar.detourKm, 2.2);
  assert.equal(sar.detourRoadKm, 2.5);
  assert.equal(buildPhotoVoiceAlert(sar, 690, 'tr'), 'Fotoğraf noktası 700 metre ileride: Sarıalan Yaylası. Rotadan yolla yaklaşık 2,5 kilometre sapma.');
  assert.equal(buildPhotoVoiceAlert(sar, 690, 'en'), 'Photo spot in 700 meters: Sarıalan Plateau. About 2.5 kilometer detour off the route by road.');
  // detourRoadKm yoksa kuş uçuşu detourKm söylenir (eski metin).
  const { detourRoadKm: _y, ...sarKus } = sar;
  assert.equal(buildPhotoVoiceAlert(sarKus, 690, 'tr'), 'Fotoğraf noktası 700 metre ileride: Sarıalan Yaylası. Rotadan yaklaşık 2,2 kilometre sapma.');
  assert.equal(buildPhotoVoiceAlert(sarKus, 690, 'en'), 'Photo spot in 700 meters: Sarıalan Plateau. About 2.2 kilometer detour off the route.');
  // detourRoadKm < 0,5 ise kuş uçuşu büyük olsa da sapma söylenmez (yol mesafesi esas).
  assert.ok(!/sapma/.test(buildPhotoVoiceAlert({ ...sar, detourRoadKm: 0.3 }, 690, 'tr')));
  const kir = spot('ps-tr-marmara-01-01'); // detourKm 0.0
  assert.equal(buildPhotoVoiceAlert(kir, 20, 'tr'), 'Fotoğraf noktası hemen ileride: Kirazlıyayla – Bursa Ovası Manzarası.');
  const tek = spot('ps-tr-ic-anadolu-01-02'); // detourKm 0.2 (< 0,5)
  assert.ok(!/sapma/.test(buildPhotoVoiceAlert(tek, 500, 'tr')));
  assert.equal(DETOUR_ANNOUNCE_MIN_KM, 0.5);
  const sak = spot('ps-tr-akdeniz-01-01'); // detourRoadKm 0.5 (sınır dahil)
  assert.equal(sak.detourRoadKm, 0.5);
  assert.match(buildPhotoVoiceAlert(sak, 1000, 'tr'), /1 kilometre ileride: .*Rotadan yolla yaklaşık 0,5 kilometre sapma\.$/);
  // Bilinmeyen dil İngilizceye düşer.
  assert.match(buildPhotoVoiceAlert(sar, 300, 'de'), /^Photo spot in 300 meters/);
});

test('rotadan erişilebilen her nokta kendi rotasında baştan sona sürüşte tam bir kez bildirilir', () => {
  for (const r of ROUTES) {
    const tracker = createPhotoAlertTracker();
    const lenM = routeLengthMeters(routeLine(r).coordinates);
    const ann = drive(r, 0, lenM, 50, tracker);
    const beklenen = SPOTS.filter((s) => s.routeId === r.id && s.safeStop === true && s.reachableFromRoute !== false)
      .map((s) => s.id).sort();
    assert.deepEqual(ann.map((a) => a.id).sort(), beklenen, r.id);
  }
});

test('bozuk pathFull: sessizce path\'e düşülmez, hata verilir (ortak routeLine kuralı)', () => {
  const r = route('tr-marmara-01');
  const d = pointAt(r.path.coordinates, 0);
  for (const pathFull of [{ type: 'Point', coordinates: [29.0, 40.0] }, 'bozuk']) {
    assert.throws(() => photoSpotsAheadOnRoute(d, { ...r, pathFull }, SPOTS), /route\.pathFull/, JSON.stringify(pathFull));
  }
  // Tek noktalı LineString de reddedilir (hata metni routeLine'da 'route.pathFull.coordinates: ...').
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

test('dil yedeği (tr → en): Türkçesi olmayan noktada sesli metnin tamamı İngilizce; Türkçesi olan nokta değişmez', () => {
  const yerli = SPOTS.filter((s) => s.title.tr === undefined);
  for (const s of yerli) {
    const en = buildPhotoVoiceAlert(s, 400, 'en');
    assert.equal(en, `Photo spot in 400 meters: ${s.title.en}.`, s.id); // gerçek veride sapma < 0,5 km
    assert.equal(buildPhotoVoiceAlert(s, 400, 'tr'), en, `${s.id}: tr istenince İngilizce okunmalı`);
    assert.equal(toPhotoAnnouncement({ spot: s, aheadM: 400 }, 'tr').text, en, s.id);
    assert.ok(!/Fotoğraf noktası|ileride|undefined/.test(buildPhotoVoiceAlert(s, 400, 'tr')), s.id);
  }
  // Sapma cümlesi de İngilizceye düşer (ÖRNEK sapma değeri).
  const p = yerli[0];
  assert.equal(buildPhotoVoiceAlert({ ...p, detourRoadKm: 2.3 }, 1000, 'tr'),
    `Photo spot in 1 kilometer: ${p.title.en}. About 2.3 kilometer detour off the route by road.`);
  // Ülke dili (el) sesli metin dili değildir; İngilizce okunur.
  assert.equal(buildPhotoVoiceAlert(p, 400, 'el'), `Photo spot in 400 meters: ${p.title.en}.`);
  // Türkçesi olan nokta Türkçe okunmaya devam eder.
  assert.equal(buildPhotoVoiceAlert(spot('ps-tr-marmara-01-01'), 20, 'tr'), 'Fotoğraf noktası hemen ileride: Kirazlıyayla – Bursa Ovası Manzarası.');
  // Ne istenen dilde ne İngilizcede başlık yoksa hata (sessizce "undefined" okunmaz).
  assert.throws(() => buildPhotoVoiceAlert({ ...p, title: { el: p.title.el } }, 400, 'tr'), TypeError);
  assert.throws(() => buildPhotoVoiceAlert({ ...p, title: { el: p.title.el, tr: '' } }, 400, 'tr'), TypeError);
});

test('gr-thessalia-01: üç nokta baştan sona sürüşte rota sırasıyla birer kez, yarıçap içinde bildirilir', () => {
  const r = route('gr-thessalia-01');
  const ids = SPOTS.filter((s) => s.routeId === r.id).map((s) => s.id);
  assert.deepEqual(ids, ['ps-gr-thessalia-01-01', 'ps-gr-thessalia-01-02', 'ps-gr-thessalia-01-03']);
  const ann = drive(r, 0, routeLengthMeters(routeLine(r).coordinates), 25, createPhotoAlertTracker());
  assert.deepEqual(ann.map((a) => a.id), ids);
  for (const a of ann) {
    const s = spot(a.id);
    assert.ok(a.aheadM <= s.notifyRadiusM && a.aheadM > s.notifyRadiusM - 30, `${a.id}: aheadM ${a.aheadM}`);
  }
});

test('es-andalucia-01: üç nokta (Boyar, Palomas, Acebuches) rota sırasıyla birer kez, yarıçap içinde; metinler es + en, Türkçe yok', () => {
  const r = route('es-andalucia-01');
  const ids = SPOTS.filter((s) => s.routeId === r.id).map((s) => s.id);
  assert.deepEqual(ids, ['ps-es-andalucia-01-01', 'ps-es-andalucia-01-02', 'ps-es-andalucia-01-03']);
  const ann = drive(r, 0, routeLengthMeters(routeLine(r).coordinates), 25, createPhotoAlertTracker());
  assert.deepEqual(ann.map((a) => a.id), ids);
  for (const a of ann) {
    const s = spot(a.id);
    assert.ok(a.aheadM <= s.notifyRadiusM && a.aheadM > s.notifyRadiusM - 30, `${a.id}: aheadM ${a.aheadM}`);
  }
  const { coordinates: coords } = routeLine(r);
  for (const id of ids) {
    const s = spot(id);
    assert.equal(s.safeStop, true, id);
    assert.equal(s.verification.status, 'doğrulanmalı', id);
    // Karar 19 bekleniyor: es metinlerinin ana dili İspanyolca olan biri tarafından kontrol edileceği notu.
    assert.match(s.verification.notes, /es metinleri ana dili İspanyolca olan biri tarafından kontrol edilmeli/, id);
    for (const f of LANG_FIELDS) assert.equal(s[f].tr, undefined, `${id}.${f}.tr`);
    // Noktaların kendisi rotaya 50 m'den yakın (rota-uzmani'nın OSM listesi; La Garganta Verde 362 m olduğu için seçilmedi).
    assert.ok(projectOnRoute(s.location, coords).offsetM < 50, `${id}: location offset`);
  }
  // Palomas: otopark (way 575269277) rotanın sağında, manzara noktası solunda (OSM, 2026-11-12); yaya yolu karşıya geçer.
  const palomas = spot('ps-es-andalucia-01-02');
  assert.match(palomas.safeStopInfo.es, /lados opuestos de la carretera: crúcela a pie con cuidado/);
  assert.match(palomas.safeStopInfo.en, /opposite sides of the road: cross on foot with care/);
  assert.match(palomas.verification.notes, /manzara noktası SOL tarafında/);
});

test('br-santa-catarina-01: üç nokta (Biker 3, ana mirante, Cascata da Barrinha) rota sırasıyla birer kez, yarıçap içinde; metinler pt + en, Türkçe yok', () => {
  const r = route('br-santa-catarina-01');
  const ids = SPOTS.filter((s) => s.routeId === r.id).map((s) => s.id);
  assert.deepEqual(ids, ['ps-br-santa-catarina-01-01', 'ps-br-santa-catarina-01-02', 'ps-br-santa-catarina-01-03']);
  const ann = drive(r, 0, routeLengthMeters(routeLine(r).coordinates), 25, createPhotoAlertTracker());
  assert.deepEqual(ann.map((a) => a.id), ids);
  for (const a of ann) {
    const s = spot(a.id);
    assert.ok(a.aheadM <= s.notifyRadiusM && a.aheadM > s.notifyRadiusM - 30, `${a.id}: aheadM ${a.aheadM}`);
  }
  const { coordinates: coords } = routeLine(r);
  for (const id of ids) {
    const s = spot(id);
    assert.equal(s.safeStop, true, id);
    assert.equal(s.verification.status, 'doğrulanmalı', id);
    // Karar 19 bekleniyor: pt metinlerinin ana dili Portekizce olan biri tarafından kontrol edileceği notu.
    assert.match(s.verification.notes, /pt metinleri ana dili Portekizce olan biri tarafından kontrol edilmeli/, id);
    for (const f of LANG_FIELDS) assert.equal(s[f].tr, undefined, `${id}.${f}.tr`);
    // Noktalar rotaya 150 m'den yakın (OSM; ana mirante ~131 m). Mirante Norte 406 m olduğu için seçilmedi.
    assert.ok(projectOnRoute(s.location, coords).offsetM < 150, `${id}: location offset`);
    assert.equal(s.geometryRevision.pathFullSha256, r.geometryRevision.pathFullSha256, `${id}: geometryRevision`);
  }
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
