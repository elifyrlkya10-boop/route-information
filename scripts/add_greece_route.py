#!/usr/bin/env python3
"""İlk Yunanistan rotasını (gr-thessalia-01, Pelion: Volos → Portaria → Hania → Zagora) üretir.

Güzergâh: Volos (Βόλος) → ΕΟ34α (Βόλου – Τσαγκαράδας) üzerinden Anakasia / Ano Volos →
Portaria (Πορταριά) → Hania geçidi (Χάνια, ~1.190 m) → ΕΟ34 (Τσαγκαράδας – Χορευτού) → Zagora (Ζαγορά).
Kaynak: Best Biking Roads "Mt Pelion: Volos – Zagora – Mouresi" (2012 sürücü yorumu: "the best route
for motorcycling in Magnesia (Volos)"; Portaria–Hania arası geniş virajlar); el.wikipedia "Χάνια
Μαγνησίας" (Hania, Volos–Zagora il yolu üzerinde, 1.190 m, Volos'a 26 km).

Yöntem (reroute_routes.py ile aynı): OSRM router.project-osrm.org (sürüş profili, overview=full),
koordinatlar 5 ondalığa yuvarlanır, art arda yinelenen nokta atılır; lengthKm = OSRM mesafesi (1 ondalık);
path = pathFull üzerinde Douglas-Peucker, 200 m.

Ara noktalar: OSRM, Volos–Portaria arasında ΕΟ34α'dan ayrılıp mahalle sokaklarından (Αργυροκάστρου,
Σταγιάτες – Άνω Βόλος, Κατηχώρι, Πορταριάς-Κατηχωρίου) ve Hania'da köy içi sokaklardan kestirme
yapıyor. Motorcuların bilinen yolu ΕΟ34α olduğu için ara noktalar ΕΟ34α yollarının (OSM way) düğümlerine
konur (aşağıda node id'leriyle). Başlangıç ve bitiş OSM'deki yer düğümleridir (Βόλος place=city
node 135531710, Ζαγορά place=town node 1827940526).

Çalıştır:
  python3 scripts/add_greece_route.py               # yalnızca hesapla ve özetle (ağ gerekir)
  python3 scripts/add_greece_route.py --write       # data/routes.json'a ekle / güncelle
  python3 scripts/add_greece_route.py --verify-tr   # HEAD'deki rotaların geometrisi değişmedi mi (ağ gerekmez)
Ardından: python3 scripts/geometry_revision.py --write && python3 scripts/build_map_data.py
"""
import argparse
import json
import subprocess
import sys

from reroute_routes import DP_TOLERANCE_M, dedupe, douglas_peucker, line_m, max_dist_to_line, osrm_route, r5
from routes_json import ROOT, dump_routes, load_routes

ROUTE_ID = "gr-thessalia-01"

COUNTRY = {"code": "GR", "name": {"el": "Ελλάδα", "en": "Greece"}, "languages": ["el", "en"]}
REGION = {"id": "gr-thessalia", "countryCode": "GR", "name": {"el": "Θεσσαλία", "en": "Thessaly"}}

# (lat, lon, açıklama) — OSM node'ları (2026-11-07 OSM API / Overpass)
WAYPOINTS = [
    (39.3624833, 22.9401864, "Βόλος, place=city node 135531710 (başlangıç)"),
    (39.3805309, 22.9668239, "ΕΟ34α Ιωλκού, way 958275451, node 6055801380"),
    (39.3808963, 22.9705450, "ΕΟ34α Ιωλκού, way 1058097604, node 6055349889"),
    (39.3812539, 22.9730774, "ΕΟ34α Βόλου – Τσαγκαράδας, way 919948007, node 10709348977"),
    (39.3806729, 22.9759460, "ΕΟ34α Πηλίου, way 1041954373, node 9721817457"),
    (39.3792161, 22.9821840, "ΕΟ34α Πηλίου, way 1058034319, node 659589661"),
    (39.3827490, 22.9833911, "ΕΟ34α, way 1321620276, node 10709349284"),
    (39.3790185, 22.9866156, "ΕΟ34α (firketeler), way 223719457, node 659589428"),
    (39.3831976, 22.9909704, "ΕΟ34α, way 1058309518, node 659590590"),
    (39.3836160, 22.9956823, "ΕΟ34α, way 1160933749, node 659590551"),
    (39.3872789, 22.9927841, "ΕΟ34α, way 958261878, node 659590494"),
    (39.3895540, 22.9977324, "ΕΟ34α Portaria, way 957656474, node 659590445"),
    (39.3903358, 22.9993828, "ΕΟ34α Portaria, way 957656475, node 4020540246"),
    (39.3887888, 22.9990385, "ΕΟ34α Portaria, way 958263121, node 191061392"),
    (39.3880427, 23.0019674, "ΕΟ34α Portaria çıkışı, way 958263122, node 8729444110"),
    (39.3961810, 23.0564197, "ΕΟ34α Hania, way 957656473, node 1691921393"),
    (39.3968966, 23.0612354, "ΕΟ34α Hania, way 958268423, node 191060256"),
    (39.4437575, 23.1033311, "Ζαγορά, place=town node 1827940526 (bitiş)"),
]

