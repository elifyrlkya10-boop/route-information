// Tehlike uyarıları + yakındaki ihtiyaç noktaları (POI) — bağımlılıksız ES modülü.
// Tarayıcıda ve Node (>=18, global fetch) üzerinde çalışır.
// Modeller: docs/urun-dokumani.md > Hazard, Poi. Şema: data/hazards.schema.json
// Bu modül hiçbir tehlike/POI verisi içermez; veri dışarıdan gelir.

export const HAZARD_TYPES = Object.freeze(['gravel', 'roadwork', 'steep_grade', 'sharp_curve']);
export const POI_TYPES = Object.freeze(['fuel', 'market', 'gear_shop']);
export const ROUTE_ID_PATTERN = /^[a-z]{2}-[a-z]+(-[a-z]+)*-\d{2}$/;
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

const HAZARD_KEYS = ['id', 'routeId', 'type', 'location', 'note', 'reportedBy', 'reportedAt', 'isSample'];
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const LANG_PATTERN = /^[a-z]{2}$/;
// RFC 3339 date-time (JSON Schema "format": "date-time").
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateLocation(loc, path, errors) {
  if (!isObj(loc)) { errors.push(`${path}: nesne olmalı`); return; }
  for (const k of Object.keys(loc)) if (k !== 'lat' && k !== 'lon') errors.push(`${path}.${k}: bilinmeyen alan`);
  if (!isNum(loc.lat) || loc.lat < -90 || loc.lat > 90) errors.push(`${path}.lat: -90..90 arası sayı olmalı`);
  if (!isNum(loc.lon) || loc.lon < -180 || loc.lon > 180) errors.push(`${path}.lon: -180..180 arası sayı olmalı`);
}

/**
 * data/hazards.schema.json ile uyumlu basit doğrulayıcı.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateHazard(h) {
  const errors = [];
  if (!isObj(h)) return { valid: false, errors: ['hazard: nesne olmalı'] };

  for (const k of HAZARD_KEYS) if (!(k in h)) errors.push(`${k}: zorunlu alan eksik`);
  for (const k of Object.keys(h)) if (!HAZARD_KEYS.includes(k)) errors.push(`${k}: bilinmeyen alan`);

  if ('id' in h && (typeof h.id !== 'string' || !ID_PATTERN.test(h.id))) errors.push('id: boş olmayan, [A-Za-z0-9._:-] karakterli metin olmalı');
  if ('routeId' in h && (typeof h.routeId !== 'string' || !ROUTE_ID_PATTERN.test(h.routeId))) errors.push('routeId: ör. tr-karadeniz-01 biçiminde olmalı');
  if ('type' in h && !HAZARD_TYPES.includes(h.type)) errors.push(`type: ${HAZARD_TYPES.join('|')} olmalı`);
  if ('location' in h) validateLocation(h.location, 'location', errors);
  if ('note' in h) {
    if (!isObj(h.note)) errors.push('note: {dil: metin} nesnesi olmalı');
    else {
      if (typeof h.note.en !== 'string') errors.push('note.en: zorunlu (İngilizce yedek dil)');
      for (const [lang, text] of Object.entries(h.note)) {
        if (!LANG_PATTERN.test(lang)) errors.push(`note.${lang}: dil kodu iki küçük harf olmalı`);
        if (typeof text !== 'string' || text.length === 0) errors.push(`note.${lang}: boş olmayan metin olmalı`);
      }
    }
  }
  if ('reportedBy' in h && (typeof h.reportedBy !== 'string' || h.reportedBy.length === 0)) errors.push('reportedBy: boş olmayan metin olmalı');
  if ('reportedAt' in h && (typeof h.reportedAt !== 'string' || !DATE_TIME_PATTERN.test(h.reportedAt) || Number.isNaN(Date.parse(h.reportedAt)))) {
    errors.push('reportedAt: RFC 3339 date-time olmalı (ör. 2026-11-01T09:30:00Z)');
  }
  if ('isSample' in h && typeof h.isSample !== 'boolean') errors.push('isSample: boolean olmalı');

  return { valid: errors.length === 0, errors };
}

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

/** İki {lat, lon} noktası arası büyük daire mesafesi (metre). */
export function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Sürücü konumuna radiusM içindeki geçerli tehlikeleri yakından uzağa sıralar.
 * Geçersiz kayıtlar atlanır. Varsayılan olarak isSample=true kayıtlar da atlanır
 * (gerçek sürüşte örnek veri uyarı olarak okunmamalı); includeSamples ile açılır.
 * @returns {Array<{hazard: object, distanceM: number}>}
 */
