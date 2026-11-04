# Ticari kullanım: hava verisi ve harita karoları (karar 11B araştırması)

- Hazırlayan: hava-durumu ajanı, 2026-11-05 gece çalışması.
- Tüm kaynaklara bu çalışmada erişildi. Fiyatlar ve koşullar değişebilir; satın almadan önce sayfalar yeniden kontrol edilmeli.
- Bu belgede yalnızca kaynak sayfada gerçekten görülen rakamlar var. Bulunamayan bilgi "bulunamadı / doğrulanmalı" diye işaretlendi.

## Özet

| Konu | Bugünkü prototip | Ticari ürün için durum | Seçenekler |
|---|---|---|---|
| Hava verisi | Open-Meteo ücretsiz API (`api.open-meteo.com`) | Ücretsiz API **yalnızca ticari olmayan kullanım** içindir. Abonelik ya da reklam içeren uygulama ticari sayılır. | Open-Meteo ücretli API (`customer-api.open-meteo.com` + `apikey`) ya da kendi Open-Meteo sunucusu (AGPLv3) |
| Harita karoları | `tile.openstreetmap.org` (OSMF sunucusu) | Yasak değil ama garanti yok; ticari servislerde erişim "her an geri çekilebilir". **Çevrimdışı kullanım ve toplu indirme yasak.** | Ücretli sağlayıcı (MapTiler, Stadia Maps), ücretsiz topluluk sunucusu (OpenFreeMap) ya da kendi karo sunucusu (Protomaps PMTiles veya raster yığını) |

Ürün kararını etkileyen iki nokta:
1. Ürünün gelir modeli (abonelik veya reklam) Open-Meteo için kesin ölçüt. Abonelik ya da reklam varsa ücretli plan ya da kendi sunucu gerekiyor.
2. Motorcu rotada çevrimdışı harita isteyecekse `tile.openstreetmap.org` hiçbir koşulda kullanılamaz (politikada açık yasak). Sağlayıcı seçimi buna göre yapılmalı.

## 1. Open-Meteo

### 1.1 Ücretsiz API'nin koşulları

