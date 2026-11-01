// Çalıştır: node prototype/hazards.test.mjs
// UYARI: Bu dosyadaki tüm tehlike, koordinat, POI ve Overpass yanıtı verileri ÖRNEKTİR (gerçek değildir).
// Ağ erişimi kullanılmaz; fetch sahte (fake) bir fonksiyonla değiştirilir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HAZARD_TYPES, ROUTE_ID_PATTERN, DEFAULT_OVERPASS_ENDPOINT,
  validateHazard, haversineMeters, hazardsWithinRadius, buildVoiceAlert,
  buildOverpassQuery, parseOverpassResponse, fetchNearbyPois,
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
