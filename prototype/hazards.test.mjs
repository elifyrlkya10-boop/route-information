// Çalıştır: node prototype/hazards.test.mjs
// UYARI: Bu dosyadaki tüm tehlike, koordinat, POI ve Overpass yanıtı verileri ÖRNEKTİR (gerçek değildir).
// Ağ erişimi kullanılmaz; fetch sahte (fake) bir fonksiyonla değiştirilir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HAZARD_TYPES, ROUTE_ID_PATTERN, DEFAULT_OVERPASS_ENDPOINT,
  validateHazard, haversineMeters, hazardsWithinRadius, buildVoiceAlert,
  buildOverpassQuery, parseOverpassResponse, fetchNearbyPois,
  projectOnRoute, routeLengthMeters, hazardsAheadOnRoute, createAlertTracker,
  routeLine, defaultHazardFilter, orderAnnouncements, SKIP_REASONS,
  SOURCE_KINDS, VERIFICATION_STATUSES, HAZARD_STATUS_UNVERIFIED, isHazardUnverified, extentRevisionStatus,
  sameGeometryRevision, fuelGapsAlongRoute,
} from './hazards.js';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---- ÖRNEK veriler (isSample: true, gerçek tehlike değildir) ----
const ORNEK_SURUCU = { lat: 40.0, lon: 33.0 }; // örnek konum
const ornekHazard = (over = {}) => ({
  id: 'ornek-hz-1',
  routeId: 'tr-ic-anadolu-01',
  type: 'gravel',
  location: { lat: 40.002, lon: 33.0 }, // ~222 m kuzey (örnek)
  note: { en: 'SAMPLE note — not real', tr: 'ÖRNEK not — gerçek değil' },
  reportedBy: 'ornek-kullanici',
  reportedAt: '2026-11-01T09:30:00Z',
  isSample: true,
  ...over,
});

test('şema ile modül sabitleri tutarlı', () => {
  const schema = JSON.parse(readFileSync(new URL('../data/hazards.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.properties.type.enum, [...HAZARD_TYPES]);
  assert.equal(schema.properties.routeId.pattern, ROUTE_ID_PATTERN.source);
  assert.deepEqual([...schema.required].sort(), Object.keys(ornekHazard()).sort());
  assert.deepEqual(schema.properties.note.required, ['en']);
});

test('geçerli örnek hazard doğrulanır', () => {
  const r = validateHazard(ornekHazard());
  assert.deepEqual(r, { valid: true, errors: [] });
  assert.ok(validateHazard(ornekHazard({ routeId: 'tr-karadeniz-01' })).valid);
});

test('hatalı hazard alanları yakalanır', () => {
  const bad = [
    ornekHazard({ routeId: 'TR-karadeniz-1' }),
    ornekHazard({ routeId: 'tr-karadeniz' }),
    ornekHazard({ type: 'pothole' }),
    ornekHazard({ location: { lat: 91, lon: 0 } }),
    ornekHazard({ note: { tr: 'yalnız Türkçe' } }),
    ornekHazard({ note: { en: '' } }),
    ornekHazard({ reportedAt: '2026-11-01' }),
    ornekHazard({ isSample: 'yes' }),
    ornekHazard({ extra: 1 }),
  ];
  for (const h of bad) assert.equal(validateHazard(h).valid, false, JSON.stringify(h));
  const { isSample, ...eksik } = ornekHazard();
  assert.match(validateHazard(eksik).errors.join(), /isSample: zorunlu/);
  assert.equal(validateHazard(null).valid, false);
});

test('haversine bilinen mesafeler', () => {
  assert.equal(haversineMeters(ORNEK_SURUCU, ORNEK_SURUCU), 0);
  // 1 derece enlem ≈ 111.195 km
  assert.ok(Math.abs(haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 5);
  // Ekvatorda 180 derece ≈ yarım çevre
  assert.ok(Math.abs(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }) - Math.PI * 6371008.8) < 1);
});

test('yarıçap içindeki tehlikeler yakından uzağa sıralanır', () => {
  const list = [
    ornekHazard({ id: 'ornek-uzak', location: { lat: 40.004, lon: 33.0 } }), // ~445 m
    ornekHazard({ id: 'ornek-yakin', location: { lat: 40.001, lon: 33.0 } }), // ~111 m
    ornekHazard({ id: 'ornek-disari', location: { lat: 40.02, lon: 33.0 } }), // ~2.2 km
    ornekHazard({ id: 'ornek-gecersiz', type: 'bogus' }),
  ];
  const r = hazardsWithinRadius(ORNEK_SURUCU, list, 500, { includeSamples: true });
  assert.deepEqual(r.map((x) => x.hazard.id), ['ornek-yakin', 'ornek-uzak']);
  assert.ok(r[0].distanceM < r[1].distanceM);
  // Varsayılan: örnek kayıtlar gerçek uyarı olarak dönmez
  assert.equal(hazardsWithinRadius(ORNEK_SURUCU, list, 500).length, 0);
  // routeId filtresi
  assert.equal(hazardsWithinRadius(ORNEK_SURUCU, list, 500, { includeSamples: true, routeId: 'tr-karadeniz-01' }).length, 0);
  assert.throws(() => hazardsWithinRadius({}, list, 500));
});

test('sesli uyarı metni tr/en', () => {
  assert.equal(buildVoiceAlert(ornekHazard(), 222, 'tr'), 'Dikkat, 200 metre mesafede taşlı yol.');
  assert.equal(buildVoiceAlert(ornekHazard({ type: 'sharp_curve' }), 1530, 'en'), 'Caution, sharp curve in 1.5 kilometers.');
  assert.equal(buildVoiceAlert(ornekHazard({ type: 'steep_grade' }), 1530, 'tr'), 'Dikkat, 1,5 kilometre mesafede dik eğim.');
  assert.equal(buildVoiceAlert(ornekHazard({ type: 'roadwork' }), 20, 'en'), 'Caution, roadwork right here.');
  assert.equal(buildVoiceAlert(ornekHazard(), 990, 'en'), 'Caution, gravel road in 1 kilometer.');
  // Desteklenmeyen dil -> İngilizce yedek
  assert.match(buildVoiceAlert(ornekHazard(), 300, 'el'), /^Caution/);
});

test('Overpass sorgusu doğru etiketleri içerir', () => {
  const q = buildOverpassQuery(40.0, 33.0, 2000.4);
  assert.match(q, /^\[out:json\]\[timeout:25\];/);
  for (const tag of ['"amenity"="fuel"', '"shop"="supermarket"', '"shop"="convenience"', '"shop"="motorcycle"']) {
    assert.ok(q.includes(`nwr[${tag}](around:2000,40,33);`), tag);
  }
  assert.match(q, /out center tags;$/);
  assert.throws(() => buildOverpassQuery(100, 0, 100));
  assert.throws(() => buildOverpassQuery(0, 0, 0));
});

// ÖRNEK Overpass yanıtı — kimlikler ve isimler uydurma DEĞİL, açıkça örnek etiketlidir.
const ORNEK_OVERPASS_YANITI = {
  version: 0.6,
  generator: 'ORNEK (sabit test verisi)',
  elements: [
    { type: 'node', id: 1, lat: 40.009, lon: 33.0, tags: { amenity: 'fuel', name: 'ORNEK Benzinlik' } },          // ~1 km
    { type: 'way', id: 2, center: { lat: 40.001, lon: 33.0 }, tags: { shop: 'supermarket', name: 'ORNEK Market' } }, // ~111 m
    { type: 'node', id: 3, lat: 40.0045, lon: 33.0, tags: { shop: 'motorcycle', brand: 'ORNEK Marka' } },           // ~500 m, name yok
    { type: 'node', id: 4, lat: 40.003, lon: 33.0, tags: { shop: 'convenience' } },                                  // ~334 m, isimsiz
    { type: 'node', id: 5, lat: 40.002, lon: 33.0, tags: { amenity: 'cafe', name: 'ORNEK ilgisiz' } },             // atlanır
    { type: 'way', id: 6, tags: { amenity: 'fuel' } },                                                               // konumsuz, atlanır
    { type: 'node', id: 1, lat: 40.009, lon: 33.0, tags: { amenity: 'fuel', name: 'ORNEK Benzinlik' } },          // tekrar, atlanır
  ],
};

test('Overpass yanıtı Poi modeline çevrilir ve sıralanır', () => {
  const pois = parseOverpassResponse(ORNEK_OVERPASS_YANITI, ORNEK_SURUCU);
  assert.deepEqual(pois.map((p) => [p.id, p.type, p.name]), [
    ['osm:way/2', 'market', 'ORNEK Market'],
    ['osm:node/4', 'market', null],
    ['osm:node/3', 'gear_shop', 'ORNEK Marka'],
    ['osm:node/1', 'fuel', 'ORNEK Benzinlik'],
  ]);
  for (const p of pois) {
    assert.deepEqual(Object.keys(p).sort(), ['distanceM', 'id', 'location', 'name', 'type']);
    assert.ok(Number.isInteger(p.distanceM));
  }
  assert.ok(Math.abs(pois[0].distanceM - 111) <= 1);
  assert.deepEqual(parseOverpassResponse({}, ORNEK_SURUCU), []);
});

test('fetchNearbyPois sahte fetch ile (ağsız)', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ORNEK_OVERPASS_YANITI };
  };
  const pois = await fetchNearbyPois({ ...ORNEK_SURUCU, radiusM: 1500, fetchImpl: fakeFetch });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEFAULT_OVERPASS_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  const sentQuery = decodeURIComponent(calls[0].init.body.replace(/^data=/, ''));
  assert.equal(sentQuery, buildOverpassQuery(40.0, 33.0, 1500));
  assert.equal(pois.length, 4);
  assert.equal(pois[0].id, 'osm:way/2');

  // Özel endpoint
  await fetchNearbyPois({ ...ORNEK_SURUCU, radiusM: 1500, endpoint: 'https://ornek.invalid/api', fetchImpl: fakeFetch });
  assert.equal(calls[1].url, 'https://ornek.invalid/api');

  // HTTP hatası
  const failFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(fetchNearbyPois({ ...ORNEK_SURUCU, radiusM: 1500, fetchImpl: failFetch }), /HTTP 429/);
});

