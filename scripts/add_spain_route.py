#!/usr/bin/env python3
"""İlk İspanya rotasını (es-andalucia-01, Sierra de Grazalema: El Bosque → Puerto del Boyar →
Puerto de las Palomas → Zahara de la Sierra) üretir.

Güzergâh: El Bosque (Cádiz) → A-372 "Carretera de Arcos de la Frontera a Ronda por Grazalema" →
Puerto del Boyar (OSM node 956501539, ele 1105) → Grazalema'nın ~1,3 km batısındaki kavşaktan CA-9104
"Zahara-Grazalema" → Puerto de las Palomas (node 266660753, ele 1185) → firketelerle iniş → Zahara de la Sierra.
Kaynaklar: Blog Motor Mapfre "Ruta en moto por los pueblos blancos de Cádiz" (2024-03-27): Grazalema'dan
Zahara'ya CA-9104 ile "un camino de solo 16 kilómetros", Sierra de Grazalema dağ geçitleri "un reto y un
disfrute para los sentidos de todo motero"; en.wikipedia "Puerto de las Palomas" (CA-9104, Grazalema – Zahara,
Zahara tarafı "very winding and steep"); dangerousroads.org "Puerto de las Palomas" (CA-9104, 15,7 km,
tamamı asfalt, en çok %14, kışın ara sıra kapanır); andalucia.org "Sierra de Grazalema route" (Puerto del
Boyar ve Puerto de las Palomas seyir noktaları).

Yöntem (add_greece_route.py ile aynı): OSRM router.project-osrm.org (sürüş profili, overview=full),
koordinatlar 5 ondalığa yuvarlanır, art arda yinelenen nokta atılır; lengthKm = OSRM mesafesi (1 ondalık);
path = pathFull üzerinde Douglas-Peucker, 200 m.

Pelion dersleri (2026-11-07/08):
  * OSRM Zahara'da CA-9104'ten km ~30,9'da ayrılıp köy içi sokaklardan (Calle Nueva, Calle Alta — sett/dar)
    Plaza del Rey'deki yer düğümüne gidiyordu. Bitiş bu yüzden yer düğümü değil, CA-9104 üzerindeki düğüm
    2249335419 (way 1562173851 / 1562173850 birleşimi, Zahara de la Sierra place node 7131596509'un ~200 m
    kuzeyi, otopark node 2249335405'in ~40 m batısı); CA-9104'ün köy girişindeki iki way'ine ara nokta konur.
  * Başlangıç El Bosque yer düğümü (place=village node 1470838256, Avenida Juan XXIII) olunca OSRM
    glorietada 106 m'lik neredeyse tam tur atıp girişin 10 m yanından A-372'ye çıkıyordu (Pelion'daki
    dönel kavşak sorununun benzeri; 400 m eşikli denetim bunu yakalamıyor). Başlangıç A-372'nin glorietanın
    ~55 m güneyindeki iki yönlü kesiminde (way 1475083865, node 3730958001); OSRM adımlarında "roundabout"
    yalnız Zahara'daki CA-9104/CA-9112 kavşağında (32 m, düz geçiş) kalır.
  * Gidip-dönme denetimi iki türlü: aynı koordinata geri dönüş ve çift şeritli yolda paralel geri gelme
    (≥400 m sonra ≤20 m yakına dönüş). OSRM adımlarında "uturn" olmamalı.

Çalıştır:
  python3 scripts/add_spain_route.py                 # yalnızca hesapla ve özetle (ağ gerekir)
  python3 scripts/add_spain_route.py --write         # data/routes.json'a ekle / güncelle
  python3 scripts/add_spain_route.py --verify-others # HEAD'deki rotaların geometrisi değişmedi mi (ağ gerekmez)
Ardından: python3 scripts/geometry_revision.py --write && python3 scripts/build_map_data.py
"""
import argparse
import sys

from add_greece_route import upsert, verify_tr
from reroute_routes import DP_TOLERANCE_M, OSRM, dedupe, douglas_peucker, get_json, hav, line_m, max_dist_to_line, r5
from routes_json import dump_routes, load_routes

ROUTE_ID = "es-andalucia-01"

COUNTRY = {"code": "ES", "name": {"es": "España", "en": "Spain"}, "languages": ["es", "en"]}
REGION = {"id": "es-andalucia", "countryCode": "ES", "name": {"es": "Andalucía", "en": "Andalusia"}}

# (lat, lon, açıklama) — OSM node'ları (2026-11-08 OSM API)
WAYPOINTS = [
    # Başlangıç El Bosque yer düğümü (node 1470838256, Avenida Juan XXIII) olunca rota glorietaya batıdan girip
    # neredeyse tam tur (106 m) atarak 10 m yandaki çıkıştan A-372'ye güneye çıkıyordu (U şekli). Başlangıç,
    # glorietanın ~55 m güneyinde, A-372'nin iki yönlü kesimindeki düğüm.
    (36.7565555, -5.5074166, "El Bosque, A-372 way 1475083865, node 3730958001 (başlangıç; yer düğümünün ~100 m güneybatısı)"),
    (36.7555421, -5.3946303, "Puerto del Boyar, A-372 way 1446388440, mountain_pass node 956501539 (ele 1105)"),
    (36.7875930, -5.3766888, "Puerto de las Palomas, CA-9104 way 32646796/1475326076, node 266660753 (ele 1185)"),
    (36.8370872, -5.3888808, "CA-9104 Zahara girişi, way 1562173858, node 9511152666"),
    (36.8414909, -5.3889221, "CA-9104 Zahara, way 1562173851, node 9511111966"),
    (36.8423228, -5.3904321, "CA-9104 Zahara, way 1562173851/1562173850, node 2249335419 (bitiş)"),
]

