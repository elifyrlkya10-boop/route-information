# Kararlar

Son güncelleme: 4 Kasım 2026.

## Verilen kararlar (kullanıcı, 4 Kasım 2026)

Kullanıcının cevabı: "11 hariç hepsini önerdiklerin olsun". Buna göre:

| # | Konu | Karar |
|---|---|---|
| 1 | Nemrut güzergâhı | **A** — güney (Karadut, ziyaretçi merkezi) yaklaşımına taşınacak — **uygulandı (2026-11-05)** |
| 2 | Nemrut Ziyaretçi Merkezi noktası | **A** — 1A ile rota üzerine gelir; gelmezse "bu rotadan erişilmiyor" işaretlenir — **uygulandı (2026-11-05)**: merkez rota üzerinde |
| 3 | Saklıkent bitişi | **B** — olduğu gibi kalır |
| 4 | Bozdağ geri dönüşü | **A** — düzeltilecek (ara nokta gerçek kavşağa) — **uygulandı (2026-11-05)** |
| 5 | `geometryRevision` | **A** — eklenecek — **uygulandı (2026-11-05)** |
| 6 | `detourRoadKm` | **A** — eklenecek; sesli bildirim yol mesafesini söyleyecek — **uygulandı (2026-11-05)** |
| 7 | Tehlike `source`/`verification`/`extent` | **B** — eklenecek; ilk kayıtlar toprak kesimler (bkz. not) — **uygulandı (2026-11-05)**: alanlar eklendi; yeni güzergâhta toprak etiketli kesim olmadığı için kayıt yok |
| 8 | Doğrulanmamış tehlikeler | **A** — temkinli metinle okunur ("olası taşlı yol") — **uygulandı (2026-11-05)** |
| 9 | Kapı/erişim türü | **B** — açılmaz; rota notunda kalır |
| 10 | Hava eşikleri | **A** — şimdilik kabul; deneme sürüşlerinden sonra gözden geçirilecek |
| 11 | Ticari kullanım | **B** — ücretli plan / kendi sunucu seçenekleri bir gece işi olarak araştırılacak — **uygulandı (2026-11-05)**: [docs/arastirma/ticari-kullanim.md](arastirma/ticari-kullanim.md) |

Not (7B ile 1A birlikte): Nemrut rotası güneye taşınınca kuzeydeki iki toprak kesim artık rota üzerinde olmayacak. İlk tehlike kayıtları,
yeni güzergâhın OSM yüzey etiketlerine göre çıkarılacak; hepsi `verification.status: doğrulanmalı` olacak.

Uygulama sırası (aynı dosyaya iki ajan yazmayacak):
- 5 Kasım gecesi, Aşama 1: rota-uzmani 1A + 4A + 5A (rota geometrisi ve `geometryRevision`).
- 5 Kasım gecesi, Aşama 2 (rota-uzmani bittikten sonra): fotograf-noktalari 2A + 6A ve `approachPoint` yeniden hesabı;
  guvenlik-ve-yakin-cevre 7B + 8A; hava-durumu 11B araştırması.
- Değişiklik notu (koordinatör, 5 Kasım): ilk planda fotoğraf ve güvenlik işleri bir sonraki geceye bırakılmıştı. Ancak rota
  geometrisi değişince fotoğraf testleri (`approachPoint` çizgiye < 5 m) yeniden hesap yapılmadan kırmızı kalır ve commit edilemez.
  Bu yüzden ikisi aynı gecenin Aşama 2'sine alındı; sıralı çalıştıkları için aynı dosyaya aynı anda yazılmıyor.

## Yeni kararlar (5 Kasım 2026 gecesinden itibaren çıktı, cevap bekliyor)

Cevap: sohbete `12A 13A ...` yazın ya da "hepsi önerilen gibi".

