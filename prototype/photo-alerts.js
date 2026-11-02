// Fotoğraf noktası bildirimi: rota boyunca ileride kalan "fotoğrafsız olmaz" noktaları — bağımlılıksız ES modülü.
// Tarayıcıda ve Node (>=18) üzerinde çalışır. Model: docs/urun-dokumani.md > PhotoSpot. Veri: data/photo-spots.json.
// Bu modül fotoğraf noktası verisi içermez; veri dışarıdan gelir. prototype/hazards.js değiştirilmez, yalnızca içe aktarılır.
//
// Hangi çizgi? route.pathFull ?? route.path.
// - Sürücü gerçek yolda gider; gerçek yol pathFull'dur. Sadeleştirilmiş path ile arada 150–330 m yanal fark olduğundan,
//   path'e izdüşürülen sürücü driverMaxOffsetM (100 m) sınırını aşıp yanlışlıkla "rota dışı" sayılabilir.
// - pathFull uzunluğu lengthKm ile %0,2 içinde; "X metre ileride" ölçekleme gerektirmeden gerçek yol mesafesidir.
//   path'te ise mesafe %3–17,5 kısa çıkar (Karadeniz'de bildirim noktası ~1,4 km kayıyordu).
// - approachPoint değerleri path'ten hesaplandı, ama path'in köşe noktaları pathFull üzerinde olduğundan
//   pathFull'a uzaklıkları 0–87 m (en büyük: Kirazlıyayla). Bu yüzden spotMaxOffsetM varsayılanı 100 m.
//   approachPoint bu sınırın dışına düşerse nokta sessizce atlanmaz, `detached` listesinde raporlanır.
// - pathFull olmayan rotada (Kemaliye) path kullanılır ve mesafeler lengthKm / çizgi uzunluğu ile ölçeklenir.

import { projectOnRoute, createAlertTracker, routeLengthMeters } from './hazards.js';

export const ROUTE_STATUS_APPROXIMATE = 'doğrulanmalı';
/** detourKm bu değerin üstündeyse sesli metne "rotadan yaklaşık X kilometre sapma" eklenir. */
export const DETOUR_ANNOUNCE_MIN_KM = 0.5;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isLine = (g) => isObj(g) && g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2;

/**
 * Bildirim hesabında kullanılacak rota çizgisi: pathFull varsa o, yoksa path.
 * scale: çizgi mesafesini yol mesafesine çeviren çarpan (pathFull için 1; yalnız path varsa lengthKm / çizgi uzunluğu).
 * @returns {{coords: number[][], source: 'pathFull'|'path', scale: number}}
 */
export function routeLineForAlerts(route) {
  if (!isObj(route)) throw new TypeError('route: nesne olmalı');
  if (isLine(route.pathFull)) return { coords: route.pathFull.coordinates, source: 'pathFull', scale: 1 };
  if (!isLine(route.path)) throw new TypeError('route.path: GeoJSON LineString olmalı');
  const coords = route.path.coordinates;
  const lineM = routeLengthMeters(coords);
  const scale = isNum(route.lengthKm) && route.lengthKm > 0 && lineM > 0 ? (route.lengthKm * 1000) / lineM : 1;
  return { coords, source: 'path', scale };
}

function isUsableSpot(s) {
  return isObj(s) && typeof s.id === 'string' && isObj(s.approachPoint)
    && isNum(s.approachPoint.lat) && isNum(s.approachPoint.lon) && isNum(s.notifyRadiusM) && s.notifyRadiusM >= 0;
}