// ---------------- Rota boyunca ileriye bakış ----------------
// Geometri GERÇEK data/routes.json'dan okunur (değiştirilmez). Tehlike kayıtları ise ÖRNEKTİR:
// konumları test içinde rota çizgisi üzerinde hesaplanır, id'leri "ORNEK" ile başlar, isSample: true.
const ROUTES = JSON.parse(readFileSync(new URL('../data/routes.json', import.meta.url), 'utf8')).routes;
const rota = (id) => ROUTES.find((r) => r.id === id);
const NEMRUT = rota('tr-guneydogu-anadolu-01');
const KEMALIYE = rota('tr-dogu-anadolu-01');

// ÖRNEK yalnız-path rota (SENTETİK, gerçek değildir). 2026-11-11'den beri katalogdaki tüm rotalarda pathFull var
// (Kemaliye OSM way geometrisiyle yeniden üretildi); yalnız path olan rota davranışı bu örnekle sınanır.
// - path: Kemaliye'nin gerçek sadeleştirilmiş path çizgisinin kopyası (4 nokta, ~10,2 km); pathFull YOK.
// - lengthKm: Kemaliye'nin lengthKm'i (11,2) -> çizgi kısa, ölçek > 1 (eski Kemaliye durumunun benzeri).
// - verification "doğrulanmalı" -> routeApproximate true.
// - geometryRevision.pathFullSha256 null (pathFull olmayan rota); pathSha256 ÖRNEK karma.
const ORNEK_YALNIZ_PATH = Object.freeze({
  id: 'tr-ornek-01',
  isSample: true,
  name: { tr: 'ÖRNEK yalnız-path rota — gerçek değil', en: 'SAMPLE path-only route — not real' },
  lengthKm: KEMALIYE.lengthKm,
  path: structuredClone(KEMALIYE.path),
  geometryRevision: { date: '2026-11-05', pathSha256: 'a'.repeat(64), pathFullSha256: null },
  verification: { status: 'doğrulanmalı' },
});

// Test yardımcısı: çizgi boyunca alongM metredeki nokta; offsetM > 0 ise parçaya dik (sola) kaydırılır.
function pointAlong(lineCoords, alongM, offsetM = 0) {
  let cum = 0;
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [lonA, latA] = lineCoords[i];
    const [lonB, latB] = lineCoords[i + 1];
    const seg = haversineMeters({ lat: latA, lon: lonA }, { lat: latB, lon: lonB });
    if (cum + seg >= alongM || i === lineCoords.length - 2) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (alongM - cum) / seg)) : 0;
      const lat = latA + t * (latB - latA);
      const lon = lonA + t * (lonB - lonA);
      if (!offsetM) return { lat, lon };
      const k = Math.cos((lat * Math.PI) / 180);
      const ex = (lonB - lonA) * k, ny = latB - latA; // derece-ölçekli yerel vektör
      const n = Math.hypot(ex, ny);
      const mPerDeg = 111195;
      return { lat: lat + ((ex / n) * offsetM) / mPerDeg, lon: lon + ((-ny / n) * offsetM) / mPerDeg / k };
    }
    cum += seg;
  }
  throw new Error('ulaşılamaz');
}
// Örnek konumlar hazardsAheadOnRoute'un kullandığı çizgi üzerinde kurulur (route.pathFull ?? route.path).
const etkinCizgi = (route) => routeLine(route).coordinates;
const ornekRotaTehlikesi = (id, route, alongM, offsetM = 0, type = 'steep_grade') =>
  ornekHazard({ id: `ORNEK-${id}`, routeId: route.id, type, location: pointAlong(etkinCizgi(route), alongM, offsetM) });

test('projectOnRoute: gerçek rota çizgisinde köşe, ara nokta ve dik sapma', () => {
  const c = NEMRUT.path.coordinates;
  const total = routeLengthMeters(c);
  // Sadeleştirilmiş çizgi OSRM uzunluğundan kısa olabilir ama aynı mertebede olmalı
  assert.ok(total < NEMRUT.lengthKm * 1000 && total > NEMRUT.lengthKm * 1000 * 0.8, String(total));
  const bas = projectOnRoute({ lat: c[0][1], lon: c[0][0] }, c);
  assert.equal(bas.segmentIndex, 0);
  assert.ok(bas.distanceAlongM < 1e-6 && bas.offsetM < 1e-6);
  const son = projectOnRoute({ lat: c.at(-1)[1], lon: c.at(-1)[0] }, c);
  assert.equal(son.segmentIndex, c.length - 2);
  assert.ok(Math.abs(son.distanceAlongM - total) < 1e-6);
  const orta = projectOnRoute(pointAlong(c, 20000), c);
  assert.ok(Math.abs(orta.distanceAlongM - 20000) < 1, String(orta.distanceAlongM));
  assert.ok(orta.offsetM < 1);
  const sapma = projectOnRoute(pointAlong(c, 20000, 30), c);
  assert.ok(Math.abs(sapma.offsetM - 30) < 3, String(sapma.offsetM));
  assert.throws(() => projectOnRoute({ lat: 0, lon: 0 }, [[0, 0]]));
  assert.throws(() => projectOnRoute({ lat: 0, lon: 0 }, [[0, 0], [0, 95]]));
  assert.throws(() => projectOnRoute({}, c));
});

test('hazardsAheadOnRoute: ileride olanlar aheadM sırasıyla; geride ve paralel yoldakiler yok', () => {
  const c = etkinCizgi(NEMRUT);
  const surucu = pointAlong(c, 30000);
  const list = [
    ornekRotaTehlikesi('ileri-1500', NEMRUT, 31500, 0, 'sharp_curve'),
    ornekRotaTehlikesi('ileri-300', NEMRUT, 30300),
    ornekRotaTehlikesi('geride-200', NEMRUT, 29800),            // kuş uçuşu çok yakın ama geride
    ornekRotaTehlikesi('paralel-yol', NEMRUT, 30700, 200),       // ileride ama rotadan 200 m uzakta
    ornekRotaTehlikesi('menzil-disi', NEMRUT, 35000),            // lookAheadM dışında
    ornekRotaTehlikesi('gps-sapmasi', NEMRUT, 30900, 20, 'gravel'), // 20 m sapma: kabul
    ornekRotaTehlikesi('gecersiz', NEMRUT, 30500, 0, 'pothole'), // geçersiz tip: atlanır
  ];
  const r = hazardsAheadOnRoute(surucu, NEMRUT, list, { lookAheadM: 2000, maxOffsetM: 50, includeSamples: true });
  assert.equal(r.routeId, 'tr-guneydogu-anadolu-01');
  assert.equal(r.routeApproximate, false);
  assert.equal(r.offRoute, false);
  assert.ok(Math.abs(r.driver.distanceAlongM - 30000) < 1);
  assert.deepEqual(r.hazards.map((x) => x.hazard.id), ['ORNEK-ileri-300', 'ORNEK-gps-sapmasi', 'ORNEK-ileri-1500']);
  assert.ok(Math.abs(r.hazards[0].aheadM - 300) < 2);
  assert.ok(Math.abs(r.hazards[2].aheadM - 1500) < 2);
  for (let i = 1; i < r.hazards.length; i++) assert.ok(r.hazards[i - 1].aheadM <= r.hazards[i].aheadM);
  // Kuş uçuşu yöntem geride kalanı en yakın olarak döndürürdü — eski açık risk #1
  const kus = hazardsWithinRadius(surucu, list, 400, { includeSamples: true }).map((x) => x.hazard.id);
  assert.ok(kus.includes('ORNEK-geride-200'));
  // Varsayılan: örnek kayıtlar gerçek uyarı olarak dönmez
  assert.equal(hazardsAheadOnRoute(surucu, NEMRUT, list).hazards.length, 0);
});