TEXT = {
    "name": {"es": "Sierra de Grazalema: El Bosque – Puerto de las Palomas – Zahara de la Sierra",
             "en": "Sierra de Grazalema: El Bosque – Puerto de las Palomas – Zahara de la Sierra"},
    "description": {
        "es": "Carretera de montaña por el Parque Natural Sierra de Grazalema. Desde El Bosque, la A-372 sube "
              "con curvas amplias entre pinares y encinas hasta el Puerto del Boyar (unos 1.100 m), con vistas "
              "al valle y a la campiña de Cádiz. Cerca de Grazalema se toma la CA-9104, estrecha y muy revirada, "
              "que pasa por el Puerto de las Palomas (unos 1.190 m) y baja en horquillas hacia Zahara de la "
              "Sierra, con vistas al embalse de Zahara-El Gastor.",
        "en": "A mountain road through the Sierra de Grazalema Natural Park. From El Bosque the A-372 climbs in "
              "wide bends through pine and holm-oak woods to the Puerto del Boyar (about 1,100 m), with views over "
              "the valley and the Cádiz countryside. Near Grazalema the route takes the narrow, very winding "
              "CA-9104 over the Puerto de las Palomas (about 1,190 m) and descends in hairpins to Zahara de la "
              "Sierra, with views over the Zahara-El Gastor reservoir.",
    },
    "bestSeason": {
        "es": "Marzo–junio y septiembre–noviembre (en invierno puede haber hielo o cierres puntuales en los "
              "puertos; en verano, mucho calor)",
        "en": "March–June and September–November (ice or occasional closures on the passes in winter; "
              "very hot in summer)",
    },
    "start_name": "El Bosque, A-372",
    "end_name": "Zahara de la Sierra, CA-9104",
}
DIFFICULTY = "hard"

BACKTRACK_ALONG_M = 400.0
BACKTRACK_NEAR_M = 20.0


def osrm_with_steps(waypoints):
    s = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
    d = get_json(OSRM + s + "?overview=full&geometries=geojson&steps=true")
    if d.get("code") != "Ok":
        raise RuntimeError(f"OSRM: {d.get('code')}")
    r = d["routes"][0]
    steps = [st for leg in r["legs"] for st in leg["steps"]]
    return r["geometry"]["coordinates"], r["distance"], [w["distance"] for w in d["waypoints"]], steps


def backtracks(full):
    """Aynı koordinata geri dönüş ya da ≥400 m sonra ≤20 m yakına geri gelme (çift şeritli yolda U dönüşü)."""
    cum = [0.0]
    for a, b in zip(full, full[1:]):
        cum.append(cum[-1] + hav(a, b))
    out, seen = [], {}
    for i, c in enumerate(full):
        k = tuple(c)
        if k in seen and i - seen[k] > 1:
            out.append(("aynı nokta", seen[k], i))
        seen.setdefault(k, i)
    # Kaba ızgara ile yakın nokta araması
    cell = {}
    for i, c in enumerate(full):
        cell.setdefault((round(c[0] * 2000), round(c[1] * 2000)), []).append(i)
    for i, c in enumerate(full):
        gx, gy = round(c[0] * 2000), round(c[1] * 2000)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in cell.get((gx + dx, gy + dy), ()):
                    if j < i and cum[i] - cum[j] >= BACKTRACK_ALONG_M and hav(full[i], full[j]) <= BACKTRACK_NEAR_M:
                        out.append((f"paralel {hav(full[i], full[j]):.1f} m", j, i))
    return out, cum


def build():
    coords, dist_m, snap, steps = osrm_with_steps([(la, lo) for la, lo, _ in WAYPOINTS])
    full = dedupe([r5(c) for c in coords])
    bad, cum = backtracks(full)
    if bad:
        raise RuntimeError(f"pathFull gidip-dönme içeriyor: {bad[:5]}")
    uturns = [st for st in steps if st["maneuver"].get("modifier") == "uturn"]
    if uturns:
        raise RuntimeError(f"OSRM adımlarında U dönüşü var: {[st['maneuver']['location'] for st in uturns]}")
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
          f"OSRM yapışma {g['snapM']} m; gidip-dönme yok")
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
    verification = old["verification"] if old else {"status": "doğrulanmalı", "notes": ""}
    rec = route_record(g, verification)
    if old and "geometryRevision" in old:
        rec = {**{k: rec[k] for k in rec if k != "verification"}, "geometryRevision": old["geometryRevision"],
               "verification": verification}
    upsert(doc["countries"], "code", COUNTRY)
    upsert(doc["regions"], "id", REGION)
    upsert(doc["routes"], "id", rec)
    dump_routes(doc)
    print("Yazıldı: data/routes.json (verification notları ayrı; sonra geometry_revision.py --write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
