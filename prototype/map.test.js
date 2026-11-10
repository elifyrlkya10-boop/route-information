// Playwright test for prototype/map.html (opened via file://)
// Run: python3 scripts/build_map_data.py && node prototype/map.test.js
//
// Console-error policy: every console error and page error fails the test, EXCEPT
// network failures for OpenStreetMap map tiles (tile.openstreetmap.org). Tiles are
// third-party images that may be blocked/unreachable in CI or offline; they do not
// affect app logic. Leaflet itself (unpkg.com) is NOT excluded: if it cannot load,
// the test fails.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");

const URL = "file://" + path.resolve(__dirname, "map.html");
const TILE_HOST = "tile.openstreetmap.org";

// Expected counts come from the generated data file, which mirrors data/*.json.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "map-data.js"), "utf8"), sandbox);
const DATA = JSON.parse(JSON.stringify(sandbox.window.MAP_DATA)); // drop cross-realm prototypes
const SRC_DOC = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/routes.json"), "utf8"));
const SRC_ROUTES = SRC_DOC.routes;
const SRC_SPOTS = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/photo-spots.json"), "utf8")).photoSpots;

// Labels the page shows for each source verification status.
const STATUS_TR = { "doğrulandı": "Doğrulandı", "doğrulanmalı": "Doğrulanmalı" };
const STATUS_EN = { "doğrulandı": "Verified", "doğrulanmalı": "Needs verification" };
const KEMALIYE = SRC_ROUTES.find((r) => r.id === "tr-dogu-anadolu-01");
// reachableFromRoute: missing field = reachable; only an explicit false is "not reachable".
const CENDERE_ID = "ps-tr-guneydogu-anadolu-01-01";
const UNREACHABLE_IDS = SRC_SPOTS.filter((s) => s.reachableFromRoute === false).map((s) => s.id);
const UNREACHABLE_TXT = { tr: "Bu rotadan erişilmiyor", en: "Not reachable from this route" };
// detourRoadKm (one way, by road) is shown when present and > 0; page formats with TR comma / EN dot.
const fmtKm = (x, lang) => { const v = x.toFixed(1); return lang === "tr" ? v.replace(".", ",") : v; };
const ROAD_TXT = { tr: (km) => `yolla ~${fmtKm(km, "tr")} km`, en: (km) => `~${fmtKm(km, "en")} km by road` };
const ROAD_WORD = { tr: "yolla ~", en: "km by road" };
// Expected list structure, derived from data/routes.json: countries (data order) -> regions -> routes.
const regionOf = (r) => SRC_DOC.regions.find((g) => g.id === r.regionId);
const countryOf = (r) => SRC_DOC.countries.find((c) => c.code === regionOf(r).countryCode);
const USED_REGIONS = SRC_DOC.regions.filter((g) => SRC_ROUTES.some((r) => r.regionId === g.id));
const USED_COUNTRIES = SRC_DOC.countries.filter((c) => USED_REGIONS.some((g) => g.countryCode === c.code));
// Same fallback rule as the page: UI language, else English, else first language present.
const pickText = (obj, lang) => { for (const l of [lang, "en", ...Object.keys(obj)]) if (obj[l]) return { text: obj[l], lang: l }; return null; };
// Routes whose texts have no Turkish (e.g. Greek routes: el + en) must fall back to English in the TR UI.
const NO_TR_ROUTES = SRC_ROUTES.filter((r) => !r.name.tr);
const DIFF = { tr: { easy: "Kolay", moderate: "Orta", hard: "Zor" }, en: { easy: "Easy", moderate: "Moderate", hard: "Hard" } };

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name + " -> " + e.message]); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: "tr-TR", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  const ignoredTileErrors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const src = (m.location() && m.location().url) || "";
    if (src.includes(TILE_HOST)) ignoredTileErrors.push(m.text());
    else errors.push(m.text() + (src ? " @ " + src : ""));
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => {
    if (r.url().includes(TILE_HOST)) ignoredTileErrors.push("requestfailed " + (r.failure() && r.failure().errorText));
    else errors.push("requestfailed " + r.url() + " " + (r.failure() && r.failure().errorText));
  });

  await page.goto(URL, { waitUntil: "load" });

  await step(`map-data.js kaynak JSON ile birebir aynı (${SRC_ROUTES.length} rota, ${SRC_DOC.countries.length} ülke, ${SRC_DOC.regions.length} bölge)`, async () => {
    assert.ok(SRC_ROUTES.length >= 1, "no routes in data/routes.json");
    assert.strictEqual(DATA.routes.length, SRC_ROUTES.length);
    assert.deepStrictEqual(DATA.countries, SRC_DOC.countries);
    assert.deepStrictEqual(DATA.regions, SRC_DOC.regions);
    // Every route belongs to a known region and country (the list groups by them).
    for (const r of SRC_ROUTES) assert.ok(regionOf(r) && countryOf(r), r.id + ": unknown region/country");
    // pathFull bilerek map-data.js'e taşınmaz; diğer tüm rota alanları birebir aynı olmalı.
    assert.deepStrictEqual(DATA.routes, SRC_ROUTES.map(({ pathFull, ...r }) => r));
    assert.deepStrictEqual(DATA.photoSpots, SRC_SPOTS);
  });

  await step("Leaflet yüklendi (unpkg 1.9.4)", async () => {
    const v = await page.evaluate(() => typeof L !== "undefined" && L.version);
    assert.strictEqual(v, "1.9.4", "Leaflet not loaded: " + v);
    assert.strictEqual(await page.locator("#notice").isHidden(), true, "error notice is visible");
  });

  await step(`${SRC_ROUTES.length} rota çizgisi SVG'de çizildi, her biri farklı renkte; doğrulanmalı olan kesikli`, async () => {
    assert.strictEqual(await page.locator("path.route-line").count(), SRC_ROUTES.length);
    for (const r of SRC_ROUTES) {
      const el = page.locator(`path.route-line[data-route-id="${r.id}"]`);
      assert.strictEqual(await el.count(), 1, "missing line " + r.id);
      const d = await el.getAttribute("d");
      // At overview zoom Leaflet simplifies short lines to a few pixels; require >= 1 drawn segment.
      assert.ok(/^M-?\d+ -?\d+L/.test(d || ""), "no drawn segment for " + r.id + ": " + d);
      const dash = await el.getAttribute("stroke-dasharray");
      if (r.verification.status === "doğrulanmalı") assert.ok(dash, r.id + " should be dashed");
      else assert.ok(!dash, r.id + " should be solid");
    }
    const strokes = await page.locator("path.route-line").evaluateAll((els) => els.map((e) => e.getAttribute("stroke")));
    assert.strictEqual(new Set(strokes).size, SRC_ROUTES.length, "route colours repeat: " + strokes.join(","));
  });

  await step(`tüm fotoğraf noktaları (${SRC_SPOTS.length}) çizildi; doğrulanmalı olan farklı`, async () => {
    assert.strictEqual(await page.locator("path.photo-spot").count(), SRC_SPOTS.length);
    for (const s of SRC_SPOTS) {
      const el = page.locator(`path.photo-spot[data-spot-id="${s.id}"]`);
      assert.strictEqual(await el.count(), 1, "missing spot " + s.id);
      const dash = await el.getAttribute("stroke-dasharray");
      if (s.verification.status === "doğrulanmalı") assert.ok(dash, s.id + " should be dashed");
      else assert.ok(!dash, s.id + " should be solid");
    }
  });

  await step("OSM atfı görünür", async () => {
    const attr = page.locator(".leaflet-control-attribution");
    assert.ok(await attr.isVisible());
    assert.match(await attr.textContent(), /OpenStreetMap/);
    assert.strictEqual(await attr.locator('a[href="https://www.openstreetmap.org/copyright"]').count(), 1);
  });

  await step("liste ülke ve bölgelere göre gruplu, her rota için ad/uzunluk/zorluk/sezon/durum", async () => {
    assert.strictEqual(await page.locator("#list h2.country").count(), USED_COUNTRIES.length);
    assert.strictEqual(await page.locator("#list h3.region").count(), USED_REGIONS.length);
    assert.strictEqual(await page.locator("#list .route").count(), SRC_ROUTES.length);
    // Document order: country heading -> its region headings -> their routes.
    const seq = await page.locator("#list > *").evaluateAll((els) => els.map((e) =>
      e.matches("h2.country") ? ["c", e.dataset.country, e.textContent] : e.matches("h3.region") ? ["g", e.dataset.region, e.textContent] : ["r", e.dataset.routeId]));
    let curC = null, curG = null;
    const seenRoutes = [];
    for (const [kind, id, text] of seq) {
      if (kind === "c") { curC = id; curG = null; assert.strictEqual(text, pickText(SRC_DOC.countries.find((c) => c.code === id).name, "tr").text); }
      else if (kind === "g") { curG = id; const g = SRC_DOC.regions.find((x) => x.id === id); assert.strictEqual(g.countryCode, curC, id + " under wrong country"); assert.strictEqual(text, pickText(g.name, "tr").text); }
      else { const r = SRC_ROUTES.find((x) => x.id === id); assert.strictEqual(r.regionId, curG, id + " under wrong region"); assert.strictEqual(countryOf(r).code, curC, id + " under wrong country"); seenRoutes.push(id); }
    }
    assert.deepStrictEqual(seenRoutes.sort(), SRC_ROUTES.map((r) => r.id).sort());
    const b = page.locator('.route[data-route-id="tr-dogu-anadolu-01"]');
    const txt = await b.textContent();
    for (const s of ["Kemaliye Taş Yol", KEMALIYE.lengthKm + " km", "Zor", "Mayıs–Ekim", STATUS_TR[KEMALIYE.verification.status]]) assert.ok(txt.includes(s), "missing '" + s + "' in: " + txt);
  });

  await step("dokunma alanları >= 64px (liste, dil, zoom, sıfırla)", async () => {
    const sels = [".route", ".lang button", ".leaflet-control-zoom-in", ".leaflet-control-zoom-out", "#reset-view"];
    for (const s of sels) {
      const boxes = await page.locator(s).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height]));
      assert.ok(boxes.length > 0, "none: " + s);
      for (const [w, h] of boxes) assert.ok(w >= 64 && h >= 64, `${s} is ${w}x${h}`);
    }
  });

  await step("telefon genişliğinde yatay kaydırma yok", async () => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(sw <= cw, `scrollWidth ${sw} > clientWidth ${cw}`);
  });

  await step("her rota TR ve EN arayüzde doğru dilde; Türkçe metni olmayan rota TR'de İngilizceye düşer (lang=\"en\")", async () => {
    assert.ok(NO_TR_ROUTES.length >= 1, "expected at least one route without Turkish text (e.g. Greece)");
    // Route content is in the country's own language(s) and English (TR/EN, EL/EN, ES/EN, ...).
    for (const r of SRC_ROUTES) {
      const langs = countryOf(r).languages;
      assert.ok(langs.includes("en"), `${countryOf(r).code}: languages must include en`);
      for (const k of ["name", "description", "bestSeason"]) for (const l of langs) assert.ok(r[k][l], `${r.id}: ${k}.${l} missing (country languages ${langs})`);
    }
    for (const lang of ["tr", "en"]) {
      await page.locator("#lang-" + lang).click();
      for (const r of SRC_ROUTES) {
        const b = page.locator(`.route[data-route-id="${r.id}"]`);
        const name = pickText(r.name, lang), season = pickText(r.bestSeason, lang);
        assert.strictEqual(await b.locator(".name").textContent(), name.text, `${r.id}/${lang}: name`);
        const meta = await b.locator(".meta").textContent();
        for (const s of [`${r.lengthKm} km`, DIFF[lang][r.difficulty], season.text]) assert.ok(meta.includes(s), `${r.id}/${lang}: missing '${s}' in meta: ${meta}`);
        // Fallback text carries its own language; text in the UI language does not.
        const nameLang = await b.locator(".name > span[lang]").evaluateAll((els) => els.map((e) => e.getAttribute("lang")));
        assert.deepStrictEqual(nameLang, name.lang === lang ? [] : [name.lang], `${r.id}/${lang}: lang attr`);
      }
      for (const c of USED_COUNTRIES) assert.strictEqual(await page.textContent(`#list h2.country[data-country="${c.code}"]`), pickText(c.name, lang).text);
    }
    await page.locator("#lang-tr").click();
    for (const r of NO_TR_ROUTES) {
      assert.ok(r.name.en && r.description.en && r.bestSeason.en, r.id + ": English text required as fallback");
      await page.locator(`.route[data-route-id="${r.id}"]`).click();
      await page.waitForTimeout(400);
      const d = await page.textContent("#detail");
      for (const s of [r.name.en, r.description.en, r.bestSeason.en, `${r.lengthKm} km`, "Ülke", countryOf(r).name.en, "Bölge", regionOf(r).name.en, r.start.name, r.end.name]) {
        assert.ok(d.includes(s), `${r.id}: detail missing '${s}'`);
      }
      assert.strictEqual(await page.getAttribute("#detail h3 > span", "lang"), "en");
      const inView = await page.evaluate((rid) => mapApp.map.getBounds().contains(mapApp.routeLayers[rid].getBounds()), r.id);
      assert.ok(inView, r.id + ": route not in view after click");
    }
  });

  await step("listede rotaya tıklayınca harita o rotaya yakınlaşır", async () => {
    await page.locator("#reset-view").click();
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => mapApp.map.getZoom());
    // Overview (reset) shows every route of every country.
    const outOfView = await page.evaluate(() => Object.entries(mapApp.routeLayers)
      .filter(([, l]) => !mapApp.map.getBounds().contains(l.getBounds())).map(([id]) => id));
    assert.deepStrictEqual(outOfView, [], "routes outside the overview: " + outOfView.join(", "));
    for (const id of ["tr-dogu-anadolu-01", "tr-marmara-01"]) {
      await page.locator(`.route[data-route-id="${id}"]`).click();
      await page.waitForTimeout(600);
      const r = await page.evaluate((rid) => {
        const m = mapApp.map, rb = mapApp.routeLayers[rid].getBounds(), vb = m.getBounds();
        return { zoom: m.getZoom(), contains: vb.contains(rb), centerIn: rb.pad(0.5).contains(m.getCenter()),
                 pressed: document.querySelector(`.route[data-route-id="${rid}"]`).getAttribute("aria-pressed") };
      }, id);
      assert.ok(r.zoom > before, `${id}: zoom ${r.zoom} not > overview ${before}`);
      assert.ok(r.contains, id + ": route not fully in view");
      assert.ok(r.centerIn, id + ": map not centered on route");
      assert.strictEqual(r.pressed, "true");
    }
    assert.match(await page.textContent("#detail"), /Uludağ Yolu/);
  });

  await step("her rota haritada kaynak koordinatlarında (lat/lon yer değiştirmez, güney/batı işareti korunur); her ülkenin rotasına tıklanınca harita oraya gider", async () => {
    // Expected bounds straight from data/routes.json path ([lon, lat]); Leaflet layer bounds must match exactly.
    const want = Object.fromEntries(SRC_ROUTES.map((r) => {
      const lats = r.path.coordinates.map((c) => c[1]), lons = r.path.coordinates.map((c) => c[0]);
      return [r.id, [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)]];
    }));
    const got = await page.evaluate(() => Object.fromEntries(Object.entries(mapApp.routeLayers).map(([id, l]) => {
      const b = l.getBounds(); return [id, [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]];
    })));
    for (const r of SRC_ROUTES) {
      want[r.id].forEach((v, k) => assert.ok(Math.abs(got[r.id][k] - v) < 1e-9, `${r.id}: layer bounds ${got[r.id]} != data ${want[r.id]}`));
    }
    // Southern / western hemisphere routes (e.g. Brazil) stay there on the map.
    for (const r of SRC_ROUTES.filter((x) => x.start.lat < 0 || x.start.lon < 0)) {
      const [s, w, n, e] = got[r.id];
      if (r.start.lat < 0) assert.ok(n < 0, `${r.id}: expected south of the equator, north edge ${n}`);
      if (r.start.lon < 0) assert.ok(e < 0, `${r.id}: expected west of Greenwich, east edge ${e}`);
    }
    // One route per used country (first in data order): clicking it zooms in and centres the map on it.
    await page.locator("#lang-tr").click();
    for (const c of USED_COUNTRIES) {
      const r = SRC_ROUTES.find((x) => countryOf(x).code === c.code);
      await page.locator("#reset-view").click();
      await page.waitForTimeout(400);
      const before = await page.evaluate(() => mapApp.map.getZoom());
      await page.locator(`.route[data-route-id="${r.id}"]`).click();
      await page.waitForTimeout(600);
      const v = await page.evaluate((rid) => {
        const m = mapApp.map, rb = mapApp.routeLayers[rid].getBounds();
        return { zoom: m.getZoom(), contains: m.getBounds().contains(rb), centerIn: rb.pad(0.5).contains(m.getCenter()) };
      }, r.id);
      assert.ok(v.zoom > before && v.contains && v.centerIn, `${c.code}/${r.id}: ${JSON.stringify(v)} (overview zoom ${before})`);
    }
    // Restore the previous step's state (Uludağ selected) for the steps below.
    await page.locator('.route[data-route-id="tr-marmara-01"]').click();
    await page.waitForTimeout(600);
  });

  await step("dil değişince metinler değişir (TR -> EN -> TR)", async () => {
    assert.strictEqual(await page.textContent("#title"), "Rota Haritası");
    await page.locator("#lang-en").click();
    assert.strictEqual(await page.textContent("#title"), "Route Map");
    assert.strictEqual(await page.getAttribute("html", "lang"), "en");
    const txt = await page.locator('.route[data-route-id="tr-dogu-anadolu-01"]').textContent();
    for (const s of ["Kemaliye Stone Road", "Hard", "May–October", STATUS_EN[KEMALIYE.verification.status]]) assert.ok(txt.includes(s), "missing '" + s + "'");
    assert.ok((await page.locator("#list h3.region").allTextContents()).includes("Black Sea"));
    assert.match(await page.textContent("#detail"), /Uludağ Road/);
    assert.match(await page.textContent("#legend"), /Needs verification/);
    await page.locator("#lang-tr").click();
    assert.strictEqual(await page.textContent("#title"), "Rota Haritası");
  });

  await step("her fotoğraf noktası açılır penceresi başlığı ve kaynak verideki durumu gösterir", async () => {
    for (const s of SRC_SPOTS) {
      // Read this marker's own popup (the previous one may still be fading out in the DOM).
      const txt = await page.evaluate((id) => {
        const m = mapApp.spotLayers[id]; m.openPopup();
        const el = m.getPopup().getElement();
        return el && el.isConnected ? el.querySelector(".leaflet-popup-content").textContent : "";
      }, s.id);
      // Same fallback rule as the page (tr -> en -> first language); fallback text carries its own lang attribute.
      const title = pickText(s.title, "tr");
      assert.ok(title && txt.includes(title.text), `${s.id}: title missing in popup: ${txt.slice(0, 80)}`);
      const titleLang = await page.evaluate((id) => {
        const el = mapApp.spotLayers[id].getPopup().getElement();
        const sp = el && el.querySelector(".leaflet-popup-content strong > span[lang]");
        return sp ? sp.getAttribute("lang") : null;
      }, s.id);
      assert.strictEqual(titleLang, title.lang === "tr" ? null : title.lang, `${s.id}: popup title lang attr`);
      const want = STATUS_TR[s.verification.status];
      assert.ok(want, `${s.id}: unknown status ${s.verification.status}`);
      assert.ok(txt.includes(want), `${s.id}: expected status '${want}' in popup`);
      for (const other of Object.values(STATUS_TR)) if (other !== want) assert.ok(!txt.includes(other), `${s.id}: wrong status '${other}'`);
    }
    await page.evaluate(() => mapApp.map.closePopup());
  });

  await step("reachableFromRoute: false noktası soluk işaretçi + lejant; pencerede TR/EN ibare ve detourRoadKm", async () => {
    // Karar 12 (Cendere) henüz cevaplanmadı; veri değişirse bu beklenti de güncellenmeli.
    assert.deepStrictEqual(UNREACHABLE_IDS, [CENDERE_ID], "unexpected unreachable set: " + UNREACHABLE_IDS);
    const reachableIds = SRC_SPOTS.filter((s) => s.reachableFromRoute !== false).map((s) => s.id);
    assert.ok(reachableIds.length >= 1, "no reachable photo spots");
    assert.strictEqual(reachableIds.length + UNREACHABLE_IDS.length, SRC_SPOTS.length);
    const drawnReachable = await page.locator("path.photo-spot:not(.unreachable)").evaluateAll((els) => els.map((e) => e.getAttribute("data-spot-id")));
    assert.deepStrictEqual(drawnReachable.sort(), [...reachableIds].sort(), "reachable markers differ from data");
    const popupText = (id) => page.evaluate((sid) => {
      const m = mapApp.spotLayers[sid]; m.openPopup();
      const el = m.getPopup().getElement();
      return el && el.isConnected ? el.querySelector(".leaflet-popup-content").textContent : "";
    }, id);
    for (const s of SRC_SPOTS) {
      const unr = s.reachableFromRoute === false;
      const el = page.locator(`path.photo-spot[data-spot-id="${s.id}"]`);
      const cls = (await el.getAttribute("class")) || "";
      assert.strictEqual(cls.includes("unreachable"), unr, `${s.id}: unreachable class ${cls}`);
      const fo = Number(await el.getAttribute("fill-opacity"));
      if (unr) assert.ok(fo < 0.5, `${s.id}: should be faded, fill-opacity ${fo}`);
      else assert.strictEqual(fo, 1, `${s.id}: should not be faded, fill-opacity ${fo}`);
    }
    for (const lang of ["tr", "en"]) {
      await page.locator("#lang-" + lang).click();
      assert.match(await page.textContent("#legend-unreachable"), lang === "tr" ? /Bu rotadan erişilmeyen/ : /Not reachable from this route/);
      for (const s of SRC_SPOTS) {
        const txt = await popupText(s.id);
        assert.ok(txt.includes(pickText(s.title, lang).text), `${s.id}/${lang}: popup not rendered: ${txt.slice(0, 60)}`);
        const has = txt.includes(UNREACHABLE_TXT[lang]);
        assert.strictEqual(has, s.reachableFromRoute === false, `${s.id}/${lang}: unreachable note shown=${has}`);
        for (const other of Object.values(UNREACHABLE_TXT)) if (other !== UNREACHABLE_TXT[lang]) assert.ok(!txt.includes(other), `${s.id}/${lang}: wrong-language note`);
        if (typeof s.detourRoadKm === "number" && s.detourRoadKm > 0) {
          assert.ok(txt.includes(ROAD_TXT[lang](s.detourRoadKm)), `${s.id}/${lang}: expected '${ROAD_TXT[lang](s.detourRoadKm)}' in: ${txt}`);
        } else {
          assert.ok(!txt.includes(ROAD_WORD[lang]), `${s.id}/${lang}: road detour shown without detourRoadKm > 0`);
        }
      }
      await page.evaluate(() => mapApp.map.closePopup());
    }
    await page.locator("#lang-tr").click();
    const c = await popupText(CENDERE_ID);
    assert.ok(c.includes("yolla ~16,7 km"), "Cendere TR road detour: " + c);
    await page.evaluate(() => mapApp.map.closePopup());
  });

  await step("konsol hatası yok (OSM karo ağ hataları hariç)", async () => {
    assert.deepStrictEqual(errors, []);
  });

  if (process.env.MAP_SCREENSHOT) await page.screenshot({ path: process.env.MAP_SCREENSHOT }).catch(() => {});
  await browser.close();

  for (const [s, n] of results) console.log(s + "  " + n);
  const kinds = {}; ignoredTileErrors.forEach((e) => { kinds[e] = (kinds[e] || 0) + 1; });
  console.log(`ignored tile errors: ${ignoredTileErrors.length}`, JSON.stringify(kinds));
  const failed = results.filter(([s]) => s === "FAIL").length;
  console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
})();
