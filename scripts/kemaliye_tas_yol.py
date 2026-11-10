#!/usr/bin/env python3
"""Kemaliye Taş Yol (tr-dogu-anadolu-01) geometrisini (pathFull, path, lengthKm) OSRM + OSM'den yeniden üretir.

2026-11-11 kontrolü (rota-uzmani): OSM'de Kemaliyeliler Taş Yolu (24-61) D877 kavşağından (node 3039725855,
Kemaliye Köprüsü'nün ~640 m kuzeyi) Kemaliye–Divriği yolu (24-61, way 73905431) kavşağına (node 2795974769)
kadar 21 way'lik kesintisiz bir zincir: her way bir öncekiyle aynı node'u paylaşıyor, arada boşluk yok.
2026-11-01'deki "~2 km ve ~0,6 km boşluk" yalnızca üç uzun way (193875160, 104673931, 288389069) birleştirildiği
için çıkmıştı; aradaki kısa way'ler (tünel adlı olanlar dahil) o tarihte de OSM'deydi (son sürüm tarihleri
2026-06-24 ve öncesi).

OSRM (router.project-osrm.org, sürüş profili) Taş Yol'dan yine de rota üretmiyor: zincirdeki maxwidth=1.7 etiketli
way'ler (1531931134, 193875160, 299891364, 299891359, 299891366, 299891368, 299891363, 299891367, 104673931,
288389069) OSRM araç profilinde araç genişliğinin (1,9 m) altında kaldığı için grafikte yok (nearest bu way'lerin
ortasından 300–800 m öteye yapışıyor). Bu yüzden (scripts/reroute_routes.py'deki Nemrut kuyruğu gibi):
  * Kemaliye başlangıcı → Taş Yol başı (node 3039725855): OSRM (overview=full, steps=true).
  * Taş Yol: OSM API'deki 21 way'in düğüm geometrisi (canlı veri), zincir sırasıyla.
lengthKm = OSRM mesafesi + Taş Yol zincirinin haversine uzunluğu (1 ondalık).
path = pathFull üzerinde Douglas-Peucker, 200 m (diğer rotalarla aynı).
Denetimler: gidip-dönme (add_spain_route.backtracks), OSRM adımlarında U dönüşü ve dönel kavşak yok,
zincirin her bağlantısı ortak node, OSRM sonu ile zincir başı ≤ 5 m.

Çalıştır:
  python3 scripts/kemaliye_tas_yol.py                  # yalnızca hesapla ve özetle (ağ gerekir)
  python3 scripts/kemaliye_tas_yol.py --steps          # OSRM adımlarını ve zinciri de yazdır
  python3 scripts/kemaliye_tas_yol.py --write          # data/routes.json'da path/pathFull/lengthKm'i güncelle
  python3 scripts/kemaliye_tas_yol.py --verify-others  # diğer rotalar HEAD ile birebir aynı mı (ağ gerekmez)
Ardından: python3 scripts/geometry_revision.py --write --date <gün> && python3 scripts/build_map_data.py
"""
import argparse
import json
import subprocess
import sys

from add_spain_route import backtracks, osrm_with_steps
from reroute_routes import (DP_TOLERANCE_M, OSM_API, dedupe, douglas_peucker, get_json, hav, line_m,
                            max_dist_to_line, r5)
from routes_json import ROOT, dump_routes, load_routes

ROUTE_ID = "tr-dogu-anadolu-01"

# (lat, lon): Kemaliye başlangıcı (rotanın mevcut start'ı) → Taş Yol'un D877 ucu (node 3039725855)
START = (39.26215, 38.4965)
TAS_START_NODE = 3039725855
TAS_END_NODE = 2795974769
# Zincir sırası: Taş Yol başı (D877) → Kemaliye–Divriği yolu kavşağı
TAS_WAYS = [299891360, 299891362, 299891370, 1531931134, 193875160, 73905395, 299891381, 299891380, 274928392,
            299891364, 299891359, 299891366, 299891368, 299891363, 299891367, 104673931, 274928391, 274928394,
            274928393, 274928390, 288389069]

BACKTRACK_STEP_TYPES = ("roundabout", "rotary", "roundabout turn", "exit roundabout", "exit rotary")


def tas_chain():
    """OSM API'den zinciri okur; [lon, lat] listesi, way bilgileri."""
    coords, info, cur = [], [], TAS_START_NODE
    for wid in TAS_WAYS:
        d = get_json(f"{OSM_API}way/{wid}/full.json")
        nodes = {e["id"]: e for e in d["elements"] if e["type"] == "node"}
        way = next(e for e in d["elements"] if e["type"] == "way")
        ns = way["nodes"]
        if ns[0] == cur:
            seq = ns
        elif ns[-1] == cur:
            seq = list(reversed(ns))
        else:
            raise RuntimeError(f"way {wid} node {cur} ile bağlanmıyor (uçlar {ns[0]}, {ns[-1]})")
        pts = [[nodes[n]["lon"], nodes[n]["lat"]] for n in seq]
        coords += pts if not coords else pts[1:]
        t = way["tags"]
        info.append({"way": wid, "version": way["version"], "timestamp": way["timestamp"], "from": seq[0],
                     "to": seq[-1], "points": len(seq), "lengthM": round(line_m(pts), 1),
                     "name": t.get("name"), "tunnel": t.get("tunnel"), "surface": t.get("surface"),
                     "maxwidth": t.get("maxwidth"), "maxheight": t.get("maxheight")})
        cur = seq[-1]
    if cur != TAS_END_NODE:
        raise RuntimeError(f"zincir {TAS_END_NODE} yerine {cur} ile bitiyor")
    return coords, info


