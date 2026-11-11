// Hava durumu — rota boyunca varış saatine göre tahmin + sürüşe uygunluk. Bağımlılıksız ES modülü.
// Tarayıcıda ve Node (>=18, global fetch) üzerinde çalışır.
// Kaynak: Open-Meteo Forecast API (https://open-meteo.com/en/docs), anahtarsız.
// Lisans/atıf: Open-Meteo verisi CC BY 4.0 — arayüzde "Weather data by Open-Meteo.com" (bağlantılı) atfı gösterilmeli.
// Ücretsiz API ticari olmayan kullanım içindir (günlük/saatlik istek sınırı var); ticari kullanım için Open-Meteo aboneliği gerekir.
// Bu modül hiçbir hava verisi içermez; veri dışarıdan (API ya da test örneği) gelir.
import { routeBearings, DEFAULT_BEARING_WINDOW_M } from './route-geometry.js';

export const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const HOURLY_VARS = Object.freeze([
  'temperature_2m', 'precipitation', 'precipitation_probability',
  'wind_speed_10m', 'wind_gusts_10m', 'visibility', 'weather_code',
  'wind_direction_10m', // derece, rüzgârın GELDİĞİ yön (meteorolojik); yalnız yan/karşı rüzgâr bilgi alanları için
]);
export const LEVELS = Object.freeze(['uygun', 'dikkat', 'önerilmez']);
export const DEFAULT_SPEED_KMH = 40;   // varsayım: virajlı dağ yolunda ortalama hız
export const DEFAULT_SAMPLE_COUNT = 6;
export const MAX_FORECAST_HOURS = 384; // Open-Meteo: en fazla 16 gün

// ---- Eşikler ----
// Kaynak belirtilmeyenler PROJE VARSAYIMIDIR (bir standarda/çalışmaya dayanmaz); sahada ve kullanıcı geri bildirimiyle ayarlanmalı.
export const THRESHOLDS = Object.freeze({
  // Yağış (Open-Meteo: önceki 1 saatin toplamı, mm). Varsayım; 7,6 mm/sa "şiddetli yağmur" sınırı AMS Glossary of Meteorology'den.
  rainMmCaution: 0.2,
  rainMmUnsafe: 7.6,
  rainProbCaution: 40,      // %, varsayım
  // Rüzgâr (10 m, km/sa). Varsayım; yönlendirme için: Beaufort 6 ≈ 39–49 km/sa, Beaufort 8 ≈ 62–74 km/sa.
  windCaution: 40,
  windUnsafe: 60,
  gustCaution: 50,
  gustUnsafe: 75,
  // Görüş (m). 1000 m: WMO sis tanımı (görüş < 1 km). 200 m: varsayım.
  visibilityCaution: 1000,
  visibilityUnsafe: 200,
  // Sıcaklık (°C, 2 m). Varsayım.
  coldCaution: 5,
  frostCaution: 0,
  iceTemp: 3,               // buzlanma: sıcaklık ≤ 3 °C VE yağış → önerilmez (görev tanımı)
  heatCaution: 35,
  heatUnsafe: 40,
  // Koşullu ekipman tetikleyicileri (ekipman-asistani ?ek= arayüzü). PROJE VARSAYIMI, kullanıcı onayı bekliyor.
  // Herhangi bir örnek noktada, sürücünün varış saatinde:
  coldGearTemp: 5,          // sıcaklık ≤ 5 °C → ?ek=soguk (termal içlik)
  fogGearVisibility: 1000,  // görüş < 1000 m ya da kod 45/48 → ?ek=sis (reflektif yelek / ışıklar açık)
});