test('hazardsAheadOnRoute: ters yön, rota dışı sürücü ve hatalı girdi', () => {
  const c = etkinCizgi(NEMRUT);
  const surucu = pointAlong(c, 30000);
  const list = [ornekRotaTehlikesi('a', NEMRUT, 30300), ornekRotaTehlikesi('b', NEMRUT, 29200)];
  const ters = hazardsAheadOnRoute(surucu, NEMRUT, list, { includeSamples: true, direction: 'reverse' });
  assert.deepEqual(ters.hazards.map((x) => x.hazard.id), ['ORNEK-b']);
  assert.ok(Math.abs(ters.hazards[0].aheadM - 800) < 2);
  const disari = hazardsAheadOnRoute(pointAlong(c, 30000, 500), NEMRUT, list, { includeSamples: true });
  assert.equal(disari.offRoute, true);
  assert.deepEqual(disari.hazards, []);
  assert.throws(() => hazardsAheadOnRoute({}, NEMRUT, list));
  assert.throws(() => hazardsAheadOnRoute(surucu, { id: 'x', path: { type: 'Point', coordinates: [0, 0] } }, list));
  assert.throws(() => hazardsAheadOnRoute(surucu, NEMRUT, list, { direction: 'geri' }));
  assert.throws(() => hazardsAheadOnRoute(surucu, NEMRUT, list, { maxOffsetM: -1 }));
});

test('routeApproximate: yalnızca "doğrulanmalı" rotada (Kemaliye, ÖRNEK yalnız-path) true', () => {
  for (const r of [...ROUTES, ORNEK_YALNIZ_PATH]) {
    const c = r.path.coordinates;
    const res = hazardsAheadOnRoute({ lat: c[0][1], lon: c[0][0] }, r, []);
    assert.equal(res.routeApproximate, r.verification.status === 'doğrulanmalı', r.id);
  }
  // Gerçek routes.json'da yalnız Kemaliye "doğrulanmalı" (pathFull'u olsa da)
  assert.deepEqual(ROUTES.filter((r) => r.verification.status === 'doğrulanmalı').map((r) => r.id), ['tr-dogu-anadolu-01']);
  assert.ok(KEMALIYE.pathFull != null);
  // Yalnız path olan ÖRNEK rota: path üzerinde, routeApproximate true
  const o = ORNEK_YALNIZ_PATH.path.coordinates;
  const ho = ornekRotaTehlikesi('yalniz-path', ORNEK_YALNIZ_PATH, 3000, 0, 'gravel');
  const ro = hazardsAheadOnRoute(pointAlong(o, 2500), ORNEK_YALNIZ_PATH, [ho], { includeSamples: true });
  assert.equal(ro.geometry, 'path');
  assert.equal(ro.routeApproximate, true);
  assert.equal(ro.hazards.length, 1);
  // Kemaliye: konumlar etkin çizgide (pathFull) kurulur
  const c = etkinCizgi(KEMALIYE);
  const h = ornekRotaTehlikesi('kemaliye', KEMALIYE, 3000, 0, 'gravel');
  const res = hazardsAheadOnRoute(pointAlong(c, 2500), KEMALIYE, [h], { includeSamples: true });
  assert.equal(res.geometry, 'pathFull');
  assert.equal(res.routeApproximate, true);
  assert.equal(res.hazards.length, 1);
  // Tehlike konumu çizgiye snap edilmez: kayıt aynen döner
  assert.equal(res.hazards[0].hazard, h);
  assert.deepEqual(res.hazards[0].hazard.location, h.location);
});

test('createAlertTracker: kademeli, tekrarsız uyarı ve yeniden kurulma', () => {
  const t = createAlertTracker(); // [1000, 300], rearmM 500
  assert.equal(t.shouldAnnounce('ORNEK-1', 1800), false); // henüz uzak
  assert.equal(t.shouldAnnounce('ORNEK-1', 990), true);   // ön uyarı
  assert.equal(t.shouldAnnounce('ORNEK-1', 700), false);  // tekrar okunmaz
  assert.equal(t.shouldAnnounce('ORNEK-1', 1100), false); // GPS sıçraması: yeniden kurulmaz (≤1500)
  assert.equal(t.shouldAnnounce('ORNEK-1', 900), false);
  assert.equal(t.shouldAnnounce('ORNEK-1', 280), true);   // yakın uyarı
  assert.equal(t.shouldAnnounce('ORNEK-1', 100), false);
  assert.equal(t.shouldAnnounce('ORNEK-1', 0), false);
  assert.equal(t.shouldAnnounce('ORNEK-1', -5), false);   // geride
  // Geç fark edilen tehlike: tek okuma, kademeler birikmez
  assert.equal(t.shouldAnnounce('ORNEK-2', 250), true);
  assert.equal(t.shouldAnnounce('ORNEK-2', 200), false);
  // Uzaklaşıp yeniden yaklaşma: >1500 m'de yeniden kurulur
  assert.equal(t.shouldAnnounce('ORNEK-1', 1600), false);
  assert.equal(t.shouldAnnounce('ORNEK-1', 950), true);
  assert.equal(t.shouldAnnounce('ORNEK-3', NaN), false);
  t.reset();
  assert.equal(t.size, 0);
  const ozel = createAlertTracker({ thresholdsM: [500], rearmM: 0 });
  assert.equal(ozel.shouldAnnounce('x', 499), true);
  assert.equal(ozel.shouldAnnounce('x', 10), false);
  assert.throws(() => createAlertTracker({ thresholdsM: [] }));
  assert.throws(() => createAlertTracker({ rearmM: -1 }));
});

test('ileriye bakış + tracker birlikte: sürüş simülasyonunda her tehlike en fazla 2 kez', () => {
  const c = etkinCizgi(NEMRUT);
  const list = [ornekRotaTehlikesi('s1', NEMRUT, 41020), ornekRotaTehlikesi('s2', NEMRUT, 41630, 0, 'sharp_curve')];
  const t = createAlertTracker();
  const okunan = [];
  for (let m = 38000; m <= 42000; m += 50) {
    const r = hazardsAheadOnRoute(pointAlong(c, m), NEMRUT, list, { includeSamples: true });
    for (const x of r.hazards) if (t.shouldAnnounce(x.hazard.id, x.aheadM)) okunan.push(`${x.hazard.id}@${m}`);
  }
  assert.deepEqual(okunan, ['ORNEK-s1@40050', 'ORNEK-s2@40650', 'ORNEK-s1@40750', 'ORNEK-s2@41350']);
});

// ---------------- pathFull, filter/getLocation, "ileride", öncelik ----------------
const AKDENIZ = rota('tr-akdeniz-01');
const yalnizPath = (route) => { const { pathFull, ...r } = route; return r; }; // kopya; routes.json değişmez

test('routeLine: katalogdaki tüm rotalarda (Kemaliye dahil) pathFull, ÖRNEK yalnız-path rotada path; lengthKm ile tutarlı', () => {
  assert.ok(ROUTES.every((r) => r.pathFull != null), 'routes.json: yalnız path olan rota kalmadı (2026-11-11)');
  for (const r of [...ROUTES, ORNEK_YALNIZ_PATH]) {
    const { geometry, coordinates } = routeLine(r);
    assert.equal(geometry, r === ORNEK_YALNIZ_PATH ? 'path' : 'pathFull', r.id);
    assert.equal(coordinates, (r.pathFull ?? r.path).coordinates);
    if (geometry === 'pathFull') {
      assert.ok(Math.abs(routeLengthMeters(coordinates) / 1000 - r.lengthKm) / r.lengthKm < 0.005, r.id);
    }
    const res = hazardsAheadOnRoute({ lat: coordinates[0][1], lon: coordinates[0][0] }, r, []);
    assert.equal(res.geometry, geometry, r.id);
  }
  assert.throws(() => routeLine({ ...NEMRUT, pathFull: { type: 'Point', coordinates: [0, 0] } }), /pathFull/);
  assert.throws(() => routeLine(null));
});

