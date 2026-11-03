// Fotoğraf noktası bildirimi: rota boyunca ileride kalan "fotoğrafsız olmaz" noktaları — bağımlılıksız ES modülü.
// Tarayıcıda ve Node (>=18) üzerinde çalışır. Model: docs/urun-dokumani.md > PhotoSpot. Veri: data/photo-spots.json.
// Bu modül fotoğraf noktası verisi içermez; veri dışarıdan gelir. prototype/hazards.js değiştirilmez, yalnızca içe aktarılır.
//
// Hangi çizgi? hazards.js'teki ortak routeLine(route): pathFull ?? path (tehlike uyarılarıyla tek kural, tek yer).
// - Sürücü gerçek yolda gider; gerçek yol pathFull'dur. Sadeleştirilmiş path ile arada 150–330 m yanal fark olduğundan,
//   path'e izdüşürülen sürücü driverMaxOffsetM (100 m) sınırını aşıp yanlışlıkla "rota dışı" sayılabilir.
// - pathFull varsa ama GeoJSON LineString değilse sessizce path'e düşülmez, routeLine hata verir (veri hatası görünür kalır).
// - Mesafeler routeLine(route).scale ile yol mesafesine çevrilir: pathFull'da 1; yalnız path olan rotada (Kemaliye)
//   lengthKm / çizgi uzunluğu (~1,03).
// - approachPoint değerleri path'ten hesaplandı, ama path'in köşe noktaları pathFull üzerinde olduğundan
//   pathFull'a uzaklıkları 0–87 m (en büyük: Kirazlıyayla). Bu yüzden spotMaxOffsetM varsayılanı 100 m.
//   approachPoint bu sınırın dışına düşerse nokta sessizce atlanmaz, `detached` listesinde raporlanır.
//
// photoSpotsAheadOnRoute, hazardsAheadOnRoute üzerine ince bir sarmalayıcıdır (izdüşüm, ölçek, yön, rota dışı ve
// atlanan kayıt kuralları tek yerde). Menzil süzgeci (notifyRadiusM) sarmalayıcıda uygulanır, çünkü izleyicinin
// uzaklaşan noktayı yeniden kurabilmesi için yarıçap dışındaki `ahead` listesine de ihtiyaç var.

import { hazardsAheadOnRoute, createAlertTracker } from './hazards.js';

export const ROUTE_STATUS_APPROXIMATE = 'doğrulanmalı';
/** detourKm bu değerin üstündeyse sesli metne "rotadan yaklaşık X kilometre sapma" eklenir. */
export const DETOUR_ANNOUNCE_MIN_KM = 0.5;
/** `ahead` listesi için "menzil yok" değeri (hazardsAheadOnRoute sonlu sayı ister; Infinity geçersiz sayılır). */
const NO_LIMIT_M = Number.MAX_VALUE;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function isUsableSpot(s) {
  return isObj(s) && typeof s.id === 'string' && isObj(s.approachPoint)
    && isNum(s.approachPoint.lat) && isNum(s.approachPoint.lon) && isNum(s.notifyRadiusM) && s.notifyRadiusM >= 0;
}

/**
 * Sürücünün rota üzerindeki konumundan İLERİDE ve bildirim yarıçapı içinde kalan fotoğraf noktaları.
 * - Çizgi: routeLine(route) (pathFull ?? path); bozuk pathFull'da hata verilir. aheadM yol mesafesidir (× scale).
 * - Noktanın kendi konumu (location) değil, rota üzerindeki approachPoint izdüşürülür; sapma mesafesi detourKm'de.
 * - 0 <= aheadM <= notifyRadiusM ise nokta `spots`'ta döner (geride kalan dönmez).
 *   `ahead` yarıçap süzgeci olmadan ileride kalan tüm noktaları içerir; createPhotoAlertTracker().update(result.ahead)
 *   ile kullanılır (izleyici yarıçapı kendisi uygular ve uzaklaşan noktayı yeniden kurar).
 * - safeStop !== true olan nokta önerilmez (güvenli durulamayan yer önerilmez).
 * - Yalnızca route.id ile aynı routeId'li noktalar değerlendirilir. isSample === true olan (örnek) nokta
 *   yalnızca includeSamples ile değerlendirilir (gerçek veride bu alan yok).
 * - Sürücü çizgiye driverMaxOffsetM'den uzaksa (ör. sapma yoluna girdi) offRoute=true ve boş liste döner.
 * - approachPoint çizgiye spotMaxOffsetM'den uzaksa nokta `detached` listesine girer (veri hatası: rota çizgisi
 *   değişmiş, scripts/compute_photo_approach.py yeniden çalıştırılmalı); bildirim üretilmez.
 * - direction: 'forward' (çizgi başından sonuna, varsayılan) veya 'reverse'.
 * @returns {{routeId: string, routeApproximate: boolean, lineSource: 'pathFull'|'path', scale: number, offRoute: boolean,
 *   driver: {distanceAlongM: number, offsetM: number, segmentIndex: number},
 *   spots: Array<{spot: object, aheadM: number, detourKm: number|null, offsetM: number}>,
 *   ahead: Array<same>, // yarıçap süzgeci olmadan ileride kalan tüm noktalar (izleyicinin yeniden kurulması için)
 *   detached: Array<{id: string, offsetM: number}>}}
 */