Kaynak: [Open-Meteo Terms](https://open-meteo.com/en/terms), [Pricing](https://open-meteo.com/en/pricing).

- **Ticari olmayan kullanım** örnekleri: "Private or non-profit websites or apps that do not have subscriptions or advertising", kişisel ev otomasyonu, kamu kurumunda açık araştırma, eğitim içeriği. Gönüllü bağış (tip jar) ticari sayılmıyor.
- **Ticari kullanım** örnekleri: "Websites or apps that have subscriptions or display advertisements", ticari ürün ve tanıtım faaliyetleri, ticari kuruluşta açıklanmayan araştırma.
- Ücretsiz sınırlar: dakikada 600, saatte 5.000, günde 10.000, ayda 300.000 çağrı. Sınırlar IP adresine ve uygulamaya göre uygulanıyor.
- Uyarı: Vercel, Netlify, Render gibi paylaşımlı barındırmalarda sınıra beklenenden önce takılınabileceği yazıyor.
- Kötüye kullanan uygulama ve IP'ler önceden haber verilmeden engellenebilir. Ücretsiz planda çalışma süresi garantisi yok.

### 1.2 Ücretli planlar

Kaynak: [Pricing](https://open-meteo.com/en/pricing). Sayfadaki fiyat tablosu Stripe bileşeniyle yükleniyor; sayfanın kendisinden tutar okunamadı.

| Plan | Aylık çağrı sınırı | Not |
|---|---|---|
| Free | 300.000 | Ticari değil |
| API Standard | 1M | Ticari; ayrılmış sunucular |
| API Professional | 5M | Ticari; tarihsel, iklim, ensemble API'leri bu plandan itibaren |
| API Enterprise | > 50M | Ticari; özel çözüm, öncelikli destek |

- Ücretli planlarda dakika/saat/gün sınırı yok, yalnız aylık sınır var. "Fixed monthly price — no per-call overages."
- %80, %90, %100 kullanımda e-posta uyarısı gönderiliyor.
- Çağrılar kesirli sayılıyor. Sayfadaki örnek: 15 değişkenle iki haftalık veri 1,5 çağrı sayılıyor.
- Ücretli planlarda %99,9 çalışma süresi hedefi var; durum sayfası status.open-meteo.com.
- Ticari kullanım için ayrı adres gerekiyor: `customer-api.open-meteo.com`, sorgu `apikey` parametresiyle. Sorgu sözdizimi ücretsiz API ile aynı.
- **Fiyatlar:** Open-Meteo'nun kendi blog yazısında ([API Subscriptions for Commercial Use](https://openmeteo.substack.com/p/api-subscriptions-for-commercial), 12 Haziran 2023): Standard "$29 per month" (1M çağrı), Professional "$99 per month" (5M çağrı).
  - Bu rakamlar 2023 tarihli. Güncel fiyat pricing sayfasında tarayıcıyla görülmeli, burada doğrulanamadı.
  - Para birimi yazıda yalnız "$" olarak geçiyor.

### 1.3 Atıf ve lisans

Kaynak: [Open-Meteo Licence](https://open-meteo.com/en/licence).

- API verisi CC BY 4.0. Uygun atıf, lisansa bağlantı ve değişiklik yapıldıysa bunun belirtilmesi gerekiyor.
- Verinin gösterildiği her yerin yanında bağlantı olmalı. Örnek metin: "Weather data by Open-Meteo.com" (https://open-meteo.com/ bağlantısıyla).
- Bu kural tüm planlarda geçerli; ücretli plan atıf yükümlülüğünü kaldırmıyor.
- Alt kaynakların lisansları farklı. Örneğin UK Met Office verisi CC BY-SA 4.0. NOAA, Météo-France, JMA gibi kaynakların kendi koşulları var.

### 1.4 Kendi Open-Meteo sunucusu

Kaynak: [open-meteo/open-meteo (GitHub)](https://github.com/open-meteo/open-meteo), [Pricing](https://open-meteo.com/en/pricing).

- Kod AGPLv3. API'yi değiştirip ağ üzerinden sunarsak değiştirilmiş kaynak kodu kullanıcılara açmamız gerekir. Değiştirmeden çalıştırmak bu yükü azaltır; hukuki görüş alınmalı.
- Kurulum: Docker ya da Ubuntu 22.04 için hazır paket. Belgeler depoda: `docs/getting-started.md`, `docs/downloading-datasets.md`, `docs/sync-command.md`.
- Veri: kendi sunucumuz Open-Meteo'nun açık veritabanına uzaktan erişip istenen veriyi yerelde önbelleğe alabiliyor. Bu veritabanı AWS Open Data Sponsorship Program ile paylaşılıyor.
- Open-Meteo günde 5 TB'tan fazla veri işliyor. Tüm modelleri kendimiz indirmek büyük iş; yalnız Türkiye / Avrupa modelleri yeterli olabilir, doğrulanmalı.
- Pricing sayfası milyarlarca çağrı düzeyinde kendi sunucuyu "the practical path" olarak öneriyor.
- Sunucu maliyeti ve gereken donanım için kaynakta rakam bulunamadı.

### 1.5 Bizim kullanımımız için not

- `prototype/weather.js` her rota için tek istekte 6 örnek nokta soruyor (çoklu konum).
- Çoklu konumlu isteğin kaç çağrı sayıldığı Open-Meteo sayfalarında bu çalışmada bulunamadı. Muhtemelen konum başına sayılıyor; doğrulanmalı.
- Ücretli plana geçişte yapılacaklar: `OPEN_METEO_ENDPOINT` ayarlanabilir olmalı. API anahtarı istemcide değil, kendi sunucumuzda (vekil sunucu) tutulmalı.
- Kendi sunucumuzda önbellek tutmak (aynı rota + aynı saat → tek istek) çağrı sayısını belirgin azaltır.

## 2. Harita karoları

### 2.1 OSMF karo sunucusu (`tile.openstreetmap.org`)

Kaynak: [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

- OSM verisi serbest, ama karo sunucuları bağış ve sponsorlukla dönüyor ve kapasitesi sınırlı. Hizmet "best-effort", SLA yok.
- İzin verilen: etkileşimli harita görüntüleme. Yalnız görünen alanın karoları ve makul ölçüde ön yükleme. Sunucu başlıklarına uyan yerel önbellek.
- Yasak:
  - Toplu indirme ve ön doldurma (pre-seeding, karo arşivi oluşturma).
  - **Çevrimdışı kullanım:** "Offline use is not permitted on tile.openstreetmap.org."
  - "Çevrimdışı için indir" düğmeleri ve arka planda karo çekme.
  - Genel ya da sahte User-Agent, silinmiş Referer, varsayılan olarak no-cache göndermek, HTTP kullanmak.
- Zorunlu:
  - Görünür atıf (genelde sağ alt).
  - Uygulamayı adlandıran sabit bir User-Agent. Kütüphane varsayılanı kabul edilmiyor.
  - Web'de doğru Referer.
  - Cache-Control / Expires / ETag başlıklarına uymak. Başlık okunamıyorsa karoyu en az 7 gün saklamak.
- Ticari ve mobil uygulamalar yasaklı değil; aynı kurallar geçerli. Ama ticari servislerde erişim "may be withdrawn at any point".
- Politikada sayısal istek sınırı yok.

Sonuç: Prototip için uygun (`prototype/map.html` atfı gösteriyor). Ticari ve çevrimdışı ihtiyaçlı bir motorcu uygulaması için uygun değil.

### 2.2 Ücretli karo sağlayıcıları

**MapTiler Cloud** — [Pricing](https://www.maptiler.com/cloud/pricing/). Fiyatlar USD, KDV hariç.

| Plan | Fiyat | Oturum / ay | API isteği / ay |
|---|---|---|---|
| Free | $0 | 5k | 100k |
| Flex | $30 / ay | 25k | 500k |
| Custom | Sayfada yok (ön ödemeli hacim sözleşmesi) | — | — |

- Free plan: "Suitable for testing, PoC, prototyping, personal, or non-commercial use."
- Flex aşım ücretleri: oturum $2,50 / 1k, API isteği $0,15 / 1k.
- Oturum tanımı: "a webpage or mobile-app load which contains a map initialization".
- Çevrimdışı ve önbellek kuralları sayfada yok; doğrulanmalı.

**Stadia Maps** — [Pricing](https://stadiamaps.com/pricing/). Para birimi "$"; yıllık fiyat yok.

| Plan | Fiyat | Kredi / ay | Aşım | Ticari |
|---|---|---|---|---|
| Free | $0 | 200.000 | Yok | Hayır |
| Starter | $20 / ay | 1.000.000 | 1.000 kredi başına 3¢ | Evet |
| Standard | $80 / ay | 7.500.000 | 1.000 kredi başına 2¢ | Evet |
| Professional | $250 / ay | 25.000.000 | 1.000 kredi başına 1,5¢ | Evet |

- Standart vektör ya da raster karo 1 kredi. Uydu karosu 4 kredi.
- Mobil ve çevrimdışı kullanım koşulları sayfada yok; doğrulanmalı.

### 2.3 Ücretsiz topluluk sunucusu: OpenFreeMap

Kaynak: [openfreemap.org](https://openfreemap.org/).

- Herkese açık sunucu ücretsiz. "There are no limits on the number of map views or requests."
- Ticari kullanım: SSS'de "Yes". Kayıt, API anahtarı ya da çerez yok.
- SLA yok: "I don't offer SLA guarantees or personalized support."
- Atıf zorunlu: OpenFreeMap, OpenMapTiles ve OpenStreetMap. MapLibre atfı kendisi ekliyor.
- Çevrimdışı indirme sınırlı: en fazla 3.000 karo ya da 50 MB, en fazla 4 paralel istek, kendine özgü User-Agent. Daha fazlası için iletişim gerekiyor.
- Kendi sunucuda da çalıştırılabiliyor.

### 2.4 Kendi karo sunucusu

**Protomaps / PMTiles (vektör, statik dosya)** — [Docs](https://docs.protomaps.com/), [Basemap downloads](https://docs.protomaps.com/basemaps/downloads).

- Altlık harita tek bir PMTiles arşivi. İstemci bu dosyayı HTTP range istekleriyle okuyor. AWS, Cloudflare, Google Cloud, Azure ve genel sunucu için kurulum rehberleri var.
- Dünya dosyası "roughly 120 gigabytes", zoom 0–15. Günlük derleme kanalı var.
- `pmtiles extract` ile bölge kesiti alınabiliyor. Her ek zoom seviyesi boyutu kabaca ikiye katlıyor.
- Lisans: altlık "Open Database License Produced Work (OpenStreetMap attribution required)". Yazılım BSD ve ODbL.
- Doğrudan bağlantı (hotlink) önerilmiyor; dosya kendi depolamamıza kopyalanmalı.
- Avantaj: aynı dosya çevrimdışı paket olarak da kullanılabilir.
- Türkiye kesitinin boyutu ve depolama/CDN maliyeti bu çalışmada ölçülmedi. Docs'ta bir maliyet hesaplayıcı bağlantısı var.

**Raster yığını (mod_tile + Mapnik + PostgreSQL/osm2pgsql)** — [switch2osm: Serving tiles](https://switch2osm.org/serving-tiles/).

- Kurulum: Debian / Ubuntu üzerine yerel kurulum ya da Docker.
- Donanım: şehir veya küçük bölge için "10-20GB of storage, 4GB of memory, and a modern dual-core processor". Tüm dünya için "1TB of fast storage, 24GB of memory, and a quad-core processor".
- Bölge kesitiyle başlanması öneriliyor (ör. Geofabrik).
- İşletme yükü (veri güncelleme, izleme) Protomaps'e göre daha fazla.

## 3. Öneri

Karar kullanıcının; aşağıdakiler hava-durumu ajanının önerisi.

1. **Hava (kısa vadede):** Ürün abonelik ya da reklamla çıkacaksa Open-Meteo API Standard ile başlansın.
   - Anahtar kendi vekil sunucumuzda tutulsun, rota+saat önbelleği eklensin.
   - Önce güncel fiyat ve çoklu konum çağrı sayımı Open-Meteo'dan doğrulansın.
   - Kendi Open-Meteo sunucusu ancak çağrı sayısı plan sınırlarını aşarsa düşünülsün (AGPLv3 ve işletme yükü var).
2. **Harita:** Çevrimdışı gereksinimi belirleyici.
   - Çevrimdışı gerekirse: Protomaps PMTiles ile kendi barındırmamız (Türkiye kesiti) en esnek seçenek.
   - Çevrimdışı gerekmezse: OpenFreeMap (ücretsiz ama SLA yok) ya da SLA'lı ücretli sağlayıcı (Stadia Starter / MapTiler Flex) seçilebilir.
   - Her durumda `tile.openstreetmap.org` ürüne geçmeden bırakılmalı.
3. **Açık sorular (kullanıcı):** Gelir modeli (abonelik / reklam / ücretsiz)? Çevrimdışı harita gerekli mi? Beklenen aylık kullanıcı ve rota sorgusu sayısı?
