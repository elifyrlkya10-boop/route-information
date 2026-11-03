// Rota geometrisi ortak yardımcıları — bağımlılıksız ES modülü (tarayıcı + Node >= 18).
// Hava durumuna, tehlikelere ya da fotoğraf noktalarına özgü hiçbir şey içermez; yalnızca çizgi geometrisi.
// İlk fonksiyon: routeBearings (rota yönü, ör. ileride yan rüzgâr için). Öneri: rota-uzmani (2026-11-03, Aşama 3).
// Bu modül veri içermez; koordinatlar dışarıdan (data/routes.json) gelir.

export const DEFAULT_BEARING_WINDOW_M = 200; // rota-uzmani önerisi: 100 m'de yuvarlama gürültüsü, 400 m'de firketeler fazla ortalanıyor
export const DEFAULT_BEARING_STEP_M = 50;
export const VARIABLE_R_THRESHOLD = 0.7;     // R < 0,7 → "yön değişken" (viraj/firkete). Proje varsayımı (rota-uzmani önerisi).

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function haversineM(lonA, latA, lonB, latB) {
  const dLat = toRad(latB - latA);
  const dLon = toRad(lonB - lonA);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

function assertCoords(coords) {
  if (!Array.isArray(coords) || coords.length < 2) throw new TypeError('coords: en az 2 [lon, lat] noktası olmalı');
  for (const c of coords) {
    if (!Array.isArray(c) || !isNum(c[0]) || !isNum(c[1]) || c[1] < -90 || c[1] > 90 || c[0] < -180 || c[0] > 180) {
      throw new TypeError('coords: her nokta [lon, lat] sayı çifti olmalı (GeoJSON sırası)');
    }
  }
}

/** Pusula açısını [0, 360) aralığına getirir. */
export function normalizeDeg(d) {
  const x = d % 360;
  return x < 0 ? x + 360 : x;
}

/**
 * Parçalar: her ardışık nokta çifti için başlangıç mesafesi s0 (m), uzunluk len (m, haversine) ve
 * birim yön vektörü (ux: doğu, uy: kuzey; yerel eşdikdörtgen düzlemde, kısa parçalarda hata ihmal edilir).
 * Sıfır uzunluklu parçalar (yinelenen nokta) atlanır.
 */
function segmentsOf(coords) {
  const segs = [];
  let s = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lonA, latA] = coords[i];
    const [lonB, latB] = coords[i + 1];
    const len = haversineM(lonA, latA, lonB, latB);
    if (!(len > 0)) continue;
    let dLon = lonB - lonA;
    if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
    const e = dLon * Math.cos(toRad((latA + latB) / 2));
    const n = latB - latA;
    const h = Math.hypot(e, n);
    segs.push({ s0: s, len, ux: e / h, uy: n / h });
    s += len;
  }
  return { segs, totalM: s };
}

/**
 * Rota boyunca kayan mesafe penceresinde yön.
 * Pencere [sM, sM + windowM] (çizgi boyunca metre); penceredeki parçaların (kırpılmış) yön vektörleri
 * uzunluklarıyla ağırlıklı toplanır — açı ortalaması değil vektör toplamı, böylece 359°/1° doğru ortalanır.
 *   bearingDeg: toplam vektörün pusula açısı (0 = kuzey, 90 = doğu, saat yönü), [0, 360). R < 0,001 ise (tam geri dönüş) null.
 *   R: |toplam vektör| / pencere uzunluğu, [0, 1]. 1 = dümdüz; küçükse viraj/firkete.
 *   variable: R < rThreshold (varsayılan 0,7) → bu kesimde tek bir yön (ve yan rüzgâr açısı) anlamlı değil.
 * Pencereler sM = 0, stepM, 2·stepM, ... ve sM + windowM ≤ toplam uzunluk; çizgi pencereden kısaysa
 * tek pencere [0, toplam] döner. Son kısmi adım (toplam − windowM'den sonrası) ayrı pencere olarak dönmez.
 * @param {number[][]} coords GeoJSON LineString koordinatları, [lon, lat] (ör. route.pathFull.coordinates)
 * @returns {{sM:number, bearingDeg:number|null, R:number, variable:boolean}[]}
 */
export function routeBearings(coords, {
  windowM = DEFAULT_BEARING_WINDOW_M, stepM = DEFAULT_BEARING_STEP_M, rThreshold = VARIABLE_R_THRESHOLD,
} = {}) {
  assertCoords(coords);
  if (!isNum(windowM) || windowM <= 0) throw new TypeError('windowM: pozitif sayı olmalı');
  if (!isNum(stepM) || stepM <= 0) throw new TypeError('stepM: pozitif sayı olmalı');
  const { segs, totalM } = segmentsOf(coords);
  if (!segs.length) throw new TypeError('coords: sıfırdan uzun en az bir parça olmalı');

  const out = [];
  const win = Math.min(windowM, totalM);
  const eps = 1e-6;
  let first = 0; // pencerenin başladığı ilk parça (pencereler ileri kaydığı için geri gitmez)
  for (let k = 0; ; k++) {
    const a = k * stepM;
    const b = a + win;
    if (b > totalM + eps) break;
    while (first < segs.length - 1 && segs[first].s0 + segs[first].len <= a) first++;
    let sx = 0, sy = 0;
    for (let i = first; i < segs.length && segs[i].s0 < b; i++) {
      const g = segs[i];
      const w = Math.min(b, g.s0 + g.len) - Math.max(a, g.s0);
      if (w > 0) { sx += w * g.ux; sy += w * g.uy; }
    }
    const mag = Math.hypot(sx, sy);
    const R = Math.min(1, mag / win);
    const bearingDeg = R >= 1e-3 ? normalizeDeg(toDeg(Math.atan2(sx, sy))) : null; // R ~ 0: yön tanımsız
    out.push({ sM: a, bearingDeg, R, variable: R < rThreshold });
  }
  return out;
}

/** İki pusula açısı arasındaki en küçük fark, [0, 180]. */
export function angleDiffDeg(a, b) {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}