// WMO hava kodları (Open-Meteo weather_code).
const WC = {
  fog: [45], rimeFog: [48],
  rain: [51, 53, 55, 61, 63, 80, 81], heavyRain: [65, 82],
  freezing: [56, 57, 66, 67], snow: [71, 73, 75, 77, 85, 86], thunder: [95, 96, 99],
};
const has = (list, code) => list.includes(code);
const isPrecipCode = (c) => [WC.rain, WC.heavyRain, WC.freezing, WC.snow, WC.thunder].some((l) => has(l, c));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- Geometri ----
function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Kullanılacak çizgiyi seçer: varsayılan `route.pathFull ?? route.path` (rota-uzmani: pathFull tam yol geometrisi,
 * uzunluğu lengthKm ile %0,2 içinde ya da farkı yalnız lengthKm'nin 1 ondalık yuvarlamasından (|fark| ≤ 0,05 km);
 * path sadeleştirilmiş, lengthKm'den kısa, fark virajlılığa bağlı). geometry: 'auto' | 'pathFull' | 'path'.
 * @returns {{geometry:'pathFull'|'path', pts:{lat:number, lon:number}[]}}
 */
function routeLine(route, geometry = 'auto') {
  if (!['auto', 'pathFull', 'path'].includes(geometry)) throw new Error(`geometry 'auto', 'pathFull' ya da 'path' olmalı`);
  const key = geometry === 'auto' ? (route?.pathFull != null ? 'pathFull' : 'path') : geometry;
  const line = route?.[key];
  const c = line?.coordinates;
  if (line?.type !== 'LineString' || !Array.isArray(c) || c.length < 2) {
    throw new Error(`${route?.id ?? 'rota'}: ${key} GeoJSON LineString ([lon,lat], en az 2 nokta) olmalı`);
  }
  return { geometry: key, pts: c.map(([lon, lat]) => ({ lat, lon })) };
}

function cumulativeKm(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
  return cum;
}

/**
 * Rota çizgisinin haversine ile ölçülen uzunluğu, km. Varsayılan pathFull ?? path;
 * { geometry: 'path' } sadeleştirilmiş çizgiyi ölçer (lengthKm'den kısa).
 */
export function lineLengthKm(route, { geometry = 'auto' } = {}) {
  const cum = cumulativeKm(routeLine(route, geometry).pts);
  return cum[cum.length - 1];
}

/** Çizgi km'sini yol km'sine çeviren çarpan: pathFull'da 1; yalnız path varsa lengthKm / çizgi uzunluğu (rota-uzmani). */
function distanceScaleFor(route, geometry, lineKm) {
  if (geometry === 'pathFull') return 1;
  return isNum(route?.lengthKm) && route.lengthKm > 0 && lineKm > 0 ? route.lengthKm / lineKm : 1;
}

/**
 * Çizgi üzerinden eşit aralıklı n nokta (başlangıç ve bitiş dahil). Çizgi: route.pathFull ?? route.path.
 * @returns {{index:number, lat:number, lon:number, distanceKm:number, geometry:'pathFull'|'path'}[]}
 *   distanceKm: başlangıca yol mesafesi. pathFull'da çizgi mesafesinin kendisi; yalnız path varsa
 *   lengthKm / çizgi uzunluğu ile ölçeklenir (yaklaşık). geometry: hangi çizginin kullanıldığı.
 */
export function sampleRoutePoints(route, n = DEFAULT_SAMPLE_COUNT, { geometry: geomOpt = 'auto' } = {}) {
  if (!Number.isInteger(n) || n < 2) throw new Error('n en az 2 olan tam sayı olmalı');
  const { geometry, pts } = routeLine(route, geomOpt);
  const cum = cumulativeKm(pts);
  const total = cum[cum.length - 1];
  const scale = distanceScaleFor(route, geometry, total);
  const out = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    if (k === 0) { out.push({ index: 0, ...pts[0], distanceKm: 0, geometry }); continue; }
    if (k === n - 1) { out.push({ index: k, ...pts[pts.length - 1], distanceKm: total * scale, geometry }); continue; }
    while (seg < pts.length - 1 && cum[seg] < d) seg++;
    const segLen = cum[seg] - cum[seg - 1];
    const t = segLen > 0 ? (d - cum[seg - 1]) / segLen : 0;
    const a = pts[seg - 1], b = pts[seg];
    out.push({ index: k, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, distanceKm: d * scale, geometry });
  }
  return out;
}

