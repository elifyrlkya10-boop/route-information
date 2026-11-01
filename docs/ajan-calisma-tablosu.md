# Ajan Çalışma Tablosu

Bu dosya `scripts/ajan_sure_tablosu.py` ile `logs/ajan-calismalari.csv` kayıtlarından otomatik üretilir; elle düzenlemeyin.
Süreler, her ajanın kendi çalışma süresidir (ajanlar paralel çalıştığı için toplam, gerçek geçen süreden uzundur). Saatler Türkiye saatidir.

## Haftalık

### 45. hafta: 2 Kasım – 8 Kasım 2026

| Ajan | Çalışma sayısı | Toplam süre (dk) | Ortalama (dk) | En uzun (dk) | Token |
|---|---:|---:|---:|---:|---:|
| rota-uzmani | 2 | 6.9 | 3.4 | 5.3 | 214.144 |
| ekipman-asistani | 2 | 3.5 | 1.8 | 2.8 | 164.602 |
| guvenlik-ve-yakin-cevre | 1 | 2.7 | 2.7 | 2.7 | 89.734 |
| fotograf-noktalari | 2 | 6.5 | 3.3 | 5.7 | 186.586 |
| hava-durumu | 1 | 3.9 | 3.9 | 3.9 | 94.439 |
| **Toplam** | **8** | **23.5** | | | **749.505** |

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
| rota-uzmani | 3 | 11.7 | 3.9 | 5.3 | 289.590 |
| ekipman-asistani | 3 | 5.2 | 1.7 | 2.8 | 223.708 |
| guvenlik-ve-yakin-cevre | 2 | 4.7 | 2.4 | 2.7 | 151.712 |
| fotograf-noktalari | 3 | 8.0 | 2.7 | 5.7 | 241.132 |
| hava-durumu | 1 | 3.9 | 3.9 | 3.9 | 94.439 |
| **Toplam** | **12** | **33.5** | | | **1.000.581** |

## Tüm çalışmalar

| Tarih | Başlangıç | Bitiş | Ajan | Süre (dk) | Durum | İş |
|---|---|---|---|---:|---|---|
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
