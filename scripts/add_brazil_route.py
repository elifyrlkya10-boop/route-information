#!/usr/bin/env python3
"""İlk Brezilya rotasını (br-santa-catarina-01, Serra do Rio do Rastro: Lauro Müller → SC-390 →
Serra do Rio do Rastro → Bom Jardim da Serra) üretir.

Güzergâh: Lauro Müller (SC) batı çıkışı, SC-390 "Rodovia Governador Irineu Bornhausen" (way 796667528,
node 7717974586) → Guatá (Rua Chapecó, SC-390 way 1568511307) → Serra do Rio do Rastro tırmanışı (SC-390 beton
kaplama, way 727758955 / 727758956 / 706539547) → zirvedeki mirante ve otoparklar → platoda SC-390 → Bom Jardim da
Serra girişi (way 418387767, SC-390 km 394 kilometre taşı node 11065394994).
Kaynaklar (erişim 2026-11-09): AutoPapo "Serra do Rio do Rastro: a história, a engenharia e o roteiro da estrada
mais sinuosa do Brasil" (Eduardo Passos, 2026-06-29: SC-390, ~24 km, 284 curvas, ~200 → 1.460 m, beton kaplama,
"peregrinação quase obrigatória de motociclistas", sis yolu dakikalar içinde kapatır, sınır 40 km/sa); Motonline
"Sul do Brasil: melhores estradas para andar de moto na região em 2025" (Marcelo Garcia, 2025-02-15: "A SC-390, que
liga Lauro Müller a Bom Jardim da Serra"); en.wikipedia "Serra do Rio do Rastro" (SC-390, en yüksek nokta 1.460 m,
kırağı sık, yüksek kesimlerde kar olabilir); OSM'de km 9,85'te "Monumento Biker 3" (Rota Biker, node 13332206664).

Yöntem (add_spain_route.py ile aynı): OSRM router.project-osrm.org (sürüş profili, overview=full, steps=true),
koordinatlar 5 ondalığa yuvarlanır, art arda yinelenen nokta atılır; lengthKm = OSRM mesafesi (1 ondalık);
path = pathFull üzerinde Douglas-Peucker, 200 m.

Pelion / Grazalema dersleri:
  * Başlangıç Lauro Müller yer düğümü (place=town node 415523991) olunca OSRM şehir içi sokaklardan (Rua Doutor
    Valdir Cotrim, Rua João Elpídio Araújo) geçip SC-390'a km 0,63'te çıkıyordu; ayrıca SC-390'ın Lauro Müller'deki
    tek yönlü kavşak adaları (way 617717602/617717603, 325495610, 420669395) ve Rodovia Flávio Righetto'daki tek
    yönlü halka (way 258593724/284556930) var. Başlangıç bu yüzden kavşak adasının ~210 m batısında, SC-390'ın iki
    yönlü kesimindeki node 7717974586 (way 796667528).
  * Bitiş Bom Jardim da Serra yer düğümü (place=village node 415523981) olunca OSRM SC-390'dan şehir sokaklarına
    (Rua Venâncio Borges de Carvalho, Rua Antão de Paula Velho, Rua Joaquim Ezírio) dönüyordu; SC-390 şehir içinde de
    tek yönlü çifte (way 1550143767 / 981085555) ayrılıyor. Bitiş şehir girişinde, SC-390'ın iki yönlü kesimindeki
    km 394 kilometre taşı (node 11065394994, way 418387767), şehir sokaklarına girmeden.
  * Ara nokta: zirvede SC-390 node 4188173756 (way 418387767 / 418390367 birleşimi, mirante otoparklarının ~300 m
    kuzeyi); OSRM'nin ileride başka bir yola kestirmesine karşı.
  * Gidip-dönme denetimi (add_spain_route.backtracks): aynı koordinata geri dönüş ve ≥400 m sonra ≤20 m yakına geri
    gelme. OSRM adımlarında "uturn" ve "roundabout"/"rotary" olmamalı.

Çalıştır:
  python3 scripts/add_brazil_route.py                 # yalnızca hesapla ve özetle (ağ gerekir)
  python3 scripts/add_brazil_route.py --steps         # OSRM adımlarını da yazdır
  python3 scripts/add_brazil_route.py --write         # data/routes.json'a ekle / güncelle
  python3 scripts/add_brazil_route.py --verify-others # HEAD'deki rotaların geometrisi değişmedi mi (ağ gerekmez)
Ardından: python3 scripts/geometry_revision.py --write --date <gün> && python3 scripts/build_map_data.py
"""
import argparse
import sys

