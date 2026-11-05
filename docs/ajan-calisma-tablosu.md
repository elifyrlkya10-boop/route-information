# Ajan Çalışma Tablosu

Bu dosya `scripts/ajan_sure_tablosu.py` ile `logs/ajan-calismalari.csv` kayıtlarından otomatik üretilir; elle düzenlemeyin.
Süreler, her ajanın kendi çalışma süresidir (ajanlar paralel çalıştığı için toplam, gerçek geçen süreden uzundur). Saatler Türkiye saatidir.

## Haftalık

### 45. hafta: 2 Kasım – 8 Kasım 2026

| Ajan | Çalışma sayısı | Toplam süre (dk) | Ortalama (dk) | En uzun (dk) | Token |
|---|---:|---:|---:|---:|---:|
| rota-uzmani | 9 | 49.5 | 5.5 | 17.7 | 1.137.283 |
| ekipman-asistani | 5 | 9.2 | 1.8 | 2.8 | 439.865 |
| guvenlik-ve-yakin-cevre | 7 | 14.9 | 2.1 | 3.8 | 694.531 |
| fotograf-noktalari | 7 | 27.1 | 3.9 | 12.1 | 778.863 |
| hava-durumu | 5 | 17.0 | 3.4 | 5.4 | 497.427 |
| **Toplam** | **33** | **117.7** | | | **3.547.969** |

### 44. hafta: 26 Ekim – 1 Kasım 2026

| Ajan | Çalışma sayısı | Toplam süre (dk) | Ortalama (dk) | En uzun (dk) | Token |
|---|---:|---:|---:|---:|---:|
| rota-uzmani | 1 | 4.8 | 4.8 | 4.8 | 75.446 |
| ekipman-asistani | 1 | 1.6 | 1.6 | 1.6 | 59.106 |
| guvenlik-ve-yakin-cevre | 1 | 2.0 | 2.0 | 2.0 | 61.978 |
| fotograf-noktalari | 1 | 1.5 | 1.5 | 1.5 | 54.546 |
| hava-durumu | 0 | 0.0 | – | – | 0 |
| **Toplam** | **4** | **10.0** | | | **251.076** |

## Aylık

### Kasım 2026

| Ajan | Çalışma sayısı | Toplam süre (dk) | Ortalama (dk) | En uzun (dk) | Token |
|---|---:|---:|---:|---:|---:|
| rota-uzmani | 10 | 54.3 | 5.4 | 17.7 | 1.212.729 |
| ekipman-asistani | 6 | 10.8 | 1.8 | 2.8 | 498.971 |
| guvenlik-ve-yakin-cevre | 8 | 16.9 | 2.1 | 3.8 | 756.509 |
| fotograf-noktalari | 8 | 28.7 | 3.6 | 12.1 | 833.409 |
| hava-durumu | 5 | 17.0 | 3.4 | 5.4 | 497.427 |
| **Toplam** | **37** | **127.7** | | | **3.799.045** |

## Tüm çalışmalar

