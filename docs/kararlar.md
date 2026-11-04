# Kararlar

Son güncelleme: 4 Kasım 2026.

## Verilen kararlar (kullanıcı, 4 Kasım 2026)

Kullanıcının cevabı: "11 hariç hepsini önerdiklerin olsun". Buna göre:

| # | Konu | Karar |
|---|---|---|
| 1 | Nemrut güzergâhı | **A** — güney (Karadut, ziyaretçi merkezi) yaklaşımına taşınacak |
| 2 | Nemrut Ziyaretçi Merkezi noktası | **A** — 1A ile rota üzerine gelir; gelmezse "bu rotadan erişilmiyor" işaretlenir |
| 3 | Saklıkent bitişi | **B** — olduğu gibi kalır |
| 4 | Bozdağ geri dönüşü | **A** — düzeltilecek (ara nokta gerçek kavşağa) |
| 5 | `geometryRevision` | **A** — eklenecek |
| 6 | `detourRoadKm` | **A** — eklenecek; sesli bildirim yol mesafesini söyleyecek |
| 7 | Tehlike `source`/`verification`/`extent` | **B** — eklenecek; ilk kayıtlar toprak kesimler (bkz. not) |
| 8 | Doğrulanmamış tehlikeler | **A** — temkinli metinle okunur ("olası taşlı yol") |
| 9 | Kapı/erişim türü | **B** — açılmaz; rota notunda kalır |
| 10 | Hava eşikleri | **A** — şimdilik kabul; deneme sürüşlerinden sonra gözden geçirilecek |
| 11 | Ticari kullanım | **B** — ücretli plan / kendi sunucu seçenekleri bir gece işi olarak araştırılacak |

Not (7B ile 1A birlikte): Nemrut rotası güneye taşınınca kuzeydeki iki toprak kesim artık rota üzerinde olmayacak. İlk tehlike kayıtları,
yeni güzergâhın OSM yüzey etiketlerine göre çıkarılacak; hepsi `verification.status: doğrulanmalı` olacak.

Uygulama sırası (aynı dosyaya iki ajan yazmayacak):
- 5 Kasım gecesi, Aşama 1: rota-uzmani 1A + 4A + 5A (rota geometrisi ve `geometryRevision`).
- 5 Kasım gecesi, Aşama 2 (rota-uzmani bittikten sonra): fotograf-noktalari 2A + 6A ve `approachPoint` yeniden hesabı;
  guvenlik-ve-yakin-cevre 7B + 8A; hava-durumu 11B araştırması.
- Değişiklik notu (koordinatör, 5 Kasım): ilk planda fotoğraf ve güvenlik işleri bir sonraki geceye bırakılmıştı. Ancak rota
  geometrisi değişince fotoğraf testleri (`approachPoint` çizgiye < 5 m) yeniden hesap yapılmadan kırmızı kalır ve commit edilemez.
  Bu yüzden ikisi aynı gecenin Aşama 2'sine alındı; sıralı çalıştıkları için aynı dosyaya aynı anda yazılmıyor.

---

## Karar sırasında sunulan seçenekler

Ajanlar bu kararlar verilene kadar ilgili verilere dokunmadı.

**Nasıl cevaplanır:** Sohbete yalnızca numara ve harfi yazmanız yeterli, örneğin `1A 2A 3B 4A 5A 6A 7B 8A 9A 10A 11A`.
Her karar için önerim **(önerilen)** diye işaretli. "Hepsi önerilen gibi" yazarsanız önerilenlerin hepsi uygulanır.

---

## Rotalar

**1. Nemrut güzergâhı.** Rota "klasik güzergâh" diye kayıtlı, ama aslında zirveye kuzeydeki toprak yoldan çıkıyor (Sincik–Büyüköz). Ziyaretçi merkezi rotanın üzerinde değil.
- **A** — Güney (Karadut, ziyaretçi merkezi) yaklaşımına taşınsın. Ziyaretçilerin bilinen yolu bu. **(önerilen)**
- **B** — Rota olduğu gibi kalsın, yalnızca adı ve notu düzeltilsin.

