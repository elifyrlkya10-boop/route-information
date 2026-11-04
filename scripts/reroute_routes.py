#!/usr/bin/env python3
"""Rota geometrisini (pathFull, path, lengthKm, end) OSRM + OSM'den yeniden üretir.

2026-11-05 kullanıcı kararları (docs/kararlar.md):
  1A  Nemrut (tr-guneydogu-anadolu-01) güney yaklaşımına taşınır:
      Kâhta → D360 → Narince → 02-05 (Gerger–Narince yolu) → 02-06 → Karadut →
      02-06 / Kayadibi–Nemrut Yolu kavşağı (node 622454111) → ziyaretçi merkezi yolu
      (way 49055992, güney kapısı node 3956530545) → yolun üst ucu, "Nemrut Otoparkı"
      (way 392432867) yanındaki turning_circle (node 364475030).
      Kavşağa kadar OSRM (sürüş profili). Kavşaktan sonrası OSRM'de yönlendirilmiyor
      (barrier=swing_gate OSRM araç profilinde geçilemez); bu kesim OSM API'deki
      way 49055992'nin düğüm geometrisinden (canlı veri) alınır.
  4A  Bozdağ (tr-ege-01): ara nokta, 35-30 il yolu üzerindeki gerçek kavşak
      node 2122980385'e alınır (köy içi ~0,27 km'lik gidip-dönme kalkar).

Yöntem (eski pathFull ile aynı): OSRM router.project-osrm.org, overview=full,
koordinatlar 5 ondalığa yuvarlanır, art arda yinelenen nokta (bacak sınırı) atılır.
lengthKm = OSRM mesafesi (+ OSM kuyruk kesiminin haversine uzunluğu), 1 ondalık.

path:
  - Nemrut: pathFull'dan Douglas-Peucker, 200 m tolerans (yerel eşdikdörtgen düzlem).
    Bu tolerans eski Nemrut path'ini (45 nokta) eski pathFull'dan 45 nokta olarak
    yeniden üretiyor (44'ü birebir aynı), yani eski yöntemle uyumlu.
  - Bozdağ: eski path korunur; yalnızca ara nokta tepe noktası (38,33913 / 28,07675)
    kavşak düğümüyle değiştirilir (diğer path noktaları ve fotoğraf noktaları kaymasın).

Çalıştır:
  python3 scripts/reroute_routes.py            # yalnızca hesapla ve özetle (ağ gerekir)
  python3 scripts/reroute_routes.py --write    # data/routes.json'a yaz
  python3 scripts/reroute_routes.py --verify-others
      # Ege ve Nemrut dışındaki rotaların path/pathFull'unun git HEAD ile birebir aynı
      # olduğunu doğrular (ağ gerekmez)
Ardından: python3 scripts/geometry_revision.py --write && python3 scripts/build_map_data.py
"""
import argparse
import json
import math
import subprocess
import sys
import time
import urllib.request

from routes_json import ROOT, dump_routes, load_routes

UA = {"User-Agent": "route-information-verify/1.0 (github.com/elifyrlkya10-boop/route-information)"}
OSRM = "https://router.project-osrm.org/route/v1/driving/"
OSM_API = "https://api.openstreetmap.org/api/0.6/"
DP_TOLERANCE_M = 200.0
CHANGED_ROUTES = ("tr-ege-01", "tr-guneydogu-anadolu-01")

PLANS = {
    "tr-guneydogu-anadolu-01": {
        # (lat, lon)
        "waypoints": [(37.78616, 38.62169), (37.9676074, 38.7388149)],  # Kâhta → node 622454111
        "tail": {"way": 49055992, "from_node": 622454111, "to_node": 364475030},
        "end_name": "Nemrut Otoparkı",
        "simplify": "dp",
    },
    "tr-ege-01": {
        "waypoints": [(38.22826, 27.97717), (38.3428564, 28.0765804), (38.48609, 28.13897)],
        "simplify": "replace-vertex",
        "old_vertex": [28.07675, 38.33913],
        "new_vertex": [28.07658, 38.34286],
    },
}


def get_json(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))


def hav(a, b):  # [lon, lat] -> metres
    R = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def line_m(coords):
    return sum(hav(a, b) for a, b in zip(coords, coords[1:]))


def r5(c):
    return [round(c[0], 5), round(c[1], 5)]


def dedupe(coords):
    out = []
    for c in coords:
        if not out or out[-1] != c:
            out.append(c)
    return out


def _xy(c, lat0):
    return (c[0] * math.cos(math.radians(lat0)) * 111320.0, c[1] * 110540.0)


def _seg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == dy == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def douglas_peucker(coords, tol_m):
    lat0 = coords[0][1]
    P = [_xy(c, lat0) for c in coords]
    keep = [False] * len(P)
    keep[0] = keep[-1] = True
    stack = [(0, len(P) - 1)]
    while stack:
        i, j = stack.pop()
        dmax, k = -1.0, -1
        for m in range(i + 1, j):
            d = _seg(P[m], P[i], P[j])
            if d > dmax:
                dmax, k = d, m
        if dmax > tol_m:
            keep[k] = True
            stack += [(i, k), (k, j)]
    return [c for c, f in zip(coords, keep) if f]


def max_dist_to_line(points, line):
    """Her noktanın çizgiye uzaklığının en büyüğü (m)."""
    lat0 = line[0][1]
    L = [_xy(c, lat0) for c in line]
    worst = 0.0
    for p in points:
        q = _xy(p, lat0)
        worst = max(worst, min(_seg(q, a, b) for a, b in zip(L, L[1:])))
    return worst


