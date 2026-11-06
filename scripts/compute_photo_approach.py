#!/usr/bin/env python3
"""Fotoğraf noktaları için rota üzerindeki bildirim noktasını (approachPoint) ve sapma mesafelerini hesaplar.

Rotadan uzaktaki bir fotoğraf noktasının bildirimi, rotayı izleyen sürücüye noktanın kendisi yerine
rota çizgisi üzerindeki bir noktadan (approachPoint) tetiklenir; notifyRadiusM bu noktanın çevresinde uygulanır.

Çizgi: bildirimlerle aynı kural, `pathFull ?? path` (prototype/hazards.js > routeLine).

Her nokta için yazılan alanlar (notifyRadiusM'den sonra, verification'dan önce, bu sırayla):
  - approachPoint {lat, lon}: noktaya giden yolun rota çizgisine katıldığı kavşak (çizgiye izdüşürülmüş, 5 ondalık).
      --osrm ile: OSRM (sürüş) noktadan üç hedefe (çizginin noktaya en yakın yeri, rota başı, rota sonu) yol
      bulur; her yolun çizgiye ilk katıldığı yer (çizgiye <= 15 m ve sonraki 200 m boyunca <= 25 m) aday
      kavşaktır; noktaya yolla en yakın aday seçilir. Yol bulunamazsa çizginin noktaya en yakın yeri kullanılır.
  - detourKm: rota çizgisi ile nokta arası kuş uçuşu en kısa mesafe (haversine, 1 ondalık). Gerçek yol değildir.
  - detourRoadKm (karar 6A): kavşak ile nokta arası gerçek yol mesafesi, tek yön (OSRM, 1 ondalık). Yalnızca
      --osrm ile ve OSRM noktayı en fazla SPOT_SNAP_MAX_M uzaktaki bir yola bağlayabildiyse yazılır;
      bulunamazsa alan yazılmaz (uydurulmaz).
  - geometryRevision: hesap anında rotadaki `geometryRevision` nesnesinin aynen kopyası (karar 5A). Bildirim
      modülü rotadakiyle eşit değilse noktayı `stale` sayar (prototype/photo-alerts.js).
Elle tutulan alanlara (ör. reachableFromRoute, karar 2A) ve verification.notes'un betik notundan önceki kısmına
dokunulmaz.

Çalıştırma kipleri:
  python3 scripts/compute_photo_approach.py --osrm [--date YYYY-MM-DD]
      Ağ gerekir (router.project-osrm.org). approachPoint/detourRoadKm/notu yeniden hesaplar.
  python3 scripts/compute_photo_approach.py --osrm --only ID[,ID...]
      Yalnızca verilen nokta (ps-...) ya da rota (routeId) id'lerinin noktalarını hesaplar; diğerlerine dokunulmaz
      (yeni nokta eklerken mevcut noktaların OSRM değerleri ve notları değişmesin diye).
  python3 scripts/compute_photo_approach.py --osrm --check
      Dosyaya yazmaz; hesaplanan alanları (approachPoint, detourKm, detourRoadKm, geometryRevision) dosyadakiyle
      karşılaştırır, farkları basar ve fark varsa 2 ile çıkar. --only ile birlikte kullanılabilir.
  python3 scripts/compute_photo_approach.py
      Ağ gerekmez. geometryRevision'ı rotadakiyle aynı olan (ve approachPoint'i çizgide duran) noktaya dokunmaz;
      bu yüzden değişiklik yokken tekrar çalıştırmak aynı dosyayı üretir. Geometrisi değişmiş rotanın
      noktalarında approachPoint çizginin en yakın yerine alınır, detourRoadKm SİLİNİR (artık doğrulanamaz) ve
      uyarı basılır: ardından --osrm ile çalıştırın.
data/routes.json yalnızca okunur.
Ardından: python3 scripts/build_map_data.py && node prototype/map.test.js
"""
import argparse
import datetime
import json
import math
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTES = ROOT / "data" / "routes.json"
SPOTS = ROOT / "data" / "photo-spots.json"