// ---- Rüzgâr bileşenleri (yalnızca BİLGİ; sürüş seviyesine etki etmez — yan rüzgâr eşiği kullanıcı onayı bekliyor) ----
/**
 * Rüzgârın rota yönüne göre bileşenleri.
 * @param {number} speedKmh rüzgâr hızı (10 m)
 * @param {number} fromDeg rüzgârın geldiği yön (meteorolojik, 0 = kuzeyden)
 * @param {number} bearingDeg sürüş yönü (pusula, 0 = kuzeye)
 * @returns {{crosswindKmh:number, crosswindSide:'right'|'left'|null, headwindKmh:number}|null}
 *   crosswindKmh: yan bileşenin büyüklüğü (≥ 0). crosswindSide: rüzgârın sürücünün hangi yanından geldiği (≈0 ise null).
 *   headwindKmh: + karşı rüzgâr, − arka rüzgâr.
 */
export function windComponents(speedKmh, fromDeg, bearingDeg) {
  if (![speedKmh, fromDeg, bearingDeg].every(isNum)) return null;
  const a = ((fromDeg - bearingDeg) * Math.PI) / 180;
  const cross = speedKmh * Math.sin(a);
  const head = speedKmh * Math.cos(a);
  const tidy = (x) => (Math.abs(x) < 1e-9 ? 0 : x);
  return {
    crosswindKmh: tidy(Math.abs(cross)),
    crosswindSide: Math.abs(cross) < 1e-9 ? null : cross > 0 ? 'right' : 'left',
    headwindKmh: tidy(head),
  };
}

/**
 * Örnek noktaların her birine rota yönü ve rüzgâr bileşenlerini ekler (yeni dizi döner; girdi değişmez).
 * Yön: route-geometry.js routeBearings (aynı çizgi: points[0].geometry; 200 m pencere), merkezi noktaya en yakın pencere.
 * Yön değişken (R < 0,7; viraj/firkete) ya da tanımsızsa crosswindKmh/headwindKmh/crosswindSide null, bearingVariable true.
 * Rüzgâr hızı ya da yönü yoksa bileşenler null (bearingVariable yine geometriden gelir).
 * Eklenen alanlar: bearingDeg, bearingR, bearingVariable, crosswindKmh, crosswindSide, headwindKmh.
 */
export function addWindComponents(route, points, { windowM = DEFAULT_BEARING_WINDOW_M } = {}) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const { geometry, pts } = routeLine(route, points[0].geometry ?? 'auto');
  const coords = pts.map((p) => [p.lon, p.lat]);
  const cum = cumulativeKm(pts);
  const scale = distanceScaleFor(route, geometry, cum[cum.length - 1]);
  const bearings = routeBearings(coords, { windowM });
  const half = Math.min(windowM, cum[cum.length - 1] * 1000) / 2;
  const at = (lineM) => {
    // pencereler sM = 0, 50, 100 ... (adım sabit) → merkezi lineM'e en yakın olanı ikili aramayla bul
    let lo = 0, hi = bearings.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bearings[mid].sM + half < lineM) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(bearings[lo - 1].sM + half - lineM) <= Math.abs(bearings[lo].sM + half - lineM)) lo--;
    return bearings[lo];
  };
  return points.map((p) => {
    const b = at(((p.distanceKm ?? 0) / scale) * 1000);
    const variable = b.variable || b.bearingDeg === null;
    const f = p.forecast;
    const c = variable ? null : windComponents(f?.wind_speed_10m, f?.wind_direction_10m, b.bearingDeg);
    return {
      ...p,
      bearingDeg: b.bearingDeg,
      bearingR: b.R,
      bearingVariable: variable,
      crosswindKmh: c ? c.crosswindKmh : null,
      crosswindSide: c ? c.crosswindSide : null,
      headwindKmh: c ? c.headwindKmh : null,
    };
  });
}

// ---- Open-Meteo ----
/**
 * Birden çok nokta için tek istek URL'si. Zaman UTC + unix saniye; birimler Open-Meteo varsayılanı
 * (°C, mm, km/sa, görüş m).
 */
export function buildForecastUrl(points, { hours = 48, endpoint = OPEN_METEO_ENDPOINT } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new Error('en az bir nokta gerekli');
  const h = Math.max(1, Math.min(MAX_FORECAST_HOURS, Math.ceil(hours)));
  const fmt = (v) => Number(v.toFixed(5)).toString();
  const params = new URLSearchParams({
    latitude: points.map((p) => fmt(p.lat)).join(','),
    longitude: points.map((p) => fmt(p.lon)).join(','),
    hourly: HOURLY_VARS.join(','),
    forecast_hours: String(h),
    timezone: 'GMT',
    timeformat: 'unixtime',
  });
  return `${endpoint}?${params.toString()}`;
}