TEXT = {
    "name": {"el": "Δρόμος του Πηλίου: Βόλος – Χάνια – Ζαγορά", "en": "Pelion Mountain Road: Volos – Hania – Zagora"},
    "description": {
        "el": "Ορεινή διαδρομή από το κέντρο του Βόλου που ανεβαίνει με στροφές από την Ανακασιά και την Πορταριά "
              "(ΕΟ34α) στο διάσελο των Χανίων (περίπου 1.190 μ.) και κατεβαίνει μέσα από δάση οξιάς και καστανιάς "
              "στη Ζαγορά, στην πλευρά του Αιγαίου. Θέα στον Παγασητικό κόλπο και στον Βόλο στην ανάβαση και στο "
              "Αιγαίο στην κατάβαση.",
        "en": "A mountain road from central Volos that climbs in bends through Anakasia and Portaria (EO34a) to the "
              "Hania pass (about 1,190 m), then descends through beech and chestnut forest to Zagora on the Aegean "
              "side. Views over the Pagasetic Gulf and Volos on the climb and over the Aegean on the descent.",
    },
    "bestSeason": {
        "el": "Απρίλιος–Οκτώβριος (τον χειμώνα πιθανό χιόνι και πάγος στο διάσελο των Χανίων)",
        "en": "April–October (snow and ice possible at the Hania pass in winter)",
    },
    "start_name": "Βόλος (Volos)",
    "end_name": "Ζαγορά (Zagora)",
}
DIFFICULTY = "moderate"


def build():
    coords, dist_m, snap = osrm_route([(la, lo) for la, lo, _ in WAYPOINTS])
    full = dedupe([r5(c) for c in coords])
    # Gidip-dönme (aynı koordinata geri dönüş) olmamalı.
    seen, revisits = {}, []
    for i, c in enumerate(full):
        k = tuple(c)
        if k in seen and i - seen[k] > 1:
            revisits.append((k, seen[k], i))
        seen.setdefault(k, i)
    if revisits:
        raise RuntimeError(f"pathFull aynı noktadan iki kez geçiyor: {revisits[:3]}")
    length_km = round(dist_m / 1000.0, 1)
    line_km = line_m(full) / 1000.0
    if abs(line_km - length_km) / length_km > 0.02:
        raise RuntimeError(f"pathFull çizgisi {line_km:.2f} km, lengthKm {length_km} ile ±%2 dışında")
    path = douglas_peucker(full, DP_TOLERANCE_M)
    assert path[0] == full[0] and path[-1] == full[-1]
    return {"pathFull": full, "path": path, "lengthKm": length_km, "lineKm": line_km,
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


def upsert(items, key, value):
    for i, x in enumerate(items):
        if x[key] == value[key]:
            items[i] = value
            return
    items.append(value)


def verify_tr():
    """HEAD'de olan her rotanın geometrisi ve geometryRevision'ı birebir aynı mı (ağ gerekmez)."""
    head = json.loads(subprocess.check_output(["git", "show", "HEAD:data/routes.json"], cwd=ROOT))
    cur = {r["id"]: r for r in load_routes()["routes"]}
    bad = []
    for o in head["routes"]:
        r = cur.get(o["id"])
        if r is None:
            bad.append(f"{o['id']}: silinmiş")
            continue
        for k in ("path", "pathFull", "lengthKm", "start", "end", "geometryRevision"):
            if r.get(k) != o.get(k):
                bad.append(f"{o['id']}: {k} HEAD'den farklı")
    for line in bad:
        print("FARK:", line)
    added = [i for i in cur if i not in {o["id"] for o in head["routes"]}]
    print(f"verify-tr: HEAD'deki {len(head['routes'])} rota", "birebir aynı" if not bad else f"{len(bad)} fark",
          f"; yeni rotalar: {', '.join(added) or 'yok'}")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--verify-tr", action="store_true")
    a = ap.parse_args()
    if a.verify_tr:
        return verify_tr()
    g = build()
    print(f"{ROUTE_ID}: lengthKm {g['lengthKm']}; pathFull {len(g['pathFull'])} nokta, çizgi {g['lineKm']:.2f} km "
          f"(fark %{100 * (g['lineKm'] - g['lengthKm']) / g['lengthKm']:+.2f}); path {len(g['path'])} nokta, "
          f"çizgi {line_m(g['path']) / 1000:.2f} km; path→pathFull en büyük uzaklık {g['dev']:.1f} m; "
          f"OSRM yapışma {g['snapM']} m")
    if not a.write:
        return 0
    doc = load_routes()
    old = next((r for r in doc["routes"] if r["id"] == ROUTE_ID), None)
    verification = old["verification"] if old else {"status": "doğrulanmalı", "notes": ""}
    rec = route_record(g, verification)
    if old and "geometryRevision" in old:
        # geometry_revision.py karma değişmediyse date'i korur; alanı yerinde bırak.
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