OSRM = "https://router.project-osrm.org/route/v1/driving/"
UA = {"User-Agent": "route-information-verify/1.0 (github.com/elifyrlkya10-boop/route-information)"}

LONG_DETOUR_KM = 3.0
ON_LINE_M = 5.0          # approachPoint çizgiye bu kadar yakınsa "çizgide" sayılır (testlerle aynı)
JOIN_ON_M = 15.0         # OSRM yolu çizgiye bu kadar yaklaşınca katılmış sayılır...
JOIN_STAY_M = 25.0       # ...ve sonraki JOIN_STAY_LEN_M boyunca bu sınırın içinde kalmalı
JOIN_STAY_LEN_M = 200.0
SPOT_SNAP_MAX_M = 150.0  # OSRM noktayı bundan uzak bir yola bağlarsa detourRoadKm yazılmaz (nokta yolda değil)
NOTE_PREFIX = "Bildirim noktası (approachPoint):"
LONG_PREFIX = "Uzun sapma:"
# Eski, OSRM tabanlı tahmin cümlesi; yerine yeni hesap yazılır.
OLD_DETOUR_RE = re.compile(r"Rotadan ~[\d.,]+ km yan yola sapma gerektirir\. ?")
COMPUTED_KEYS = ("approachPoint", "detourKm", "detourRoadKm", "geometryRevision")


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
    """(uzaklık m, en yakın nokta (lat, lon), çizgi başından uzaklık m)."""
    best, cum = None, 0.0
    for i in range(len(line) - 1):
        q = project(p, line[i], line[i + 1])
        d = haversine_m(p, q)
        if best is None or d < best[0]:
            best = (d, q, cum + haversine_m(line[i], q))
        cum += haversine_m(line[i], line[i + 1])
    return best


def route_line(route):
    """pathFull ?? path, (lat, lon) listesi olarak."""
    g = route.get("pathFull") or route["path"]
    return [(c[1], c[0]) for c in g["coordinates"]]


def get_json(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))


def osrm_route(a, b):
    url = f"{OSRM}{a[1]:.6f},{a[0]:.6f};{b[1]:.6f},{b[0]:.6f}?overview=full&geometries=geojson&steps=false"
    d = get_json(url)
    time.sleep(0.3)  # genel sunucuya nazik ol
    if d.get("code") != "Ok" or not d.get("routes"):
        return None
    return d


def join_point(geo, line):
    """OSRM yolunun (noktadan başlayarak) rota çizgisine ilk kalıcı katıldığı yer: (indeks, yol boyu m) ya da None."""
    cum = [0.0]
    for i in range(1, len(geo)):
        cum.append(cum[-1] + haversine_m(geo[i - 1], geo[i]))
    offs = [nearest_on_line(p, line)[0] for p in geo]
    for i in range(len(geo)):
        if offs[i] > JOIN_ON_M:
            continue
        if all(offs[k] <= JOIN_STAY_M for k in range(i, len(geo)) if cum[k] - cum[i] <= JOIN_STAY_LEN_M):
            return i, cum[i]
    return None


def osrm_junction(p, line):
    """Noktadan rotaya yolla en yakın kavşak: {junction (lat, lon), roadM, snapM, target} ya da None."""
    _, near, _ = nearest_on_line(p, line)
    best = None
    for name, target in (("en yakın yer", near), ("rota başı", line[0]), ("rota sonu", line[-1])):
        d = osrm_route(p, target)
        if d is None:
            continue
        geo = [(c[1], c[0]) for c in d["routes"][0]["geometry"]["coordinates"]]
        m = join_point(geo, line)
        if m is None:
            continue
        cand = {"junction": geo[m[0]], "roadM": m[1], "snapM": d["waypoints"][0]["distance"], "target": name}
        if best is None or cand["roadM"] < best["roadM"]:
            best = cand
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