/** Bir nokta yanıtından, verilen ana (ms) en yakın saatin değerleri; 90 dk'dan uzaksa null. */
export function pickHour(locationJson, timeMs) {
  const hourly = locationJson?.hourly;
  const times = hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return null;
  let best = -1, bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(times[i] * 1000 - timeMs);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  if (bestDiff > 90 * 60 * 1000) return null;
  const f = { time: new Date(times[best] * 1000).toISOString() };
  for (const v of HOURLY_VARS) f[v] = isNum(hourly[v]?.[best]) ? hourly[v][best] : null;
  return f;
}

/**
 * Her örnek nokta için varış saatini (startTime + yol mesafesi / speedKmh) hesaplar ve o saatin tahminini seçer.
 * Çizgi route.pathFull ?? route.path; sonuçta geometry ('pathFull' | 'path') ve distanceScale görünür.
 * Yalnız path kullanıldığında mesafeler ve varış saatleri yaklaşıktır (routeApproximate: true).
 * @returns {Promise<{routeId, source, geometry, routeApproximate, distanceScale, startTime, speedKmh, lineLengthKm, routeKm, points: object[]}>}
 */
export async function fetchRouteForecast(route, {
  fetchImpl, startTime = Date.now(), speedKmh = DEFAULT_SPEED_KMH, n = DEFAULT_SAMPLE_COUNT,
  now = Date.now(), endpoint, signal,
} = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('fetch bulunamadı; fetchImpl verin');
  if (!isNum(speedKmh) || speedKmh <= 0) throw new Error('speedKmh pozitif sayı olmalı');
  const startMs = startTime instanceof Date ? startTime.getTime() : new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) throw new Error('startTime geçerli bir zaman olmalı');

  const samples = sampleRoutePoints(route, n);
  const geometry = samples[0].geometry;
  const lineKm = lineLengthKm(route, { geometry });
  const arrivals = samples.map((p) => startMs + (p.distanceKm / speedKmh) * 3600 * 1000);
  const hours = Math.ceil((arrivals[arrivals.length - 1] - now) / 3600000) + 2;
  const url = buildForecastUrl(samples, { hours, endpoint });

  const res = await doFetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  if (json && !Array.isArray(json) && json.error) throw new Error(`Open-Meteo hatası: ${json.reason ?? 'bilinmiyor'}`);
  const locations = Array.isArray(json) ? json : [json]; // tek noktada nesne, çok noktada dizi döner
  if (locations.length !== samples.length) throw new Error(`Open-Meteo: ${samples.length} nokta istendi, ${locations.length} geldi`);

  return {
    routeId: route.id,
    source: 'Open-Meteo (open-meteo.com, CC BY 4.0)',
    geometry,
    routeApproximate: geometry !== 'pathFull' || route.routeApproximate === true,
    distanceScale: distanceScaleFor(route, geometry, lineKm),
    startTime: new Date(startMs).toISOString(),
    speedKmh,
    lineLengthKm: lineKm,
    routeKm: samples[samples.length - 1].distanceKm,
    // Her noktada bilgi alanları: bearingDeg, bearingVariable, crosswindKmh, headwindKmh (bkz. addWindComponents).
    points: addWindComponents(route, samples.map((p, i) => ({
      ...p,
      arrival: new Date(arrivals[i]).toISOString(),
      // Open-Meteo'nun kullandığı arazi yüksekliği (90 m DEM); rota verisinde doğrulanmış rakım yok.
      elevationM: isNum(locations[i]?.elevation) ? locations[i].elevation : null,
      forecast: pickHour(locations[i], arrivals[i]),
    }))),
  };
}