export function photoSpotsAheadOnRoute(driver, route, spots, {
  spotMaxOffsetM = 100, driverMaxOffsetM = 100, direction = 'forward', includeSamples = false,
} = {}) {
  if (!driver || !isNum(driver.lat) || !isNum(driver.lon)) throw new TypeError('driver: {lat, lon} olmalı');
  if (!isNum(spotMaxOffsetM) || spotMaxOffsetM < 0) throw new TypeError('spotMaxOffsetM: negatif olmayan sayı olmalı');
  if (!isNum(driverMaxOffsetM) || driverMaxOffsetM < 0) throw new TypeError('driverMaxOffsetM: negatif olmayan sayı olmalı');
  if (direction !== 'forward' && direction !== 'reverse') throw new TypeError("direction: 'forward' veya 'reverse' olmalı");

  const routeId = isObj(route) ? route.id : undefined;
  const res = hazardsAheadOnRoute(driver, route, spots, {
    lookAheadM: NO_LIMIT_M,
    maxOffsetM: spotMaxOffsetM,
    driverMaxOffsetM,
    direction,
    includeSamples,
    filter: (s, { includeSamples: inc }) => isUsableSpot(s) && s.routeId === routeId && s.safeStop === true
      && (s.isSample !== true || inc),
    getLocation: (s) => s.approachPoint,
    includeSkipped: true,
  });

  const ahead = res.hazards.map(({ hazard: s, aheadM, offsetM }) => (
    { spot: s, aheadM, detourKm: isNum(s.detourKm) ? s.detourKm : null, offsetM }
  ));
  return {
    routeId: res.routeId,
    routeApproximate: res.geometry === 'path' && route.verification?.status === ROUTE_STATUS_APPROXIMATE,
    lineSource: res.geometry,
    scale: res.scale,
    offRoute: res.offRoute,
    driver: res.driver,
    spots: ahead.filter((e) => e.aheadM <= e.spot.notifyRadiusM),
    ahead,
    detached: res.skipped.filter((x) => x.reason === 'offset').map((x) => ({ id: x.item.id, offsetM: x.offsetM })),
  };
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

/**
 * photoSpotsAheadOnRoute kaydını (spots/ahead öğesi) orderAnnouncements'a verilecek bildirime çevirir.
 * Tehlike bildirimleriyle aynı listede sıralanır: kind 'photo', tehlikeden (kind 'hazard') sonra okunur.
 * safeStop !== true ise null döner (buildPhotoVoiceAlert ile aynı kural).
 * @param {{spot: object, aheadM: number}} entry
 * @returns {{kind: 'photo', id: string, aheadM: number, text: string}|null}
 */
export function toPhotoAnnouncement(entry, lang = 'en') {
  if (!isObj(entry) || !isObj(entry.spot)) throw new TypeError('entry: {spot, aheadM} olmalı');
  if (typeof entry.spot.id !== 'string') throw new TypeError('entry.spot.id: metin olmalı');
  const text = buildPhotoVoiceAlert(entry.spot, entry.aheadM, lang);
  if (text === null) return null;
  return { kind: 'photo', id: entry.spot.id, aheadM: entry.aheadM, text };
}
