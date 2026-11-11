// Tehlike uyarıları + yakındaki ihtiyaç noktaları (POI) — bağımlılıksız ES modülü.
// Tarayıcıda ve Node (>=18, global fetch) üzerinde çalışır.
// Modeller: docs/urun-dokumani.md > Hazard, Poi. Şema: data/hazards.schema.json
// Bu modül hiçbir tehlike/POI verisi içermez; veri dışarıdan gelir.

export const HAZARD_TYPES = Object.freeze(['gravel', 'roadwork', 'steep_grade', 'sharp_curve']);
export const POI_TYPES = Object.freeze(['fuel', 'market', 'gear_shop']);
export const ROUTE_ID_PATTERN = /^[a-z]{2}-[a-z]+(-[a-z]+)*-\d{2}$/;
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

const HAZARD_KEYS = ['id', 'routeId', 'type', 'location', 'note', 'reportedBy', 'reportedAt', 'isSample'];
// İsteğe bağlı alanlar (kullanıcı kararı 7B; eski kayıtlarla geriye uyumlu).
const HAZARD_OPTIONAL_KEYS = ['source', 'verification', 'extent'];
export const SOURCE_KINDS = Object.freeze(['osm', 'user', 'field']);
export const VERIFICATION_STATUSES = Object.freeze(['doğrulanmalı', 'doğrulandı']);
/** verification.status bu değerdeyse kayıt temkinli metinle okunur ("olası taşlı yol"; karar 8A). */
export const HAZARD_STATUS_UNVERIFIED = 'doğrulanmalı';
const OSM_REF_PATTERN = /^(node|way|relation)\/[0-9]+$/;
const OSM_TAG_PATTERN = /^[A-Za-z0-9_:]+=.+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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