// ---- Değerlendirme ----
const T = THRESHOLDS;
const km = (d) => Math.round(d);
const MSG = {
  no_data: (f, p) => ({ tr: `${km(p.distanceKm)}. km için tahmin yok`, en: `no forecast for km ${km(p.distanceKm)}` }),
  thunder: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de gök gürültülü fırtına`, en: `thunderstorm at km ${km(p.distanceKm)}` }),
  snow: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de kar`, en: `snow at km ${km(p.distanceKm)}` }),
  ice: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de buzlanma riski (${Math.round(f.temperature_2m)} °C ve yağış)`, en: `ice risk at km ${km(p.distanceKm)} (${Math.round(f.temperature_2m)} °C with precipitation)` }),
  ice_possible: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de soğuk ve yağış olasılığı, buzlanma olabilir`, en: `cold with chance of precipitation at km ${km(p.distanceKm)}, ice possible` }),
  heavy_rain: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de şiddetli yağmur`, en: `heavy rain at km ${km(p.distanceKm)}` }),
  rain: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de yağmur bekleniyor`, en: `rain expected at km ${km(p.distanceKm)}` }),
  rain_chance: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de yağmur olasılığı yüzde ${Math.round(f.precipitation_probability)}`, en: `${Math.round(f.precipitation_probability)} percent chance of rain at km ${km(p.distanceKm)}` }),
  wind: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de kuvvetli rüzgâr, ${Math.round(f.wind_speed_10m)} km/sa`, en: `strong wind at km ${km(p.distanceKm)}, ${Math.round(f.wind_speed_10m)} km/h` }),
  gust: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de sert rüzgâr hamlesi, ${Math.round(f.wind_gusts_10m)} km/sa`, en: `strong gusts at km ${km(p.distanceKm)}, ${Math.round(f.wind_gusts_10m)} km/h` }),
  fog: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de sis, görüş düşük`, en: `fog and low visibility at km ${km(p.distanceKm)}` }),
  frost: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de don (${Math.round(f.temperature_2m)} °C), yolda buz olabilir`, en: `freezing at km ${km(p.distanceKm)} (${Math.round(f.temperature_2m)} °C), road ice possible` }),
  cold: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de soğuk, ${Math.round(f.temperature_2m)} °C`, en: `cold at km ${km(p.distanceKm)}, ${Math.round(f.temperature_2m)} °C` }),
  heat: (f, p) => ({ tr: `${km(p.distanceKm)}. km'de aşırı sıcak, ${Math.round(f.temperature_2m)} °C`, en: `extreme heat at km ${km(p.distanceKm)}, ${Math.round(f.temperature_2m)} °C` }),
};

function assessPoint(p) {
  const out = [];
  const add = (code, level) => out.push({ code, level, pointIndex: p.index, distanceKm: p.distanceKm, ...MSG[code](p.forecast, p) });
  const f = p.forecast;
  if (!f || HOURLY_VARS.every((v) => f[v] === null)) { add('no_data', 'dikkat'); return { reasons: out, rain: false, cold: false, fog: false, noData: true }; }
  const t = f.temperature_2m, mm = f.precipitation, prob = f.precipitation_probability, code = f.weather_code;
  const precip = (isNum(mm) && mm > 0) || isPrecipCode(code);

  if (has(WC.thunder, code)) add('thunder', 'önerilmez');
  if (has(WC.snow, code)) add('snow', 'önerilmez');
  if (has(WC.freezing, code) || has(WC.rimeFog, code) || (isNum(t) && t <= T.iceTemp && precip)) add('ice', 'önerilmez');
  else if (isNum(t) && t <= T.iceTemp && isNum(prob) && prob >= T.rainProbCaution) add('ice_possible', 'dikkat');

  const rainy = (isNum(mm) && mm >= T.rainMmCaution) || has(WC.rain, code) || has(WC.heavyRain, code);
  if ((isNum(mm) && mm >= T.rainMmUnsafe) || has(WC.heavyRain, code)) add('heavy_rain', 'önerilmez');
  else if (rainy) add('rain', 'dikkat');
  else if (isNum(prob) && prob >= T.rainProbCaution) add('rain_chance', 'dikkat');

  if (isNum(f.wind_speed_10m) && f.wind_speed_10m >= T.windCaution) add('wind', f.wind_speed_10m >= T.windUnsafe ? 'önerilmez' : 'dikkat');
  if (isNum(f.wind_gusts_10m) && f.wind_gusts_10m >= T.gustCaution) add('gust', f.wind_gusts_10m >= T.gustUnsafe ? 'önerilmez' : 'dikkat');
  if ((isNum(f.visibility) && f.visibility < T.visibilityCaution) || has(WC.fog, code)) {
    add('fog', isNum(f.visibility) && f.visibility < T.visibilityUnsafe ? 'önerilmez' : 'dikkat');
  }
  if (isNum(t) && t <= T.frostCaution && !out.some((r) => r.code === 'ice')) add('frost', 'dikkat');
  else if (isNum(t) && t > T.frostCaution && t <= T.coldCaution) add('cold', 'dikkat');
  if (isNum(t) && t >= T.heatCaution) add('heat', t >= T.heatUnsafe ? 'önerilmez' : 'dikkat');

  const rain = precip || (isNum(mm) && mm >= T.rainMmCaution) || (isNum(prob) && prob >= T.rainProbCaution);
  const cold = isNum(t) && t <= T.coldGearTemp;
  const fog = (isNum(f.visibility) && f.visibility < T.fogGearVisibility) || has(WC.fog, code) || has(WC.rimeFog, code);
  return { reasons: out, rain, cold, fog, noData: false };
}

