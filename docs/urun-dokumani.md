# Ürün Dokümanı — Motorcu Rota Uygulaması

> Kaynak: el yazısı fikir taslağı (mind-map). Bu doküman o taslağın düzenlenmiş halidir.

**Vizyon:** Herkesin erişebildiği, global bir motorcu uygulaması. 🌍

Uygulama dört ana başlıktan oluşur:

1. Haritayla uyumlu doğru rotalar
2. Ekipman kontrol listesi (sesli asistan)
3. Güvenlik ve yakın çevre bilgisi ("Neden bu uygulama?")
4. Fotoğraf çekilmesi gereken noktalar

---

## 1. Haritayla uyumlu doğru bir rota

**Peki bu rotalar neler?**
Motorcuların dağda gezebildiği, bol manzaralı rotalar.

**Kapsam (ilk sürüm):**

| Ülke | Kapsam |
|------|--------|
| Türkiye | 7 bölgenin her birinden rotalar: Marmara, Ege, Akdeniz, İç Anadolu, Karadeniz, Doğu Anadolu, Güneydoğu Anadolu |
| Yunanistan | Seçili manzaralı dağ rotaları |
| İspanya | Seçili manzaralı dağ rotaları |
| Brezilya | Seçili manzaralı dağ rotaları |

**Dil:** Her ülkenin kendi dili + ek olarak İngilizce.

| Ülke | Diller |
|------|--------|
| Türkiye | Türkçe, İngilizce |
| Yunanistan | Yunanca, İngilizce |
| İspanya | İspanyolca, İngilizce |
| Brezilya | Portekizce, İngilizce |

## 2. Ekipman kontrol listesi

**Peki neler olabilir?**

1. Telsiz (interkom)
2. Bot
3. Ceket
4. Kask
5. Dizlikler, kolluklar
6. Motor kontrolü — fren, gaz, ayna gibi teknik kontroller

**Tasarım:** Bunu ufak, **sesli** özelliğe sahip bir asistan olarak tasarlıyoruz.
Asistan maddeleri tek tek sesli okur; sürücü "tamam" diyerek (veya dokunarak) bir sonraki maddeye geçer.
Eldivenle kullanılabilmesi için büyük butonlar ve eller serbest kullanım hedeflenir.

## 3. Neden bu uygulama?

**Peki motorcular neden bu uygulamaya ihtiyaç duysun?**

1. **Tehlike uyarıları (güvenlik):** Kendi haritasındaki olabilecek tehlikeleri uyarı olarak hatırlatır.
   - Taşlı yol
   - Yol tadilatı / çalışması
   - Yol eğimi (dik iniş/çıkış), keskin virajlar
2. **Yakındaki ihtiyaç noktaları:** Benzinlik, market ve motorcuların ihtiyacı olabilecek ekipman dükkanlarını
   tek bir yerde, en yakından uzağa doğru — **sen sormadan** — sıralar.
3. **Topluluk:** Kapalı (özel / paylaşılan) rotaları gösteren diğer kullanıcıları bir araya getirir.

> İlk iki özellik **ihtiyaçtan**, üçüncüsü **keyiften**.

## 4. Fotoğraf çekilmesi gereken noktalar

Rota üzerinde "böyle yerlerde fotoğraf olmasa olmaz" denilecek manzara noktaları işaretlenir.
Sürücü noktaya yaklaşınca bildirim alır; güvenli durma yeri bilgisi de gösterilir.

---

## Öncelik (MVP önerisi)

| Öncelik | Özellik | Gerekçe |
|---------|---------|---------|
| P0 | Ekipman kontrol listesi (sesli) | Bağımsız, harita gerektirmez, hemen değer üretir |
| P0 | Rota kataloğu (Türkiye 7 bölge) + harita | Uygulamanın çekirdeği |
| P0 | Tehlike uyarıları | Güvenlik — ihtiyaç |
| P1 | Yakındaki benzinlik / market / ekipman dükkanı | İhtiyaç |
| P1 | Fotoğraf noktaları | Rota deneyimini zenginleştirir |
| P1 | Yunanistan, İspanya, Brezilya + dilleri | Global genişleme |
| P2 | Topluluk / kapalı rotalar | Keyif |

## Veri modeli (taslak)