test('hazardsAheadOnRoute pathFull ile: aheadM gerçek yol mesafesi; pathFull yoksa eski davranış', () => {
  const full = etkinCizgi(AKDENIZ);
  const surucu = pointAlong(full, 20000);
  const h = ornekRotaTehlikesi('akdeniz-viraj', AKDENIZ, 21000, 0, 'sharp_curve');
  const r = hazardsAheadOnRoute(surucu, AKDENIZ, [h], { includeSamples: true });
  assert.equal(r.geometry, 'pathFull');
  assert.equal(r.offRoute, false);
  assert.equal(r.hazards.length, 1);
  assert.ok(Math.abs(r.hazards[0].aheadM - 1000) < 2, String(r.hazards[0].aheadM));
  // Aynı rota pathFull'suz: path kullanılır, sonuç doğrudan path üzerinde hesaplananla aynıdır
  const eski = yalnizPath(NEMRUT);
  const c = eski.path.coordinates;
  const hs = [ornekHazard({ id: 'ORNEK-eski', routeId: eski.id, location: pointAlong(c, 30400) })];
  const re = hazardsAheadOnRoute(pointAlong(c, 30000), eski, hs, { includeSamples: true });
  assert.equal(re.geometry, 'path');
  // Çizgi üzerindeki fark hâlâ 400 m; aheadM artık yol mesafesi (× scale = lengthKm / path uzunluğu)
  assert.ok(Math.abs(re.hazards[0].distanceAlongM - re.driver.distanceAlongM - 400) < 2);
  assert.ok(Math.abs(re.hazards[0].aheadM - 400 * re.scale) < 2);
  // ÖRNEK yalnız-path rota: path + routeApproximate
  const o = hazardsAheadOnRoute(pointAlong(ORNEK_YALNIZ_PATH.path.coordinates, 1000), ORNEK_YALNIZ_PATH, []);
  assert.equal(o.geometry, 'path');
  assert.equal(o.routeApproximate, true);
  // Kemaliye (gerçek): artık pathFull + routeApproximate (durum "doğrulanmalı")
  const k = hazardsAheadOnRoute(pointAlong(etkinCizgi(KEMALIYE), 1000), KEMALIYE, []);
  assert.equal(k.geometry, 'pathFull');
  assert.equal(k.scale, 1);
  assert.equal(k.routeApproximate, true);
});

test('rota dışı kontrolü pathFull\'a göre yapılır', () => {
  const full = etkinCizgi(AKDENIZ);
  assert.equal(hazardsAheadOnRoute(pointAlong(full, 15000, 80), AKDENIZ, []).offRoute, false);
  const disari = hazardsAheadOnRoute(pointAlong(full, 15000, 150), AKDENIZ, []);
  assert.equal(disari.offRoute, true);
  assert.equal(disari.geometry, 'pathFull');
  assert.ok(Math.abs(disari.driver.offsetM - 150) < 10, String(disari.driver.offsetM));
});

test('filter ve getLocation: varsayılan süzgeç korunur, başka kayıt türleri için değiştirilebilir', () => {
  const full = etkinCizgi(NEMRUT);
  const surucu = pointAlong(full, 30000);
  // ÖRNEK fotoğraf-noktası benzeri kayıt: tehlike şemasına uymaz, konumu approachPoint'tedir
  const ornekFoto = { id: 'ORNEK-foto', isSample: true, approachPoint: pointAlong(full, 30600), location: pointAlong(full, 30600, 2000) };
  const tehlike = ornekRotaTehlikesi('t', NEMRUT, 30300);
  // Varsayılan: şemaya uymayan kayıt atlanır (eski davranış)
  assert.deepEqual(hazardsAheadOnRoute(surucu, NEMRUT, [ornekFoto, tehlike], { includeSamples: true }).hazards.map((x) => x.hazard.id), ['ORNEK-t']);
  assert.equal(defaultHazardFilter(tehlike), false); // örnek, includeSamples yok
  assert.equal(defaultHazardFilter(tehlike, { includeSamples: true }), true);
  assert.equal(defaultHazardFilter(ornekFoto, { includeSamples: true }), false);
  // Özel süzgeç + approachPoint
  const gorulen = [];
  const filter = (x, opts) => { gorulen.push(opts.includeSamples); return typeof x.approachPoint === 'object' && (!x.isSample || opts.includeSamples); };
  const r = hazardsAheadOnRoute(surucu, NEMRUT, [ornekFoto, tehlike], { includeSamples: true, filter, getLocation: (x) => x.approachPoint });
  assert.deepEqual(r.hazards.map((x) => x.hazard.id), ['ORNEK-foto']);
  assert.ok(Math.abs(r.hazards[0].aheadM - 600) < 2);
  assert.deepEqual(gorulen, [true, true]);
  // Varsayılan konumla (location rotadan 2 km uzakta) aynı kayıt maxOffsetM'e takılır
  assert.equal(hazardsAheadOnRoute(surucu, NEMRUT, [ornekFoto], { includeSamples: true, filter }).hazards.length, 0);
  // Geçersiz konum döndüren kayıt hata vermeden atlanır
  assert.equal(hazardsAheadOnRoute(surucu, NEMRUT, [ornekFoto], { filter: () => true, getLocation: () => null }).hazards.length, 0);
  assert.throws(() => hazardsAheadOnRoute(surucu, NEMRUT, [], { filter: 'x' }));
  assert.throws(() => hazardsAheadOnRoute(surucu, NEMRUT, [], { getLocation: 1 }));
});

test('sesli uyarı: yön bilgisi varsa "ileride" / "ahead"', () => {
  const o = { ahead: true };
  assert.equal(buildVoiceAlert(ornekHazard(), 300, 'tr', o), 'Dikkat, 300 metre ileride taşlı yol.');
  assert.equal(buildVoiceAlert(ornekHazard(), 300, 'en', o), 'Caution, gravel road 300 meters ahead.');
  assert.equal(buildVoiceAlert(ornekHazard({ type: 'sharp_curve' }), 1530, 'tr', o), 'Dikkat, 1,5 kilometre ileride keskin viraj.');
  assert.equal(buildVoiceAlert(ornekHazard({ type: 'sharp_curve' }), 1530, 'en', o), 'Caution, sharp curve 1.5 kilometers ahead.');
  assert.equal(buildVoiceAlert(ornekHazard({ type: 'roadwork' }), 990, 'tr', o), 'Dikkat, 1 kilometre ileride yol çalışması.');
  assert.equal(buildVoiceAlert(ornekHazard({ type: 'roadwork' }), 1020, 'en', o), 'Caution, roadwork 1 kilometer ahead.');
  assert.equal(buildVoiceAlert(ornekHazard(), 20, 'tr', o), 'Dikkat, çok yakında taşlı yol.');
  // Yön bilgisi yoksa eski metin (kuş uçuşu)
  assert.equal(buildVoiceAlert(ornekHazard(), 300, 'tr'), 'Dikkat, 300 metre mesafede taşlı yol.');
  assert.equal(buildVoiceAlert(ornekHazard(), 300, 'en', { ahead: false }), 'Caution, gravel road in 300 meters.');
});

test('orderAnnouncements: önce tehlike, sonra fotoğraf; tür içinde yakın olan önce', () => {
  const giris = [
    { kind: 'photo', id: 'ORNEK-f1', aheadM: 100 },
    { kind: 'hazard', id: 'ORNEK-h2', aheadM: 900 },
    { kind: 'other', id: 'ORNEK-x' },
    { kind: 'hazard', id: 'ORNEK-h1', aheadM: 280 },
    { kind: 'photo', id: 'ORNEK-f2', aheadM: 100 },
  ];
  const kopya = structuredClone(giris);
  assert.deepEqual(orderAnnouncements(giris).map((x) => x.id), ['ORNEK-h1', 'ORNEK-h2', 'ORNEK-f1', 'ORNEK-f2', 'ORNEK-x']);
  assert.deepEqual(giris, kopya); // girdi değişmez
  assert.deepEqual(orderAnnouncements([]), []);
  assert.throws(() => orderAnnouncements(null));
});

// ---------------- scale, lookAheadOf, includeSkipped (ortak çizgi kuralı) ----------------

test('routeLine.scale: pathFull için 1; yalnız path varsa lengthKm / çizgi uzunluğu', () => {
  for (const r of [...ROUTES, ORNEK_YALNIZ_PATH]) {
    const { geometry, scale } = routeLine(r);
    if (geometry === 'pathFull') assert.equal(scale, 1, r.id);
    else assert.ok(Math.abs(scale - (r.lengthKm * 1000) / routeLengthMeters(r.path.coordinates)) < 1e-12, r.id);
  }
  // Kemaliye (gerçek) artık pathFull: ölçek 1
  assert.equal(routeLine(KEMALIYE).geometry, 'pathFull');
  assert.equal(routeLine(KEMALIYE).scale, 1);
  const k = routeLine(ORNEK_YALNIZ_PATH);
  assert.equal(k.geometry, 'path');
  assert.ok(k.scale > 1 && k.scale < 1.15, String(k.scale)); // ÖRNEK: 11,2 km / ~10,2 km çizgi
  // lengthKm yoksa/geçersizse ölçek 1 (çizgi mesafesi olduğu gibi)
  const { lengthKm, ...uzunluksuz } = ORNEK_YALNIZ_PATH;
  assert.equal(routeLine(uzunluksuz).scale, 1);
  assert.equal(routeLine({ ...ORNEK_YALNIZ_PATH, lengthKm: 0 }).scale, 1);
  assert.equal(routeLine({ ...ORNEK_YALNIZ_PATH, lengthKm: 'x' }).scale, 1);
  // pathFull varsa lengthKm farklı olsa bile ölçeklenmez
  assert.equal(routeLine({ ...NEMRUT, lengthKm: 999 }).scale, 1);
});