/**
 * @param {object[]|{points:object[]}} pointForecasts fetchRouteForecast sonucu ya da onun points dizisi
 * @returns {{level:'uygun'|'dikkat'|'önerilmez', reasons:object[], rainExpected:boolean, coldExpected:boolean,
 *   fogExpected:boolean, dataMissing:boolean, points:object[]}}
 *   reasons: en ağır seviyeden hafife, aynı seviyede rota sırasına göre; her biri {code, level, tr, en, pointIndex, distanceKm}
 *   coldExpected: bir noktada ≤ THRESHOLDS.coldGearTemp °C; fogExpected: görüş < THRESHOLDS.fogGearVisibility m ya da kod 45/48
 *   (ikisi de proje varsayımı). dataMissing: en az bir noktada tahmin yok (o noktada koşullar bilinmiyor).
 */
export function assessRide(pointForecasts) {
  const pts = Array.isArray(pointForecasts) ? pointForecasts : pointForecasts?.points;
  if (!Array.isArray(pts) || pts.length === 0) throw new Error('nokta tahmini yok');
  const rank = (l) => LEVELS.indexOf(l);
  let level = 'uygun', rainExpected = false, coldExpected = false, fogExpected = false, dataMissing = false;
  const reasons = [];
  const points = pts.map((p) => {
    const r = assessPoint(p);
    const pl = r.reasons.reduce((m, x) => (rank(x.level) > rank(m) ? x.level : m), 'uygun');
    if (rank(pl) > rank(level)) level = pl;
    rainExpected ||= r.rain;
    coldExpected ||= r.cold;
    fogExpected ||= r.fog;
    dataMissing ||= r.noData;
    reasons.push(...r.reasons);
    return { index: p.index, distanceKm: p.distanceKm, arrival: p.arrival, elevationM: p.elevationM ?? null, level: pl };
  });
  reasons.sort((a, b) => rank(b.level) - rank(a.level) || a.distanceKm - b.distanceKm);
  return { level, reasons, rainExpected, coldExpected, fogExpected, dataMissing, points };
}

/** Yağmur ekipmanı gerekli mi? (THRESHOLDS: herhangi bir noktada yağış kodu, ≥ 0,2 mm/sa ya da olasılık ≥ %40) */
export function rainGearNeeded(assessment) {
  return Boolean(assessment?.rainExpected);
}

/**
 * Koşullu ekipman kararları: true → ekle, false → kaldır, null → bilinmiyor (dokunma).
 * Bir noktada tahmin yoksa (dataMissing) "beklenmiyor" kesin değildir; false yerine null döner ki madde silinmesin.
 */
export function gearConditions(assessment) {
  const v = (x) => (x ? true : assessment?.dataMissing ? null : false);
  return { rain: v(assessment?.rainExpected), cold: v(assessment?.coldExpected), fog: v(assessment?.fogExpected) };
}