from add_greece_route import upsert, verify_tr
from add_spain_route import backtracks, osrm_with_steps
from reroute_routes import DP_TOLERANCE_M, dedupe, douglas_peucker, line_m, max_dist_to_line, r5
from routes_json import dump_routes, load_routes

ROUTE_ID = "br-santa-catarina-01"

COUNTRY = {"code": "BR", "name": {"pt": "Brasil", "en": "Brazil"}, "languages": ["pt", "en"]}
REGION = {"id": "br-santa-catarina", "countryCode": "BR", "name": {"pt": "Santa Catarina", "en": "Santa Catarina"}}

# (lat, lon, açıklama) — OSM node'ları (2026-11-09 OSM API)
WAYPOINTS = [
    (-28.3916080, -49.4053386, "Lauro Müller, SC-390 way 796667528, node 7717974586 (başlangıç; kavşak adasının ~210 m batısı)"),
    (-28.3909037, -49.5515223, "Serra do Rio do Rastro zirvesi, SC-390 way 418387767/418390367, node 4188173756"),
    (-28.3402961, -49.6106804, "Bom Jardim da Serra girişi, SC-390 way 418387767, km 394 milestone node 11065394994 (bitiş)"),
]

TEXT = {
    "name": {"pt": "Serra do Rio do Rastro: Lauro Müller – Bom Jardim da Serra (SC-390)",
             "en": "Serra do Rio do Rastro: Lauro Müller – Bom Jardim da Serra (SC-390)"},
    "description": {
        "pt": "Estrada de serra pela SC-390, no sul de Santa Catarina. De Lauro Müller, a rodovia segue pelo vale "
              "e sobe a escarpa da Serra Geral em dezenas de curvas fechadas, num trecho pavimentado em concreto, "
              "até o mirante no alto da serra (cerca de 1.400 m), com vista para as curvas da estrada e, em dias "
              "claros, até o litoral. Depois continua pelo planalto, entre campos de altitude, até Bom Jardim da Serra.",
        "en": "A mountain road on the SC-390 in southern Santa Catarina. From Lauro Müller the highway follows the "
              "valley and climbs the Serra Geral escarpment in dozens of tight bends, on a concrete-paved section, "
              "to the viewpoint at the top of the range (about 1,400 m), overlooking the road's curves and, on clear "
              "days, the coast. It then continues across the highland grasslands to Bom Jardim da Serra.",
    },
    "bestSeason": {
        "pt": "Março–maio e setembro–novembro (no inverno, geada, gelo e às vezes neve no alto da serra; "
              "neblina pode fechar a estrada em qualquer época)",
        "en": "March–May and September–November (frost, ice and occasionally snow at the top in winter; "
              "fog can close the road at any time of year)",
    },
    "start_name": "Lauro Müller, SC-390",
    "end_name": "Bom Jardim da Serra, SC-390 (km 394)",
}
DIFFICULTY = "hard"

