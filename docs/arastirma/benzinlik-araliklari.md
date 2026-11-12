# Rotalarda benzinlik aralıkları (araştırma notu)

> **Bu bir araştırma notudur, uygulama verisi değildir.** Hiçbir değer `data/` altına yazılmadı.
> **OSM'de görünmüyor ≠ yok.** Aşağıdaki "istasyon yok" ve boşluk değerleri yalnızca OpenStreetMap'te
> `amenity=fuel` olarak işaretlenmiş noktaları yansıtır. Kapanmış, mevsimlik, etiketsiz ya da haritaya hiç
> girilmemiş istasyonlar olabilir; tersine OSM'deki bir istasyon kapanmış olabilir. **Doğrulanmalı.**

Hazırlayan: guvenlik-ve-yakin-cevre, 2026-11-13 gecesi (TR). Rota verisi: `data/routes.json` (yalnızca okundu).

## Yöntem

- Hesap: `prototype/hazards.js` > `fuelGapsAlongRoute(route, pois, { maxOffsetM })`. Çizgi `routeLine(route)`
  (tüm rotalarda `pathFull`), istasyonlar `projectOnRoute` ile çizgiye izdüşürüldü; çizgiye `maxOffsetM`'den
  uzak olanlar sayılmadı. Aralıklar: başlangıç → ilk istasyon, istasyonlar arası, son istasyon → bitiş (km, yol çizgisi boyunca).
