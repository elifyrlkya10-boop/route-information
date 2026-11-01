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
const ornekRotaTehlikesi = (id, route, alongM, offsetM = 0, type = 'steep_grade') =>
  ornekHazard({ id: `ORNEK-${id}`, routeId: route.id, type, location: pointAlong(route.path.coordinates, alongM, offsetM) });

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
  const c = NEMRUT.path.coordinates;
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
  const c = NEMRUT.path.coordinates;
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

test('routeApproximate: yalnızca "doğrulanmalı" rotada (Kemaliye) true', () => {
  for (const r of ROUTES) {
    const c = r.path.coordinates;
    const res = hazardsAheadOnRoute({ lat: c[0][1], lon: c[0][0] }, r, []);
    assert.equal(res.routeApproximate, r.verification.status === 'doğrulanmalı', r.id);
  }
  assert.equal(KEMALIYE.verification.status, 'doğrulanmalı');
  const c = KEMALIYE.path.coordinates;
  const h = ornekRotaTehlikesi('kemaliye', KEMALIYE, 3000, 0, 'gravel');
  const res = hazardsAheadOnRoute(pointAlong(c, 2500), KEMALIYE, [h], { includeSamples: true });
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
  const c = NEMRUT.path.coordinates;
  const list = [ornekRotaTehlikesi('s1', NEMRUT, 41020), ornekRotaTehlikesi('s2', NEMRUT, 41630, 0, 'sharp_curve')];
  const t = createAlertTracker();
  const okunan = [];
  for (let m = 38000; m <= 42000; m += 50) {
    const r = hazardsAheadOnRoute(pointAlong(c, m), NEMRUT, list, { includeSamples: true });
    for (const x of r.hazards) if (t.shouldAnnounce(x.hazard.id, x.aheadM)) okunan.push(`${x.hazard.id}@${m}`);
  }
  assert.deepEqual(okunan, ['ORNEK-s1@40050', 'ORNEK-s2@40650', 'ORNEK-s1@40750', 'ORNEK-s2@41350']);
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