VERIFICATION_NOTES = (
    "2026-11-10 kontrolü (rota-uzmani): çizginin 19 noktasının tümü yola oturuyor (OSRM nearest en fazla 0,6 m); "
    "başlangıç SC-390 üzerinde OSM node 7717974586 (way 796667528, Lauro Müller place=town node 415523991'in ~800 m "
    "batısı; Nominatim: Santa Bárbara, Lauro Müller), bitiş SC-390 üzerinde km 394 kilometre taşı node 11065394994 "
    "(way 418387767, Bom Jardim da Serra place=village node 415523981'in ~1,4 km doğusu, şehir girişi; Nominatim: "
    "Bom Jardim da Serra). pathFull 1564 nokta, çizgi 31,65 km (lengthKm 31,6 ile farkı %+0,17); path pathFull'dan "
    "Douglas-Peucker 200 m ile 19 nokta, çizgi 26,41 km (lengthKm'den %16,4 kısa). "
    "Seçim gerekçesi: Serra do Rio do Rastro (SC-390) Brezilya'nın bilinen motosiklet yolu: AutoPapo 'Serra do Rio do "
    "Rastro: a história, a engenharia e o roteiro da estrada mais sinuosa do Brasil' (Eduardo Passos, 2026-06-29; "
    "~24 km, 284 curvas, ~200 → 1.460 m, beton kaplama, 'peregrinação quase obrigatória de motociclistas', sis yolu "
    "dakikalar içinde kapatabilir, kış buzu/karı yolu kapatabilir, hız sınırı 40 km/sa); Motonline 'Sul do Brasil: "
    "melhores estradas para andar de moto na região em 2025' (Marcelo Garcia, 2025-02-15; 'A SC-390, que liga Lauro "
    "Müller a Bom Jardim da Serra', 284 curvas, 24 km de subida, 1.421 m); en.wikipedia 'Serra do Rio do Rastro' "
    "(SC-390, en yüksek nokta 1.460 m, kırağı sık, yüksek kesimlerde kar olabilir); OSM'de km 9,85'te 'Monumento "
    "Biker 3' (Rota Biker, node 13332206664). Erişim 2026-11-09. Geometri: OpenStreetMap verisi üzerinde OSRM "
    "(router.project-osrm.org, sürüş profili, overview=full) ile 2026-11-10 gecesi alındı (scripts/add_brazil_route.py), "
    "koordinatlar 5 ondalığa yuvarlandı. Ara nokta: zirvede SC-390 node 4188173756. OSRM kendi başına Lauro Müller "
    "yer düğümünden şehir sokaklarıyla (Rua Doutor Valdir Cotrim, Rua João Elpídio Araújo) çıkıyor, Bom Jardim da "
    "Serra'da SC-390'dan şehir sokaklarına (Rua Venâncio Borges de Carvalho, Rua Joaquim Ezírio) dönüyordu; başlangıç "
    "ve bitiş bu yüzden SC-390'ın iki yönlü kesiminde, tek yönlü kavşak adalarının ve şehir içi tek yönlü çiftin "
    "dışında. OSRM adımlarında dönel kavşak ve U dönüşü yok; gidip-dönme yok (aynı noktaya ve ≥400 m sonra ≤20 m "
    "yakına dönüş denetlendi). Güzergâh tümüyle SC-390 'Rodovia Governador Irineu Bornhausen': km 0–3,96 way "
    "796667528; km 3,96–4,38 Guatá'da Rua Chapecó (way 1568511307); km 4,38–14,92 vadi (way 796667526, 62229109); "
    "km 14,92–21,35 serra tırmanışı, beton (way 727758955, 727758956, 706539547); km 21,35–23,04 zirve, mirante ve "
    "otoparklar (way 998927118, 998927115, 418390366, 418390368, 418390365); km 23,04–31,65 plato (way 418387767). "
    "Yüzey: OSM'de km 0–14,92 ve km 21,35–31,65 surface=asphalt, km 14,92–21,35 surface=concrete; toprak/taşlı etiket "
    "yok. Doğrulanmalı: pt metinleri ana dili Portekizce olan biri tarafından kontrol edilmeli (kullanıcı kararı 19 "
    "bekleniyor); serradaki güncel yol durumu, sis/buz/kar kapanmaları (sahada/resmî kaynaktan, ör. SIE/DEINFRA-SC, "
    "teyit edilmeli); mirante rakımı (AutoPapo ve en.wikipedia 1.460 m, Motonline 1.421 m; OSM'de rotaya yakın "
    "ele etiketli zirve/geçit düğümü yok); kaynaklardaki '24 km / 284 curvas' kesiminin rotadaki tam sınırı (rota "
    "31,6 km, Lauro Müller'den Bom Jardim da Serra girişine); bestSeason (proje önerisi: güney yarımkürede kış "
    "haziran–ağustos, yaz yağışlı); zorluk (hard, proje değerlendirmesi: art arda kapalı virajlar, dik eğim, sis, "
    "40 km/sa sınırı); OSRM grafiği OSM'nin en yeni düzenlemelerinden eski olabilir, sahada teyit edilmeli."
)

