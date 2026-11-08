// Çalıştır: node prototype/weather.test.mjs
// UYARI: Bu dosyadaki tüm Open-Meteo yanıtları ve hava değerleri ÖRNEKTİR (gerçek tahmin değildir).
// Ağ erişimi kullanılmaz; fetch sahte (fake) bir fonksiyonla değiştirilir. Rota gerçek data/routes.json'dan okunur.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OPEN_METEO_ENDPOINT, HOURLY_VARS, THRESHOLDS, lineLengthKm, sampleRoutePoints, buildForecastUrl, pickHour,
  fetchRouteForecast, assessRide, rainGearNeeded, gearConditions, checklistUrl, buildWeatherAlert,
  windComponents, addWindComponents,
} from './weather.js';
import { routeBearings } from './route-geometry.js';

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
test('sadeleştirilmiş path lengthKm\'den kısa; üst sınır yalnız path\'in KULLANILDIĞI rotada (pathFull yok) aranır', () => {
  // path, pathFull'un Douglas-Peucker sadeleştirmesi: her rotada lengthKm'den kısa olmalı (değişmez özellik).
  // Fark rotanın virajlılığına bağlıdır (2026-11-07 ölçümü: Türkiye %3,0–17,5; Pelion 2026-11-08 geometrisinde %21,5;
  // Sierra de Grazalema 2026-11-09 geometrisinde %17,7 — bu testin formülüyle (lengthKm − path)/path; rota-uzmani'nın %15,0'ı
  // aynı farkın lengthKm'e oranı). pathFull olan rotada
  // hava modülü path'i hiç kullanmaz (sonraki test bunu sınar), bu yüzden orada üst sınır anlamlı değildir.
  // Sınırı genişletmek yerine üst sınır, path'in mesafe/varış saati için ölçeklenerek kullanıldığı rotalarda korunur.
  for (const r of data.routes) {
    const L = lineLengthKm(r, { geometry: 'path' });
    const diff = (r.lengthKm - L) / L;
    assert.ok(L > 0 && L < r.lengthKm, `${r.id}: çizgi ${L.toFixed(1)} km, lengthKm ${r.lengthKm}`);
    if (!r.pathFull) assert.ok(diff > 0 && diff < 0.18, `${r.id} (yalnız path): fark %${(diff * 100).toFixed(1)}`);
  }
  assert.ok(data.routes.some((r) => !r.pathFull), 'üst sınır en az bir yalnız-path rotada (Kemaliye) sınanmalı');
});

