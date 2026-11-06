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
// - approachPoint değerleri scripts/compute_photo_approach.py ile aynı çizgiden (pathFull ?? path) hesaplanır ve çizgi
//   üzerindedir (< 5 m). spotMaxOffsetM varsayılanı 50 m; bu sınırın dışına düşen nokta sessizce atlanmaz, `detached`
//   listesinde raporlanır.
// - Eskime: her nokta, hesaplandığı andaki rota `geometryRevision` nesnesinin kopyasını taşır (karar 5A). Rotadaki
//   geometryRevision ile eşit değilse (hazards.js > sameGeometryRevision: iki karma karşılaştırılır, date
//   karşılaştırılmaz; ya da noktada yoksa) nokta bildirilmez, `stale` listesinde raporlanır:
//   rota çizgisi değişmiş, betik yeniden çalıştırılmalı. Rotada geometryRevision yoksa bu kontrol yapılmaz.
// - reachableFromRoute === false (karar 2A, "bu rotadan erişilmiyor") olan nokta bildirilmez, `unreachable`'da döner.
// - Sapma metni: detourRoadKm (gerçek yol mesafesi, tek yön, karar 6A) varsa o, yoksa kuş uçuşu detourKm söylenir.
//
// photoSpotsAheadOnRoute, hazardsAheadOnRoute üzerine ince bir sarmalayıcıdır (izdüşüm, ölçek, yön, rota dışı ve
// atlanan kayıt kuralları tek yerde). Menzil süzgeci (notifyRadiusM) sarmalayıcıda uygulanır, çünkü izleyicinin
// uzaklaşan noktayı yeniden kurabilmesi için yarıçap dışındaki `ahead` listesine de ihtiyaç var.

import { hazardsAheadOnRoute, createAlertTracker, sameGeometryRevision } from './hazards.js';

// Eskime kuralı tek yerde: hazards.js > sameGeometryRevision (pathSha256 + pathFullSha256; date karşılaştırılmaz).
// Dışa açık API korunur: bu modülden içe aktaran kod (ör. photo-alerts.test.mjs) aynı fonksiyonu alır.
export { sameGeometryRevision };

export const ROUTE_STATUS_APPROXIMATE = 'doğrulanmalı';
/** Söylenen sapma (detourRoadKm, yoksa detourKm) bu değer ve üstündeyse sesli metne sapma cümlesi eklenir. */
export const DETOUR_ANNOUNCE_MIN_KM = 0.5;
/** approachPoint bildirim çizgisine bundan uzaksa nokta `detached` sayılır (varsayılan). */
export const SPOT_MAX_OFFSET_M = 50;
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
 * - approachPoint çizgiye spotMaxOffsetM'den (50 m) uzaksa nokta `detached` listesine girer (veri hatası: rota çizgisi
 *   değişmiş, scripts/compute_photo_approach.py yeniden çalıştırılmalı); bildirim üretilmez.
 * - Rotada geometryRevision varsa ve nokta aynı nesneyi taşımıyorsa nokta `stale` listesine girer (izdüşürülmez,
 *   bildirilmez). stale/unreachable/detached yalnızca bu rotanın (routeId), kullanılabilir ve isSample kuralından
 *   geçen noktaları içerir; offRoute=true iken de stale ve unreachable doldurulur (veri durumu sürücüye bağlı değil).
 * - reachableFromRoute === false olan nokta `unreachable` listesine girer, bildirilmez.
 * - direction: 'forward' (çizgi başından sonuna, varsayılan) veya 'reverse'.
 * @returns {{routeId: string, routeApproximate: boolean, lineSource: 'pathFull'|'path', scale: number, offRoute: boolean,
 *   driver: {distanceAlongM: number, offsetM: number, segmentIndex: number},
 *   spots: Array<{spot: object, aheadM: number, detourKm: number|null, detourRoadKm: number|null, offsetM: number}>,
 *   ahead: Array<same>, // yarıçap süzgeci olmadan ileride kalan tüm noktalar (izleyicinin yeniden kurulması için)
 *   detached: Array<{id: string, offsetM: number}>,
 *   stale: Array<{id: string, spotRevision: object|null, routeRevision: object}>,
 *   unreachable: Array<{id: string}>}}
 */