- Veri: Overpass API, rota çizgisinin sınır kutusu + ~3 km tampon içinde `nwr["amenity"="fuel"]`, `out center tags`
  (way'ler için merkez noktası). Yanıt `parseOverpassResponse` ile `Poi` listesine çevrildi.
- İki yarıçap: **500 m** (yol kenarındaki istasyon — asıl değer) ve **2000 m** (yakın yerleşimdeki istasyonlar; dağ yolunda
  kuş uçuşu 2 km yol ile çok daha uzun olabilir, bu sütun yalnız bilgi içindir).
- Çizgi başının/sonunun gerisinde kalan istasyonlar km 0'a ya da rota sonuna izdüşer (ör. başlangıç kentindeki istasyonlar).
- Süzme yapılmadı: `access=private`, yalnız CNG/LPG satan istasyonlar ve isimsiz düğümler de sayıldı (bkz. Notlar).

### Erişim denemeleri (2026-11-12 23:16–23:31 UTC / 2026-11-13 02:16–02:31 TR)

| Uç nokta | Sonuç |
|---|---|
| overpass-api.de | Bağlantı sıfırlandı (curl 35) |
| overpass.kumi.systems | 40 s zaman aşımı |
| overpass.private.coffee | 40 s zaman aşımı |
| overpass.osm.jp | Proxy 502 |
| **maps.mail.ru/osm/tools/overpass** | **Çalıştı** (Overpass API 0.7.62.4; arada HTTP 504 verdi, 15 s aralıkla en çok 4 deneme ile 10 rotanın hepsi alındı) |
| api.openstreetmap.org (API 0.6 `map.json`) | Yalnızca `tr-dogu-anadolu-01` için çapraz kontrol: bbox 38.3831,39.2320,38.5359,39.3542 (lon,lat), 8235 öğe, `amenity=fuel` **0** (2026-11-12 23:30:42 UTC / 2026-11-13 02:30 TR) |

Ayna verisinin güncelliği her satırda `osm_base` (Overpass'ın OSM veri zaman damgası) olarak verildi; hepsi erişimden birkaç dakika öncesine ait.

## Sonuçlar

Biçim: istasyon sayısı: OSM id'leri (rota boyunca sırayla). En uzun boşluk: km (nereden → nereye, rota km'si).

| Rota | Yarıçap | İstasyonlar (OSM) | En uzun boşluk km | Kaynak | Erişim (yanıt alındı) |
|---|---|---|---|---|---|
| `tr-marmara-01` | 500 m | 1: node/3504400060 | 33,6 (node/3504400060 km 0,1 → bitiş km 33,7) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:22:28Z | 2026-11-12 23:24:06 UTC / 2026-11-13 02:24 TR |
| `tr-marmara-01` | 2000 m | 14: node/290867058, node/4699020199, node/9307928433, node/3504400060, node/9293222113, node/7010764250, node/7010764251, node/3417163622, node/7010764273, node/3498638364, node/9307928434, node/11563327346, node/6484952791, way/1451372512 | 27,6 (way/1451372512 km 6,0 → bitiş km 33,7) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:22:28Z | 2026-11-12 23:24:06 UTC / 2026-11-13 02:24 TR |
| `tr-ege-01` | 500 m | 7: node/7181502165, node/4699022939, node/4748577087, node/1256852905, node/4699020288, node/6409211402, node/6420931626 | 43,0 (node/1256852905 km 6,3 → node/4699020288 km 49,3) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:23:33Z | 2026-11-12 23:25:28 UTC / 2026-11-13 02:25 TR |
| `tr-ege-01` | 2000 m | 16: node/11508263864, node/8074085299, node/8074085300, node/8074085301, node/7181502165, node/4699022939, node/4748577087, node/1256852905, node/3619166269, node/3619166312, node/4699018195, node/4699020288, node/6409211402, node/6420931626, node/6420931625, node/6420931624 | 41,7 (node/1256852905 km 6,3 → node/3619166269 km 48,0) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:23:33Z | 2026-11-12 23:25:28 UTC / 2026-11-13 02:25 TR |
| `tr-akdeniz-01` | 500 m | 6: node/2300063983, node/4699023915, node/6004565739, node/11283555169, node/4699020190, node/6505979386 | 38,2 (node/6505979386 km 13,1 → bitiş km 51,4) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:18:19Z | 2026-11-12 23:19:56 UTC / 2026-11-13 02:19 TR |
| `tr-akdeniz-01` | 2000 m | 28: node/12201804711, node/5260045062, node/6901702852, node/4699020904, node/6139375015, node/2300063983, node/5992278862, node/5992278861, node/4991829746, node/4699023915, node/4991829747, node/4991829756, node/6016086592, node/6080374270, node/4699023916, node/6016086594, node/6016086593, node/6016086591, node/6036984851, node/7653361874, node/6036984726, node/4699020283, node/4908901717, node/6004565739, node/5970207677, node/11283555169, node/4699020190, node/6505979386 | 38,2 (node/6505979386 km 13,1 → bitiş km 51,4) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:18:19Z | 2026-11-12 23:19:56 UTC / 2026-11-13 02:19 TR |
| `tr-ic-anadolu-01` | 500 m | 5: node/9273800788, node/9273800784, node/8851268029, node/8851268027, node/8851268028 | 41,1 (node/9273800788 km 0,0 → node/9273800784 km 41,1) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:23:33Z | 2026-11-12 23:25:49 UTC / 2026-11-13 02:25 TR |
| `tr-ic-anadolu-01` | 2000 m | 10: node/9273800788, node/9273800784, node/8851268029, node/8851268027, node/8851268028, node/9266793254, node/9266793255, node/9266793257, node/9266793258, node/9266793259 | 41,1 (node/9273800788 km 0,0 → node/9273800784 km 41,1) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:23:33Z | 2026-11-12 23:25:49 UTC / 2026-11-13 02:25 TR |
| `tr-karadeniz-01` | 500 m | 2: node/4766211853, node/5040311501 | 52,3 (node/4766211853 km 1,6 → node/5040311501 km 53,9) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:25:31Z | 2026-11-12 23:27:32 UTC / 2026-11-13 02:27 TR |
| `tr-karadeniz-01` | 2000 m | 4: node/10141160799, node/4766211853, node/5029357603, node/5040311501 | 52,2 (node/4766211853 km 1,6 → node/5029357603 km 53,7) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:25:31Z | 2026-11-12 23:27:32 UTC / 2026-11-13 02:27 TR |
| `tr-dogu-anadolu-01` | 500 m | 0: — | 11,2 (başlangıç km 0,0 → bitiş km 11,2) — **rotada istasyon yok (OSM)** | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:28:35Z | 2026-11-12 23:30:29 UTC / 2026-11-13 02:30 TR |
| `tr-dogu-anadolu-01` | 2000 m | 0: — | 11,2 (başlangıç km 0,0 → bitiş km 11,2) — **rotada istasyon yok (OSM)** | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:28:35Z | 2026-11-12 23:30:29 UTC / 2026-11-13 02:30 TR |
| `tr-guneydogu-anadolu-01` | 500 m | 12: node/4871262490, node/4871262485, node/4871262496, node/4871262491, node/4871262501, node/5003735230, node/4871263436, node/4871263435, node/5003735231, node/2794605800, node/2794605962, node/5001495624 | 22,9 (node/5001495624 km 20,5 → bitiş km 43,4) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:19:17Z | 2026-11-12 23:21:19 UTC / 2026-11-13 02:21 TR |
| `tr-guneydogu-anadolu-01` | 2000 m | 18: node/4871262490, node/10765657339, node/4871262485, node/4871262496, node/4871262491, node/4871262501, node/4871262511, node/6847704674, node/4871263430, node/5003735230, node/4871263436, node/4871263435, node/5003735231, node/2794605800, node/4699019932, node/2794605962, node/5002999801, node/5001495624 | 22,9 (node/5001495624 km 20,5 → bitiş km 43,4) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:19:17Z | 2026-11-12 23:21:19 UTC / 2026-11-13 02:21 TR |
| `gr-thessalia-01` | 500 m | 15: node/2423184396, node/9924866331, node/9171307834, node/9171307835, node/9171354630, node/9171354631, node/2631525573, node/2631525574, node/432916433, node/2631510289, node/2631551237, node/2631553298, node/9170051318, node/1803217496, node/5860152715 | 31,0 (node/2631553298 km 12,7 → node/9170051318 km 43,7) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:27:36Z | 2026-11-12 23:29:22 UTC / 2026-11-13 02:29 TR |
| `gr-thessalia-01` | 2000 m | 43: node/2423184396, node/2631497293, node/4392586411, node/4392595378, node/5548147523, node/6835514652, node/6835602924, node/7614705156, node/7614705163, node/9171420824, node/9171420829, node/9171420833, node/9171420838, node/9171420851, node/9171420858, node/9171420865, node/9924804360, node/9924804364, node/9924804373, node/9924804378, node/9924804383, node/9924866331, node/9171307834, node/9171307835, node/7614791661, node/7614791669, node/9171307830, node/9171307833, node/9171346566, node/9171346573, node/9171354630, node/9171346576, node/9171354631, node/2631525573, node/2631525574, node/432916433, node/2631510289, node/7856719293, node/2631551237, node/2631553298, node/9170051318, node/1803217496, node/5860152715 | 31,0 (node/2631553298 km 12,7 → node/9170051318 km 43,7) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:27:36Z | 2026-11-12 23:29:22 UTC / 2026-11-13 02:29 TR |
| `es-andalucia-01` | 500 m | 1: way/1464113168 | 31,7 (way/1464113168 km 0,0 → bitiş km 31,7) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:27:36Z | 2026-11-12 23:29:40 UTC / 2026-11-13 02:29 TR |
| `es-andalucia-01` | 2000 m | 3: node/287011192, way/1464113168, node/593879565 | 17,6 (way/1464113168 km 0,0 → node/593879565 km 17,6) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:27:36Z | 2026-11-12 23:29:40 UTC / 2026-11-13 02:29 TR |
| `br-santa-catarina-01` | 500 m | 0: — | 31,7 (başlangıç km 0,0 → bitiş km 31,7) — **rotada istasyon yok (OSM)** | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:21:16Z | 2026-11-12 23:23:19 UTC / 2026-11-13 02:23 TR |
| `br-santa-catarina-01` | 2000 m | 3: node/5379369279, way/291544472, way/355820079 | 31,7 (way/291544472 km 0,0 → way/355820079 km 31,7) | Overpass (maps.mail.ru aynası), osm_base 2026-11-12T23:21:16Z | 2026-11-12 23:23:19 UTC / 2026-11-13 02:23 TR |

Ölçülemeyen rota: **yok** (10 rotanın 10'u ölçüldü).

### Özet (500 m)

| Rota | Uzunluk km | En uzun boşluk km | Not |
|---|---|---|---|
| `tr-karadeniz-01` | 54,4 | 52,3 | km 1,6 → km 53,9 arasında OSM'de istasyon yok (başlangıç Maçka, bitiş Torul) |
| `tr-ege-01` | 51,4 | 43,0 | km 6,3 → km 49,3 (Ödemiş → Salihli yönünde) |
| `tr-ic-anadolu-01` | 46,2 | 41,1 | km 0 → km 41,1 (Hacılar → Develi yönünde) |
| `tr-akdeniz-01` | 51,4 | 38,2 | km 13,1'den rota sonuna (Saklıkent Kayak Merkezi) kadar yok |
| `tr-marmara-01` | 33,7 | 33,6 | km 0,1'den rota sonuna (Uludağ Oteller Bölgesi) kadar yok |
| `br-santa-catarina-01` | 31,7 | 31,7 | **Rota üstünde (500 m) hiç yok**; en yakınlar 0,6–1,7 km uzakta, iki uçta |
| `es-andalucia-01` | 31,7 | 31,7 | Tek istasyon başlangıçta (km 0, Galp, çizgiye 496 m); rota sonuna (Zahara de la Sierra) kadar yok |
| `gr-thessalia-01` | 45,1 | 31,0 | km 12,7 → km 43,7 (bitiş Zagora km 45,1) |
| `tr-guneydogu-anadolu-01` | 43,4 | 22,9 | km 20,5'ten rota sonuna (Nemrut Otoparkı) kadar yok |
| `tr-dogu-anadolu-01` | 11,2 | 11,2 | **Bbox içinde (rotanın ~3 km çevresi, Kemaliye merkezi dahil) OSM'de hiç istasyon yok**; Overpass ve OSM API aynı sonucu verdi. Rota çizgisi `doğrulanmalı` (routeApproximate) |

## Notlar ve sınırlar

- **OSM'de görünmüyor ≠ yok; doğrulanmalı.** Özellikle Kemaliye (`tr-dogu-anadolu-01`) ve Serra do Rio do Rastro
  (`br-santa-catarina-01`) için saha ya da yerel kaynak teyidi gerekir. Önceki gecelerde rota-uzmani'nın notları da aynı yönde
  (Motonline: "güzergâh bölgesinde benzinlikler seyrek").
- 2000 m sütununda motor için uygun olmayabilecek kayıtlar var: `tr-karadeniz-01` node/10141160799 "AKSA Maçka CNG" (CNG),
  `es-andalucia-01` node/287011192 kooperatif istasyonu (`access=private`). 500 m sonuçlarını etkilemiyorlar.
- İsimsiz düğümler (ör. `tr-ic-anadolu-01` node/9273800788, node/9273800784) OSM'de yalnız `amenity=fuel` taşıyor; çalışır durumda olup olmadıkları bilinmiyor.
- Mesafeler rota çizgisi boyuncadır; istasyona gitmek için rotadan sapma (500 m'ye kadar kuş uçuşu) eklenmedi.
- Rotalar tek yön ölçüldü; boşluk uzunluğu ters yönde de aynıdır.
- Ham Overpass yanıtları ve hesap betikleri yalnızca bu gecenin geçici çalışma dizininde tutuldu; repo'ya eklenmedi.
- Veri © OpenStreetMap katkıcıları, ODbL.