/**
 * Sürücünün rota üzerindeki konumundan İLERİDE ve bildirim yarıçapı içinde kalan fotoğraf noktaları.
 * - Noktanın kendi konumu (location) değil, rota üzerindeki approachPoint izdüşürülür; sapma mesafesi detourKm'de.
 * - 0 <= aheadM <= notifyRadiusM ise nokta `spots`'ta döner (geride kalan dönmez). aheadM yol mesafesidir (metre).
 *   `ahead` yarıçap süzgeci olmadan ileride kalan tüm noktaları içerir; createPhotoAlertTracker().update(result.ahead)
 *   ile kullanılır (izleyici yarıçapı kendisi uygular ve uzaklaşan noktayı yeniden kurar).
 * - safeStop !== true olan nokta önerilmez (güvenli durulamayan yer önerilmez).
 * - Yalnızca route.id ile aynı routeId'li noktalar değerlendirilir.
 * - Sürücü çizgiye driverMaxOffsetM'den uzaksa (ör. sapma yoluna girdi) offRoute=true ve boş liste döner.
 * - approachPoint çizgiye spotMaxOffsetM'den uzaksa nokta `detached` listesine girer (veri hatası: rota çizgisi
 *   değişmiş, scripts/compute_photo_approach.py yeniden çalıştırılmalı); bildirim üretilmez.
 * - direction: 'forward' (çizgi başından sonuna, varsayılan) veya 'reverse'.
 * @returns {{routeId: string, routeApproximate: boolean, lineSource: 'pathFull'|'path', offRoute: boolean,
 *   driver: {distanceAlongM: number, offsetM: number, segmentIndex: number},
 *   spots: Array<{spot: object, aheadM: number, detourKm: number|null, offsetM: number}>,
 *   ahead: Array<same>, // yarıçap süzgeci olmadan ileride kalan tüm noktalar (izleyicinin yeniden kurulması için)
 *   detached: Array<{id: string, offsetM: number}>}}
 */
export function photoSpotsAheadOnRoute(driver, route, spots, {
  spotMaxOffsetM = 100, driverMaxOffsetM = 100, direction = 'forward',
} = {}) {
  if (!driver || !isNum(driver.lat) || !isNum(driver.lon)) throw new TypeError('driver: {lat, lon} olmalı');
  if (!isNum(spotMaxOffsetM) || spotMaxOffsetM < 0) throw new TypeError('spotMaxOffsetM: negatif olmayan sayı olmalı');
  if (!isNum(driverMaxOffsetM) || driverMaxOffsetM < 0) throw new TypeError('driverMaxOffsetM: negatif olmayan sayı olmalı');
  if (direction !== 'forward' && direction !== 'reverse') throw new TypeError("direction: 'forward' veya 'reverse' olmalı");

  const { coords, source, scale } = routeLineForAlerts(route);
  const d = projectOnRoute(driver, coords);
  const result = {
    routeId: route.id,
    routeApproximate: source === 'path' && route.verification?.status === ROUTE_STATUS_APPROXIMATE,
    lineSource: source,
    offRoute: d.offsetM > driverMaxOffsetM,
    driver: d,
    spots: [],
    ahead: [],
    detached: [],
  };
  if (result.offRoute) return result;

  const sign = direction === 'forward' ? 1 : -1;
  for (const s of spots || []) {
    if (!isUsableSpot(s) || s.routeId !== route.id) continue;
    if (s.safeStop !== true) continue;
    const p = projectOnRoute(s.approachPoint, coords);
    if (p.offsetM > spotMaxOffsetM) { result.detached.push({ id: s.id, offsetM: p.offsetM }); continue; }
    const aheadM = sign * (p.distanceAlongM - d.distanceAlongM) * scale;
    if (aheadM < 0) continue;
    const entry = { spot: s, aheadM, detourKm: isNum(s.detourKm) ? s.detourKm : null, offsetM: p.offsetM };
    result.ahead.push(entry);
    if (aheadM <= s.notifyRadiusM) result.spots.push(entry);
  }
  const byAhead = (a, b) => a.aheadM - b.aheadM || a.spot.id.localeCompare(b.spot.id);
  result.spots.sort(byAhead);
  result.ahead.sort(byAhead);
  return result;
}