test('pathFull olan her rotada path farkı önemsiz: path silinse ya da bozulsa örnekleme, varış ve yön aynı (sahte fetch, ÖRNEK yanıt)', async () => {
  const bozukPath = (r) => ({ type: 'LineString', coordinates: [r.path.coordinates[0], r.path.coordinates.at(-1)] }); // 2 noktalı kiriş
  const opt = { startTime: Date.parse('2026-11-02T08:00:00Z'), now: ORNEK_BASLANGIC_SAATI, speedKmh: 40, n: 6 };
  const body = (pts) => ornekOpenMeteoYaniti(pts, { hourValues: () => ({ wind_direction_10m: 90 }) }); // ÖRNEK
  const pf = data.routes.filter((r) => r.pathFull);
  assert.ok(pf.some((r) => r.id === 'gr-thessalia-01'), 'Pelion da sınanmalı');
  for (const r of pf) {
    const asil = await fetchRouteForecast(r, { ...opt, fetchImpl: sahteFetch(body) });
    for (const v of [{ ...r, path: undefined }, { ...r, path: bozukPath(r) }]) {
      assert.deepEqual(sampleRoutePoints(v), sampleRoutePoints(r), r.id);
      assert.deepEqual(await fetchRouteForecast(v, { ...opt, fetchImpl: sahteFetch(body) }), asil, `${r.id}: path değişince sonuç değişmemeli`);
    }
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

test('pathFull ?? path: pathFull varsa o kullanılır, lengthKm ile %0,2 içinde; yoksa path ölçeklenir', () => {
  for (const r of data.routes) {
    const s = sampleRoutePoints(r, 4);
    if (r.pathFull) {
      assert.ok(s.every((p) => p.geometry === 'pathFull'), r.id);
      const L = lineLengthKm(r);
      assert.ok(Math.abs(L - r.lengthKm) / r.lengthKm < 0.002, `${r.id}: pathFull ${L.toFixed(2)} km, lengthKm ${r.lengthKm}`);
      assert.ok(Math.abs(s[3].distanceKm - L) < 1e-9);
    } else {
      assert.ok(s.every((p) => p.geometry === 'path'), r.id);
      assert.ok(Math.abs(s[3].distanceKm - r.lengthKm) < 1e-9, `${r.id}: path ölçeklenip lengthKm'e eşitlenmeli`);
      const L = lineLengthKm(r);
      s.forEach((p, i) => assert.ok(Math.abs(p.distanceKm - (r.lengthKm * i) / 3) < 1e-9));
      assert.ok(L < r.lengthKm);
    }
  }
  assert.ok(data.routes.some((r) => !r.pathFull), 'en az bir rota yalnız path ile (Kemaliye) denenmeli');
  assert.throws(() => sampleRoutePoints({ id: 'x', pathFull: { type: 'LineString', coordinates: [[0, 0]] },
    path: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }, 3), /pathFull/);
});

test('fetchRouteForecast: kullanılan çizgi sonuçta görünür; yalnız path → yaklaşık ve ölçekli varış (sahte fetch)', async () => {
  const start = Date.parse('2026-11-02T08:00:00Z');
  const opt = { startTime: start, now: ORNEK_BASLANGIC_SAATI, speedKmh: 40, n: 3 };
  const full = await fetchRouteForecast(ROUTE, { ...opt, fetchImpl: sahteFetch((pts) => ornekOpenMeteoYaniti(pts)) });
  assert.equal(full.geometry, 'pathFull');
  assert.equal(full.routeApproximate, false);
  assert.equal(full.distanceScale, 1);
  assert.ok(full.points.every((p) => p.geometry === 'pathFull'));
  const kem = data.routes.find((r) => !r.pathFull);
  const p = await fetchRouteForecast(kem, { ...opt, fetchImpl: sahteFetch((pts) => ornekOpenMeteoYaniti(pts)) });
  assert.equal(p.geometry, 'path');
  assert.equal(p.routeApproximate, true);
  assert.ok(Math.abs(p.distanceScale - kem.lengthKm / lineLengthKm(kem)) < 1e-12);
  assert.ok(Math.abs(p.routeKm - kem.lengthKm) < 1e-9);
  assert.equal(p.points[2].arrival, new Date(start + (kem.lengthKm / 40) * 3600e3).toISOString());
});

test('assessRide: coldExpected (≤ 5 °C) ve fogExpected (görüş < 1000 m ya da kod 45/48) — ÖRNEK değerler', () => {
  assert.equal(THRESHOLDS.coldGearTemp, 5);
  assert.equal(THRESHOLDS.fogGearVisibility, 1000);
  const a = (f) => assessRide([ornekNokta({}, 0, 0), ornekNokta(f, 20, 1)]);
  assert.equal(a({ temperature_2m: 5 }).coldExpected, true);
  assert.equal(a({ temperature_2m: 5.1 }).coldExpected, false);
  assert.equal(a({ temperature_2m: -2 }).coldExpected, true);
  assert.equal(a({ visibility: 999 }).fogExpected, true);
  assert.equal(a({ visibility: 1000 }).fogExpected, false);
  assert.equal(a({ weather_code: 45 }).fogExpected, true);
  assert.equal(a({ weather_code: 48 }).fogExpected, true);
  const calm = a({});
  assert.equal(calm.coldExpected, false);
  assert.equal(calm.fogExpected, false);
  assert.equal(calm.dataMissing, false);
  assert.deepEqual(gearConditions(calm), { rain: false, cold: false, fog: false });
  const miss = assessRide([ornekNokta({ temperature_2m: 3 }), ornekNokta(null, 30, 2)]);
  assert.equal(miss.dataMissing, true);
  assert.deepEqual(gearConditions(miss), { rain: null, cold: true, fog: null }, 'veri yoksa madde kaldırılmaz');
});

test('checklistUrl: üç koşul açıkça yazılır (?ek=yagmur,-soguk,sis), sorgu ve # korunur', () => {
  assert.equal(checklistUrl('checklist.html', { rain: true, cold: false, fog: true }), 'checklist.html?ek=yagmur,-soguk,sis');
  assert.equal(checklistUrl('checklist.html', { rain: false, cold: false, fog: false }), 'checklist.html?ek=-yagmur,-soguk,-sis');
  assert.equal(checklistUrl('checklist.html?lang=en&ek=soğuk,foo,-rain#x', { rain: true, cold: false, fog: false }),
    'checklist.html?lang=en&ek=foo,yagmur,-soguk,-sis#x');
  const ornek = assessRide([ornekNokta({ temperature_2m: 2, visibility: 500 })]);
  assert.equal(checklistUrl('checklist.html', ornek), 'checklist.html?ek=-yagmur,soguk,sis');
  const miss = assessRide([ornekNokta({ temperature_2m: 3 }), ornekNokta(null, 30, 2)]);
  assert.equal(checklistUrl('checklist.html?ek=sis', miss), 'checklist.html?ek=sis,soguk');
  // eski çağrı aynen çalışır
  assert.equal(checklistUrl('checklist.html', true), 'checklist.html?ek=yagmur');
  assert.equal(checklistUrl('checklist.html'), 'checklist.html');
});

// ---- Yan / karşı rüzgâr (yalnız bilgi alanı). Rüzgâr değerleri ÖRNEKTİR; rota geometrisi gerçek pathFull. ----
const BEARINGS = routeBearings(ROUTE.pathFull.coordinates);
// Gerçek pathFull üzerinde düz (R > 0,999) ve değişken (R < 0,7) birer pencere; nokta pencerenin ortasına konur.
const DUZ = BEARINGS.find((b) => b.R > 0.999 && b.sM > 5000);
const DEGISKEN = BEARINGS.find((b) => b.variable);
const noktaPencerede = (b, forecast, index = 1) => ({ ...ornekNokta(forecast, (b.sM + 100) / 1000, index), geometry: 'pathFull' });

test('windComponents: yön kuralı (rüzgârın geldiği yön; + karşı, − arka) — ÖRNEK değerler', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let c = windComponents(30, 0, 0); // kuzeye giderken kuzeyden
  assert.ok(near(c.headwindKmh, 30) && near(c.crosswindKmh, 0) && c.crosswindSide === null);
  c = windComponents(30, 180, 0); // arkadan
  assert.ok(near(c.headwindKmh, -30) && near(c.crosswindKmh, 0));
  c = windComponents(30, 90, 0); // kuzeye giderken doğudan → sağdan
  assert.ok(near(c.crosswindKmh, 30) && near(c.headwindKmh, 0) && c.crosswindSide === 'right');
  c = windComponents(30, 270, 0);
  assert.equal(c.crosswindSide, 'left');
  c = windComponents(20, 45, 0);
  assert.ok(near(c.crosswindKmh, 20 * Math.SQRT1_2) && near(c.headwindKmh, 20 * Math.SQRT1_2));
  c = windComponents(30, 5, 355); // 359°/1° sarması
  assert.ok(near(c.crosswindKmh, 30 * Math.sin(Math.PI / 18)) && c.crosswindSide === 'right');
  assert.equal(windComponents(null, 90, 0), null);
  assert.equal(windComponents(30, null, 0), null);
});

test('addWindComponents: gerçek pathFull düz kesimde yola dik 30 km/sa ≈ 30 yan, ≈ 0 karşı (ÖRNEK rüzgâr)', () => {
  assert.ok(DUZ, 'İç Anadolu pathFull\'da düz pencere olmalı');
  const dik = (DUZ.bearingDeg + 90) % 360;
  const [p] = addWindComponents(ROUTE, [noktaPencerede(DUZ, { wind_speed_10m: 30, wind_direction_10m: dik })]);
  assert.equal(p.bearingVariable, false);
  assert.ok(Math.abs(p.bearingDeg - DUZ.bearingDeg) < 2, `yön ${p.bearingDeg} ≈ ${DUZ.bearingDeg}`);
  assert.ok(Math.abs(p.crosswindKmh - 30) < 0.1, `yan ${p.crosswindKmh}`);
  assert.ok(Math.abs(p.headwindKmh) < 1, `karşı ${p.headwindKmh}`);
  assert.equal(p.crosswindSide, 'right');
  const [q] = addWindComponents(ROUTE, [noktaPencerede(DUZ, { wind_speed_10m: 30, wind_direction_10m: DUZ.bearingDeg })]);
  assert.ok(Math.abs(q.headwindKmh - 30) < 0.1 && q.crosswindKmh < 1, 'önden gelen rüzgâr karşı bileşen');
  // rüzgâr yönü yoksa bileşen yok ama yön bilgisi var
  const [r] = addWindComponents(ROUTE, [noktaPencerede(DUZ, { wind_speed_10m: 30 })]);
  assert.equal(r.bearingVariable, false);
  assert.equal(r.crosswindKmh, null);
  assert.equal(r.headwindKmh, null);
});

test('addWindComponents: değişken kesimde (R < 0,7) bileşenler null, bearingVariable true (ÖRNEK rüzgâr)', () => {
  assert.ok(DEGISKEN, 'İç Anadolu pathFull\'da değişken pencere olmalı');
  const [p] = addWindComponents(ROUTE, [noktaPencerede(DEGISKEN, { wind_speed_10m: 30, wind_direction_10m: 90 })]);
  assert.equal(p.bearingVariable, true);
  assert.ok(p.bearingR < 0.7);
  assert.equal(p.crosswindKmh, null);
  assert.equal(p.headwindKmh, null);
  assert.equal(p.crosswindSide, null);
});

test('fetchRouteForecast: wind_direction_10m istenir, her noktada bilgi alanları; yalnız path (Kemaliye) da çalışır (sahte fetch)', async () => {
  assert.ok(HOURLY_VARS.includes('wind_direction_10m'));
  const opt = { startTime: Date.parse('2026-11-02T08:00:00Z'), now: ORNEK_BASLANGIC_SAATI, speedKmh: 40, n: 6 };
  const body = (pts) => ornekOpenMeteoYaniti(pts, { hourValues: () => ({ wind_direction_10m: 90 }) }); // ÖRNEK
  for (const route of [ROUTE, data.routes.find((r) => !r.pathFull)]) {
    const f = sahteFetch(body);
    const r = await fetchRouteForecast(route, { ...opt, fetchImpl: f });
    assert.ok(new URL(f.calls[0]).searchParams.get('hourly').split(',').includes('wind_direction_10m'));
    for (const p of r.points) {
      assert.equal(p.forecast.wind_direction_10m, 90);
      assert.equal(typeof p.bearingVariable, 'boolean');
      if (p.bearingVariable) assert.equal(p.crosswindKmh, null);
      else {
        assert.ok(p.crosswindKmh >= 0 && p.crosswindKmh <= 10 + 1e-9, `${route.id} nokta ${p.index}`);
        assert.ok(Math.abs(Math.hypot(p.crosswindKmh, p.headwindKmh) - 10) < 1e-9);
      }
    }
  }
});

test('assessRide: yan rüzgâr alanları seviyeyi ve gerekçeleri değiştirmez (ÖRNEK değerler)', () => {
  const durumlar = [
    {}, { wind_speed_10m: 35 }, { wind_speed_10m: 45 }, { wind_speed_10m: 65, wind_gusts_10m: 80 },
    { temperature_2m: 2, precipitation: 0.3, weather_code: 61 },
  ];
  for (const f of durumlar) {
    const eski = [noktaPencerede(DUZ, f, 0), noktaPencerede(DEGISKEN, f, 1)];
    const yeni = addWindComponents(ROUTE, eski.map((p) => ({ ...p, forecast: { ...p.forecast,
      wind_direction_10m: (DUZ.bearingDeg + 90) % 360 } })));
    assert.equal(yeni[0].bearingVariable, false);
    assert.equal(yeni[1].bearingVariable, true);
    const a = assessRide(eski), b = assessRide(yeni);
    assert.deepEqual(b, a, JSON.stringify(f));
  }
});

// ---- gr-thessalia-01 (Pelion, ilk Yunanistan rotası; rota-uzmani 2026-11-07). Hava değerleri ÖRNEKTİR; geometri gerçek pathFull. ----
const PELION = data.routes.find((r) => r.id === 'gr-thessalia-01');

test('Pelion: fetchRouteForecast örnekleme, varış saati, rakım ve yan rüzgâr alanları (sahte fetch, ÖRNEK yanıt)', async () => {
  assert.ok(PELION?.pathFull, 'gr-thessalia-01 pathFull ile olmalı');
  const start = Date.parse('2026-11-02T08:00:00Z');
  const n = 6;
  // ÖRNEK: tüm noktalarda doğudan (90°) 25 km/sa rüzgâr; rakımlar örnek (Hania geçidi civarı yüksek).
  const ornekRakim = [10, 600, 1100, 1150, 700, 450];
  const f = sahteFetch((pts) => ornekOpenMeteoYaniti(pts, {
    elevations: ornekRakim, hourValues: () => ({ wind_speed_10m: 25, wind_direction_10m: 90 }),
  }));
  const r = await fetchRouteForecast(PELION, { fetchImpl: f, startTime: start, now: ORNEK_BASLANGIC_SAATI, speedKmh: 40, n });
  assert.equal(f.calls.length, 1, 'tek istek');
  assert.equal(r.routeId, 'gr-thessalia-01');
  assert.equal(r.geometry, 'pathFull');
  assert.equal(r.routeApproximate, false);
  assert.equal(r.distanceScale, 1);
  const L = lineLengthKm(PELION);
  assert.ok(Math.abs(L - PELION.lengthKm) / PELION.lengthKm < 0.002, `pathFull ${L.toFixed(2)} km, lengthKm ${PELION.lengthKm}`);
  assert.ok(Math.abs(r.routeKm - L) < 1e-9);
  // uçlar: rotanın gerçek başlangıç/bitişi (Volos, Zagora)
  const c = PELION.pathFull.coordinates;
  assert.deepEqual([r.points[0].lon, r.points[0].lat], c[0]);
  assert.deepEqual([r.points.at(-1).lon, r.points.at(-1).lat], c.at(-1));
  assert.ok(Math.abs(r.points[0].lat - PELION.start.lat) < 1e-3 && Math.abs(r.points.at(-1).lon - PELION.end.lon) < 1e-3);
  // istek URL'si örnek noktaları taşır (5 ondalık) ve dönüş saatini kapsar
  const u = new URL(f.calls[0]);
  assert.equal(u.searchParams.get('latitude').split(',').length, n);
  const hours = Number(u.searchParams.get('forecast_hours'));
  assert.ok(hours >= Math.ceil((start + (L / 40) * 3600e3 - ORNEK_BASLANGIC_SAATI) / 3600e3));
  const bearings = routeBearings(c);
  r.points.forEach((p, i) => {
    assert.ok(Math.abs(p.distanceKm - (L * i) / (n - 1)) < 1e-9, `nokta ${i} mesafe`);
    const arr = start + ((L * i) / (n - 1) / 40) * 3600e3; // 45,06 km / 40 km/sa ≈ 68 dk
    assert.equal(p.arrival, new Date(arr).toISOString(), `nokta ${i} varış`);
    assert.equal(p.forecast.temperature_2m, 15 + Math.round((arr - ORNEK_BASLANGIC_SAATI) / 3600e3), `nokta ${i} saat seçimi`);
    assert.equal(p.elevationM, ornekRakim[i]);
    // yön: noktanın merkezine en yakın 200 m pencere (testin kendi seçimi)
    const lineM = p.distanceKm * 1000;
    const b = bearings.reduce((best, x) => (Math.abs(x.sM + 100 - lineM) < Math.abs(best.sM + 100 - lineM) ? x : best));
    assert.equal(p.bearingR, b.R, `nokta ${i} pencere`);
    assert.equal(p.bearingVariable, b.variable || b.bearingDeg === null);
    if (p.bearingVariable) {
      assert.equal(p.crosswindKmh, null);
      assert.equal(p.headwindKmh, null);
    } else {
      const rad = ((90 - p.bearingDeg) * Math.PI) / 180;
      assert.ok(Math.abs(p.crosswindKmh - Math.abs(25 * Math.sin(rad))) < 1e-9, `nokta ${i} yan`);
      assert.ok(Math.abs(p.headwindKmh - 25 * Math.cos(rad)) < 1e-9, `nokta ${i} karşı`);
    }
  });
  // sakin ÖRNEK hava (25 km/sa < 40 eşiği) → uygun
  assert.equal(assessRide(r).level, 'uygun');
});

test('Pelion: firkete (way 223719457) ve düz kesimde yan rüzgâr; Hania tarafında ÖRNEK soğuk + yağış → önerilmez', async () => {
  const bs = routeBearings(PELION.pathFull.coordinates);
  // rota-uzmani: firketeler km ~8,1–9,3 (way 223719457; 2026-11-08 geometrisi). Oradaki en düşük R'li pencere variable olmalı → bileşen yok.
  const firkete = bs.filter((b) => b.sM >= 8100 && b.sM + 200 <= 9300).reduce((m, b) => (b.R < m.R ? b : m));
  assert.ok(firkete.variable && firkete.R < 0.3, `firkete R ${firkete.R}`);
  const duz = bs.find((b) => b.R > 0.99 && b.sM > 5400); // şehir dışı (km 5,4 sonrası) ilk düz pencere
  assert.ok(duz, 'Pelion pathFull\'da şehir dışında düz pencere olmalı');
  const pts = [
    { ...ornekNokta({ wind_speed_10m: 30, wind_direction_10m: 90 }, (firkete.sM + 100) / 1000, 0), geometry: 'pathFull' },
    { ...ornekNokta({ wind_speed_10m: 30, wind_direction_10m: (duz.bearingDeg + 270) % 360 }, (duz.sM + 100) / 1000, 1), geometry: 'pathFull' },
  ];
  const [p, q] = addWindComponents(PELION, pts);
  assert.equal(p.bearingVariable, true);
  assert.equal(p.crosswindKmh, null);
  assert.equal(q.bearingVariable, false);
  assert.ok(Math.abs(q.crosswindKmh - 30) < 0.1 && Math.abs(q.headwindKmh) < 1, `yan ${q.crosswindKmh}, karşı ${q.headwindKmh}`);
  assert.equal(q.crosswindSide, 'left');
  // ÖRNEK kış senaryosu (bestSeason: Hania'da kar/buz olası): 4. örnek nokta (km ~27, Hania inişi) 1 °C ve yağış.
  const f = sahteFetch((ptsQ) => ornekOpenMeteoYaniti(ptsQ, {
    hourValues: (i) => (i === 3 ? { temperature_2m: 1, precipitation: 0.4, weather_code: 61 } : {}),
  }));
  const r = await fetchRouteForecast(PELION, { fetchImpl: f, startTime: ORNEK_BASLANGIC_SAATI, now: ORNEK_BASLANGIC_SAATI, n: 6 });
  const a = assessRide(r);
  assert.equal(a.level, 'önerilmez');
  assert.equal(a.reasons[0].code, 'ice');
  assert.equal(a.reasons[0].distanceKm, r.points[3].distanceKm);
  assert.match(buildWeatherAlert(a, 'en'), /^Riding not advised: ice risk at km 27 \(1 °C with precipitation\)\. Take rain gear\.$/);
  // Yunanca uyarı metni henüz yok: 'el' İngilizceye düşer (rota metinleri el + en).
  assert.equal(buildWeatherAlert(a, 'el'), buildWeatherAlert(a, 'en'));
  assert.equal(checklistUrl('checklist.html', a), 'checklist.html?ek=yagmur,soguk,-sis');
});

// ---- es-andalucia-01 (Sierra de Grazalema, ilk İspanya rotası; rota-uzmani 2026-11-09). Hava değerleri ÖRNEKTİR; geometri gerçek pathFull. ----
const ANDALUCIA = data.routes.find((r) => r.id === 'es-andalucia-01');

test('Sierra de Grazalema: fetchRouteForecast örnekleme, varış saati, rakım ve yan rüzgâr alanları (sahte fetch, ÖRNEK yanıt)', async () => {
  assert.ok(ANDALUCIA?.pathFull, 'es-andalucia-01 pathFull ile olmalı');
  const start = Date.parse('2026-11-02T08:00:00Z');
  const n = 6;
  // ÖRNEK: tüm noktalarda batıdan (270°, Atlantik yönü) 20 km/sa rüzgâr; rakımlar örnek (Boyar/Palomas geçitleri yüksek).
  const ornekRakim = [300, 700, 1000, 1150, 750, 500];
  const f = sahteFetch((pts) => ornekOpenMeteoYaniti(pts, {
    elevations: ornekRakim, hourValues: () => ({ wind_speed_10m: 20, wind_direction_10m: 270 }),
  }));
  const r = await fetchRouteForecast(ANDALUCIA, { fetchImpl: f, startTime: start, now: ORNEK_BASLANGIC_SAATI, speedKmh: 40, n });
  assert.equal(f.calls.length, 1, 'tek istek');
  assert.equal(r.routeId, 'es-andalucia-01');
  assert.equal(r.geometry, 'pathFull');
  assert.equal(r.routeApproximate, false);
  assert.equal(r.distanceScale, 1);
  const L = lineLengthKm(ANDALUCIA);
  assert.ok(Math.abs(L - ANDALUCIA.lengthKm) / ANDALUCIA.lengthKm < 0.002, `pathFull ${L.toFixed(2)} km, lengthKm ${ANDALUCIA.lengthKm}`);
  assert.ok(Math.abs(r.routeKm - L) < 1e-9);
  // uçlar: rotanın gerçek başlangıç/bitişi (El Bosque A-372, Zahara de la Sierra CA-9104)
  const c = ANDALUCIA.pathFull.coordinates;
  assert.deepEqual([r.points[0].lon, r.points[0].lat], c[0]);
  assert.deepEqual([r.points.at(-1).lon, r.points.at(-1).lat], c.at(-1));
  assert.ok(Math.abs(r.points[0].lat - ANDALUCIA.start.lat) < 1e-3 && Math.abs(r.points.at(-1).lon - ANDALUCIA.end.lon) < 1e-3);
  // batı boylamı (negatif) URL'de doğru taşınır
  const u = new URL(f.calls[0]);
  const lons = u.searchParams.get('longitude').split(',').map(Number);
  assert.equal(lons.length, n);
  assert.ok(lons.every((x) => x < -5 && x > -6), `boylamlar ${lons}`);
  const hours = Number(u.searchParams.get('forecast_hours'));
  assert.ok(hours >= Math.ceil((start + (L / 40) * 3600e3 - ORNEK_BASLANGIC_SAATI) / 3600e3));
  const bearings = routeBearings(c);
  r.points.forEach((p, i) => {
    assert.ok(Math.abs(p.distanceKm - (L * i) / (n - 1)) < 1e-9, `nokta ${i} mesafe`);
    const arr = start + ((L * i) / (n - 1) / 40) * 3600e3; // 31,75 km / 40 km/sa ≈ 48 dk
    assert.equal(p.arrival, new Date(arr).toISOString(), `nokta ${i} varış`);
    assert.equal(p.forecast.temperature_2m, 15 + Math.round((arr - ORNEK_BASLANGIC_SAATI) / 3600e3), `nokta ${i} saat seçimi`);
    assert.equal(p.elevationM, ornekRakim[i]);
    // yön: noktanın merkezine en yakın 200 m pencere (testin kendi seçimi)
    const lineM = p.distanceKm * 1000;
    const b = bearings.reduce((best, x) => (Math.abs(x.sM + 100 - lineM) < Math.abs(best.sM + 100 - lineM) ? x : best));
    assert.equal(p.bearingR, b.R, `nokta ${i} pencere`);
    assert.equal(p.bearingVariable, b.variable || b.bearingDeg === null);
    if (p.bearingVariable) {
      assert.equal(p.crosswindKmh, null);
      assert.equal(p.headwindKmh, null);
    } else {
      const rad = ((270 - p.bearingDeg) * Math.PI) / 180;
      assert.ok(Math.abs(p.crosswindKmh - Math.abs(20 * Math.sin(rad))) < 1e-9, `nokta ${i} yan`);
      assert.ok(Math.abs(p.headwindKmh - 20 * Math.cos(rad)) < 1e-9, `nokta ${i} karşı`);
    }
  });
  assert.equal(assessRide(r).level, 'uygun', 'sakin ÖRNEK hava (20 km/sa < 40 eşiği)');
});

test('Sierra de Grazalema: iniş firketesi ve A-372 düz kesiminde yan rüzgâr; Palomas tarafında ÖRNEK soğuk + yağış → önerilmez', async () => {
  const bs = routeBearings(ANDALUCIA.pathFull.coordinates);
  // rota-uzmani: CA-9104 iniş firketeleri km 21,25–23,90. Oradaki en düşük R'li pencere variable olmalı → bileşen yok.
  const firkete = bs.filter((b) => b.sM >= 21250 && b.sM + 200 <= 23900).reduce((m, b) => (b.R < m.R ? b : m));
  assert.ok(firkete.variable && firkete.R < 0.3, `firkete R ${firkete.R}`);
  const duz = bs.find((b) => b.R > 0.99 && b.sM >= 1700 && b.sM + 200 <= 15230); // El Bosque sonrası A-372 düz pencere
  assert.ok(duz, 'A-372 üzerinde düz pencere olmalı');
  const pts = [
    { ...ornekNokta({ wind_speed_10m: 35, wind_direction_10m: 270 }, (firkete.sM + 100) / 1000, 0), geometry: 'pathFull' },
    { ...ornekNokta({ wind_speed_10m: 35, wind_direction_10m: (duz.bearingDeg + 90) % 360 }, (duz.sM + 100) / 1000, 1), geometry: 'pathFull' },
  ];
  const [p, q] = addWindComponents(ANDALUCIA, pts);
  assert.equal(p.bearingVariable, true);
  assert.equal(p.crosswindKmh, null);
  assert.equal(p.crosswindSide, null);
  assert.equal(q.bearingVariable, false);
  assert.ok(Math.abs(q.crosswindKmh - 35) < 0.1 && Math.abs(q.headwindKmh) < 1, `yan ${q.crosswindKmh}, karşı ${q.headwindKmh}`);
  assert.equal(q.crosswindSide, 'right');
  // Yan rüzgâr yalnız bilgi (karar 18 cevap bekliyor): 35 km/sa yan rüzgâr seviyeyi değiştirmez.
  assert.equal(assessRide([q]).level, 'uygun');
  // ÖRNEK kış senaryosu (bestSeason: "en invierno puede haber hielo"): 4. örnek nokta (km ~19, CA-9104 tırmanışı,
  // Puerto de las Palomas'a ~1,4 km) 1 °C ve yağış.
  const f = sahteFetch((ptsQ) => ornekOpenMeteoYaniti(ptsQ, {
    hourValues: (i) => (i === 3 ? { temperature_2m: 1, precipitation: 0.4, weather_code: 61 } : {}),
  }));
  const r = await fetchRouteForecast(ANDALUCIA, { fetchImpl: f, startTime: ORNEK_BASLANGIC_SAATI, now: ORNEK_BASLANGIC_SAATI, n: 6 });
  assert.ok(r.points[3].distanceKm > 17.21 && r.points[3].distanceKm < 20.46, `nokta 3 CA-9104 tırmanışında (km ${r.points[3].distanceKm})`);
  const a = assessRide(r);
  assert.equal(a.level, 'önerilmez');
  assert.equal(a.reasons[0].code, 'ice');
  assert.equal(a.reasons[0].distanceKm, r.points[3].distanceKm);
  assert.match(buildWeatherAlert(a, 'en'), /^Riding not advised: ice risk at km 19 \(1 °C with precipitation\)\. Take rain gear\.$/);
  // İspanyolca uyarı metni henüz yok: 'es' İngilizceye düşer (rota metinleri es + en).
  assert.equal(buildWeatherAlert(a, 'es'), buildWeatherAlert(a, 'en'));
  assert.equal(checklistUrl('checklist.html', a), 'checklist.html?ek=yagmur,soguk,-sis');
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log(`ok   - ${t.name}`); }
  catch (e) { failed++; console.log(`FAIL - ${t.name}\n       ${e.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} test geçti`);
if (failed) process.exit(1);
