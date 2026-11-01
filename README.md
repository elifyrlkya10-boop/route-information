# route-information

Herkesin erişebildiği, global bir **motorcu rota uygulaması** 🏍️🌍
*A global route app for motorcyclists — scenic mountain routes, gear checklist, hazard warnings, nearby services and photo spots.*

## Özellikler / Features

1. **Haritayla uyumlu doğru rotalar** — Türkiye'nin 7 bölgesinden, ardından Yunanistan, İspanya ve Brezilya'dan bol manzaralı dağ rotaları. Her ülkenin kendi dili + İngilizce.
2. **Ekipman kontrol listesi** — telsiz, bot, ceket, kask, dizlik/kolluk, motor kontrolü (fren, gaz, ayna). Küçük bir **sesli asistan** olarak.
3. **Neden bu uygulama?**
   - Tehlike uyarıları: taşlı yol, yol çalışması, dik eğim *(ihtiyaç)*
   - Yakındaki benzinlik, market ve ekipman dükkanlarını sormadan sıralar *(ihtiyaç)*
   - Kapalı rotaları paylaşan kullanıcıları bir araya getirir *(keyif)*
4. **Fotoğraf noktaları** — "böyle yerde fotoğraf olmasa olmaz" dedirten manzara noktaları.

Ayrıntılar: [docs/urun-dokumani.md](docs/urun-dokumani.md)

## Prototip

[`prototype/checklist.html`](prototype/checklist.html) — sesli ekipman kontrol listesi (TR / EN / EL / ES / PT).
Dosyayı Chrome'da açın, **Sesli başlat**'a basın; asistan her maddeyi okur, "tamam" deyin veya butona basın.

## Ajanlar / Agents

Her başlığın kendi Claude Code ajanı var (`.claude/agents/`):

| Başlık | Ajan |
|--------|------|
| Haritayla uyumlu doğru rota | `rota-uzmani` |
| Ekipman kontrol listesi | `ekipman-asistani` |
| Neden bu uygulama? (tehlike, yakın çevre, topluluk) | `guvenlik-ve-yakin-cevre` |
| Fotoğraf çekilmesi gereken noktalar | `fotograf-noktalari` |