```text
Country   { code, name{lang}, languages[] }
Region    { id, countryCode, name{lang} }
Route     { id, regionId, name{lang}, description{lang}, lengthKm,
            difficulty: easy|moderate|hard, bestSeason{lang},
            start{name, lat, lon}, end{name, lat, lon},
            path: GeoJSON LineString ([lon,lat]),
            pathFull?: GeoJSON LineString (sadeleştirilmemiş OSRM geometrisi; OSRM'nin yönlendirmediği kesimde OSM way düğüm geometrisi — Nemrut kuyruğu, Kemaliye Taş Yol; uzunluğu lengthKm ile ±%2; map-data.js'e taşınmaz),
            geometryRevision{ date, pathSha256, pathFullSha256 | null },
            verification{ status: doğrulanmalı|doğrulandı, notes } }
Hazard    { id, routeId, type: gravel|roadwork|steep_grade|sharp_curve, location{lat, lon},
            note{lang; en zorunlu}, reportedBy, reportedAt, isSample,
            source?{kind: osm|user|field, ref, tag?}, verification?{status, checkedAt?, notes?},
            extent?{fromKm, toKm, geometry, line?, geometryRevision?} }
Poi       { id: "osm:<type>/<id>", type: fuel|market|gear_shop, location{lat, lon}, name?, distanceM }
PhotoSpot { id, routeId, location{lat, lon}, title{lang}, description{lang},
            safeStop: bool, safeStopInfo{lang}, notifyRadiusM,
            approachPoint{lat, lon}, detourKm, detourRoadKm?, reachableFromRoute?,
            geometryRevision (rotadakinin kopyası), verification{ status, notes } }
ChecklistItem { id, order, text{lang}, spokenText{lang}, conditional?: { key, before } }
```

**Rota id kuralı:** `<ülke>-<bölge>-<nn>` (ör. `tr-karadeniz-01`, `tr-ic-anadolu-01`, `gr-thessalia-01`, `es-andalucia-01`, `br-santa-catarina-01`). Bölge adları: marmara, ege, akdeniz,
ic-anadolu, karadeniz, dogu-anadolu, guneydogu-anadolu. Tehlike ve fotoğraf noktaları rotalara bu id ile bağlanır; id'ler değiştirilmez.

**Veri dosyaları:** `data/routes.json`, `data/photo-spots.json`, `data/hazards.json` (şu an boş; etiketsiz yüzey tehlike sayılmaz), `data/hazards.schema.json` (tehlike verisi henüz yok; uydurma veri eklenmez,
örnek veri `isSample: true` ile işaretlenir). Koordinatlar `scripts/verify_coordinates.py` ile OpenStreetMap'e karşı kontrol edilir (rapor: `scripts/verify_report.json`).
2026-11-10 durumu: 10 rota (7 Türkiye, 1 Yunanistan, 1 İspanya, 1 Brezilya), 9'i **doğrulandı**; 21 fotoğraf noktası, 11'i **doğrulandı** (yurt dışı noktaları, sahada ve ana dili o dil olan biri tarafından kontrol edilene kadar **doğrulanmalı**).

2026-11-01 durumu: 7 rotanın 6'sı ve 12 fotoğraf noktasının 11'i **doğrulandı**. Hâlâ **doğrulanmalı** olanlar:
Kemaliye Taş Yol çizgisi (OSM'de yol parçaları eksik) ve Saklıkent manzara noktası (OSM'de karşılığı yok).
"Doğrulandı", koordinatın yola ve adlı yere oturduğu anlamına gelir. Otopark, zemin ve mevsimsel kapanma gibi bilgiler yine sahada teyit edilmelidir.

## Teknik notlar

- Harita prototipi: `prototype/map.html` (Leaflet 1.9.4 + OSM karoları, "© OpenStreetMap contributors" atfı). Veri `scripts/build_map_data.py`
  ile `prototype/map-data.js` olarak üretilir; JSON değişince betik yeniden çalıştırılır. OSM karo politikası yoğun kullanıma izin vermez;
  ürüne geçmeden önce kendi karo sunucusu ya da sağlayıcı gerekir.