| Tarih | Başlangıç | Bitiş | Ajan | Süre (dk) | Durum | İş |
|---|---|---|---|---:|---|---|
| 2026-11-06 | 02:20:02 | 02:20:49 | fotograf-noktalari | 0.8 | tamamlandi | Fotoğraf bildirimi ortak eskime kontrolüne bağlandı |
| 2026-11-06 | 02:18:20 | 02:19:56 | guvenlik-ve-yakin-cevre | 1.6 | tamamlandi | Ortak eskime kontrolü sameGeometryRevision (hazards.js) |
| 2026-11-06 | 02:17:55 | 02:19:56 | hava-durumu | 2.0 | tamamlandi | Yan/karşı rüzgâr bilgi alanları (sürüş seviyesi değişmedi) |
| 2026-11-06 | 02:15:24 | 02:17:01 | rota-uzmani | 1.6 | tamamlandi | Haritada erişilmeyen fotoğraf noktasının ayrı gösterimi |
| 2026-11-05 | 02:46:34 | 02:47:13 | rota-uzmani | 0.7 | tamamlandi | Aşama 3: diğer ajanların notlarına cevap (dosya değişmedi) |
| 2026-11-05 | 02:33:18 | 02:45:23 | fotograf-noktalari | 12.1 | tamamlandi | Karar 2A/6A: approachPoint gerçek kavşaklara, detourRoadKm, geometryRevision kopyası |
| 2026-11-05 | 02:32:39 | 02:36:28 | guvenlik-ve-yakin-cevre | 3.8 | tamamlandi | Karar 7B/8A: tehlike şemasına source/verification/extent, temkinli okuma |
| 2026-11-05 | 02:32:35 | 02:37:56 | hava-durumu | 5.4 | tamamlandi | Yön testleri yeni geometriye uyarlandı, karar 11B ticari kullanım araştırması |
| 2026-11-05 | 02:17:28 | 02:31:41 | rota-uzmani | 14.2 | tamamlandi | Karar 1A/4A/5A: Nemrut güney yaklaşımı, Bozdağ düzeltmesi, geometryRevision |
| 2026-11-04 | 02:43:42 | 02:45:17 | rota-uzmani | 1.6 | tamamlandi | Aşama 3: yön oranları, Nemrut toprak kesim tablosu, geometryRevision tanımı (dosya değişmedi) |
| 2026-11-04 | 02:43:10 | 02:43:30 | guvenlik-ve-yakin-cevre | 0.3 | tamamlandi | Aşama 3: hata metni önerisine cevap (dosya değişmedi) |
| 2026-11-04 | 02:39:14 | 02:42:36 | fotograf-noktalari | 3.4 | tamamlandi | Fotoğraf bildirimi: ortak routeLine, ince sarmalayıcı, toPhotoAnnouncement |
| 2026-11-04 | 02:35:20 | 02:38:10 | hava-durumu | 2.8 | tamamlandi | Ortak yön yardımcısı routeBearings (prototype/route-geometry.js) |
| 2026-11-04 | 02:35:05 | 02:38:10 | guvenlik-ve-yakin-cevre | 3.1 | tamamlandi | Tehlike modülü: routeLine.scale, includeSkipped, lookAheadOf |
| 2026-11-04 | 02:16:09 | 02:33:50 | rota-uzmani | 17.7 | tamamlandi | Nemrut ve Bozdağ güzergâh kontrolü (yalnızca notlar, geometri değişmedi) |
| 2026-11-04 | 02:15:27 | 02:17:50 | ekipman-asistani | 2.4 | tamamlandi | Kontrol listesi: adresteki ek parametresini güncel tutma |
| 2026-11-03 | 02:30:04 | 02:31:05 | rota-uzmani | 1.0 | tamamlandi | Aşama 3: yön penceresi önerisi, geometri sürümü önerisi (dosya değişmedi) |
| 2026-11-03 | 02:29:55 | 02:30:23 | ekipman-asistani | 0.5 | tamamlandi | Aşama 3: hava-durumu sorusuna cevap, adres parametresi önerisi (dosya değişmedi) |
| 2026-11-03 | 02:29:51 | 02:30:23 | guvenlik-ve-yakin-cevre | 0.5 | tamamlandi | Aşama 3: fotoğraf sorularına cevap, skipped/lookAheadOf önerisi (dosya değişmedi) |
| 2026-11-03 | 02:29:48 | 02:30:23 | fotograf-noktalari | 0.6 | tamamlandi | Aşama 3: tek rota çizgisi kuralı ve ölçek önerisi (dosya değişmedi) |
| 2026-11-03 | 02:25:01 | 02:27:52 | hava-durumu | 2.9 | tamamlandi | Hava modülü: pathFull, soğuk/sis koşulları, üç koşullu kontrol listesi bağlantısı |
| 2026-11-03 | 02:25:00 | 02:27:52 | guvenlik-ve-yakin-cevre | 2.9 | tamamlandi | Tehlike modülü: pathFull, filter/getLocation, ileride uyarısı, bildirim önceliği |
| 2026-11-03 | 02:24:46 | 02:28:33 | fotograf-noktalari | 3.8 | tamamlandi | Fotoğraf bildirimi modülü (approachPoint, tek bildirim, sapma bilgisi) |
| 2026-11-03 | 02:16:02 | 02:21:54 | rota-uzmani | 5.9 | tamamlandi | 6 rotaya sadeleştirilmemiş tam geometri (pathFull) |
| 2026-11-03 | 02:15:21 | 02:18:09 | ekipman-asistani | 2.8 | tamamlandi | Kontrol listesi: soğuk ve sis koşullu maddeleri |
| 2026-11-02 | 02:31:57 | 02:33:32 | rota-uzmani | 1.6 | tamamlandi | Aşama 3: rota sorularına cevap, harita testi kaynak veriden okuyor |
| 2026-11-02 | 02:31:38 | 02:32:21 | ekipman-asistani | 0.7 | tamamlandi | Aşama 3: ?ek=-yagmur ile kaldırma, hava-durumu sorularına cevap |
| 2026-11-02 | 02:31:33 | 02:32:21 | fotograf-noktalari | 0.8 | tamamlandi | Aşama 3: fotoğraf bildirimi için öneri (dosya değişmedi) |
| 2026-11-02 | 02:24:40 | 02:30:23 | fotograf-noktalari | 5.7 | tamamlandi | Fotoğraf noktalarına rota üzerinde bildirim noktası, Saklıkent konumu |
| 2026-11-02 | 02:24:36 | 02:28:31 | hava-durumu | 3.9 | tamamlandi | İlk hava modülü (Open-Meteo, sürüş değerlendirmesi, yağmurluk eşiği) |
| 2026-11-02 | 02:24:31 | 02:27:13 | guvenlik-ve-yakin-cevre | 2.7 | tamamlandi | Rota boyunca ileriye bakan tehlike sıralama, uyarı takibi |
| 2026-11-02 | 02:17:20 | 02:22:37 | rota-uzmani | 5.3 | tamamlandi | Leaflet harita prototipi (7 rota + fotoğraf noktaları) |
| 2026-11-02 | 02:16:55 | 02:19:45 | ekipman-asistani | 2.8 | tamamlandi | Kontrol listesi: koşullu yağmurluk maddesi, kimlik tabanlı kayıt |
| 2026-11-01 | 17:39:46 | 17:44:34 | rota-uzmani | 4.8 | tamamlandi | Türkiye 7 bölge rotaları |
| 2026-11-01 | 17:39:44 | 17:41:16 | fotograf-noktalari | 1.5 | tamamlandi | 7 rotaya 12 fotoğraf noktası |
| 2026-11-01 | 17:39:44 | 17:41:22 | ekipman-asistani | 1.6 | tamamlandi | Kontrol listesi: kayıt, ses uyarısı, büyük butonlar |
| 2026-11-01 | 17:39:38 | 17:41:38 | guvenlik-ve-yakin-cevre | 2.0 | tamamlandi | Tehlike şeması ve Overpass sorgusu |