BACKTRACK_STEP_TYPES = ("roundabout", "rotary", "roundabout turn", "exit roundabout", "exit rotary")


def build():
    coords, dist_m, snap, steps = osrm_with_steps([(la, lo) for la, lo, _ in WAYPOINTS])
    full = dedupe([r5(c) for c in coords])
    bad, _cum = backtracks(full)
    if bad:
        raise RuntimeError(f"pathFull gidip-dönme içeriyor: {bad[:5]}")
    uturns = [st for st in steps if st["maneuver"].get("modifier") == "uturn"]
    if uturns:
        raise RuntimeError(f"OSRM adımlarında U dönüşü var: {[st['maneuver']['location'] for st in uturns]}")
    rounds = [st for st in steps if st["maneuver"]["type"] in BACKTRACK_STEP_TYPES]
    if rounds:
        raise RuntimeError(f"OSRM adımlarında dönel kavşak var: {[st['maneuver']['location'] for st in rounds]}")
    length_km = round(dist_m / 1000.0, 1)
    line_km = line_m(full) / 1000.0
    if abs(line_km - length_km) / length_km > 0.02:
        raise RuntimeError(f"pathFull çizgisi {line_km:.2f} km, lengthKm {length_km} ile ±%2 dışında")
    path = douglas_peucker(full, DP_TOLERANCE_M)
    assert path[0] == full[0] and path[-1] == full[-1]
    return {"pathFull": full, "path": path, "lengthKm": length_km, "lineKm": line_km, "steps": steps,
            "snapM": [round(x, 1) for x in snap], "dev": max_dist_to_line(path, full)}


def route_record(g, verification):
    full, path = g["pathFull"], g["path"]
    return {
        "id": ROUTE_ID,
        "regionId": REGION["id"],
        "name": TEXT["name"],
        "description": TEXT["description"],
        "lengthKm": g["lengthKm"],
        "difficulty": DIFFICULTY,
        "bestSeason": TEXT["bestSeason"],
        "start": {"name": TEXT["start_name"], "lat": full[0][1], "lon": full[0][0]},
        "end": {"name": TEXT["end_name"], "lat": full[-1][1], "lon": full[-1][0]},
        "path": {"type": "LineString", "coordinates": path},
        "pathFull": {"type": "LineString", "coordinates": full},
        "verification": verification,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--verify-others", action="store_true")
    ap.add_argument("--steps", action="store_true", help="OSRM adımlarını yazdır")
    a = ap.parse_args()
    if a.verify_others:
        return verify_tr()
    g = build()
    print(f"{ROUTE_ID}: lengthKm {g['lengthKm']}; pathFull {len(g['pathFull'])} nokta, çizgi {g['lineKm']:.2f} km "
          f"(fark %{100 * (g['lineKm'] - g['lengthKm']) / g['lengthKm']:+.2f}); path {len(g['path'])} nokta, "
          f"çizgi {line_m(g['path']) / 1000:.2f} km; path→pathFull en büyük uzaklık {g['dev']:.1f} m; "
          f"OSRM yapışma {g['snapM']} m; gidip-dönme, U dönüşü ve dönel kavşak yok")
    if a.steps:
        km = 0.0
        for st in g["steps"]:
            m = st["maneuver"]
            print(f"  km {km / 1000:6.2f} {m['type']:<14} {m.get('modifier') or '':<12} {st.get('ref') or '':<8} "
                  f"{st['name']} ({st['distance']:.0f} m)")
            km += st["distance"]
    if not a.write:
        return 0
    doc = load_routes()
    old = next((r for r in doc["routes"] if r["id"] == ROUTE_ID), None)
    verification = old["verification"] if old else {"status": "doğrulandı", "notes": VERIFICATION_NOTES}
    rec = route_record(g, verification)
    if old and "geometryRevision" in old:
        rec = {**{k: rec[k] for k in rec if k != "verification"}, "geometryRevision": old["geometryRevision"],
               "verification": verification}
    upsert(doc["countries"], "code", COUNTRY)
    upsert(doc["regions"], "id", REGION)
    upsert(doc["routes"], "id", rec)
    dump_routes(doc)
    print("Yazıldı: data/routes.json (sonra geometry_revision.py --write --date <gün>)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