- `lengthKm` yol uzunluğudur (OSRM); `path` sadeleştirilmiş çizgidir ve daha kısadır (fark virajlılığa bağlı; 2026-11 ölçümlerinde en çok Pelion, ~%21,5). Mesafe, varış saati, rota dışı ve
  tehlike hesapları `pathFull ?? path` kullanır; yalnızca `path` olan rotada sonuç yaklaşıktır (`routeApproximate: true`). 2026-11-11'den beri katalogda yalnız `path`'i olan rota yok (Kemaliye'nin `pathFull`'u OSM way geometrisinden üretildi); bu davranış testlerde açıkça ÖRNEK diye işaretli sentetik rotalarla sınanıyor. `pathFull` uzunluğu ile `lengthKm` arasındaki fark %0,2 içinde olmalı ya da yalnız `lengthKm`'nin 1 ondalık yuvarlamasından gelmeli (|fark| ≤ 0,05 km). `routeApproximate` şu an modüllerde farklı hesaplanıyor (karar 23).
  Harita sadeleştirilmiş `path`'i çizer. Harita listesi ülke › bölge gruplu; metin önce arayüz dilinde, yoksa İngilizcede gösterilir. `path` yöntemi: `pathFull` üzerinde Douglas-Peucker, 200 m tolerans.
- `geometryRevision`: karma = `coordinates` dizisinin `json.dumps(separators=(",",":"))` UTF-8 metninin SHA-256'sı (JS `JSON.stringify` ile aynı);
  hesap `scripts/geometry_revision.py`. Fotoğraf noktaları ve tehlike `extent` kayıtları kopyasını taşır;
  eşitlik kuralı tek yerde, `sameGeometryRevision` (`prototype/hazards.js`): iki karma karşılaştırılır, `date` karşılaştırılmaz.
  Uyuşmazsa nokta `stale` olur ve bildirilmez.
  Rota çizgisi değişince sıra: `reroute_routes.py --write` → `geometry_revision.py --write` → `build_map_data.py` → `compute_photo_approach.py --osrm`.
  Ortak kural `routeLine(route)` (`prototype/hazards.js`): çizgi `pathFull ?? path`, `scale` = çizgi mesafesini yol mesafesine çeviren çarpan
  (pathFull için 1; yalnız path varsa lengthKm / çizgi uzunluğu). Bozuk `pathFull` hata verir, sessizce `path`'e düşülmez.
- Rota yönü: `prototype/route-geometry.js` `routeBearings` — 200 m mesafe penceresi, 50 m adım, uzunlukla ağırlıklı vektör toplamı;
  R < 0,7 ise "yön değişken" (viraj/firkete). 0,7 eşiği proje varsayımıdır. Yan rüzgâr değerlendirmesi henüz yok.
- Fotoğraf noktası bildirimi rota üzerindeki `approachPoint` çevresinde `notifyRadiusM` ile tetiklenir; `detourKm` rotadan noktaya kuş uçuşu
  mesafedir (gerçek yol mesafesi değil). Değerler `scripts/compute_photo_approach.py` ile `data/routes.json`'dan hesaplanır; rota çizgisi değişirse betik yeniden çalıştırılır.
- Fotoğraf noktası `approachPoint`: noktaya giden yolun rotaya katıldığı kavşak (OSRM); `detourRoadKm` tek yön yol mesafesidir ve sesli bildirim bunu söyler,
  `detourKm` kuş uçuşudur. Nokta çizgiden 50 m'den uzaksa `detached`, `reachableFromRoute: false` ise bildirilmez.
- Yeni fotoğraf noktası eklerken `compute_photo_approach.py --osrm --only <routeId>`; mevcut noktaların değişmediği `--osrm --check` ile doğrulanır.
  Sesli metin tr/en; başlık istenen dilde yoksa metnin tamamı İngilizce okunur. Hava uyarıları şu an tr/en (el bekliyor).