test('ÖRNEK yalnız-path rota: aheadM = çizgi mesafesi × lengthKm / çizgi uzunluğu; lookAheadM yol mesafesiyle', () => {
  const R = ORNEK_YALNIZ_PATH;
  const c = R.path.coordinates;
  const { scale } = routeLine(R);
  const h = ornekRotaTehlikesi('yalniz-path-olcek', R, 4000, 0, 'gravel');
  const r = hazardsAheadOnRoute(pointAlong(c, 2000), R, [h], { includeSamples: true, lookAheadM: 3000 });
  assert.equal(r.scale, scale);
  assert.equal(r.routeApproximate, true);
  const cizgi = r.hazards[0].distanceAlongM - r.driver.distanceAlongM;
  assert.ok(Math.abs(cizgi - 2000) < 2, String(cizgi));
  assert.ok(Math.abs(r.hazards[0].aheadM - cizgi * scale) < 1e-6);
  assert.ok(r.hazards[0].aheadM > 2010); // ölçek (>1) uygulanmış
  // Menzil yol mesafesine uygulanır: çizgide 2000 m ama yolda >2000 m -> lookAheadM 2010'da dönmez
  assert.equal(hazardsAheadOnRoute(pointAlong(c, 2000), R, [h], { includeSamples: true, lookAheadM: 2010 }).hazards.length, 0);
  // pathFull rotasında scale 1 ve aheadM çizgi farkıyla aynı
  const full = etkinCizgi(AKDENIZ);
  const a = hazardsAheadOnRoute(pointAlong(full, 10000), AKDENIZ, [ornekRotaTehlikesi('ak', AKDENIZ, 10700)], { includeSamples: true });
  assert.equal(a.scale, 1);
  assert.equal(a.hazards[0].aheadM, a.hazards[0].distanceAlongM - a.driver.distanceAlongM);
});

test('Kemaliye (gerçek, 2026-11-11): pathFull ~lengthKm, scale 1, aheadM = çizgi farkı, routeApproximate true', () => {
  const c = etkinCizgi(KEMALIYE);
  assert.equal(c, KEMALIYE.pathFull.coordinates);
  const fullM = routeLengthMeters(c);
  assert.ok(Math.abs(fullM / 1000 - KEMALIYE.lengthKm) / KEMALIYE.lengthKm < 0.005, String(fullM)); // ~11,17 / 11,2 km
  assert.ok(fullM > routeLengthMeters(KEMALIYE.path.coordinates)); // sadeleştirilmiş path daha kısa
  const h = ornekRotaTehlikesi('kemaliye-full', KEMALIYE, 5000, 0, 'gravel');
  const r = hazardsAheadOnRoute(pointAlong(c, 3040), KEMALIYE, [h], { includeSamples: true, lookAheadM: 3000 });
  assert.equal(r.geometry, 'pathFull');
  assert.equal(r.scale, 1);
  assert.equal(r.routeApproximate, true);
  assert.equal(r.offRoute, false);
  assert.equal(r.hazards.length, 1);
  assert.equal(r.hazards[0].aheadM, r.hazards[0].distanceAlongM - r.driver.distanceAlongM);
  assert.ok(Math.abs(r.hazards[0].aheadM - 1960) < 2, String(r.hazards[0].aheadM));
  // Menzil düz yol mesafesi: 1960 m < 1970 döner, 1950'de dönmez
  assert.equal(hazardsAheadOnRoute(pointAlong(c, 3040), KEMALIYE, [h], { includeSamples: true, lookAheadM: 1970 }).hazards.length, 1);
  assert.equal(hazardsAheadOnRoute(pointAlong(c, 3040), KEMALIYE, [h], { includeSamples: true, lookAheadM: 1950 }).hazards.length, 0);
  // Geometri revizyonu: pathFullSha256 artık karma (null değil)
  assert.match(KEMALIYE.geometryRevision.pathFullSha256, /^[0-9a-f]{64}$/);
});

test('lookAheadOf: kayıt başına menzil; geçersiz değerde lookAheadM', () => {
  const c = etkinCizgi(NEMRUT);
  const surucu = pointAlong(c, 30000);
  const menzil = { 'ORNEK-r300': 300, 'ORNEK-r1000': 1000, 'ORNEK-nan': NaN, 'ORNEK-neg': -1 };
  const list = [
    ornekRotaTehlikesi('r300', NEMRUT, 30500),   // 500 m ileride, menzil 300 -> dönmez
    ornekRotaTehlikesi('r1000', NEMRUT, 30500),  // 500 m ileride, menzil 1000 -> döner
    ornekRotaTehlikesi('nan', NEMRUT, 31500),    // geçersiz menzil -> lookAheadM (2000) -> döner
    ornekRotaTehlikesi('neg', NEMRUT, 32500),    // negatif menzil -> lookAheadM (2000) -> dönmez (2500)
    ornekRotaTehlikesi('yok', NEMRUT, 31800),    // undefined -> lookAheadM -> döner
  ];
  const r = hazardsAheadOnRoute(surucu, NEMRUT, list, { includeSamples: true, lookAheadOf: (h) => menzil[h.id] });
  assert.deepEqual(r.hazards.map((x) => x.hazard.id), ['ORNEK-r1000', 'ORNEK-nan', 'ORNEK-yok']);
  // lookAheadOf verilmezse eski davranış
  assert.deepEqual(hazardsAheadOnRoute(surucu, NEMRUT, list, { includeSamples: true }).hazards.map((x) => x.hazard.id),
    ['ORNEK-r1000', 'ORNEK-r300', 'ORNEK-nan', 'ORNEK-yok']);
  assert.throws(() => hazardsAheadOnRoute(surucu, NEMRUT, list, { lookAheadOf: 5 }), /lookAheadOf/);
});

test('includeSkipped: filter/location/offset nedenleri; geride ve menzil dışı listeye girmez', () => {
  assert.deepEqual([...SKIP_REASONS], ['filter', 'location', 'offset']);
  const c = etkinCizgi(NEMRUT);
  const surucu = pointAlong(c, 30000);
  const ileri = ornekRotaTehlikesi('ileri', NEMRUT, 30400);
  const gecersizTip = ornekRotaTehlikesi('tip', NEMRUT, 30500, 0, 'pothole');
  const kopuk = ornekRotaTehlikesi('kopuk', NEMRUT, 30600, 300);
  const geride = ornekRotaTehlikesi('geride', NEMRUT, 29000);
  const uzak = ornekRotaTehlikesi('uzak', NEMRUT, 36000);
  const list = [ileri, gecersizTip, kopuk, geride, uzak];
  const r = hazardsAheadOnRoute(surucu, NEMRUT, list, { includeSamples: true, includeSkipped: true });
  assert.deepEqual(r.hazards.map((x) => x.hazard.id), ['ORNEK-ileri']);
  assert.deepEqual(r.skipped.map((x) => [x.item.id, x.reason]), [['ORNEK-tip', 'filter'], ['ORNEK-kopuk', 'offset']]);
  assert.equal(r.skipped[0].item, gecersizTip);
  assert.equal('offsetM' in r.skipped[0], false);
  assert.ok(r.skipped[1].offsetM > 50 && r.skipped[1].offsetM <= 310, String(r.skipped[1].offsetM)); // en yakın parçaya izdüşüm (köşede 300'den az olabilir)
  // Örnek kayıtlar includeSamples olmadan 'filter' nedeniyle atlanır (sessiz değil, raporlanır)
  const v = hazardsAheadOnRoute(surucu, NEMRUT, list, { includeSkipped: true });
  assert.equal(v.hazards.length, 0);
  assert.deepEqual(v.skipped.map((x) => x.reason), ['filter', 'filter', 'filter', 'filter', 'filter']);
  // Geçerli konum dönmeyen kayıt: 'location'
  const l = hazardsAheadOnRoute(surucu, NEMRUT, [ileri], { includeSamples: true, includeSkipped: true, getLocation: () => ({ lat: 'x' }) });
  assert.deepEqual(l.skipped.map((x) => x.reason), ['location']);
  // Varsayılan: skipped alanı yok (eski dönüş biçimi)
  assert.equal('skipped' in hazardsAheadOnRoute(surucu, NEMRUT, list, { includeSamples: true }), false);
  // Rota dışı sürücü: kayıtlar değerlendirilmez, skipped boş
  const d = hazardsAheadOnRoute(pointAlong(c, 30000, 500), NEMRUT, list, { includeSamples: true, includeSkipped: true });
  assert.equal(d.offRoute, true);
  assert.deepEqual(d.skipped, []);
});