def osrm_route(waypoints):
    s = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
    d = get_json(OSRM + s + "?overview=full&geometries=geojson&steps=false")
    if d.get("code") != "Ok":
        raise RuntimeError(f"OSRM: {d.get('code')}")
    r = d["routes"][0]
    return r["geometry"]["coordinates"], r["distance"], [w["distance"] for w in d["waypoints"]]


def osm_way_tail(way_id, from_node, to_node):
    d = get_json(f"{OSM_API}way/{way_id}/full.json")
    nodes = {e["id"]: e for e in d["elements"] if e["type"] == "node"}
    way = next(e for e in d["elements"] if e["type"] == "way")
    ns = way["nodes"]
    i, j = ns.index(from_node), ns.index(to_node)
    seq = ns[i:j + 1] if i <= j else list(reversed(ns[j:i + 1]))
    return [[nodes[n]["lon"], nodes[n]["lat"]] for n in seq], way["version"]


def build(route_id):
    plan = PLANS[route_id]
    coords, dist_m, snap = osrm_route(plan["waypoints"])
    full = [r5(c) for c in coords]
    tail_m, tail_info = 0.0, None
    if "tail" in plan:
        t = plan["tail"]
        tail, ver = osm_way_tail(t["way"], t["from_node"], t["to_node"])
        tail = [r5(c) for c in tail]
        if hav(full[-1], tail[0]) > 5:
            raise RuntimeError(f"{route_id}: OSRM sonu ile OSM kuyruğu birleşmiyor ({hav(full[-1], tail[0]):.1f} m)")
        tail_m = line_m(tail)
        full = full + tail
        tail_info = {"way": t["way"], "version": ver, "points": len(tail), "lengthM": round(tail_m, 1)}
    full = dedupe(full)
    return {
        "pathFull": full,
        "osrmM": dist_m,
        "tailM": tail_m,
        "tail": tail_info,
        "snapM": [round(x, 1) for x in snap],
        "lengthKm": round((dist_m + tail_m) / 1000.0, 1),
        "lineKm": line_m(full) / 1000.0,
    }


def simplify(route, plan, full):
    if plan["simplify"] == "dp":
        return douglas_peucker(full, DP_TOLERANCE_M)
    old = route["path"]["coordinates"]
    if plan["old_vertex"] not in old and plan["new_vertex"] in old:
        return old  # zaten uygulanmış (betik yeniden çalıştırıldı)
    if plan["old_vertex"] not in old:
        raise RuntimeError(f"{route['id']}: değiştirilecek path noktası bulunamadı")
    return [plan["new_vertex"] if c == plan["old_vertex"] else c for c in old]


def verify_others():
    head = json.loads(subprocess.check_output(["git", "show", "HEAD:data/routes.json"], cwd=ROOT))
    cur = load_routes()
    old = {r["id"]: r for r in head["routes"]}
    bad = []
    ids = [r["id"] for r in cur["routes"]]
    if ids != [r["id"] for r in head["routes"]]:
        bad.append(f"rota id listesi değişti: {ids}")
    for r in cur["routes"]:
        if r["id"] in CHANGED_ROUTES:
            continue
        o = old.get(r["id"])
        for k in ("path", "pathFull", "lengthKm", "start", "end"):
            if r.get(k) != o.get(k):
                bad.append(f"{r['id']}: {k} HEAD'den farklı")
    for line in bad:
        print("FARK:", line)
    print("verify-others:", "OK (değişmeyen rotalar HEAD ile birebir aynı)" if not bad else f"{len(bad)} fark")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--verify-others", action="store_true")
    a = ap.parse_args()
    if a.verify_others:
        return verify_others()
    doc = load_routes()
    byid = {r["id"]: r for r in doc["routes"]}
    for rid, plan in PLANS.items():
        r = byid[rid]
        g = build(rid)
        full = g["pathFull"]
        path = simplify(r, plan, full)
        assert path[0] == full[0] and path[-1] == full[-1], rid
        dev = max_dist_to_line(path, full)
        print(f"{rid}: OSRM {g['osrmM'] / 1000:.3f} km + kuyruk {g['tailM'] / 1000:.3f} km → lengthKm {g['lengthKm']} "
              f"(eski {r['lengthKm']}); pathFull {len(full)} nokta, çizgi {g['lineKm']:.2f} km "
              f"(fark %{100 * (g['lineKm'] - g['lengthKm']) / g['lengthKm']:+.2f}); path {len(path)} nokta "
              f"(eski {len(r['path']['coordinates'])}), çizgi {line_m(path) / 1000:.2f} km; "
              f"path noktalarının pathFull'a en büyük uzaklığı {dev:.1f} m; OSRM yapışma {g['snapM']} m; kuyruk {g['tail']}")
        if a.write:
            r["pathFull"] = {"type": "LineString", "coordinates": full}
            r["path"] = {"type": "LineString", "coordinates": path}
            r["lengthKm"] = g["lengthKm"]
            if "end_name" in plan:
                r["end"] = {"name": plan["end_name"], "lat": full[-1][1], "lon": full[-1][0]}
    if a.write:
        dump_routes(doc)
        print("Yazıldı: data/routes.json (notlar/geometryRevision ayrı güncellenir)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
