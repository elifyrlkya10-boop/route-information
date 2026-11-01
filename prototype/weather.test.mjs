// Çalıştır: node prototype/weather.test.mjs
// UYARI: Bu dosyadaki tüm Open-Meteo yanıtları ve hava değerleri ÖRNEKTİR (gerçek tahmin değildir).
// Ağ erişimi kullanılmaz; fetch sahte (fake) bir fonksiyonla değiştirilir. Rota gerçek data/routes.json'dan okunur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OPEN_METEO_ENDPOINT, HOURLY_VARS, THRESHOLDS, lineLengthKm, sampleRoutePoints, buildForecastUrl, pickHour,
  fetchRouteForecast, assessRide, rainGearNeeded, checklistUrl, buildWeatherAlert,
} from './weather.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const data = JSON.parse(readFileSync(new URL('../data/routes.json', import.meta.url), 'utf8'));
const ROUTE = data.routes.find((r) => r.id === 'tr-ic-anadolu-01');
assert.ok(ROUTE, 'tr-ic-anadolu-01 data/routes.json içinde olmalı');

// ---- ÖRNEK Open-Meteo yanıtı (şekil: dokümandaki çoklu konum yanıtı, timeformat=unixtime) ----
// Değerler UYDURMA DEĞİL, açıkça ÖRNEK test girdisidir: gerçek hava durumunu temsil etmez.
const ORNEK_BASLANGIC_SAATI = Date.parse('2026-11-02T07:00:00Z'); // örnek "şimdi"
const ORNEK_SAAT_SAYISI = 6;
function ornekOpenMeteoYaniti(points, { hourValues = () => ({}), elevations = [] } = {}) {
  return points.map((p, i) => {
    const time = Array.from({ length: ORNEK_SAAT_SAYISI }, (_, h) => ORNEK_BASLANGIC_SAATI / 1000 + h * 3600);
    const hourly = { time };
    for (const v of HOURLY_VARS) hourly[v] = [];
    time.forEach((_, h) => {
      const base = { // ÖRNEK sakin hava değerleri
        temperature_2m: 15 + h, precipitation: 0, precipitation_probability: 0,
        wind_speed_10m: 10, wind_gusts_10m: 20, visibility: 24000, weather_code: 1,
      };
      const v = { ...base, ...hourValues(i, h) };
      for (const k of HOURLY_VARS) hourly[k].push(v[k]);
    });
    return {
      ORNEK: true, // bu nesne örnektir
      latitude: p.lat, longitude: p.lon, generationtime_ms: 0.1, utc_offset_seconds: 0,
      timezone: 'GMT', timezone_abbreviation: 'GMT', elevation: elevations[i] ?? 1000 + i * 100,
      hourly_units: { time: 'unixtime', temperature_2m: '°C', precipitation: 'mm', precipitation_probability: '%',
        wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h', visibility: 'm', weather_code: 'wmo code' },
      hourly,
    };
  });
}
function sahteFetch(bodyFor, { status = 200 } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const lats = u.searchParams.get('latitude').split(',').map(Number);
    const lons = u.searchParams.get('longitude').split(',').map(Number);
    const pts = lats.map((lat, i) => ({ lat, lon: lons[i] }));
    return { ok: status >= 200 && status < 300, status, json: async () => bodyFor(pts) };
  };
  fn.calls = calls;
  return fn;
}
// Tek noktalı ÖRNEK tahmin (assessRide testleri için)
const ornekNokta = (forecast, distanceKm = 10, index = 1) => ({
  index, lat: 38.6, lon: 35.5, distanceKm, arrival: '2026-11-02T08:00:00.000Z', elevationM: 1500,
  forecast: forecast === null ? null : {
    time: '2026-11-02T08:00:00.000Z', temperature_2m: 15, precipitation: 0, precipitation_probability: 0,
    wind_speed_10m: 10, wind_gusts_10m: 20, visibility: 24000, weather_code: 1, ...forecast,
  },
});

// ---- Testler ----
test('çizgi uzunluğu lengthKm\'den kısa (tüm rotalar; ölçülen fark %3–18)', () => {
  for (const r of data.routes) {
    const L = lineLengthKm(r);
    const diff = (r.lengthKm - L) / L;
    assert.ok(L > 0 && L < r.lengthKm, `${r.id}: çizgi ${L.toFixed(1)} km, lengthKm ${r.lengthKm}`);
    assert.ok(diff > 0 && diff < 0.2, `${r.id}: fark %${(diff * 100).toFixed(1)}`);
  }
});

test('sampleRoutePoints: n nokta, uçlar dahil, eşit aralık', () => {
  const s = sampleRoutePoints(ROUTE, 5);
  const c = ROUTE.path.coordinates;
  assert.equal(s.length, 5);
  assert.deepEqual([s[0].lon, s[0].lat], c[0]);
  assert.deepEqual([s[4].lon, s[4].lat], c[c.length - 1]);
  const L = lineLengthKm(ROUTE);
  assert.ok(Math.abs(s[4].distanceKm - L) < 1e-9);
  s.forEach((p, i) => assert.ok(Math.abs(p.distanceKm - (L * i) / 4) < 1e-9));
  assert.throws(() => sampleRoutePoints(ROUTE, 1));
  assert.throws(() => sampleRoutePoints({ id: 'x', path: { type: 'LineString', coordinates: [[0, 0]] } }, 3));
});

