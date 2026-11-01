#!/usr/bin/env python3
"""Ajan çalışma sürelerini haftalık ve aylık tablolara dönüştürür.

Girdi : logs/ajan-calismalari.csv  (her ajan çalışması bir satır; saatler Türkiye saati)
Çıktı : docs/ajan-calisma-tablosu.md
Çalıştır: python3 scripts/ajan_sure_tablosu.py
"""
import csv, datetime as dt, pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
AJANLAR = ["rota-uzmani", "ekipman-asistani", "guvenlik-ve-yakin-cevre", "fotograf-noktalari", "hava-durumu"]
AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

def dk(sn):
    return f"{sn / 60:.1f}"

def tablo(baslik, gruplar, etiket):
    satirlar = [f"## {baslik}", ""]
    if not gruplar:
        return satirlar + ["Henüz kayıt yok.", ""]
    for anahtar in sorted(gruplar, reverse=True):
        kayitlar = gruplar[anahtar]
        satirlar += [f"### {etiket(anahtar)}", "",
                     "| Ajan | Çalışma sayısı | Toplam süre (dk) | Ortalama (dk) | En uzun (dk) | Token |",
                     "|---|---:|---:|---:|---:|---:|"]
        top_n = top_sn = top_tok = 0
        for ajan in AJANLAR:
            r = [k for k in kayitlar if k["ajan"] == ajan]
            n, sn, tok = len(r), sum(float(k["sure_sn"]) for k in r), sum(int(k["token"] or 0) for k in r)
            enuzun = max((float(k["sure_sn"]) for k in r), default=0)
            top_n, top_sn, top_tok = top_n + n, top_sn + sn, top_tok + tok
            satirlar.append(f"| {ajan} | {n} | {dk(sn)} | {dk(sn / n) if n else '–'} | {dk(enuzun) if n else '–'} | {tok:,} |".replace(",", "."))
        satirlar += [f"| **Toplam** | **{top_n}** | **{dk(top_sn)}** | | | **{top_tok:,}** |".replace(",", "."), ""]
    return satirlar

def main():
    kayitlar = list(csv.DictReader(open(ROOT / "logs/ajan-calismalari.csv", encoding="utf-8")))
    haftalik, aylik = defaultdict(list), defaultdict(list)
    for k in kayitlar:
        d = dt.date.fromisoformat(k["tarih"])
        haftalik[d - dt.timedelta(days=d.weekday())].append(k)
        aylik[(d.year, d.month)].append(k)
    def hafta(pzt):
        paz = pzt + dt.timedelta(days=6)
        return f"{pzt.isocalendar()[1]}. hafta: {pzt.day} {AYLAR[pzt.month - 1]} – {paz.day} {AYLAR[paz.month - 1]} {paz.year}"
    cikti = ["# Ajan Çalışma Tablosu", "",
             "Bu dosya `scripts/ajan_sure_tablosu.py` ile `logs/ajan-calismalari.csv` kayıtlarından otomatik üretilir; elle düzenlemeyin.",
             "Süreler, her ajanın kendi çalışma süresidir (ajanlar paralel çalıştığı için toplam, gerçek geçen süreden uzundur). Saatler Türkiye saatidir.",
             ""]
    cikti += tablo("Haftalık", haftalik, hafta)
    cikti += tablo("Aylık", aylik, lambda a: f"{AYLAR[a[1] - 1]} {a[0]}")
    cikti += ["## Tüm çalışmalar", "", "| Tarih | Başlangıç | Bitiş | Ajan | Süre (dk) | Durum | İş |", "|---|---|---|---|---:|---|---|"]
    for k in sorted(kayitlar, key=lambda k: (k["tarih"], k["baslangic"]), reverse=True):
        cikti.append(f"| {k['tarih']} | {k['baslangic']} | {k['bitis']} | {k['ajan']} | {dk(float(k['sure_sn']))} | {k['durum']} | {k['is']} |")
    (ROOT / "docs/ajan-calisma-tablosu.md").write_text("\n".join(cikti) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