def place(s, computed):
    """Hesaplanan alanları verification'dan hemen önce, COMPUTED_KEYS sırasıyla yerleştir."""
    rebuilt = {}
    for k, v in s.items():
        if k in COMPUTED_KEYS:
            continue
        if k == "verification":
            rebuilt.update(computed)
        rebuilt[k] = v
    s.clear()
    s.update(rebuilt)


def approach_note(s, line_name, how, date):
    road = s.get("detourRoadKm")
    unreachable = s.get("reachableFromRoute") is False
    if unreachable:
        parts = [f"{NOTE_PREFIX} {how}. Nokta bu rotadan erişilmiyor (reachableFromRoute: false): bildirim üretilmez; "
                 f"alanlar yalnızca bilgi için tutulur."]
    else:
        parts = [f"{NOTE_PREFIX} {how}; bildirim (notifyRadiusM={s['notifyRadiusM']} m) bu noktanın çevresinde tetiklenir."]
    say = "" if unreachable else " sesli bildirim bunu söyler."
    if road is not None:
        parts.append(f"detourRoadKm={km_tr(road)} km bu kavşaktan noktaya gerçek yol mesafesidir (tek yön; OSRM sürüş "
                     f"profili, router.project-osrm.org, {date});{say}".rstrip(";") + ("" if say else "."))
    else:
        parts.append("Gerçek yol mesafesi bulunamadı, detourRoadKm yazılmadı" +
                     ("." if unreachable else "; sesli bildirim kuş uçuşu detourKm'i söyler."))
    parts.append(f"detourKm={km_tr(s['detourKm'])} km rotadan noktaya kuş uçuşu en kısa mesafedir. "
                 f"Çizgi: {line_name}; geometryRevision rotadakinin kopyasıdır (scripts/compute_photo_approach.py).")
    far = road if road is not None else s["detourKm"]
    if far > LONG_DETOUR_KM and not unreachable:
        parts.append(f"{LONG_PREFIX} nokta rotadan {LONG_DETOUR_KM:g} km'den fazla sapma gerektiriyor; bildirim metninde "
                     f"sapma belirtilir, sapma yolu sahada teyit edilmeli.")
    return " ".join(parts)