test('ince sarmalayıcı örneği: fotoğraf noktası benzeri ÖRNEK kayıtlar (filter + getLocation + lookAheadOf + includeSkipped)', () => {
  const full = etkinCizgi(NEMRUT);
  const surucu = pointAlong(full, 30000);
  const ornekNokta = (id, alongM, offsetM, notifyRadiusM, over = {}) => ({
    id: `ORNEK-${id}`, routeId: NEMRUT.id, isSample: true, safeStop: true, notifyRadiusM,
    approachPoint: pointAlong(full, alongM, offsetM), ...over,
  });
  const noktalar = [
    ornekNokta('yakin', 30800, 0, 1000),
    ornekNokta('yaricap-disi', 31500, 0, 1000),
    ornekNokta('kopuk', 30500, 250, 3000),
    ornekNokta('guvensiz', 30400, 0, 1000, { safeStop: false }),
    ornekNokta('baska-rota', 30400, 0, 1000, { routeId: 'tr-ege-01' }),
  ];
  const filter = (s, { includeSamples }) => s.safeStop === true && s.routeId === NEMRUT.id && (!s.isSample || includeSamples);
  const r = hazardsAheadOnRoute(surucu, NEMRUT, noktalar, {
    includeSamples: true, filter, getLocation: (s) => s.approachPoint, lookAheadOf: (s) => s.notifyRadiusM,
    maxOffsetM: 100, includeSkipped: true,
  });
  assert.deepEqual(r.hazards.map((x) => x.hazard.id), ['ORNEK-yakin']);
  assert.ok(Math.abs(r.hazards[0].aheadM - 800) < 2);
  // detached karşılığı: reason 'offset'
  assert.deepEqual(r.skipped.filter((x) => x.reason === 'offset').map((x) => x.item.id), ['ORNEK-kopuk']);
  assert.deepEqual(r.skipped.filter((x) => x.reason === 'filter').map((x) => x.item.id), ['ORNEK-guvensiz', 'ORNEK-baska-rota']);
});

// ---------------- Karar 7B (source/verification/extent) ve 8A (temkinli metin) ----------------
// Kayıtlar ÖRNEKTİR (isSample: true). OSM ref/tag değerleri biçim testi içindir, bir tehlike iddiası değildir.
const ornek7B = (over = {}) => ornekHazard({
  id: 'ORNEK-7b',
  source: { kind: 'osm', ref: 'way/1', tag: 'surface=gravel' },
  verification: { status: 'doğrulanmalı', notes: 'ÖRNEK — gerçek değil' },
  extent: {
    fromKm: 1.2, toKm: 2.5, geometry: 'pathFull',
    line: { type: 'LineString', coordinates: [[33.0, 40.0], [33.01, 40.01]] },
    geometryRevision: { date: '2026-11-05', pathSha256: 'a'.repeat(64), pathFullSha256: null },
  },
  ...over,
});

test('şema: source/verification/extent isteğe bağlı ve modül sabitleriyle tutarlı', () => {
  const schema = JSON.parse(readFileSync(new URL('../data/hazards.schema.json', import.meta.url), 'utf8'));
  for (const k of ['source', 'verification', 'extent']) {
    assert.ok(schema.properties[k], k);
    assert.ok(!schema.required.includes(k), `${k} zorunlu olmamalı (geriye uyum)`);
  }
  assert.deepEqual(schema.properties.source.properties.kind.enum, [...SOURCE_KINDS]);
  assert.deepEqual(schema.properties.verification.properties.status.enum, [...VERIFICATION_STATUSES]);
  assert.ok(VERIFICATION_STATUSES.includes(HAZARD_STATUS_UNVERIFIED));
  assert.deepEqual(Object.keys(schema.properties.extent.properties.geometryRevision.properties), ['date', 'pathSha256', 'pathFullSha256']);
  // Eski biçimdeki kayıt (yeni alanlar yok) hâlâ geçerli.
  assert.deepEqual(validateHazard(ornekHazard()), { valid: true, errors: [] });
});

test('validateHazard: geçerli source/verification/extent kabul edilir', () => {
  assert.deepEqual(validateHazard(ornek7B()), { valid: true, errors: [] });
  // Yalnızca km, yalnızca line, user/field kaynak, doğrulandı + checkedAt
  const { line, ...kmOnly } = ornek7B().extent;
  assert.ok(validateHazard(ornek7B({ extent: kmOnly })).valid);
  assert.ok(validateHazard(ornek7B({ extent: { line } })).valid);
  assert.ok(validateHazard(ornek7B({ source: { kind: 'user', ref: 'ornek-bildirim-1' } })).valid);
  assert.ok(validateHazard(ornek7B({ source: { kind: 'field', ref: 'ornek-saha-1' } })).valid);
  assert.ok(validateHazard(ornek7B({ verification: { status: 'doğrulandı', checkedAt: '2026-11-05T10:00:00Z' } })).valid);
  const rev = { date: '2026-11-05', pathSha256: 'b'.repeat(64), pathFullSha256: 'c'.repeat(64) };
  assert.ok(validateHazard(ornek7B({ extent: { ...kmOnly, geometryRevision: rev } })).valid);
});

test('validateHazard: hatalı source/verification/extent yakalanır', () => {
  const errs = (over) => validateHazard(ornek7B(over)).errors.join(' | ');
  const base = ornek7B().extent;
  assert.match(errs({ source: { kind: 'wiki', ref: 'x' } }), /source\.kind/);
  assert.match(errs({ source: { kind: 'osm', ref: '49055992', tag: 'surface=gravel' } }), /source\.ref: osm/);
  assert.match(errs({ source: { kind: 'osm', ref: 'way/1' } }), /source\.tag: osm için zorunlu/);
  assert.match(errs({ source: { kind: 'osm', ref: 'way/1', tag: 'gravel' } }), /source\.tag: anahtar=değer/);
  assert.match(errs({ source: { kind: 'user', ref: '' } }), /source\.ref/);
  assert.match(errs({ source: { kind: 'user', ref: 'x', extra: 1 } }), /source\.extra: bilinmeyen alan/);
  assert.match(errs({ verification: { status: 'belki' } }), /verification\.status/);
  assert.match(errs({ verification: { status: 'doğrulandı', checkedAt: 'dün' } }), /verification\.checkedAt/);
  assert.match(errs({ verification: { status: 'doğrulandı', notes: '' } }), /verification\.notes/);
  assert.match(errs({ verification: 'doğrulanmalı' }), /verification: nesne/);
  assert.match(errs({ extent: {} }), /extent: \{fromKm, toKm\} ve\/veya line/);
  assert.match(errs({ extent: { ...base, fromKm: 3, toKm: 2 } }), /fromKm <= toKm/);
  assert.match(errs({ extent: { ...base, fromKm: -1 } }), /extent\.fromKm/);
  assert.match(errs({ extent: { fromKm: 1, toKm: 2 } }), /extent\.geometry: fromKm\/toKm ile zorunlu/);
  assert.match(errs({ extent: { fromKm: 1, geometry: 'path' } }), /extent\.toKm/);
  assert.match(errs({ extent: { line: { type: 'LineString', coordinates: [[33, 40]] } } }), /extent\.line\.coordinates: en az 2/);
  assert.match(errs({ extent: { line: { type: 'LineString', coordinates: [[40, 95], [33, 40]] } } }), /extent\.line\.coordinates: her nokta/);
  assert.match(errs({ extent: { line: { type: 'Point', coordinates: [33, 40] } } }), /extent\.line: GeoJSON LineString/);
  assert.match(errs({ extent: { ...base, geometryRevision: { date: '5 Kasım', pathSha256: 'x', pathFullSha256: 'y' } } }),
    /geometryRevision\.date.*geometryRevision\.pathSha256.*geometryRevision\.pathFullSha256/);
  assert.match(errs({ extent: { ...base, geometryRevision: { date: '2026-11-05', pathSha256: 'a'.repeat(64) } } }), /pathFullSha256/);
  assert.match(errs({ extent: { ...base, kmFrom: 1 } }), /extent\.kmFrom: bilinmeyen alan/);
  // Yeni alanlarda hata olan kayıt ileriye bakışta 'filter' ile atlanır.
  assert.equal(defaultHazardFilter(ornek7B({ verification: { status: 'belki' } }), { includeSamples: true }), false);
});