**2. Nemrut Ziyaretçi Merkezi fotoğraf noktası.** Şu an "rotadan 1,8 km sapma" diye okunuyor, ama rotadan oraya doğrudan yol yok.
- **A** — 1A seçilirse sorun kendiliğinden kalkar. 1B seçilirse nokta "bu rotadan erişilmiyor" diye işaretlenip bildirimden çıkarılsın. **(önerilen)**
- **B** — Nokta bu rotadan tamamen silinsin.

**3. Saklıkent bitişi.** Rota bitişi bir mahalle noktası; kayak merkezi yaklaşık 0,5 km ötede.
- **A** — Bitiş kayak merkezine taşınsın.
- **B** — Olduğu gibi kalsın; bildirim zaten çalışıyor. **(önerilen: fark küçük, yeniden hesaplama zinciri büyük)**

**4. Bozdağ'daki hatalı geri dönüş.** Rota çizgisinde 0,27 km'lik gereksiz bir gidip-dönme var.
- **A** — Düzeltilsin. Ara nokta gerçek kavşağa alınır. **(önerilen)**
- **B** — Kalsın.

## Veri alanları

**5. `geometryRevision`.** Rota çizgisi değişince fotoğraf noktaları gibi bağlı verilerin eskidiğini otomatik fark etmek için.
- **A** — Eklensin. **(önerilen: 1A ve 4A ile rota değişikliği geleceği için)**
- **B** — Şimdilik gerek yok.

**6. `detourRoadKm`.** Fotoğraf noktasına sapmanın gerçek yol mesafesi. Örneğin Bozdağ kayak merkezi kuş uçuşu 3,3 km, yolla 9,4 km.
- **A** — Eklensin; sesli bildirim yol mesafesini söylesin. **(önerilen)**
- **B** — Kuş uçuşu mesafe yeterli.

**7. Tehlike kayıtlarına kaynak, doğrulama ve kesim alanları** (`source`, `verification`, `extent`). Örneğin "OSM'ye göre km 55–57 arası toprak yol, sahada doğrulanmadı" gibi kayıtlar tutabilmek için.
- **A** — Eklensin.
- **B** — Eklensin; ilk kayıtlar olarak Nemrut'taki iki toprak kesim girilsin. **(önerilen)**
- **C** — Şimdilik eklenmesin; yalnızca sahada doğrulanmış tehlikeler girilsin.

## Uyarı kuralları

**8. Doğrulanmamış tehlikeler** (OSM'den gelen, sahada teyit edilmemiş) sürücüye okunsun mu?
- **A** — Temkinli metinle okunsun ("olası taşlı yol"). **(önerilen: gereksiz uyarı, eksik uyarıdan daha az zararlı)**
- **B** — Hiç okunmasın; yalnızca haritada görünsün.

**9. Kapı ve erişim kısıtı** (ör. Nemrut güney yolundaki bariyer) için yeni bir tehlike türü açılsın mı?
- **A** — Açılsın (`gate`).
- **B** — Açılmasın; bu bilgi rota notunda kalsın. **(önerilen: önce sahada doğrulanmalı)**

**10. Hava eşikleri.** Bunlar proje varsayımı, bir kaynağa dayanmıyor:
- rüzgâr: 40 km/sa'te dikkat, 60 km/sa'te önerilmez
- hamle: 50 km/sa'te dikkat, 75 km/sa'te önerilmez
- yağmurluk: yağış 0,2 mm/sa ya da yağış olasılığı %40
- soğuk: 5 °C ve altı
- sis: görüş 1000 m'nin altında
- yön değişken: R < 0,7

Seçenekler:
- **A** — Şimdilik kabul; deneme sürüşlerinden sonra gözden geçirilsin. **(önerilen)**
- **B** — Değiştirmek istiyorum (hangisini değiştirmek istediğinizi yazın).

## Yayın

**11. Ticari kullanım.** Open-Meteo'nun ücretsiz sürümü ve OSM'nin harita sunucusu ticari ya da yoğun kullanıma izin vermiyor.
- **A** — Şimdilik prototip; yayına çıkarken karar verilsin. **(önerilen)**
- **B** — Şimdiden ücretli plan ya da kendi sunucu seçeneklerinin araştırılması istensin (bir gece işi olarak).