export function hazardsWithinRadius(driver, hazards, radiusM, { includeSamples = false, routeId } = {}) {
  if (!driver || !isNum(driver.lat) || !isNum(driver.lon)) throw new TypeError('driver: {lat, lon} olmalı');
  if (!isNum(radiusM) || radiusM < 0) throw new TypeError('radiusM: negatif olmayan sayı olmalı');
  const out = [];
  for (const h of hazards || []) {
    if (!validateHazard(h).valid) continue;
    if (h.isSample && !includeSamples) continue;
    if (routeId && h.routeId !== routeId) continue;
    const distanceM = haversineMeters(driver, h.location);
    if (distanceM <= radiusM) out.push({ hazard: h, distanceM });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

const HAZARD_LABELS = {
  tr: { gravel: 'taşlı yol', roadwork: 'yol çalışması', steep_grade: 'dik eğim', sharp_curve: 'keskin viraj' },
  en: { gravel: 'gravel road', roadwork: 'roadwork', steep_grade: 'steep grade', sharp_curve: 'sharp curve' },
};

/** Sesli okumaya uygun yuvarlanmış mesafe: <1 km için 50 m adımlar, üstü 0.1 km. */
function spokenDistance(distanceM, lang) {
  if (distanceM < 50) return lang === 'tr' ? 'çok yakında' : 'right here';
  if (distanceM < 1000) {
    const m = Math.round(distanceM / 50) * 50;
    if (m >= 1000) return lang === 'tr' ? '1 kilometre mesafede' : 'in 1 kilometer';
    return lang === 'tr' ? `${m} metre mesafede` : `in ${m} meters`;
  }
  const km = Math.round(distanceM / 100) / 10;
  const kmText = lang === 'tr' ? String(km).replace('.', ',') : String(km);
  return lang === 'tr' ? `${kmText} kilometre mesafede` : `in ${kmText} kilometers`;
}

/**
 * Kısa sesli uyarı metni (tr/en). Etkileşim gerektirmez; tek cümle.
 * Not: mesafe kuş uçuşudur, "ileride" denmez çünkü yön bilgisi yoktur.
 */
export function buildVoiceAlert(hazard, distanceM, lang = 'en') {
  const l = lang === 'tr' ? 'tr' : 'en';
  const label = HAZARD_LABELS[l][hazard.type];
  if (!label) throw new TypeError(`bilinmeyen tehlike tipi: ${hazard.type}`);
  const dist = spokenDistance(distanceM, l);
  return l === 'tr' ? `Dikkat, ${dist} ${label}.` : `Caution, ${label} ${dist}.`;
}

// ---------------- Overpass / POI ----------------

/**
 * Overpass QL sorgusu: lat/lon çevresinde radiusM içindeki
 * amenity=fuel, shop=supermarket, shop=convenience, shop=motorcycle.
 */
export function buildOverpassQuery(lat, lon, radiusM, { timeoutS = 25 } = {}) {
  if (!isNum(lat) || lat < -90 || lat > 90) throw new TypeError('lat: -90..90 arası sayı olmalı');
  if (!isNum(lon) || lon < -180 || lon > 180) throw new TypeError('lon: -180..180 arası sayı olmalı');
  if (!isNum(radiusM) || radiusM <= 0) throw new TypeError('radiusM: pozitif sayı olmalı');
  const r = Math.round(radiusM);
  const around = `(around:${r},${lat},${lon})`;
  return [
    `[out:json][timeout:${Math.round(timeoutS)}];`,
    '(',
    `  nwr["amenity"="fuel"]${around};`,
    `  nwr["shop"="supermarket"]${around};`,
    `  nwr["shop"="convenience"]${around};`,
    `  nwr["shop"="motorcycle"]${around};`,
    ');',
    'out center tags;',
  ].join('\n');
}

function poiTypeFromTags(tags = {}) {
  if (tags.amenity === 'fuel') return 'fuel';
  if (tags.shop === 'supermarket' || tags.shop === 'convenience') return 'market';
  if (tags.shop === 'motorcycle') return 'gear_shop';
  return null;
}

/**
 * Overpass JSON yanıtını Poi listesine çevirir, en yakından uzağa sıralar.
 * Poi: { id, type: fuel|market|gear_shop, location: {lat, lon}, name, distanceM }
 * Konumsuz veya tanınmayan tipteki öğeler atlanır; way/relation için "center" kullanılır.
 */
export function parseOverpassResponse(json, origin) {
  if (!origin || !isNum(origin.lat) || !isNum(origin.lon)) throw new TypeError('origin: {lat, lon} olmalı');
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const seen = new Set();
  const pois = [];
  for (const el of elements) {
    const type = poiTypeFromTags(el?.tags);
    if (!type) continue;
    const lat = isNum(el.lat) ? el.lat : el.center?.lat;
    const lon = isNum(el.lon) ? el.lon : el.center?.lon;
    if (!isNum(lat) || !isNum(lon)) continue;
    const id = `osm:${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const location = { lat, lon };
    pois.push({
      id,
      type,
      location,
      name: el.tags.name ?? el.tags.brand ?? null,
      distanceM: Math.round(haversineMeters(origin, location)),
    });
  }
  return pois.sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));
}

/**
 * Overpass'tan yakındaki POI'leri çeker.
 * @param {{lat:number, lon:number, radiusM:number, endpoint?:string, fetchImpl?:Function, signal?:AbortSignal}} opts
 */
export async function fetchNearbyPois({ lat, lon, radiusM, endpoint = DEFAULT_OVERPASS_ENDPOINT, fetchImpl, signal } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('fetch bulunamadı; fetchImpl verin');
  const query = buildOverpassQuery(lat, lon, radiusM);
  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
    body: 'data=' + encodeURIComponent(query),
    signal,
  });
  if (!res || !res.ok) throw new Error(`Overpass isteği başarısız: HTTP ${res?.status ?? '?'}`);
  const json = await res.json();
  return parseOverpassResponse(json, { lat, lon });
}