test('buildForecastUrl: tek istekte çok nokta ve tüm saatlik alanlar', () => {
  const s = sampleRoutePoints(ROUTE, 3);
  const u = new URL(buildForecastUrl(s, { hours: 5 }));
  assert.equal(`${u.origin}${u.pathname}`, OPEN_METEO_ENDPOINT);
  assert.equal(u.searchParams.get('latitude').split(',').length, 3);
  assert.equal(u.searchParams.get('longitude').split(',').length, 3);
  assert.deepEqual(u.searchParams.get('hourly').split(','), [...HOURLY_VARS]);
  assert.equal(u.searchParams.get('forecast_hours'), '5');
  assert.equal(u.searchParams.get('timezone'), 'GMT');
  assert.equal(u.searchParams.get('timeformat'), 'unixtime');
  assert.equal(new URL(buildForecastUrl(s, { hours: 9999 })).searchParams.get('forecast_hours'), '384');
  assert.throws(() => buildForecastUrl([]));
});

test('pickHour: en yakın saat; 90 dk\'dan uzaksa null (ÖRNEK yanıt)', () => {
  const [loc] = ornekOpenMeteoYaniti([{ lat: 0, lon: 0 }]);
  assert.equal(pickHour(loc, ORNEK_BASLANGIC_SAATI + 2 * 3600e3 + 20 * 60e3).temperature_2m, 17);
  assert.equal(pickHour(loc, ORNEK_BASLANGIC_SAATI + 2 * 3600e3 + 40 * 60e3).temperature_2m, 18);
  assert.equal(pickHour(loc, ORNEK_BASLANGIC_SAATI + 10 * 3600e3), null);
});

test('fetchRouteForecast: varış saatine göre saat seçer, rakımı taşır (sahte fetch)', async () => {
  const f = sahteFetch((pts) => ornekOpenMeteoYaniti(pts));
  const start = Date.parse('2026-11-02T08:00:00Z');
  const r = await fetchRouteForecast(ROUTE, { fetchImpl: f, startTime: start, speedKmh: 40, n: 4, now: ORNEK_BASLANGIC_SAATI });
  assert.equal(f.calls.length, 1, 'tek istek');
  assert.equal(r.routeId, 'tr-ic-anadolu-01');
  assert.equal(r.points.length, 4);
  const L = lineLengthKm(ROUTE);
  r.points.forEach((p, i) => {
    const arr = start + ((L * i) / 3 / 40) * 3600e3;
    assert.equal(p.arrival, new Date(arr).toISOString());
    const nearestH = Math.round((arr - ORNEK_BASLANGIC_SAATI) / 3600e3);
    assert.equal(p.forecast.temperature_2m, 15 + nearestH, `nokta ${i}`);
    assert.equal(p.elevationM, 1000 + i * 100);
  });
  const hours = Number(new URL(f.calls[0]).searchParams.get('forecast_hours'));
  assert.ok(hours >= Math.ceil((start + (L / 40) * 3600e3 - ORNEK_BASLANGIC_SAATI) / 3600e3));
});

test('fetchRouteForecast: API hatası, HTTP hatası ve eksik nokta yakalanır', async () => {
  const opt = { startTime: ORNEK_BASLANGIC_SAATI, now: ORNEK_BASLANGIC_SAATI, n: 3 };
  await assert.rejects(fetchRouteForecast(ROUTE, { ...opt, fetchImpl: sahteFetch(() => ({ error: true, reason: 'ÖRNEK hata' })) }), /ÖRNEK hata/);
  await assert.rejects(fetchRouteForecast(ROUTE, { ...opt, fetchImpl: sahteFetch(() => [], { status: 429 }) }), /HTTP 429/);
  await assert.rejects(fetchRouteForecast(ROUTE, { ...opt, fetchImpl: sahteFetch((pts) => ornekOpenMeteoYaniti(pts.slice(1))) }), /3 nokta/);
});

test('assessRide: sakin ÖRNEK hava → uygun, yağmurluk gerekmez', () => {
  const a = assessRide([ornekNokta({}, 0, 0), ornekNokta({}, 20, 1)]);
  assert.equal(a.level, 'uygun');
  assert.deepEqual(a.reasons, []);
  assert.equal(rainGearNeeded(a), false);
});

