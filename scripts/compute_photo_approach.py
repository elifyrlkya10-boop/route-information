#!/usr/bin/env python3
"""Fotoğraf noktaları için rota üzerindeki bildirim noktasını (approachPoint) hesaplar.

Rotadan uzaktaki bir fotoğraf noktasının bildirimi, rotayı izleyen sürücüye
noktanın kendisi yerine rota çizgisi üzerindeki en yakın noktadan (approachPoint)
tetiklenir; notifyRadiusM bu noktanın çevresinde uygulanır.

Her nokta için:
  - approachPoint {lat, lon}: data/routes.json'daki rota çizgisinin (path.coordinates)
    noktaya en yakın yeri (doğru parçalarına izdüşüm, 5 ondalık).
  - detourKm: approachPoint ile nokta arası kuş uçuşu mesafe (haversine, 1 ondalık).
    Gerçek yol mesafesi değildir; bu durum verification.notes'a yazılır.
  - detourKm > 3 ise noktaya dokunulmaz (silinmez), notes'a ayrıca not düşülür.

data/routes.json yalnızca okunur. Çıktı deterministiktir: değişiklik yokken
tekrar çalıştırmak aynı dosyayı üretir. Ağ erişimi gerekmez.

Çalıştır: python3 scripts/compute_photo_approach.py
Ardından: python3 scripts/build_map_data.py && node prototype/map.test.js
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTES = ROOT / "data" / "routes.json"
SPOTS = ROOT / "data" / "photo-spots.json"

LONG_DETOUR_KM = 3.0
NOTE_PREFIX = "Bildirim noktası (approachPoint):"
LONG_PREFIX = "Uzun sapma:"
# Eski, OSRM tabanlı tahmin cümlesi; yerine yeni hesap yazılır.
OLD_DETOUR_RE = re.compile(r"Rotadan ~[\d.,]+ km yan yola sapma gerektirir\. ?")


def haversine_m(a, b):  # (lat, lon) -> metres
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def project(p, a, b):
    """p'nin a-b doğru parçası üzerindeki en yakın noktası (yerel eşdikdörtgen düzlem)."""
    k = math.cos(math.radians(p[0]))
    ax, ay = (a[1] - p[1]) * k, a[0] - p[0]
    bx, by = (b[1] - p[1]) * k, b[0] - p[0]
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    t = 0.0 if den == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / den))
    return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))


def nearest_on_line(p, line):
    best = None
    for i in range(len(line) - 1):
        q = project(p, line[i], line[i + 1])
        d = haversine_m(p, q)
        if best is None or d < best[0]:
            best = (d, q)
    return best


def fmt(v):
    """photo-spots.json'un mevcut biçimi: iç nesneler tek satırda, '{ "a": 1 }'."""
    if isinstance(v, dict):
        return "{ " + ", ".join(json.dumps(k, ensure_ascii=False) + ": " + fmt(x) for k, x in v.items()) + " }"
    return json.dumps(v, ensure_ascii=False)


def dump(doc):
    out = ["{", '  "photoSpots": [']
    spots = doc["photoSpots"]
    for i, s in enumerate(spots):
        out.append("    {")
        items = list(s.items())
        for j, (k, v) in enumerate(items):
            out.append("      " + json.dumps(k, ensure_ascii=False) + ": " + fmt(v) + ("," if j < len(items) - 1 else ""))
        out.append("    }" + ("," if i < len(spots) - 1 else ""))
    out += ["  ]", "}"]
    return "\n".join(out) + "\n"


def km_tr(x):
    return f"{x:.1f}".replace(".", ",")


def main():
    routes = json.loads(ROUTES.read_text(encoding="utf-8"))["routes"]
    doc = json.loads(SPOTS.read_text(encoding="utf-8"))
    lines = {r["id"]: [(c[1], c[0]) for c in r["path"]["coordinates"]] for r in routes}

    for s in doc["photoSpots"]:
        line = lines.get(s["routeId"])
        if not line or len(line) < 2:
            print(f"{s['id']}: rota çizgisi yok ({s['routeId']})", file=sys.stderr)
            return 1
        p = (s["location"]["lat"], s["location"]["lon"])
        dist_m, q = nearest_on_line(p, line)
        detour = round(dist_m / 1000, 1)

        # Alanları notifyRadiusM'den sonra, verification'dan önce yerleştir.
        rebuilt = {}
        for k, v in s.items():
            if k in ("approachPoint", "detourKm"):
                continue
            if k == "verification":
                rebuilt["approachPoint"] = {"lat": round(q[0], 5), "lon": round(q[1], 5)}
                rebuilt["detourKm"] = detour
            rebuilt[k] = v
        s.clear()
        s.update(rebuilt)

        notes = s["verification"]["notes"]
        notes = OLD_DETOUR_RE.sub("", notes)
        notes = notes.split(NOTE_PREFIX)[0].strip()  # önceki çalıştırmanın notu (sonda) atılır
        add = (f"{NOTE_PREFIX} rota çizgisinin noktaya en yakın yeri; bildirim (notifyRadiusM={s['notifyRadiusM']} m) "
               f"bu noktanın çevresinde tetiklenir. detourKm={km_tr(detour)} km kuş uçuşu mesafedir, gerçek yol mesafesi "
               f"değildir; sapma yolunun kavşağı bu noktadan farklı olabilir (scripts/compute_photo_approach.py).")
        if detour > LONG_DETOUR_KM:
            add += (f" {LONG_PREFIX} nokta rotadan {LONG_DETOUR_KM:g} km'den fazla uzakta; bildirim metninde sapma "
                    f"olduğu belirtilmeli, sapma yolu ve gerçek mesafe sahada teyit edilmeli.")
        s["verification"]["notes"] = (notes + " " + add).strip()
        print(f"{s['id']}: detourKm={detour} approachPoint={s['approachPoint']}")

    SPOTS.write_text(dump(doc), encoding="utf-8")
    print(f"Wrote {SPOTS.relative_to(ROOT)}: {len(doc['photoSpots'])} photo spots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