// checklist.html EK_ALIASES ile aynı anahtarlar; yazarken Türkçe ASCII anahtar kullanılır.
const GEAR_KEYS = Object.freeze({ rain: 'yagmur', cold: 'soguk', fog: 'sis' });
const GEAR_ALIASES = Object.freeze({ yagmur: 'rain', 'yağmur': 'rain', rain: 'rain', soguk: 'cold', 'soğuk': 'cold', cold: 'cold', sis: 'fog', fog: 'fog' });

/**
 * ekipman-asistani kontrol listesi bağlantısı (?ek=; virgülle ayrılır, başta "-" kaldırır). Mevcut sorgu ve # korunur.
 * - checklistUrl(base, needsRain: boolean): eski arayüz; true → yagmur eklenir, false → base aynen döner.
 * - checklistUrl(base, assessment | {rain, cold, fog}): üç koşul her seferinde açıkça yazılır, ör. ?ek=yagmur,-soguk,sis
 *   (önceki günden kayıtta kalan madde böylece temizlenir). null/undefined koşul yazılmaz (mevcut değeri korunur).
 *   Not: checklist.html ?ek= komutunu her yüklemede yeniden uygular; bağlantı sürüş öncesi kararı temsil eder.
 */
export function checklistUrl(base = 'checklist.html', conditions = false) {
  const legacy = typeof conditions === 'boolean' || conditions == null;
  if (legacy && !conditions) return base;
  const want = legacy ? { rain: true }
    : ('rainExpected' in conditions || 'coldExpected' in conditions || 'fogExpected' in conditions) ? gearConditions(conditions)
      : conditions;
  const hashAt = base.indexOf('#');
  const hash = hashAt >= 0 ? base.slice(hashAt) : '';
  const head = hashAt >= 0 ? base.slice(0, hashAt) : base;
  const qAt = head.indexOf('?');
  const path = qAt >= 0 ? head.slice(0, qAt) : head;
  const params = new URLSearchParams(qAt >= 0 ? head.slice(qAt + 1) : '');
  let ek = (params.get('ek') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const condOf = (v) => GEAR_ALIASES[v.toLowerCase().replace(/^-/, '')];
  if (legacy) {
    if (!ek.some((v) => !v.startsWith('-') && condOf(v) === 'rain')) ek.push(GEAR_KEYS.rain);
  } else {
    const decided = Object.keys(GEAR_KEYS).filter((k) => typeof want[k] === 'boolean');
    ek = ek.filter((v) => !decided.includes(condOf(v)));
    for (const k of decided) ek.push(want[k] ? GEAR_KEYS[k] : `-${GEAR_KEYS[k]}`);
  }
  if (ek.length === 0) params.delete('ek'); else params.set('ek', ek.join(','));
  const q = params.toString().replace(/%2C/g, ',');
  return `${path}${q ? `?${q}` : ''}${hash}`;
}

const ALERT = {
  tr: { uygun: 'Hava sürüşe uygun.', dikkat: 'Dikkat', 'önerilmez': 'Sürüş önerilmez', more: (k) => ` ve ${k} uyarı daha`, gear: ' Yağmurluğunu al.' },
  en: { uygun: 'Weather is fine for riding.', dikkat: 'Caution', 'önerilmez': 'Riding not advised', more: (k) => ` and ${k} more warning${k > 1 ? 's' : ''}`, gear: ' Take rain gear.' },
};

/** Kısa, etkileşim gerektirmeyen sesli/metin uyarı. En fazla iki gerekçe okur. Bilinmeyen dilde İngilizce. */
export function buildWeatherAlert(assessment, lang = 'en') {
  const L = ALERT[lang] ? lang : 'en';
  const A = ALERT[L];
  if (assessment.level === 'uygun') return A.uygun + (assessment.rainExpected ? A.gear : '');
  const top = assessment.reasons.filter((r) => r.level === assessment.level);
  const seen = new Set();
  const picked = [];
  for (const r of top) { if (!seen.has(r.code) && picked.length < 2) { seen.add(r.code); picked.push(r); } }
  const rest = new Set(top.map((r) => r.code)).size - picked.length;
  return `${A[assessment.level]}: ${picked.map((r) => r[L]).join(L === 'tr' ? ', ' : ', ')}${rest > 0 ? A.more(rest) : ''}.${assessment.rainExpected ? A.gear : ''}`;
}