- Benzinlik boşluğu: `prototype/hazards.js` > `fuelGapsAlongRoute(route, pois, { maxOffsetM = 500 })` — `type: fuel` POI'leri rota çizgisine izdüşürür, başlangıç/istasyonlar arası/bitiş aralıklarını ve en uzun boşluğu yol km'si olarak verir. Gerçek rotalar için ölçüm: [docs/arastirma/benzinlik-araliklari.md](arastirma/benzinlik-araliklari.md) (OSM, 2026-11-13; doğrulanmalı).
- Fotoğraf bildirimi: `prototype/photo-alerts.js` (`hazardsAheadOnRoute` üzerine ince sarmalayıcı; çizgiden 100 m'den uzak düşen noktalar `detached` olarak raporlanır; `toPhotoAnnouncement` ile `kind: 'photo'`). `approachPoint` rota çizgisine izdüşürülür; `aheadM` ≤ `notifyRadiusM` olunca nokta başına bir kez
  tetiklenir, `notifyRadiusM` + 500 m uzaklaşınca yeniden kurulur. `detourKm` ≥ 0,5 ise "rotadan yaklaşık X km sapma" söylenir; `safeStop` false olan nokta önerilmez.
  Harita, `reachableFromRoute: false` noktayı soluk işaretçi ve "Bu rotadan erişilmiyor" ibaresiyle gösterir; `detourRoadKm` > 0 ise "yolla ~X km (tek yön)" yazar.
- Aynı anda gelen bildirimlerde tehlike, fotoğraftan önce okunur (`orderAnnouncements`). Rota boyunca hesaplanan uyarılar "X metre ileride" der.
- `verification.status: doğrulanmalı` olan tehlikeler temkinli okunur ("olası taşlı yol").
- Tehlike uyarıları rota boyunca ileriye bakılarak sıralanır (`hazardsAheadOnRoute`, `prototype/hazards.js`); her tehlike en fazla iki kez
  (≈1 km ön uyarı, ≈300 m yakın uyarı) sesli okunur. "doğrulanmalı" rotalarda sonuç `routeApproximate: true` taşır ve mesafeler yaklaşıktır.
- Hava durumu: `prototype/weather.js`, Open-Meteo Forecast API (anahtarsız). Veri lisansı CC BY 4.0; arayüzde "Weather data by Open-Meteo.com"
  atfı gösterilmelidir. Ücretsiz API yalnızca ticari olmayan kullanım içindir ve istek sınırı vardır; önbellek gerekir.
  Ticari kullanım ve karo seçenekleri: [docs/arastirma/ticari-kullanim.md](arastirma/ticari-kullanim.md) (OSM karo sunucusunda çevrimdışı kullanım yasaktır).
  Yan/karşı rüzgâr: `wind_direction_10m` + `routeBearings`; `crosswindKmh` / `headwindKmh` (+ karşı, − arka) yalnız bilgi alanıdır, sürüş seviyesini
  etkilemez; yön değişken (R < 0,7) noktalarda hesaplanmaz. Yan rüzgâr eşiği kullanıcı onayı bekliyor (docs/kararlar.md, 18).
  Sürüş değerlendirmesi: uygun / dikkat / önerilmez. Eşikler modüldeki `THRESHOLDS` sabitindedir ve çoğu **proje varsayımıdır** (gözden geçirilmeli).
- Koşullu ekipman maddeleri: yağmur beklenirse (rota üzerindeki herhangi bir örnek noktada, sürücünün varış saatinde yağış ≥ 0,2 mm/sa,
  yağış olasılığı ≥ %40 ya da yağışlı hava kodu) kontrol listesi `checklist.html?ek=yagmur` ile açılır; `?ek=-yagmur` maddeyi kaldırır.
  Madde motor kontrolünden önce yer alır; Sıfırla işaretleri temizler ama koşullu maddeyi bırakır. Kayıt sabit madde kimlikleriyle tutulur.
- Önerilen ek koşullu maddeler (eşikler `THRESHOLDS` ile aynı, **proje varsayımı**, kullanıcı onayı bekliyor):
  soğuk — rota üzerinde varış saatinde sıcaklık ≤ 5 °C → `?ek=soguk` (termal içlik); sis — görüş < 1000 m ya da sis kodu (45/48) → `?ek=sis`
  (reflektif yelek / ışıklar açık). Kaldırmak için `?ek=-soguk`, `?ek=-sis`. Uygulandı: soğuk maddesi ceketten, sis maddesi motor kontrolünden önce.
  Hava modülü bağlantıyı her seferinde üç koşulla açıkça üretir (ör. `checklist.html?ek=yagmur,-soguk,sis`); bir noktada tahmin yoksa o koşul için kaldırma yazılmaz.
  Sayfa, koşullu madde değişince adresteki `ek` parametresini `history.replaceState` ile tam durumla günceller; yenileme son durumu korur.

- Harita: OpenStreetMap tabanlı (ör. Leaflet / MapLibre) — global erişim ve lisans açısından uygun.
- Yakındaki noktalar: OSM verisi (Overpass API: `amenity=fuel`, `shop=supermarket`, `shop=convenience`, `shop=motorcycle`) — `prototype/hazards.js`. Genel Overpass sunucusunun kullanım sınırı var; önbellek/seyreltme gerekir ve OSM (ODbL) atıfı gösterilmelidir.
- Sesli asistan: tarayıcıda Web Speech API (`speechSynthesis` + `SpeechRecognition`), mobilde platform TTS/STT.
- Çeviriler: tüm metinler `{dil: metin}` şeklinde tutulur; varsayılan dil cihaz dilinden seçilir, İngilizce yedek dildir.
