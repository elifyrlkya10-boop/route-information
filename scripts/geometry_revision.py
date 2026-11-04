#!/usr/bin/env python3
"""Her rotanın `geometryRevision` alanını hesaplar / doğrular.

Biçim (kullanıcı kararı 5A, alan adları ve sırası sabit):
    "geometryRevision": {"date": "YYYY-MM-DD", "pathSha256": "<hex>", "pathFullSha256": "<hex>" | null}

Karma: geometrinin `coordinates` dizisinin
    json.dumps(coords, separators=(",", ":"))
metninin UTF-8 baytlarının SHA-256'sı (küçük harf hex). `pathFull` olmayan rotada
`pathFullSha256: null` (alan atlanmaz). Bağlı veriler (ör. fotoğraf noktalarının
approachPoint'i) bu nesneyi kopyalayıp eşitlikle eskimeyi anlayabilir.

`date`, geometrinin son değiştiği gündür. --write yalnızca karması değişen (ya da
alanı olmayan) rotada `date`'i --date değerine çeker; karması aynı kalan rotada
mevcut `date` korunur, yani betiği yeniden çalıştırmak dosyayı değiştirmez.

Çalıştır:
  python3 scripts/geometry_revision.py --check                    # uyuşmazlıkta çıkış kodu 1
  python3 scripts/geometry_revision.py --write --date 2026-11-05  # alanları yaz/güncelle
Ağ erişimi gerekmez.
"""
import argparse
import datetime
import hashlib
import json
import sys

from routes_json import dump_routes, load_routes


def coords_sha256(geometry):
    if geometry is None:
        return None
    text = json.dumps(geometry["coordinates"], separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def expected_hashes(route):
    return coords_sha256(route["path"]), coords_sha256(route.get("pathFull"))


def insert_after(route, after_key, key, value):
    """Alanı belirli bir anahtardan sonra koy (dosyadaki alan sırası okunur kalsın)."""
    items = [(k, v) for k, v in route.items() if k != key]
    out, placed = {}, False
    for k, v in items:
        out[k] = v
        if k == after_key:
            out[key] = value
            placed = True
    if not placed:
        out[key] = value
    route.clear()
    route.update(out)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--write", action="store_true")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    a = ap.parse_args()

    doc = load_routes()
    problems, changed = [], []
    for r in doc["routes"]:
        p, f = expected_hashes(r)
        cur = r.get("geometryRevision")
        ok = (isinstance(cur, dict) and list(cur) == ["date", "pathSha256", "pathFullSha256"]
              and cur["pathSha256"] == p and cur["pathFullSha256"] == f)
        if a.check:
            if not ok:
                problems.append(f"{r['id']}: geometryRevision {cur!r} beklenen pathSha256={p} pathFullSha256={f}")
            else:
                print(f"ok  {r['id']}: {cur['date']} path={p[:12]}… pathFull={(f or 'null')[:12]}")
        elif not ok:
            after = "pathFull" if "pathFull" in r else "path"
            insert_after(r, after, "geometryRevision", {"date": a.date, "pathSha256": p, "pathFullSha256": f})
            changed.append(r["id"])
    if a.check:
        for line in problems:
            print("FAIL", line)
        return 1 if problems else 0
    if changed:
        dump_routes(doc)
    print("Güncellenen rotalar:", ", ".join(changed) if changed else "yok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
