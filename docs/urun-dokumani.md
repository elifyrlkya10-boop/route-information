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
            verification{ status: doğrulanmalı|doğrulandı, notes } }
Hazard    { id, routeId, type: gravel|roadwork|steep_grade|sharp_curve, location{lat, lon},
            note{lang; en zorunlu}, reportedBy, reportedAt, isSample }
Poi       { id: "osm:<type>/<id>", type: fuel|market|gear_shop, location{lat, lon}, name?, distanceM }
PhotoSpot { id, routeId, location{lat, lon}, title{lang}, description{lang},
            safeStop: bool, safeStopInfo{lang}, notifyRadiusM, verification{ status, notes } }
ChecklistItem { id, order, text{lang}, spokenText{lang} }
```

**Rota id kuralı:** `<ülke>-<bölge>-<nn>` (ör. `tr-karadeniz-01`, `tr-ic-anadolu-01`). Bölge adları: marmara, ege, akdeniz,
ic-anadolu, karadeniz, dogu-anadolu, guneydogu-anadolu. Tehlike ve fotoğraf noktaları rotalara bu id ile bağlanır; id'ler değiştirilmez.

**Veri dosyaları:** `data/routes.json`, `data/photo-spots.json`, `data/hazards.schema.json` (tehlike verisi henüz yok; uydurma veri eklenmez,
örnek veri `isSample: true` ile işaretlenir). Tüm rota ve fotoğraf noktası kayıtları şu an **doğrulanmalı** durumundadır.

## Teknik notlar

- Harita: OpenStreetMap tabanlı (ör. Leaflet / MapLibre) — global erişim ve lisans açısından uygun.
- Yakındaki noktalar: OSM verisi (Overpass API: `amenity=fuel`, `shop=supermarket`, `shop=convenience`, `shop=motorcycle`) — `prototype/hazards.js`. Genel Overpass sunucusunun kullanım sınırı var; önbellek/seyreltme gerekir ve OSM (ODbL) atıfı gösterilmelidir.
- Sesli asistan: tarayıcıda Web Speech API (`speechSynthesis` + `SpeechRecognition`), mobilde platform TTS/STT.
- Çeviriler: tüm metinler `{dil: metin}` şeklinde tutulur; varsayılan dil cihaz dilinden seçilir, İngilizce yedek dildir.