const isDateTime = (v) => typeof v === 'string' && DATE_TIME_PATTERN.test(v) && !Number.isNaN(Date.parse(v));
const unknownKeys = (obj, allowed, path, errors) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${path}.${k}: bilinmeyen alan`);
};

function validateSource(src, errors) {
  if (!isObj(src)) { errors.push('source: nesne olmalı'); return; }
  unknownKeys(src, ['kind', 'ref', 'tag'], 'source', errors);
  if (!SOURCE_KINDS.includes(src.kind)) errors.push(`source.kind: ${SOURCE_KINDS.join('|')} olmalı`);
  if (typeof src.ref !== 'string' || src.ref.length === 0) errors.push('source.ref: boş olmayan metin olmalı');
  else if (src.kind === 'osm' && !OSM_REF_PATTERN.test(src.ref)) errors.push('source.ref: osm için node|way|relation/<id> olmalı (ör. way/49055992)');
  if ('tag' in src && (typeof src.tag !== 'string' || !OSM_TAG_PATTERN.test(src.tag))) errors.push('source.tag: anahtar=değer olmalı (ör. surface=gravel)');
  else if (src.kind === 'osm' && !('tag' in src)) errors.push('source.tag: osm için zorunlu (ör. surface=gravel)');
}

function validateVerification(v, errors) {
  if (!isObj(v)) { errors.push('verification: nesne olmalı'); return; }
  unknownKeys(v, ['status', 'checkedAt', 'notes'], 'verification', errors);
  if (!VERIFICATION_STATUSES.includes(v.status)) errors.push(`verification.status: ${VERIFICATION_STATUSES.join('|')} olmalı`);
  if ('checkedAt' in v && !isDateTime(v.checkedAt)) errors.push('verification.checkedAt: RFC 3339 date-time olmalı');
  if ('notes' in v && (typeof v.notes !== 'string' || v.notes.length === 0)) errors.push('verification.notes: boş olmayan metin olmalı');
}

function validateExtent(e, errors) {
  if (!isObj(e)) { errors.push('extent: nesne olmalı'); return; }
  unknownKeys(e, ['fromKm', 'toKm', 'geometry', 'line', 'geometryRevision'], 'extent', errors);
  const hasKm = 'fromKm' in e || 'toKm' in e;
  if (!hasKm && !('line' in e)) errors.push('extent: {fromKm, toKm} ve/veya line olmalı');
  if (hasKm) {
    const okFrom = isNum(e.fromKm) && e.fromKm >= 0;
    const okTo = isNum(e.toKm) && e.toKm >= 0;
    if (!okFrom) errors.push('extent.fromKm: negatif olmayan sayı olmalı');
    if (!okTo) errors.push('extent.toKm: negatif olmayan sayı olmalı');
    if (okFrom && okTo && e.fromKm > e.toKm) errors.push('extent: fromKm <= toKm olmalı');
    if (e.geometry !== 'pathFull' && e.geometry !== 'path') errors.push("extent.geometry: fromKm/toKm ile zorunlu, 'pathFull' veya 'path' olmalı");
  } else if ('geometry' in e && e.geometry !== 'pathFull' && e.geometry !== 'path') {
    errors.push("extent.geometry: 'pathFull' veya 'path' olmalı");
  }
  if ('line' in e) {
    const l = e.line;
    if (!isObj(l) || l.type !== 'LineString') errors.push('extent.line: GeoJSON LineString olmalı');
    else {
      unknownKeys(l, ['type', 'coordinates'], 'extent.line', errors);
      try { assertLineCoords(l.coordinates, 'extent.line.coordinates'); } catch (err) { errors.push(err.message); }
    }
  }
  if ('geometryRevision' in e) {
    const r = e.geometryRevision;
    if (!isObj(r)) errors.push('extent.geometryRevision: nesne olmalı');
    else {
      unknownKeys(r, ['date', 'pathSha256', 'pathFullSha256'], 'extent.geometryRevision', errors);
      if (typeof r.date !== 'string' || !DATE_PATTERN.test(r.date)) errors.push('extent.geometryRevision.date: YYYY-MM-DD olmalı');
      if (typeof r.pathSha256 !== 'string' || !SHA256_PATTERN.test(r.pathSha256)) errors.push('extent.geometryRevision.pathSha256: 64 karakter küçük harf hex olmalı');
      if (!('pathFullSha256' in r) || (r.pathFullSha256 !== null && (typeof r.pathFullSha256 !== 'string' || !SHA256_PATTERN.test(r.pathFullSha256)))) {
        errors.push('extent.geometryRevision.pathFullSha256: 64 karakter hex ya da null olmalı');
      }
    }
  }
}

/**
 * data/hazards.schema.json ile uyumlu basit doğrulayıcı.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateHazard(h) {
  const errors = [];
  if (!isObj(h)) return { valid: false, errors: ['hazard: nesne olmalı'] };

  for (const k of HAZARD_KEYS) if (!(k in h)) errors.push(`${k}: zorunlu alan eksik`);
  for (const k of Object.keys(h)) if (!HAZARD_KEYS.includes(k) && !HAZARD_OPTIONAL_KEYS.includes(k)) errors.push(`${k}: bilinmeyen alan`);

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
  if ('reportedAt' in h && !isDateTime(h.reportedAt)) {
    errors.push('reportedAt: RFC 3339 date-time olmalı (ör. 2026-11-01T09:30:00Z)');
  }
  if ('isSample' in h && typeof h.isSample !== 'boolean') errors.push('isSample: boolean olmalı');
  if ('source' in h) validateSource(h.source, errors);
  if ('verification' in h) validateVerification(h.verification, errors);
  if ('extent' in h) validateExtent(h.extent, errors);

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

// ---------------- Rota boyunca ileriye bakış ----------------

export const ROUTE_STATUS_APPROXIMATE = 'doğrulanmalı';

function assertLineCoords(lineCoords, label = 'lineCoords') {
  if (!Array.isArray(lineCoords) || lineCoords.length < 2) throw new TypeError(`${label}: en az 2 [lon, lat] noktası olmalı`);
  for (const c of lineCoords) {
    if (!Array.isArray(c) || !isNum(c[0]) || !isNum(c[1]) || c[1] < -90 || c[1] > 90 || c[0] < -180 || c[0] > 180) {
      throw new TypeError(`${label}: her nokta [lon, lat] sayı çifti olmalı (GeoJSON sırası)`);
    }
  }
}

/**
 * Noktayı rota çizgisine (GeoJSON LineString koordinatları, [lon, lat]) izdüşürür.
 * Her parça için yerel eşdikdörtgen düzlemde en yakın nokta bulunur (kısa parçalarda hata ihmal edilir),
 * offsetM o noktaya haversine mesafesidir. En küçük offset'li parça seçilir (eşitlikte ilk parça).
 * distanceAlongM: rota başından izdüşüm noktasına kadar çizgi boyunca mesafe (haversine parça toplamı).
 * Not: Nokta çizgiye "snap" edilmez/değiştirilmez; yalnızca konumu ölçülür.
 * @returns {{distanceAlongM: number, offsetM: number, segmentIndex: number}}
 */
export function projectOnRoute(point, lineCoords) {
  if (!point || !isNum(point.lat) || !isNum(point.lon)) throw new TypeError('point: {lat, lon} olmalı');
  assertLineCoords(lineCoords);
  let best = null;
  let cum = 0;
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [lonA, latA] = lineCoords[i];
    const [lonB, latB] = lineCoords[i + 1];
    const segLen = haversineMeters({ lat: latA, lon: lonA }, { lat: latB, lon: lonB });
    const k = Math.cos(toRad((latA + latB) / 2));
    const bx = (lonB - lonA) * k, by = latB - latA;
    const px = (point.lon - lonA) * k, py = point.lat - latA;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
    const q = { lat: latA + t * (latB - latA), lon: lonA + t * (lonB - lonA) };
    const offsetM = haversineMeters(point, q);
    if (!best || offsetM < best.offsetM) best = { distanceAlongM: cum + t * segLen, offsetM, segmentIndex: i };
    cum += segLen;
  }
  return best;
}

/** Rota çizgisinin toplam uzunluğu (metre, haversine parça toplamı). */
export function routeLengthMeters(lineCoords) {
  assertLineCoords(lineCoords);
  let m = 0;
  for (let i = 0; i < lineCoords.length - 1; i++) {
    m += haversineMeters({ lat: lineCoords[i][1], lon: lineCoords[i][0] }, { lat: lineCoords[i + 1][1], lon: lineCoords[i + 1][0] });
  }
  return m;
}

/**
 * Mesafe/ileriye bakış için kullanılacak rota çizgisi: route.pathFull ?? route.path.
 * pathFull (tam yol çizgisi: OSRM ya da OSM way geometrisi) varsa o, yoksa sadeleştirilmiş path kullanılır
 *   (ör. yalnız path olan bir rota).
 * pathFull varsa ama GeoJSON LineString değilse sessizce path'e düşülmez, hata verilir.
 * scale: çizgi mesafesini yol mesafesine çeviren çarpan (yol mesafesi = çizgi mesafesi × scale).
 *   - pathFull için 1 (pathFull zaten gerçek yol; lengthKm ile %0,5 içinde).
 *   - Yalnız path varsa route.lengthKm × 1000 / çizgi uzunluğu (yalnız path olan bir rotada genelde 1'in biraz üstü).
 *   - Yalnız path var ama lengthKm geçerli pozitif sayı değilse (ya da çizgi uzunluğu 0 ise) 1.
 * Geriye uyum: önceki dönüş alanları (geometry, coordinates) aynen duruyor; scale yeni alan.
 * @returns {{geometry: 'pathFull'|'path', coordinates: number[][], scale: number}}
 */
export function routeLine(route) {
  if (!isObj(route)) throw new TypeError('route: nesne olmalı');
  const geometry = route.pathFull != null ? 'pathFull' : 'path';
  const line = route[geometry];
  if (!isObj(line) || line.type !== 'LineString') throw new TypeError(`route.${geometry}: GeoJSON LineString olmalı`);
  assertLineCoords(line.coordinates, `route.${geometry}.coordinates`);
  let scale = 1;
  if (geometry === 'path' && isNum(route.lengthKm) && route.lengthKm > 0) {
    const lineM = routeLengthMeters(line.coordinates);
    if (lineM > 0) scale = (route.lengthKm * 1000) / lineM;
  }
  return { geometry, coordinates: line.coordinates, scale };
}

/**
 * hazardsAheadOnRoute'un varsayılan süzgeci: şemaya uyan kayıt ve (includeSamples yoksa) isSample=false.
 * Gerçek sürüşte örnek veri uyarı olarak okunmamalı.
 */
export function defaultHazardFilter(h, { includeSamples = false } = {}) {
  return validateHazard(h).valid && (!h.isSample || includeSamples);
}

const defaultGetLocation = (item) => item?.location;

/** includeSkipped ile dönen atlanma nedenleri. */
export const SKIP_REASONS = Object.freeze(['filter', 'location', 'offset']);

/**
 * Sürücünün rota üzerindeki konumundan İLERİDE kalan tehlikeler (kuş uçuşu yarıçap yerine).
 * - route: data/routes.json'daki rota nesnesi. Çizgi olarak routeLine(route) kullanılır
 *   (route.pathFull ?? route.path, GeoJSON LineString, [lon, lat]); hangisinin kullanıldığı sonuçta
 *   geometry alanında, çarpanı scale alanında görünür.
 * - aheadM YOL mesafesidir: (çizgi mesafesi farkı) × scale. pathFull'da scale = 1; yalnız path olan
 *   bir rotada lengthKm / çizgi uzunluğu. lookAheadM ve lookAheadOf da yol mesafesiyle karşılaştırılır.
 *   distanceAlongM (sürücü ve kayıt) ve offsetM ölçeklenmez: çizgi üzerindeki ham değerlerdir.
 * - Tehlike, rotaya maxOffsetM'den yakınsa ve 0 <= aheadM <= menzil ise döner; geride kalanlar
 *   ve paralel/başka yoldaki (rotaya uzak) tehlikeler dönmez. Sonuç aheadM'e göre yakından uzağa sıralı.
 * - Menzil kayıt başınadır: lookAheadOf(item) => number (varsayılan () => lookAheadM). Geçerli,
 *   negatif olmayan sayı dönmezse o kayıt için lookAheadM kullanılır. Ör. fotoğraf noktası: s => s.notifyRadiusM.
 * - direction: 'forward' (çizgi başından sonuna, varsayılan) veya 'reverse' (rotayı ters yönde süren).
 * - Sürücü rotaya driverMaxOffsetM'den uzaksa (rota dışı kontrolü, aynı çizgiyle) "ileride" tanımsızdır:
 *   offRoute=true ve boş liste döner.
 * - filter(item, {includeSamples}) => boolean: hangi kayıtların değerlendirileceği. Varsayılan
 *   defaultHazardFilter (validateHazard + isSample kuralı). Başka kayıt türleri (ör. fotoğraf noktaları)
 *   için kendi süzgecinizi verin; o zaman includeSamples yalnızca süzgece iletilir.
 * - getLocation(item) => {lat, lon}: izdüşürülecek konum (varsayılan item.location; ör. fotoğraf
 *   noktası için item => item.approachPoint). Geçerli konum dönmeyen kayıt atlanır.
 * - includeSkipped: true ise sonuçta skipped: Array<{item, reason, offsetM?}> bulunur (giriş sırasıyla).
 *   reason: 'filter' (süzgeç reddetti), 'location' (geçerli konum yok), 'offset' (izdüşüm maxOffsetM'den
 *   uzak; offsetM ile — ör. rota çizgisi değişmiş, kayıt kopmuş). Geride kalan ve menzil dışındaki kayıtlar
 *   normal durumdur, skipped'e GİRMEZ. offRoute=true iken kayıtlar değerlendirilmez, skipped boş döner.
 *   includeSkipped false (varsayılan) ise skipped alanı hiç yoktur (eski dönüş biçimi).
 * - route.verification.status === 'doğrulanmalı' ise routeApproximate=true (çizgi yaklaşık sayılır — yalnız path
 *   olsun ya da doğrulanmamış bir pathFull olsun, ör. Kemaliye: 2026-11-11'den beri OSM way geometrisinden
 *   pathFull'u var ama hâlâ 'doğrulanmalı'; aheadM/offsetM de yaklaşıktır; tehlike konumları bu çizgiye snap EDİLMEZ).
 * Sonuç kayıtlarında öğe, geriye uyum için her zaman "hazard" anahtarındadır (skipped'de "item").
 * @returns {{routeId: string, geometry: 'pathFull'|'path', scale: number, routeApproximate: boolean, offRoute: boolean,
 *   driver: {distanceAlongM: number, offsetM: number, segmentIndex: number},
 *   hazards: Array<{hazard: object, aheadM: number, offsetM: number, distanceAlongM: number}>,
 *   skipped?: Array<{item: object, reason: 'filter'|'location'|'offset', offsetM?: number}>}}
 */
export function hazardsAheadOnRoute(driver, route, hazards, {
  lookAheadM = 2000, maxOffsetM = 50, driverMaxOffsetM = 100, includeSamples = false, direction = 'forward',
  filter = defaultHazardFilter, getLocation = defaultGetLocation, lookAheadOf, includeSkipped = false,
} = {}) {
  if (!driver || !isNum(driver.lat) || !isNum(driver.lon)) throw new TypeError('driver: {lat, lon} olmalı');
  const { geometry, coordinates: coords, scale } = routeLine(route);
  if (!isNum(lookAheadM) || lookAheadM < 0) throw new TypeError('lookAheadM: negatif olmayan sayı olmalı');
  if (!isNum(maxOffsetM) || maxOffsetM < 0) throw new TypeError('maxOffsetM: negatif olmayan sayı olmalı');
  if (!isNum(driverMaxOffsetM) || driverMaxOffsetM < 0) throw new TypeError('driverMaxOffsetM: negatif olmayan sayı olmalı');
  if (direction !== 'forward' && direction !== 'reverse') throw new TypeError("direction: 'forward' veya 'reverse' olmalı");
  if (typeof filter !== 'function') throw new TypeError('filter: fonksiyon olmalı');
  if (typeof getLocation !== 'function') throw new TypeError('getLocation: fonksiyon olmalı');
  if (lookAheadOf != null && typeof lookAheadOf !== 'function') throw new TypeError('lookAheadOf: fonksiyon olmalı');

  const d = projectOnRoute(driver, coords);
  const result = {
    routeId: route.id,
    geometry,
    scale,
    routeApproximate: route.verification?.status === ROUTE_STATUS_APPROXIMATE,
    offRoute: d.offsetM > driverMaxOffsetM,
    driver: d,
    hazards: [],
  };
  if (includeSkipped) result.skipped = [];
  if (result.offRoute) return result;

  const skip = includeSkipped ? (entry) => result.skipped.push(entry) : () => {};
  const sign = direction === 'forward' ? 1 : -1;
  for (const h of hazards || []) {
    if (!filter(h, { includeSamples })) { skip({ item: h, reason: 'filter' }); continue; }
    const loc = getLocation(h);
    if (!isObj(loc) || !isNum(loc.lat) || !isNum(loc.lon)) { skip({ item: h, reason: 'location' }); continue; }
    const p = projectOnRoute(loc, coords);
    if (p.offsetM > maxOffsetM) { skip({ item: h, reason: 'offset', offsetM: p.offsetM }); continue; }
    const aheadM = sign * (p.distanceAlongM - d.distanceAlongM) * scale;
    const own = lookAheadOf ? lookAheadOf(h) : lookAheadM;
    const rangeM = isNum(own) && own >= 0 ? own : lookAheadM;
    if (aheadM < 0 || aheadM > rangeM) continue;
    result.hazards.push({ hazard: h, aheadM, offsetM: p.offsetM, distanceAlongM: p.distanceAlongM });
  }
  result.hazards.sort((a, b) => a.aheadM - b.aheadM || String(a.hazard?.id).localeCompare(String(b.hazard?.id)));
  return result;
}

/**
 * Aynı uyarının tekrar tekrar okunmasını önleyen küçük durum nesnesi.
 * Her tehlike için kademeli eşikler (varsayılan 1000 m ve 300 m): aheadM bir eşiğin altına ilk kez
 * indiğinde bir kez okunur. Böylece bir tehlike en fazla iki kez (ön uyarı + yakın uyarı) okunur;
 * doğrudan 300 m içinde ilk kez görülürse yalnızca bir kez okunur (kademeler atlanır, birikmez).
 * aheadM en büyük eşik + rearmM'in üstüne çıkarsa (ör. sürücü geri dönüp yeniden yaklaşıyor) tehlike
 * yeniden kurulur. Geçersiz/negatif aheadM hiçbir zaman okunmaz.
 * @param {{thresholdsM?: number[], rearmM?: number}} opts
 */
export function createAlertTracker({ thresholdsM = [1000, 300], rearmM = 500 } = {}) {
  if (!Array.isArray(thresholdsM) || thresholdsM.length === 0 || !thresholdsM.every((t) => isNum(t) && t >= 0)) {
    throw new TypeError('thresholdsM: negatif olmayan sayılardan oluşan boş olmayan dizi olmalı');
  }
  if (!isNum(rearmM) || rearmM < 0) throw new TypeError('rearmM: negatif olmayan sayı olmalı');
  const stages = [...new Set(thresholdsM)].sort((a, b) => b - a); // büyükten küçüğe
  const rearmAboveM = stages[0] + rearmM;
  const level = new Map(); // hazardId -> okunan son kademe (1..stages.length)
  return {
    /** true ise şimdi okunmalı; durum güncellenir. */
    shouldAnnounce(hazardId, aheadM) {
      if (!isNum(aheadM) || aheadM < 0) return false;
      if (aheadM > rearmAboveM) { level.delete(hazardId); return false; }
      const now = stages.filter((t) => aheadM <= t).length;
      if (now > (level.get(hazardId) ?? 0)) { level.set(hazardId, now); return true; }
      return false;
    },
    /** Tek bir tehlikenin ya da (argümansız) tümünün durumunu siler, ör. yeni sürüş başlarken. */
    reset(hazardId) { if (hazardId === undefined) level.clear(); else level.delete(hazardId); },
    get size() { return level.size; },
  };
}

const HAZARD_LABELS = {
  tr: { gravel: 'taşlı yol', roadwork: 'yol çalışması', steep_grade: 'dik eğim', sharp_curve: 'keskin viraj' },
  en: { gravel: 'gravel road', roadwork: 'roadwork', steep_grade: 'steep grade', sharp_curve: 'sharp curve' },
};
// Doğrulanmamış (verification.status: doğrulanmalı) kayıtlar için temkinli etiketler (karar 8A).
const HAZARD_LABELS_TENTATIVE = {
  tr: { gravel: 'olası taşlı yol', roadwork: 'olası yol çalışması', steep_grade: 'olası dik eğim', sharp_curve: 'olası keskin viraj' },
  en: { gravel: 'possible gravel road', roadwork: 'possible roadwork', steep_grade: 'possible steep grade', sharp_curve: 'possible sharp curve' },
};

/** true: kayıt doğrulanmamış (verification.status 'doğrulanmalı'), temkinli okunur. verification yoksa false (eski kayıtlar). */
export function isHazardUnverified(hazard) {
  return hazard?.verification?.status === HAZARD_STATUS_UNVERIFIED;
}

/** geometryRevision'da karşılaştırılan alanlar (date bilgi amaçlıdır, karşılaştırılmaz). */
const REVISION_HASH_KEYS = ['pathSha256', 'pathFullSha256'];

/**
 * İki geometryRevision nesnesi aynı rota çizgisini mi gösteriyor? Tek eskime kuralı (tehlike extent'i ve
 * fotoğraf noktaları için ortak).
 * - Alan alan katı eşitlik: pathSha256 ve pathFullSha256. null === null eşittir (pathFull olmayan, yalnız path olan bir rota).
 * - date karşılaştırılmaz: scripts/geometry_revision.py date'i yalnızca karma değişince günceller; karmalar aynıysa
 *   çizgi aynıdır.
 * - Geriye uyum: pathFullSha256 alanı hiç yoksa null sayılır (önceki extentRevisionStatus davranışı).
 * - İki taraftan biri nesne değilse ya da pathSha256 metin değilse false (bozuk/boş kopya "aynı" sayılmaz).
 * @returns {boolean}
 */
export function sameGeometryRevision(a, b) {
  if (!isObj(a) || !isObj(b)) return false;
  if (typeof a.pathSha256 !== 'string' || typeof b.pathSha256 !== 'string') return false;
  return REVISION_HASH_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * extent.geometryRevision'ı rotanın geometryRevision'ıyla karşılaştırır (sameGeometryRevision; date karşılaştırılmaz).
 * 'none': extent ya da kopyası yok, ya da rotada geometryRevision yok (eskime anlaşılamaz);
 * 'current': iki karma da eşit; 'stale': rota çizgisi değişmiş, fromKm/toKm/line yeniden hesaplanmalı.
 * @returns {'none'|'current'|'stale'}
 */
export function extentRevisionStatus(hazard, route) {
  const a = hazard?.extent?.geometryRevision;
  const b = route?.geometryRevision;
  if (!isObj(a) || !isObj(b)) return 'none';
  return sameGeometryRevision(a, b) ? 'current' : 'stale';
}

/**
 * Sesli okumaya uygun yuvarlanmış mesafe: <1 km için 50 m adımlar, üstü 0.1 km.
 * ahead=true: yön biliniyor (rota boyunca ileride) -> "ileride"/"ahead"; değilse "mesafede"/"in".
 */
function spokenDistance(distanceM, lang, ahead) {
  if (distanceM < 50) return lang === 'tr' ? 'çok yakında' : 'right here';
  const m = Math.round(distanceM / 50) * 50;
  const km = distanceM < 1000 ? (m >= 1000 ? 1 : null) : Math.round(distanceM / 100) / 10;
  const tr = km === null ? `${m} metre` : `${String(km).replace('.', ',')} kilometre`;
  const en = km === null ? `${m} meters` : `${km} ${km === 1 ? 'kilometer' : 'kilometers'}`;
  if (lang === 'tr') return `${tr} ${ahead ? 'ileride' : 'mesafede'}`;
  return ahead ? `${en} ahead` : `in ${en}`;
}

/**
 * Kısa sesli uyarı metni (tr/en). Etkileşim gerektirmez; tek cümle.
 * - Varsayılan (ahead=false): distanceM kuş uçuşu kabul edilir, yön yoktur -> "300 metre mesafede".
 * - { ahead: true }: distanceM rota boyunca ileride kalan mesafedir (hazardsAheadOnRoute'un aheadM'i)
 *   -> "300 metre ileride" / "300 meters ahead".
 * - verification.status 'doğrulanmalı' ise temkinli etiket (karar 8A):
 *   "Dikkat, 300 metre ileride olası taşlı yol." / "Caution, possible gravel road 300 meters ahead."
 */
export function buildVoiceAlert(hazard, distanceM, lang = 'en', { ahead = false } = {}) {
  const l = lang === 'tr' ? 'tr' : 'en';
  const label = (isHazardUnverified(hazard) ? HAZARD_LABELS_TENTATIVE : HAZARD_LABELS)[l][hazard.type];
  if (!label) throw new TypeError(`bilinmeyen tehlike tipi: ${hazard.type}`);
  const dist = spokenDistance(distanceM, l, ahead === true);
  return l === 'tr' ? `Dikkat, ${dist} ${label}.` : `Caution, ${label} ${dist}.`;
}

/** Aynı anda okunacak bildirimlerde tür önceliği: küçük olan önce. Bilinmeyen tür en sona. */
export const ANNOUNCEMENT_PRIORITY = Object.freeze({ hazard: 0, photo: 1 });

/**
 * Aynı anda tetiklenen sesli bildirimleri okuma sırasına koyar (girdiyi değiştirmez).
 * Kural: önce güvenlik — tüm tehlike uyarıları (kind: 'hazard') fotoğraf bildirimlerinden
 * (kind: 'photo') önce okunur; aynı tür içinde aheadM küçük olan önce; eşitlikte giriş sırası korunur.
 * @param {Array<{kind: string, aheadM?: number}>} items
 */
export function orderAnnouncements(items) {
  if (!Array.isArray(items)) throw new TypeError('items: dizi olmalı');
  const rank = (k) => ANNOUNCEMENT_PRIORITY[k] ?? Object.keys(ANNOUNCEMENT_PRIORITY).length;
  const dist = (x) => (isNum(x?.aheadM) ? x.aheadM : Infinity);
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item?.kind) - rank(b.item?.kind) || dist(a.item) - dist(b.item) || a.i - b.i)
    .map((x) => x.item);
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