def set_note(s, note):
    notes = OLD_DETOUR_RE.sub("", s["verification"]["notes"])
    notes = notes.split(NOTE_PREFIX)[0].strip()  # önceki çalıştırmanın notu (sonda) atılır
    s["verification"]["notes"] = (notes + " " + note).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osrm", action="store_true", help="kavşak ve detourRoadKm'i OSRM ile yeniden hesapla (ağ gerekir)")
    ap.add_argument("--date", default=datetime.date.today().isoformat(), help="nota yazılacak OSRM sorgu tarihi")
    ap.add_argument("--only", default="", help="virgülle ayrılmış nokta ya da rota id'leri; yalnızca bunlar hesaplanır")
    ap.add_argument("--check", action="store_true", help="yazma; hesaplanan alanları dosyadakiyle karşılaştır")
    a = ap.parse_args()
    only = {x.strip() for x in a.only.split(",") if x.strip()}

    routes = {r["id"]: r for r in json.loads(ROUTES.read_text(encoding="utf-8"))["routes"]}
    doc = json.loads(SPOTS.read_text(encoding="utf-8"))
    warnings = []

    known = {s["id"] for s in doc["photoSpots"]} | {s["routeId"] for s in doc["photoSpots"]}
    if only - known:
        print(f"--only: bilinmeyen id: {', '.join(sorted(only - known))}", file=sys.stderr)
        return 1
    before = {s["id"]: {k: s.get(k) for k in COMPUTED_KEYS} for s in doc["photoSpots"]}

    for s in doc["photoSpots"]:
        if only and s["id"] not in only and s["routeId"] not in only:
            continue
        r = routes.get(s["routeId"])
        if r is None or len(r["path"]["coordinates"]) < 2:
            print(f"{s['id']}: rota çizgisi yok ({s['routeId']})", file=sys.stderr)
            return 1
        rev = r.get("geometryRevision")
        if rev is None:
            print(f"{s['id']}: rotada geometryRevision yok ({r['id']}); önce scripts/geometry_revision.py", file=sys.stderr)
            return 1
        line = route_line(r)
        line_name = "pathFull" if r.get("pathFull") else "path"
        p = (s["location"]["lat"], s["location"]["lon"])
        dist_m, near, _ = nearest_on_line(p, line)
        detour = round(dist_m / 1000, 1)

        if not a.osrm:
            ap_ = s.get("approachPoint")
            on_line = ap_ and nearest_on_line((ap_["lat"], ap_["lon"]), line)[0] < ON_LINE_M
            if s.get("geometryRevision") == rev and on_line:
                print(f"{s['id']}: güncel, dokunulmadı")
                continue
            computed = {"approachPoint": {"lat": round(near[0], 5), "lon": round(near[1], 5)}, "detourKm": detour,
                        "geometryRevision": dict(rev)}
            place(s, computed)
            set_note(s, approach_note(s, line_name, "rota çizgisinin noktaya en yakın yeri (çevrimdışı hesap)", a.date))
            warnings.append(f"{s['id']}: rota geometrisi değişmiş; approachPoint en yakın yere alındı, detourRoadKm silindi. "
                            f"--osrm ile yeniden çalıştırın.")
            continue

        j = osrm_junction(p, line)
        computed = {}
        if j is not None:
            _, q, _ = nearest_on_line(j["junction"], line)
            computed["approachPoint"] = {"lat": round(q[0], 5), "lon": round(q[1], 5)}
            computed["detourKm"] = detour
            if j["snapM"] <= SPOT_SNAP_MAX_M:
                computed["detourRoadKm"] = round(j["roadM"] / 1000, 1)
            how = (f"noktadan gelen yolun rota çizgisine katıldığı kavşak (OSRM, hedef: {j['target']}; "
                   f"OSRM noktayı {j['snapM']:.0f} m ötedeki yola bağladı)")
            if j["snapM"] > SPOT_SNAP_MAX_M:
                warnings.append(f"{s['id']}: OSRM noktayı {j['snapM']:.0f} m uzaktaki yola bağladı; detourRoadKm yazılmadı")
        else:
            computed["approachPoint"] = {"lat": round(near[0], 5), "lon": round(near[1], 5)}
            computed["detourKm"] = detour
            how = "rota çizgisinin noktaya en yakın yeri (OSRM ile rotaya katılan yol bulunamadı)"
            warnings.append(f"{s['id']}: OSRM ile kavşak bulunamadı; detourRoadKm yazılmadı")
        computed["geometryRevision"] = dict(rev)
        place(s, computed)
        set_note(s, approach_note(s, line_name, how, a.date))
        print(f"{s['id']}: approachPoint={s['approachPoint']} detourKm={s['detourKm']} detourRoadKm={s.get('detourRoadKm')}")

    for w in warnings:
        print("UYARI", w, file=sys.stderr)
    if a.check:
        diffs = 0
        for s in doc["photoSpots"]:
            for k in COMPUTED_KEYS:
                if s.get(k) != before[s["id"]][k]:
                    diffs += 1
                    print(f"FARK {s['id']} {k}: dosyada {before[s['id']][k]} -> hesap {s.get(k)}")
        print(f"--check: {diffs} fark; dosya yazılmadı")
        return 2 if diffs else 0
    SPOTS.write_text(dump(doc), encoding="utf-8")
    print(f"Wrote {SPOTS.relative_to(ROOT)}: {len(doc['photoSpots'])} photo spots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