export function photoSpotsAheadOnRoute(driver, route, spots, {
  spotMaxOffsetM = SPOT_MAX_OFFSET_M, driverMaxOffsetM = 100, direction = 'forward', includeSamples = false,
} = {}) {
  if (!driver || !isNum(driver.lat) || !isNum(driver.lon)) throw new TypeError('driver: {lat, lon} olmalı');
  if (!isNum(spotMaxOffsetM) || spotMaxOffsetM < 0) throw new TypeError('spotMaxOffsetM: negatif olmayan sayı olmalı');
  if (!isNum(driverMaxOffsetM) || driverMaxOffsetM < 0) throw new TypeError('driverMaxOffsetM: negatif olmayan sayı olmalı');
  if (direction !== 'forward' && direction !== 'reverse') throw new TypeError("direction: 'forward' veya 'reverse' olmalı");

  const routeId = isObj(route) ? route.id : undefined;
  const routeRevision = isObj(route) && isObj(route.geometryRevision) ? route.geometryRevision : null;
  const stale = [];
  const unreachable = [];
  const candidates = [];
  for (const s of spots || []) {
    if (!isUsableSpot(s) || s.routeId !== routeId || (s.isSample === true && !includeSamples)) continue;
    if (routeRevision && !sameGeometryRevision(s.geometryRevision, routeRevision)) {
      stale.push({ id: s.id, spotRevision: isObj(s.geometryRevision) ? s.geometryRevision : null, routeRevision });
      continue;
    }
    if (s.reachableFromRoute === false) { unreachable.push({ id: s.id }); continue; }
    candidates.push(s);
  }
  const res = hazardsAheadOnRoute(driver, route, candidates, {
    lookAheadM: NO_LIMIT_M,
    maxOffsetM: spotMaxOffsetM,
    driverMaxOffsetM,
    direction,
    includeSamples,
    filter: (s) => s.safeStop === true,
    getLocation: (s) => s.approachPoint,
    includeSkipped: true,
  });

  const ahead = res.hazards.map(({ hazard: s, aheadM, offsetM }) => (
    {
      spot: s, aheadM, detourKm: isNum(s.detourKm) ? s.detourKm : null,
      detourRoadKm: isNum(s.detourRoadKm) ? s.detourRoadKm : null, offsetM,
    }
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
    stale,
    unreachable,
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
  return lang === 'tr' ? `${String(km).replace('.', ',')} kilometre ileride` : `in ${km} kilometer${km === 1 ? '' : 's'}`;
}

/**
 * Kısa sesli bildirim metni (tr/en), etkileşim gerektirmez.
 * - Sapma: detourRoadKm (gerçek yol, tek yön) varsa "rotadan yolla yaklaşık X kilometre sapma"; yoksa detourKm
 *   (kuş uçuşu) "rotadan yaklaşık X kilometre sapma". Söylenen değer >= 0,5 km ise eklenir.
 * - reachableFromRoute === false ise null döner (bu rotadan erişilmiyor).
 * - safeStop !== true ise null döner: güvenli durulamayan nokta önerilmez.
 * - Dil yedeği (tr → en): başlık istenen dilde yoksa (ör. yalnız {el, en} olan Yunanistan noktası) metnin TAMAMI
 *   İngilizce kurulur; Türkçe çerçeve içinde İngilizce başlık okunmaz. tr/en dışındaki diller İngilizceye düşer.
 * @returns {string|null}
 */
export function buildPhotoVoiceAlert(spot, aheadM, lang = 'en') {
  if (!isObj(spot)) throw new TypeError('spot: nesne olmalı');
  if (!isNum(aheadM) || aheadM < 0) throw new TypeError('aheadM: negatif olmayan sayı olmalı');
  if (spot.safeStop !== true || spot.reachableFromRoute === false) return null;
  const want = lang === 'tr' ? 'tr' : 'en';
  const l = typeof spot.title?.[want] === 'string' && spot.title[want].length > 0 ? want : 'en';
  const title = spot.title?.[l];
  if (typeof title !== 'string' || title.length === 0) throw new TypeError('spot.title: en az en metni olmalı');
  const dist = spokenDistance(aheadM, l);
  let text = l === 'tr' ? `Fotoğraf noktası ${dist}: ${title}.` : `Photo spot ${dist}: ${title}.`;
  const byRoad = isNum(spot.detourRoadKm) && spot.detourRoadKm >= 0;
  const detour = byRoad ? spot.detourRoadKm : spot.detourKm;
  if (isNum(detour) && detour >= DETOUR_ANNOUNCE_MIN_KM) {
    const km = Math.round(detour * 10) / 10;
    const kmTr = String(km).replace('.', ',');
    if (byRoad) {
      text += l === 'tr' ? ` Rotadan yolla yaklaşık ${kmTr} kilometre sapma.` : ` About ${km} kilometer detour off the route by road.`;
    } else {
      text += l === 'tr' ? ` Rotadan yaklaşık ${kmTr} kilometre sapma.` : ` About ${km} kilometer detour off the route.`;
    }
  }
  return text;
}

/**
 * photoSpotsAheadOnRoute kaydını (spots/ahead öğesi) orderAnnouncements'a verilecek bildirime çevirir.
 * Tehlike bildirimleriyle aynı listede sıralanır: kind 'photo', tehlikeden (kind 'hazard') sonra okunur.
 * safeStop !== true ya da reachableFromRoute === false ise null döner (buildPhotoVoiceAlert ile aynı kural).
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