test('8A: doğrulanmalı kayıt temkinli metinle okunur; doğrulandı ve eski kayıt aynı metinle', () => {
  const u = ornek7B();
  assert.equal(isHazardUnverified(u), true);
  assert.equal(buildVoiceAlert(u, 300, 'tr', { ahead: true }), 'Dikkat, 300 metre ileride olası taşlı yol.');
  assert.equal(buildVoiceAlert(u, 300, 'en', { ahead: true }), 'Caution, possible gravel road 300 meters ahead.');
  assert.equal(buildVoiceAlert({ ...u, type: 'roadwork' }, 1200, 'tr', { ahead: true }), 'Dikkat, 1,2 kilometre ileride olası yol çalışması.');
  assert.equal(buildVoiceAlert({ ...u, type: 'steep_grade' }, 600, 'en'), 'Caution, possible steep grade in 600 meters.');
  assert.equal(buildVoiceAlert({ ...u, type: 'sharp_curve' }, 20, 'tr'), 'Dikkat, çok yakında olası keskin viraj.');
  const v = ornek7B({ verification: { status: 'doğrulandı', checkedAt: '2026-11-05T10:00:00Z' } });
  assert.equal(isHazardUnverified(v), false);
  assert.equal(buildVoiceAlert(v, 300, 'tr', { ahead: true }), 'Dikkat, 300 metre ileride taşlı yol.');
  assert.equal(isHazardUnverified(ornekHazard()), false);
  assert.equal(buildVoiceAlert(ornekHazard(), 300, 'en', { ahead: true }), 'Caution, gravel road 300 meters ahead.');
});

test('extentRevisionStatus: rotanın geometryRevision karmasıyla eskime kontrolü (gerçek routes.json)', () => {
  const r = ROUTES.find((x) => x.id === 'tr-guneydogu-anadolu-01');
  assert.ok(r.geometryRevision, 'routes.json geometryRevision taşımalı (karar 5A)');
  const kopya = { ...r.geometryRevision };
  const h = (geometryRevision) => ornek7B({ routeId: r.id, extent: { fromKm: 1, toKm: 2, geometry: 'pathFull', geometryRevision } });
  assert.ok(validateHazard(h(kopya)).valid, 'routes.json geometryRevision kopyası şemaya uymalı');
  assert.equal(extentRevisionStatus(h(kopya), r), 'current');
  assert.equal(extentRevisionStatus(h({ ...kopya, date: '2030-01-01' }), r), 'current', 'date karşılaştırılmaz');
  assert.equal(extentRevisionStatus(h({ ...kopya, pathFullSha256: 'f'.repeat(64) }), r), 'stale');
  assert.equal(extentRevisionStatus(h({ ...kopya, pathSha256: 'f'.repeat(64) }), r), 'stale');
  assert.equal(extentRevisionStatus(ornekHazard(), r), 'none');
  const { geometryRevision, ...revsiz } = r;
  assert.equal(extentRevisionStatus(h(kopya), revsiz), 'none');
  // pathFull olmayan rota (ÖRNEK yalnız-path; katalogda artık yok): pathFullSha256 null kopyası da 'current'
  const k = ORNEK_YALNIZ_PATH;
  assert.equal(k.pathFull, undefined);
  assert.equal(k.geometryRevision.pathFullSha256, null);
  assert.equal(extentRevisionStatus(h({ ...k.geometryRevision }), k), 'current');
  assert.equal(extentRevisionStatus(h({ ...k.geometryRevision, pathFullSha256: 'f'.repeat(64) }), k), 'stale');
  // Kemaliye (gerçek): eski null'lı kopya (pathFull eklenmeden önceki revizyon) artık 'stale'
  const kem = KEMALIYE;
  assert.equal(extentRevisionStatus(h({ ...kem.geometryRevision }), kem), 'current');
  assert.equal(extentRevisionStatus(h({ ...kem.geometryRevision, pathFullSha256: null }), kem), 'stale');
});

test('sameGeometryRevision: alan alan karma eşitliği, null === null, date karşılaştırılmaz (gerçek routes.json)', () => {
  const r = ROUTES.find((x) => x.pathFull != null);
  const k = ORNEK_YALNIZ_PATH; // ÖRNEK yalnız-path rota: pathFullSha256 null (katalogda böyle rota artık yok)
  const rev = r.geometryRevision;
  assert.equal(sameGeometryRevision(rev, { ...rev }), true);
  assert.equal(sameGeometryRevision({ ...rev, date: '2030-01-01' }, rev), true, 'date karşılaştırılmaz');
  assert.equal(sameGeometryRevision({ ...rev, pathSha256: 'f'.repeat(64) }, rev), false);
  assert.equal(sameGeometryRevision({ ...rev, pathFullSha256: 'f'.repeat(64) }, rev), false);
  assert.equal(sameGeometryRevision({ ...rev, pathFullSha256: null }, rev), false, 'null ile karma eşit değil');
  assert.equal(k.geometryRevision.pathFullSha256, null);
  assert.equal(sameGeometryRevision({ ...k.geometryRevision }, k.geometryRevision), true, 'null === null');
  assert.equal(sameGeometryRevision(k.geometryRevision, rev), false, 'farklı rotalar');
  // Geriye uyum: pathFullSha256 alanı yoksa null sayılır.
  const { pathFullSha256: _p, ...eksik } = k.geometryRevision;
  assert.equal(sameGeometryRevision(eksik, k.geometryRevision), true);
  // Simetrik
  for (const [a, b] of [[rev, { ...rev, date: '2030-01-01' }], [rev, k.geometryRevision], [eksik, k.geometryRevision]]) {
    assert.equal(sameGeometryRevision(a, b), sameGeometryRevision(b, a));
  }
  // Nesne olmayan ya da bozuk girdiler false (hata fırlatmaz).
  for (const bad of [null, undefined, 'x', 1, [], [rev]]) {
    assert.equal(sameGeometryRevision(bad, rev), false, String(bad));
    assert.equal(sameGeometryRevision(rev, bad), false, String(bad));
  }
  assert.equal(sameGeometryRevision({}, {}), false, 'boş kopya aynı sayılmaz');
  assert.equal(sameGeometryRevision({ pathSha256: 1 }, { pathSha256: 1 }), false);
  // extentRevisionStatus aynı kuralı kullanır.
  const h = (geometryRevision) => ({ extent: { fromKm: 0, toKm: 1, geometry: 'pathFull', geometryRevision } });
  for (const cand of [{ ...rev }, { ...rev, date: '2030-01-01' }, { ...rev, pathSha256: 'f'.repeat(64) }, k.geometryRevision]) {
    assert.equal(extentRevisionStatus(h(cand), r), sameGeometryRevision(cand, rev) ? 'current' : 'stale');
  }
});

test('assertLineCoords alan adı öneki: routeLine route.<geometry>.coordinates, projectOnRoute lineCoords', () => {
  const r = ROUTES.find((x) => x.pathFull != null);
  assert.throws(() => routeLine({ ...r, pathFull: { type: 'LineString', coordinates: [[29.0, 40.0]] } }),
    (e) => e instanceof TypeError && /^route\.pathFull\.coordinates: en az 2 \[lon, lat\] noktası olmalı$/.test(e.message));
  const { pathFull, ...yalniz } = r;
  assert.throws(() => routeLine({ ...yalniz, path: { type: 'LineString', coordinates: [[29.0, 95], [29.1, 40.1]] } }),
    (e) => e instanceof TypeError && /^route\.path\.coordinates: her nokta \[lon, lat\] sayı çifti olmalı \(GeoJSON sırası\)$/.test(e.message));
  assert.throws(() => projectOnRoute({ lat: 40, lon: 29 }, [[29, 40]]), /^TypeError: lineCoords: en az 2/);
  assert.throws(() => routeLengthMeters([[29, 40], ['x', 40]]), /lineCoords: her nokta/);
});

