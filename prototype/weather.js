// Hava durumu — rota boyunca varış saatine göre tahmin + sürüşe uygunluk. Bağımlılıksız ES modülü.
// Tarayıcıda ve Node (>=18, global fetch) üzerinde çalışır.
// Kaynak: Open-Meteo Forecast API (https://open-meteo.com/en/docs), anahtarsız.
// Lisans/atıf: Open-Meteo verisi CC BY 4.0 — arayüzde "Weather data by Open-Meteo.com" (bağlantılı) atfı gösterilmeli.
// Ücretsiz API ticari olmayan kullanım içindir (günlük/saatlik istek sınırı var); ticari kullanım için Open-Meteo aboneliği gerekir.
// Bu modül hiçbir hava verisi içermez; veri dışarıdan (API ya da test örneği) gelir.

export const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const HOURLY_VARS = Object.freeze([
  'temperature_2m', 'precipitation', 'precipitation_probability',
  'wind_speed_10m', 'wind_gusts_10m', 'visibility', 'weather_code',
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

function routeCoords(route) {
  const c = route?.path?.coordinates;
  if (route?.path?.type !== 'LineString' || !Array.isArray(c) || c.length < 2) {
    throw new Error(`${route?.id ?? 'rota'}: path GeoJSON LineString ([lon,lat], en az 2 nokta) olmalı`);
  }
  return c.map(([lon, lat]) => ({ lat, lon }));
}

/** Rota çizgisinin (path) haversine ile ölçülen uzunluğu, km. lengthKm'den kısadır (çizgi sadeleştirilmiş). */
export function lineLengthKm(route) {
  const pts = routeCoords(route);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1], pts[i]);
  return total;
}

/**
 * Çizgi üzerinden eşit aralıklı n nokta (başlangıç ve bitiş dahil).
 * @returns {{index:number, lat:number, lon:number, distanceKm:number}[]} distanceKm: çizgi üzerinden başlangıca uzaklık
 */
export function sampleRoutePoints(route, n = DEFAULT_SAMPLE_COUNT) {
  if (!Number.isInteger(n) || n < 2) throw new Error('n en az 2 olan tam sayı olmalı');
  const pts = routeCoords(route);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const out = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    if (k === 0) { out.push({ index: 0, ...pts[0], distanceKm: 0 }); continue; }
    if (k === n - 1) { out.push({ index: k, ...pts[pts.length - 1], distanceKm: total }); continue; }
    while (seg < pts.length - 1 && cum[seg] < d) seg++;
    const segLen = cum[seg] - cum[seg - 1];
    const t = segLen > 0 ? (d - cum[seg - 1]) / segLen : 0;
    const a = pts[seg - 1], b = pts[seg];
    out.push({ index: k, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, distanceKm: d });
  }
  return out;
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
 * Her örnek nokta için varış saatini (startTime + çizgi mesafesi / speedKmh) hesaplar ve o saatin tahminini seçer.
 * @returns {Promise<{routeId, source, startTime, speedKmh, lineLengthKm, points: object[]}>}
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
    startTime: new Date(startMs).toISOString(),
    speedKmh,
    lineLengthKm: samples[samples.length - 1].distanceKm,
    points: samples.map((p, i) => ({
      ...p,
      arrival: new Date(arrivals[i]).toISOString(),
      // Open-Meteo'nun kullandığı arazi yüksekliği (90 m DEM); rota verisinde doğrulanmış rakım yok.
      elevationM: isNum(locations[i]?.elevation) ? locations[i].elevation : null,
      forecast: pickHour(locations[i], arrivals[i]),
    })),
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
  if (!f || HOURLY_VARS.every((v) => f[v] === null)) { add('no_data', 'dikkat'); return { reasons: out, rain: false }; }
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
  return { reasons: out, rain };
}

/**
 * @param {object[]|{points:object[]}} pointForecasts fetchRouteForecast sonucu ya da onun points dizisi
 * @returns {{level:'uygun'|'dikkat'|'önerilmez', reasons:object[], rainExpected:boolean, points:object[]}}
 *   reasons: en ağır seviyeden hafife, aynı seviyede rota sırasına göre; her biri {code, level, tr, en, pointIndex, distanceKm}
 */
export function assessRide(pointForecasts) {
  const pts = Array.isArray(pointForecasts) ? pointForecasts : pointForecasts?.points;
  if (!Array.isArray(pts) || pts.length === 0) throw new Error('nokta tahmini yok');
  const rank = (l) => LEVELS.indexOf(l);
  let level = 'uygun', rainExpected = false;
  const reasons = [];
  const points = pts.map((p) => {
    const r = assessPoint(p);
    const pl = r.reasons.reduce((m, x) => (rank(x.level) > rank(m) ? x.level : m), 'uygun');
    if (rank(pl) > rank(level)) level = pl;
    rainExpected ||= r.rain;
    reasons.push(...r.reasons);
    return { index: p.index, distanceKm: p.distanceKm, arrival: p.arrival, elevationM: p.elevationM ?? null, level: pl };
  });
  reasons.sort((a, b) => rank(b.level) - rank(a.level) || a.distanceKm - b.distanceKm);
  return { level, reasons, rainExpected, points };
}

/** Yağmur ekipmanı gerekli mi? (THRESHOLDS: herhangi bir noktada yağış kodu, ≥ 0,2 mm/sa ya da olasılık ≥ %40) */
export function rainGearNeeded(assessment) {
  return Boolean(assessment?.rainExpected);
}

/** ekipman-asistani kontrol listesi bağlantısı; yağmur bekleniyorsa ?ek=yagmur ekler (mevcut sorgu ve # korunur). */
export function checklistUrl(base = 'checklist.html', needsRain = false) {
  if (!needsRain) return base;
  const hashAt = base.indexOf('#');
  const hash = hashAt >= 0 ? base.slice(hashAt) : '';
  const head = hashAt >= 0 ? base.slice(0, hashAt) : base;
  const qAt = head.indexOf('?');
  const path = qAt >= 0 ? head.slice(0, qAt) : head;
  const params = new URLSearchParams(qAt >= 0 ? head.slice(qAt + 1) : '');
  const ek = (params.get('ek') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ek.some((v) => ['yagmur', 'yağmur', 'rain'].includes(v.toLowerCase()))) ek.push('yagmur');
  params.set('ek', ek.join(','));
  return `${path}?${params.toString().replace(/%2C/g, ',')}${hash}`;
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