**12. Cendere Köprüsü fotoğraf noktası.** Nemrut güneye taşınınca köprü rotadan çıktı: yolla tek yön 16,7 km sapma (gidiş-dönüş ~33 km, rota 43 km).
- **A** — "bu rotadan erişilmiyor" kalsın (şu anki durum); haritada durur, sesli bildirilmez. **(önerilen)**
- **B** — Uzun sapma olarak bildirilsin (km 2,8'de "yolla 16,7 km sapma").

**13. Tekir Yaylası fotoğraf noktası.** Nokta en yakın yoldan 217 m uzakta, bu yüzden yol mesafesi hesaplanamadı.
- **A** — Gerçek bir otopark/yol noktasına (OSM'den) taşınsın. **(önerilen)**
- **B** — Olduğu gibi kalsın.

**14. Tehlike kayıtlarında `source` ve `verification` zorunlu olsun mu?** (şu an yalnızca testle zorunlu, şemada değil)
- **A** — Şemada da zorunlu olsun. **(önerilen)**
- **B** — İsteğe bağlı kalsın.

**15. `verification` alanı olmayan tehlike kaydı nasıl okunsun?**
- **A** — Doğrulanmamış sayılsın, temkinli okunsun ("olası …"). **(önerilen)**
- **B** — Kesin dille okunsun (şu anki durum).

**16. Ticari kullanım için üç soru** (araştırma bunlara göre öneri yapıyor):
- Gelir modeli: abonelik / reklam / ücretsiz?
- Çevrimdışı harita gerekli mi?
- Beklenen aylık kullanıcı sayısı?
(Bu sorunun harfli seçeneği yok; kısaca yazmanız yeterli.)

**17. Nemrut'ta Cendere varyantı.** Karar 1A ile rota Narince–Karadut'tan gidiyor. Alternatif: Kâhta → Cendere Köprüsü → Eski Kâhta (Arsameia) → ziyaretçi merkezi (~39 km); Cendere ve Arsameia rotaya girer ama Karadut'tan geçilmez.
- **A** — Şu anki Karadut güzergâhı kalsın. **(önerilen: karar 1A böyleydi; değişiklik bağlı verilerin yeniden hesaplanmasını gerektirir)**
- **B** — Cendere varyantına geçilsin (bu durumda 12 kendiliğinden çözülür).

**18. Yan rüzgâr uyarısı** (6 Kasım gecesi eklendi; hava-durumu'nun önerisi, proje varsayımı). Yan ve karşı rüzgâr artık hesaplanıyor ama yalnızca bilgi olarak duruyor; sürüş değerlendirmesini etkilemiyor.
- **A** — Yan rüzgâr ≥ 30 km/sa ya da hamlenin yan bileşeni ≥ 45 km/sa ise "dikkat" verilsin ve sesli uyarıda söylensin ("28. km'de sağdan yan rüzgâr, 32 km/sa"). Deneme sürüşlerinden sonra gözden geçirilsin. **(önerilen)**
- **B** — Yalnızca bilgi olarak kalsın; uyarı olmasın.

**19. Yunanca, İspanyolca ve Portekizce metinler** (7 Kasım gecesi eklendi; 9 Kasım'da İspanyolca, 10 Kasım'da Portekizce de eklendi). Yunanistan (`gr-thessalia-01`, Pelion), İspanya (`es-andalucia-01`, Sierra de Grazalema) ve Brezilya (`br-santa-catarina-01`, Serra do Rio do Rastro) rotalarının metinlerini ajanlar yazdı.
- **A** — Yunanca, İspanyolca ve Portekizce metinler ana dili o dil olan biri tarafından kontrol edilene kadar "doğrulanmalı" sayılsın; hava uyarılarına el/es/pt bu kontrolden sonra eklensin. **(önerilen)**
- **B** — Ajanların metinleri şimdilik yeterli; hava uyarılarına da el/es/pt eklensin.

**20. Ülke ve yer adları Türkçe arayüzde.** Şu an Türkçe arayüzde "Greece", "Βόλος (Volos)" görünüyor.
- **A** — Ülke ve bölge adlarına `tr` eklensin ("Yunanistan", "Teselya", "İspanya", "Endülüs", "Brezilya"; "Santa Catarina" aynı kalır); başlangıç/bitiş adları çok dilli (`name{lang}`) olsun. **(önerilen)**
- **B** — Olduğu gibi kalsın (İngilizceye düşme yeterli).

**21. Kısa rotalarda harita çizgisi** (11 Kasım gecesi eklendi; rota-uzmani'nın sorusu). Kemaliye Taş Yol artık OSM yolunun kendisini izliyor (`pathFull`, 269 nokta). Haritada gösterilen sadeleştirilmiş çizgi (Douglas-Peucker 200 m) ise 4 noktaya indi ve kanyonda kaba görünüyor (gerçek yoldan en fazla ~190 m sapıyor). Uyarı ve hesaplar `pathFull` ile yapıldığı için yalnızca görünüm etkileniyor.
- **A** — Harita çizgisi için tolerans rota uzunluğuna göre küçülsün (ör. 15 km'den kısa rotalarda 50 m); diğer rotalar değişmesin. **(önerilen)**
- **B** — Bütün rotalarda aynı kural (200 m) kalsın.

**22. Kemaliye bitiş adı.** `end.name` hâlâ "…OSM yol parçasının sonu" diyor; gerçekte orası Taş Yol'un Kemaliye–Divriği yoluna katıldığı kavşak (OSM node 2795974769).
- **A** — "Kemaliyeliler Taş Yolu – Kemaliye–Divriği yolu kavşağı" olsun (karar 20 A seçilirse İngilizcesi "Stone Road – Kemaliye–Divriği road junction"). **(önerilen)**
- **B** — Olduğu gibi kalsın.

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
