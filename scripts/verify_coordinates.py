#!/usr/bin/env python3
"""Rota ve fotoğraf noktası koordinatlarını OpenStreetMap'e karşı bağımsız olarak kontrol eder.

Kontroller:
  1. Rota çizgisinin her noktası bir yola düşüyor mu? (OSRM /nearest, eşik 50 m)
  2. Başlangıç/bitiş adları, Nominatim'de aranınca koordinata yakın mı? (eşik 5 km)
  3. Çizgi uzunluğu ile lengthKm tutarlı mı? (sadeleştirilmiş çizgi gerçekten kısa olur)
  4. Fotoğraf noktası rotasına yakın mı (eşik 1,5 km) ve yola erişilebilir mi?
  5. Fotoğraf noktası başlığındaki yer adı Nominatim'de noktaya yakın mı? (eşik 5 km)

Çalıştır: python3 scripts/verify_coordinates.py  (ağ erişimi gerekir; Nominatim için 1 istek/sn)
Çıktı: scripts/verify_report.json
"""
import json, math, time, urllib.parse, urllib.request, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = {"User-Agent": "route-information-verify/1.0 (github.com/elifyrlkya10-boop/route-information)"}

def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))

def hav(a, b):  # (lat, lon) -> metres
    R = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def seg_dist(p, a, b):  # point to segment, local equirectangular, metres
    k = math.cos(math.radians(p[0]))
    ax, ay = (a[1] - p[1]) * k * 111320, (a[0] - p[0]) * 110540
    bx, by = (b[1] - p[1]) * k * 111320, (b[0] - p[0]) * 110540
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    return math.hypot(ax + t * dx, ay + t * dy)

def nearest_road(lat, lon):
    d = get(f"https://router.project-osrm.org/nearest/v1/driving/{lon},{lat}")
    w = d["waypoints"][0]
    return round(w["distance"]), w.get("name", "")

_last = [0.0]
def geocode(q, near):
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    d = 0.35  # aramayı noktanın ~35 km çevresiyle sınırla; aynı adlı başka yerlerle karışmasın
    viewbox = f"{near[1] - d},{near[0] + d},{near[1] + d},{near[0] - d}"
    res = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 5, "viewbox": viewbox, "bounded": 1}))
    best = None
    for r in res:
        d = hav(near, (float(r["lat"]), float(r["lon"])))
        if best is None or d < best[0]:
            best = (round(d), r["display_name"][:80])
    return best

def place_name(s):
    for sep in (" – ", " - ", " (", ","):
        s = s.split(sep)[0]
    return s.strip()

def main():
    routes = json.load(open(ROOT / "data/routes.json"))["routes"]
    spots = json.load(open(ROOT / "data/photo-spots.json"))["photoSpots"]
    report = {"routes": {}, "photoSpots": {}}
    for r in routes:
        coords = [(c[1], c[0]) for c in r["path"]["coordinates"]]
        off = []
        for i, (la, lo) in enumerate(coords):
            dist, name = nearest_road(la, lo)
            if dist > 50:
                off.append({"index": i, "distM": dist})
            time.sleep(0.2)
        line_km = sum(hav(coords[i], coords[i + 1]) for i in range(len(coords) - 1)) / 1000
        ends = {}
        for key in ("start", "end"):
            pt = r[key]
            ends[key] = {"name": pt["name"], "geocode": geocode(place_name(pt["name"]), (pt["lat"], pt["lon"]))}
        report["routes"][r["id"]] = {
            "points": len(coords), "offRoadPoints": off,
            "lineKm": round(line_km, 1), "lengthKm": r["lengthKm"], "ends": ends,
        }
        print(r["id"], json.dumps(report["routes"][r["id"]], ensure_ascii=False), flush=True)
    by_id = {r["id"]: [(c[1], c[0]) for c in r["path"]["coordinates"]] for r in routes}
    for s in spots:
        p = (s["location"]["lat"], s["location"]["lon"])
        line = by_id.get(s["routeId"])
        to_route = None if not line else round(min(seg_dist(p, line[i], line[i + 1]) for i in range(len(line) - 1)))
        road, road_name = nearest_road(*p)
        q = place_name(s["title"]["tr"])
        report["photoSpots"][s["id"]] = {
            "routeId": s["routeId"], "routeKnown": line is not None, "distToRouteM": to_route,
            "distToRoadM": road, "roadName": road_name, "query": q, "geocode": geocode(q, p),
        }
        print(s["id"], json.dumps(report["photoSpots"][s["id"]], ensure_ascii=False), flush=True)
    json.dump(report, open(ROOT / "scripts/verify_report.json", "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    sys.exit(main())
