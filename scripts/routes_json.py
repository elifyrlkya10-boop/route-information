"""data/routes.json okuma/yazma yardımcıları (rota betikleri ortak kullanır).

Dosya biçimi: 2 boşluk girinti, ensure_ascii=False; `pathFull.coordinates` dizisi
her satırda bir `[lon, lat]` olacak biçimde sıkıştırılır (dosya küçük kalsın).
`dump_routes(load_routes())` dosyayı bayt bayt aynı üretir.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTES = ROOT / "data" / "routes.json"


def load_routes(path=ROUTES):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dumps_routes(doc):
    marks = {}
    clone = json.loads(json.dumps(doc))
    for r in clone["routes"]:
        full = r.get("pathFull")
        if full is not None:
            key = f"@@PATHFULL:{r['id']}@@"
            marks[key] = full["coordinates"]
            full["coordinates"] = key
    text = json.dumps(clone, ensure_ascii=False, indent=2)
    for key, coords in marks.items():
        # "coordinates": "<key>" satırının girintisini bul
        needle = f'"{key}"'
        i = text.index(needle)
        line_start = text.rindex("\n", 0, i) + 1
        indent = len(text[line_start:]) - len(text[line_start:].lstrip(" "))
        inner = " " * (indent + 2)
        body = ",\n".join(inner + json.dumps(c, separators=(", ", ": ")) for c in coords)
        text = text.replace(needle, "[\n" + body + "\n" + " " * indent + "]", 1)
    return text + "\n"


def dump_routes(doc, path=ROUTES):
    Path(path).write_text(dumps_routes(doc), encoding="utf-8")