test('data/hazards.json: tüm kayıtlar geçerli; gerçek kayıtlar source + verification taşır, rota id ve OSM kaynağı tutarlı', () => {
  const file = JSON.parse(readFileSync(new URL('../data/hazards.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(file.hazards), 'hazards dizi olmalı');
  const ids = new Set(ROUTES.map((x) => x.id));
  const seen = new Set();
  for (const h of file.hazards) {
    assert.deepEqual(validateHazard(h).errors, [], h.id);
    assert.ok(!seen.has(h.id), `yinelenen id ${h.id}`); seen.add(h.id);
    assert.ok(ids.has(h.routeId), `${h.id}: bilinmeyen routeId`);
    if (!h.isSample) {
      assert.ok(h.source && h.verification, `${h.id}: gerçek kayıtta source ve verification zorunlu (7B)`);
      if (h.extent?.geometryRevision) {
        assert.equal(extentRevisionStatus(h, ROUTES.find((x) => x.id === h.routeId)), 'current', `${h.id}: extent eskimiş`);
      }
    }
  }
});

// ---- fuelGapsAlongRoute: TÜM veriler ÖRNEKTİR (sentetik rota ve sentetik POI; gerçek konum/istasyon iddiası yok) ----
// ÖRNEK düz rota: ekvator üzerinde (okyanus) lon 0 → 0,1; ~11,1 km. Gerçek bir yol DEĞİLDİR.
const ORNEK_DUZ_ROTA = Object.freeze({
  id: 'xx-ornek-99',
  isSample: true,
  name: { tr: 'ÖRNEK düz rota — gerçek değil', en: 'SAMPLE straight route — not real' },
  lengthKm: 11.1,
  path: { type: 'LineString', coordinates: [[0, 0], [0.1, 0]] },
  pathFull: { type: 'LineString', coordinates: [[0, 0], [0.05, 0], [0.1, 0]] },
  verification: { status: 'doğrulandı' },
});
const ORNEK_DUZ_UZUNLUK_KM = routeLengthMeters(ORNEK_DUZ_ROTA.pathFull.coordinates) / 1000;
const ornekBenzinlik = (id, route, alongM, offsetM = 0, type = 'fuel') => ({
  id: `ORNEK:${id}`, type, isSample: true, name: 'ÖRNEK istasyon — gerçek değil',
  location: pointAlong(etkinCizgi(route), alongM, offsetM),
});
const yakin = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

test('fuelGapsAlongRoute (ÖRNEK): istasyon yok -> tek aralık başlangıç→bitiş, noStationOnRoute', () => {
  const r = fuelGapsAlongRoute(ORNEK_DUZ_ROTA, []);
  assert.equal(r.routeId, 'xx-ornek-99');
  assert.equal(r.geometry, 'pathFull');
  assert.equal(r.maxOffsetM, 500);
  assert.equal(r.noStationOnRoute, true);
  assert.equal(r.stations.length, 0);
  assert.equal(r.gaps.length, 1);
  assert.deepEqual([r.gaps[0].from, r.gaps[0].to], ['start', 'end']);
  assert.ok(yakin(r.longestGap.lengthKm, ORNEK_DUZ_UZUNLUK_KM, 1e-9));
  assert.ok(yakin(r.routeLengthKm, 11.12, 0.01), String(r.routeLengthKm));
  assert.equal(fuelGapsAlongRoute(ORNEK_DUZ_ROTA, undefined).noStationOnRoute, true);
});

test('fuelGapsAlongRoute (ÖRNEK): başlangıç–ilk, arası, son–bitiş aralıkları ve en uzun boşluk', () => {
  const pois = [
    ornekBenzinlik('b', ORNEK_DUZ_ROTA, 8000, 120),   // ters sırada verildi; sıralanmalı
    ornekBenzinlik('a', ORNEK_DUZ_ROTA, 2000),
  ];
  const r = fuelGapsAlongRoute(ORNEK_DUZ_ROTA, pois);
  assert.equal(r.noStationOnRoute, false);
  assert.deepEqual(r.stations.map((s) => s.poi.id), ['ORNEK:a', 'ORNEK:b']);
  assert.ok(yakin(r.stations[1].offsetM, 120, 2), String(r.stations[1].offsetM));
  assert.deepEqual(r.gaps.map((g) => [g.from, g.to]), [['start', 'ORNEK:a'], ['ORNEK:a', 'ORNEK:b'], ['ORNEK:b', 'end']]);
  assert.ok(yakin(r.gaps[0].lengthKm, 2));
  assert.ok(yakin(r.gaps[1].lengthKm, 6));
  assert.ok(yakin(r.gaps[2].lengthKm, ORNEK_DUZ_UZUNLUK_KM - 8));
  assert.deepEqual([r.longestGap.from, r.longestGap.to], ['ORNEK:a', 'ORNEK:b']);
  const toplam = r.gaps.reduce((s, g) => s + g.lengthKm, 0);
  assert.ok(yakin(toplam, r.routeLengthKm, 1e-9));
  assert.deepEqual(pois.map((p) => p.id), ['ORNEK:b', 'ORNEK:a'], 'girdi değiştirilmemeli');
});

test('fuelGapsAlongRoute (ÖRNEK): maxOffsetM dışı sayılmaz, fuel olmayan ve konumsuz POI yok sayılır, yinelenen atlanır', () => {
  const pois = [
    ornekBenzinlik('uzak', ORNEK_DUZ_ROTA, 5000, 800),
    ornekBenzinlik('market', ORNEK_DUZ_ROTA, 5000, 0, 'market'),
    { id: 'ORNEK:konumsuz', type: 'fuel', isSample: true },
    ornekBenzinlik('yakin', ORNEK_DUZ_ROTA, 3000, 300),
    ornekBenzinlik('yakin', ORNEK_DUZ_ROTA, 3000, 300),
  ];
  const r = fuelGapsAlongRoute(ORNEK_DUZ_ROTA, pois);
  assert.deepEqual(r.stations.map((s) => s.poi.id), ['ORNEK:yakin']);
  assert.deepEqual(r.skipped.map((s) => [s.poi.id, s.reason]), [['ORNEK:uzak', 'offset'], ['ORNEK:yakin', 'duplicate']]);
  assert.ok(yakin(r.skipped[0].offsetM, 800, 5));
  // Yarıçap büyütülünce uzak istasyon sayılır.
  const genis = fuelGapsAlongRoute(ORNEK_DUZ_ROTA, pois, { maxOffsetM: 1000 });
  assert.deepEqual(genis.stations.map((s) => s.poi.id), ['ORNEK:yakin', 'ORNEK:uzak']);
  // Yalnız rota dışı istasyon -> rotada istasyon yok.
  const yok = fuelGapsAlongRoute(ORNEK_DUZ_ROTA, [ornekBenzinlik('uzak', ORNEK_DUZ_ROTA, 5000, 800)]);
  assert.equal(yok.noStationOnRoute, true);
  assert.equal(yok.gaps.length, 1);
});

test('fuelGapsAlongRoute (ÖRNEK): başlangıç/bitişteki istasyon sıfır uzunluklu aralık verir; uç dışı izdüşüm kırpılır', () => {
  const bas = { id: 'ORNEK:bas', type: 'fuel', isSample: true, location: { lat: 0.001, lon: -0.002 } }; // çizgi başının gerisinde
  const son = ornekBenzinlik('son', ORNEK_DUZ_ROTA, ORNEK_DUZ_UZUNLUK_KM * 1000);
  const r = fuelGapsAlongRoute(ORNEK_DUZ_ROTA, [son, bas]);
  assert.equal(r.gaps.length, 3);
  assert.ok(yakin(r.gaps[0].lengthKm, 0, 1e-9));
  assert.ok(yakin(r.gaps[2].lengthKm, 0, 1e-6));
  assert.ok(r.gaps.every((g) => g.lengthKm >= 0));
  assert.deepEqual([r.longestGap.from, r.longestGap.to], ['ORNEK:bas', 'ORNEK:son']);
});

test('fuelGapsAlongRoute (ÖRNEK): yalnız-path rotada mesafeler scale ile yol mesafesine çevrilir, routeApproximate', () => {
  const { scale, coordinates } = routeLine(ORNEK_YALNIZ_PATH);
  assert.ok(scale > 1);
  const r = fuelGapsAlongRoute(ORNEK_YALNIZ_PATH, [ornekBenzinlik('orta', ORNEK_YALNIZ_PATH, 4000)]);
  assert.equal(r.geometry, 'path');
  assert.equal(r.routeApproximate, true);
  assert.ok(yakin(r.routeLengthKm, ORNEK_YALNIZ_PATH.lengthKm, 1e-6));
  assert.ok(yakin(r.stations[0].distanceAlongKm, 4 * scale, 0.01));
  assert.ok(yakin(r.gaps[1].lengthKm, (routeLengthMeters(coordinates) / 1000 - 4) * scale, 0.01));
});

test('fuelGapsAlongRoute: geçersiz girdiler TypeError', () => {
  assert.throws(() => fuelGapsAlongRoute(null, []), TypeError);
  assert.throws(() => fuelGapsAlongRoute(ORNEK_DUZ_ROTA, [], { maxOffsetM: -1 }), /maxOffsetM/);
  assert.throws(() => fuelGapsAlongRoute(ORNEK_DUZ_ROTA, [], { maxOffsetM: NaN }), /maxOffsetM/);
  assert.throws(() => fuelGapsAlongRoute(ORNEK_DUZ_ROTA, {}), /pois: dizi/);
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
