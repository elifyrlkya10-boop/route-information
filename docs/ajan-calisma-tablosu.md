# Ajan Çalışma Tablosu

Bu dosya `scripts/ajan_sure_tablosu.py` ile `logs/ajan-calismalari.csv` kayıtlarından otomatik üretilir; elle düzenlemeyin.
Süreler, her ajanın kendi çalışma süresidir (ajanlar paralel çalıştığı için toplam, gerçek geçen süreden uzundur). Saatler Türkiye saatidir.

## Haftalık

### 45. hafta: 2 Kasım – 8 Kasım 2026

| Ajan | Çalışma sayısı | Toplam süre (dk) | Ortalama (dk) | En uzun (dk) | Token |
|---|---:|---:|---:|---:|---:|
| rota-uzmani | 6 | 33.0 | 5.5 | 17.7 | 666.095 |
| ekipman-asistani | 5 | 9.2 | 1.8 | 2.8 | 439.865 |
| guvenlik-ve-yakin-cevre | 5 | 9.5 | 1.9 | 3.1 | 490.871 |
| fotograf-noktalari | 5 | 14.2 | 2.8 | 5.7 | 510.552 |
| hava-durumu | 3 | 9.6 | 3.2 | 3.9 | 280.326 |
| **Toplam** | **24** | **75.6** | | | **2.387.709** |

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
| rota-uzmani | 7 | 37.8 | 5.4 | 17.7 | 741.541 |
| ekipman-asistani | 6 | 10.8 | 1.8 | 2.8 | 498.971 |
| guvenlik-ve-yakin-cevre | 6 | 11.5 | 1.9 | 3.1 | 552.849 |
| fotograf-noktalari | 6 | 15.8 | 2.6 | 5.7 | 565.098 |
| hava-durumu | 3 | 9.6 | 3.2 | 3.9 | 280.326 |
| **Toplam** | **28** | **85.5** | | | **2.638.785** |

## Tüm çalışmalar

| Tarih | Başlangıç | Bitiş | Ajan | Süre (dk) | Durum | İş |
|---|---|---|---|---:|---|---|
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