def build():
    coords, osrm_m, snap, steps = osrm_with_steps([START, (39.2847847, 38.4881379)])
    head = dedupe([r5(c) for c in coords])
    uturns = [st for st in steps if st["maneuver"].get("modifier") == "uturn"]
    if uturns:
        raise RuntimeError(f"OSRM adımlarında U dönüşü var: {[st['maneuver']['location'] for st in uturns]}")
    rounds = [st for st in steps if st["maneuver"]["type"] in BACKTRACK_STEP_TYPES]
    if rounds:
        raise RuntimeError(f"OSRM adımlarında dönel kavşak var: {[st['maneuver']['location'] for st in rounds]}")
    chain, info = tas_chain()
    chain_m = line_m(chain)
    tail = [r5(c) for c in chain]
    if hav(head[-1], tail[0]) > 5:
        raise RuntimeError(f"OSRM sonu ile Taş Yol başı birleşmiyor ({hav(head[-1], tail[0]):.1f} m)")
    full = dedupe(head + tail)
    bad, _cum = backtracks(full)
    if bad:
        raise RuntimeError(f"pathFull gidip-dönme içeriyor: {bad[:5]}")
    length_km = round((osrm_m + chain_m) / 1000.0, 1)
    line_km = line_m(full) / 1000.0
    if abs(line_km - length_km) / length_km > 0.02:
        raise RuntimeError(f"pathFull çizgisi {line_km:.2f} km, lengthKm {length_km} ile ±%2 dışında")
    path = douglas_peucker(full, DP_TOLERANCE_M)
    assert path[0] == full[0] and path[-1] == full[-1]
    return {"pathFull": full, "path": path, "lengthKm": length_km, "lineKm": line_km, "osrmM": osrm_m,
            "chainM": chain_m, "steps": steps, "chain": info, "snapM": [round(x, 1) for x in snap],
            "dev": max_dist_to_line(path, full), "headPoints": len(head)}


def verify_others():
    """Kemaliye dışındaki rotaların geometrisi ve geometryRevision'ı HEAD ile birebir aynı mı."""
    head = json.loads(subprocess.check_output(["git", "show", "HEAD:data/routes.json"], cwd=ROOT))
    cur = {r["id"]: r for r in load_routes()["routes"]}
    bad = []
    if list(cur) != [r["id"] for r in head["routes"]]:
        bad.append(f"rota id listesi değişti: {list(cur)}")
    for o in head["routes"]:
        if o["id"] == ROUTE_ID:
            continue
        r = cur.get(o["id"])
        if r != o:
            bad.append(f"{o['id']}: HEAD'den farklı")
    for line in bad:
        print("FARK:", line)
    print(f"verify-others: {len(head['routes']) - 1} rota", "HEAD ile birebir aynı" if not bad else f"{len(bad)} fark")
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--verify-others", action="store_true")
    ap.add_argument("--steps", action="store_true")
    a = ap.parse_args()
    if a.verify_others:
        return verify_others()
    g = build()
    print(f"{ROUTE_ID}: lengthKm {g['lengthKm']} (OSRM {g['osrmM'] / 1000:.3f} km + Taş Yol zinciri "
          f"{g['chainM'] / 1000:.3f} km); pathFull {len(g['pathFull'])} nokta, çizgi {g['lineKm']:.3f} km "
          f"(fark %{100 * (g['lineKm'] - g['lengthKm']) / g['lengthKm']:+.2f}); path {len(g['path'])} nokta, "
          f"çizgi {line_m(g['path']) / 1000:.3f} km; path→pathFull en büyük uzaklık {g['dev']:.1f} m; "
          f"OSRM yapışma {g['snapM']} m; gidip-dönme, U dönüşü ve dönel kavşak yok")
    if a.steps:
        km = 0.0
        for st in g["steps"]:
            m = st["maneuver"]
            print(f"  km {km / 1000:6.2f} {m['type']:<14} {m.get('modifier') or '':<12} {st.get('ref') or '':<8} "
                  f"{st['name']} ({st['distance']:.0f} m)")
            km += st["distance"]
        for c in g["chain"]:
            print(f"  km {km / 1000:6.2f} way {c['way']} v{c['version']} {c['timestamp'][:10]} {c['name']} "
                  f"tunnel={c['tunnel']} surface={c['surface']} maxwidth={c['maxwidth']} "
                  f"{c['from']}→{c['to']} {c['points']} nokta {c['lengthM']} m")
            km += c["lengthM"]
    if not a.write:
        return 0
    doc = load_routes()
    r = next(x for x in doc["routes"] if x["id"] == ROUTE_ID)
    if [r["start"]["lon"], r["start"]["lat"]] != g["pathFull"][0] or \
            [r["end"]["lon"], r["end"]["lat"]] != g["pathFull"][-1]:
        raise RuntimeError("start/end pathFull uçlarıyla aynı değil")
    r["lengthKm"] = g["lengthKm"]
    r["path"] = {"type": "LineString", "coordinates": g["path"]}
    # pathFull, path'ten hemen sonra (diğer rotalardaki sıra)
    items = list(r.items())
    r.clear()
    for k, v in items:
        if k == "pathFull":
            continue
        r[k] = v
        if k == "path":
            r["pathFull"] = {"type": "LineString", "coordinates": g["pathFull"]}
    dump_routes(doc)
    print("Yazıldı: data/routes.json (sonra geometry_revision.py --write --date <gün>)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