/**
 * Fotoğraf noktası başına tek bildirim. Noktaların notifyRadiusM değerleri farklı olduğu için her yarıçap için
 * ayrı bir createAlertTracker({thresholdsM: [notifyRadiusM]}) açılır. Tehlike izleyicisinden ayrıdır
 * (fotoğraf bildirimi tehlike uyarısını bastırmaz). aheadM > notifyRadiusM + rearmM olunca nokta yeniden kurulur
 * (ör. sürücü geri dönüp yeniden yaklaşıyor).
 */
export function createPhotoAlertTracker({ rearmM = 500 } = {}) {
  if (!isNum(rearmM) || rearmM < 0) throw new TypeError('rearmM: negatif olmayan sayı olmalı');
  const byRadius = new Map(); // notifyRadiusM -> tracker
  const trackerFor = (r) => {
    if (!byRadius.has(r)) byRadius.set(r, createAlertTracker({ thresholdsM: [r], rearmM }));
    return byRadius.get(r);
  };
  return {
    /** true ise şimdi bildirilmeli; durum güncellenir. spot: PhotoSpot (id, notifyRadiusM). */
    shouldAnnounce(spot, aheadM) {
      if (!isUsableSpot(spot)) return false;
      return trackerFor(spot.notifyRadiusM).shouldAnnounce(spot.id, aheadM);
    },
    /**
     * Her konum güncellemesinde photoSpotsAheadOnRoute(...).ahead verilmelidir (yalnız `spots` verilirse
     * uzaklaşan nokta görülmez ve yeniden kurulmaz).
     * @param {Array<{spot: object, aheadM: number}>} entries
     * @returns {object[]} şimdi bildirilecek noktalar
     */
    update(entries) {
      const out = [];
      for (const { spot, aheadM } of entries || []) if (this.shouldAnnounce(spot, aheadM)) out.push(spot);
      return out;
    },
    reset(spotId) { for (const t of byRadius.values()) t.reset(spotId); },
  };
}

function spokenDistance(m, lang) {
  if (m < 50) return lang === 'tr' ? 'hemen ileride' : 'right ahead';
  if (m < 1000) {
    const r = Math.round(m / 50) * 50;
    if (r >= 1000) return lang === 'tr' ? '1 kilometre ileride' : 'in 1 kilometer';
    return lang === 'tr' ? `${r} metre ileride` : `in ${r} meters`;
  }
  const km = Math.round(m / 100) / 10;
  return lang === 'tr' ? `${String(km).replace('.', ',')} kilometre ileride` : `in ${km} kilometers`;
}

/**
 * Kısa sesli bildirim metni (tr/en), etkileşim gerektirmez.
 * - detourKm >= 0,5 ise "rotadan yaklaşık X kilometre sapma" eklenir (kuş uçuşu; gerçek yol daha uzun olabilir).
 * - safeStop !== true ise null döner: güvenli durulamayan nokta önerilmez.
 * - Başlık istenen dilde yoksa İngilizceye düşülür.
 * @returns {string|null}
 */
export function buildPhotoVoiceAlert(spot, aheadM, lang = 'en') {
  if (!isObj(spot)) throw new TypeError('spot: nesne olmalı');
  if (!isNum(aheadM) || aheadM < 0) throw new TypeError('aheadM: negatif olmayan sayı olmalı');
  if (spot.safeStop !== true) return null;
  const l = lang === 'tr' ? 'tr' : 'en';
  const title = spot.title?.[l] ?? spot.title?.en;
  if (typeof title !== 'string' || title.length === 0) throw new TypeError('spot.title: en az en metni olmalı');
  const dist = spokenDistance(aheadM, l);
  let text = l === 'tr' ? `Fotoğraf noktası ${dist}: ${title}.` : `Photo spot ${dist}: ${title}.`;
  if (isNum(spot.detourKm) && spot.detourKm >= DETOUR_ANNOUNCE_MIN_KM) {
    const km = Math.round(spot.detourKm * 10) / 10;
    text += l === 'tr'
      ? ` Rotadan yaklaşık ${String(km).replace('.', ',')} kilometre sapma.`
      : ` About ${km} kilometer detour off the route.`;
  }
  return text;
}