test('assessRide: buzlanma (≤ 3 °C ve yağış) → önerilmez, yağmurluk gerekir', () => {
  const a = assessRide([ornekNokta({}, 0, 0), ornekNokta({ temperature_2m: 2, precipitation: 0.3, weather_code: 61 }, 30, 1)]);
  assert.equal(a.level, 'önerilmez');
  assert.equal(a.reasons[0].code, 'ice');
  assert.match(a.reasons[0].tr, /30\. km'de buzlanma/);
  assert.match(a.reasons[0].en, /ice risk at km 30/);
  assert.equal(a.points[1].level, 'önerilmez');
  assert.equal(rainGearNeeded(a), true);
  // 4 °C'de aynı yağış buzlanma değil, yağmur (dikkat) + soğuk
  const b = assessRide([ornekNokta({ temperature_2m: 4, precipitation: 0.3, weather_code: 61 })]);
  assert.equal(b.level, 'dikkat');
  assert.deepEqual(b.reasons.map((r) => r.code).sort(), ['cold', 'rain']);
});

test('assessRide: eşikler (rüzgâr, hamle, sis, sıcak, olasılık, fırtına, veri yok)', () => {
  const lvl = (f) => assessRide([ornekNokta(f)]).level;
  assert.equal(lvl({ wind_speed_10m: THRESHOLDS.windCaution }), 'dikkat');
  assert.equal(lvl({ wind_speed_10m: THRESHOLDS.windUnsafe }), 'önerilmez');
  assert.equal(lvl({ wind_gusts_10m: THRESHOLDS.gustCaution }), 'dikkat');
  assert.equal(lvl({ wind_gusts_10m: THRESHOLDS.gustUnsafe }), 'önerilmez');
  assert.equal(lvl({ visibility: 800 }), 'dikkat');
  assert.equal(lvl({ visibility: 150 }), 'önerilmez');
  assert.equal(lvl({ weather_code: 45 }), 'dikkat');
  assert.equal(lvl({ temperature_2m: 36 }), 'dikkat');
  assert.equal(lvl({ temperature_2m: 41 }), 'önerilmez');
  assert.equal(lvl({ temperature_2m: -1 }), 'dikkat');
  assert.equal(lvl({ weather_code: 95 }), 'önerilmez');
  assert.equal(lvl({ weather_code: 73 }), 'önerilmez');
  assert.equal(lvl({ precipitation: THRESHOLDS.rainMmUnsafe }), 'önerilmez');
  const p = assessRide([ornekNokta({ precipitation_probability: 40 })]);
  assert.equal(p.level, 'dikkat');
  assert.equal(rainGearNeeded(p), true);
  assert.equal(rainGearNeeded(assessRide([ornekNokta({ precipitation_probability: 39 })])), false);
  const n = assessRide([ornekNokta(null)]);
  assert.equal(n.level, 'dikkat');
  assert.equal(n.reasons[0].code, 'no_data');
});

test('checklistUrl: ekipman-asistani ?ek=yagmur arayüzü', () => {
  assert.equal(checklistUrl('checklist.html', true), 'checklist.html?ek=yagmur');
  assert.equal(checklistUrl('checklist.html', false), 'checklist.html');
  assert.equal(checklistUrl('checklist.html?lang=en#x', true), 'checklist.html?lang=en&ek=yagmur#x');
  assert.equal(checklistUrl('checklist.html?ek=yagmur', true), 'checklist.html?ek=yagmur');
  assert.equal(checklistUrl('https://ornek.test/p/checklist.html?ek=sis', true), 'https://ornek.test/p/checklist.html?ek=sis,yagmur');
});

test('buildWeatherAlert: kısa tr/en metin, bilinmeyen dilde İngilizce', () => {
  const ok = assessRide([ornekNokta({})]);
  assert.equal(buildWeatherAlert(ok, 'tr'), 'Hava sürüşe uygun.');
  assert.equal(buildWeatherAlert(ok, 'en'), 'Weather is fine for riding.');
  const bad = assessRide([
    ornekNokta({ wind_gusts_10m: 80 }, 12, 1),
    ornekNokta({ temperature_2m: 1, precipitation: 0.5, weather_code: 61 }, 40, 2),
    ornekNokta({ weather_code: 95 }, 45, 3),
  ]);
  assert.equal(buildWeatherAlert(bad, 'tr'),
    "Sürüş önerilmez: 12. km'de sert rüzgâr hamlesi, 80 km/sa, 40. km'de buzlanma riski (1 °C ve yağış) ve 1 uyarı daha. Yağmurluğunu al.");
  assert.equal(buildWeatherAlert(bad, 'en'),
    'Riding not advised: strong gusts at km 12, 80 km/h, ice risk at km 40 (1 °C with precipitation) and 1 more warning. Take rain gear.');
  assert.equal(buildWeatherAlert(bad, 'xx'), buildWeatherAlert(bad, 'en'));
  const c = assessRide([ornekNokta({ wind_speed_10m: 45 }, 20)]);
  assert.equal(buildWeatherAlert(c, 'tr'), "Dikkat: 20. km'de kuvvetli rüzgâr, 45 km/sa.");
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   - ${t.name}`); }
  catch (e) { failed++; console.log(`FAIL - ${t.name}\n       ${e.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} test geçti`);
if (failed) process.exit(1);
