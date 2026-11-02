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
const SRC_ROUTES = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/routes.json"), "utf8")).routes;
const SRC_SPOTS = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/photo-spots.json"), "utf8")).photoSpots;

// Labels the page shows for each source verification status.
const STATUS_TR = { "doğrulandı": "Doğrulandı", "doğrulanmalı": "Doğrulanmalı" };
const STATUS_EN = { "doğrulandı": "Verified", "doğrulanmalı": "Needs verification" };
const KEMALIYE = SRC_ROUTES.find((r) => r.id === "tr-dogu-anadolu-01");

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

  await step("map-data.js kaynak JSON ile birebir aynı (7 rota)", async () => {
    assert.strictEqual(SRC_ROUTES.length, 7);
    // pathFull bilerek map-data.js'e taşınmaz; diğer tüm rota alanları birebir aynı olmalı.
    assert.deepStrictEqual(DATA.routes, SRC_ROUTES.map(({ pathFull, ...r }) => r));
    assert.deepStrictEqual(DATA.photoSpots, SRC_SPOTS);
  });

  await step("Leaflet yüklendi (unpkg 1.9.4)", async () => {
    const v = await page.evaluate(() => typeof L !== "undefined" && L.version);
    assert.strictEqual(v, "1.9.4", "Leaflet not loaded: " + v);
    assert.strictEqual(await page.locator("#notice").isHidden(), true, "error notice is visible");
  });

  await step("7 rota çizgisi SVG'de çizildi; doğrulanmalı olan kesikli", async () => {
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

  await step("liste bölgelere göre gruplu, her rota için ad/uzunluk/zorluk/sezon/durum", async () => {
    assert.strictEqual(await page.locator("#list h2").count(), 7);
    assert.strictEqual(await page.locator("#list .route").count(), 7);
    const b = page.locator('.route[data-route-id="tr-dogu-anadolu-01"]');
    const txt = await b.textContent();
    for (const s of ["Kemaliye Taş Yol", "11.1 km", "Zor", "Mayıs–Ekim", STATUS_TR[KEMALIYE.verification.status]]) assert.ok(txt.includes(s), "missing '" + s + "' in: " + txt);
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

  await step("listede rotaya tıklayınca harita o rotaya yakınlaşır", async () => {
    const before = await page.evaluate(() => mapApp.map.getZoom());
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

  await step("dil değişince metinler değişir (TR -> EN -> TR)", async () => {
    assert.strictEqual(await page.textContent("#title"), "Rota Haritası");
    await page.locator("#lang-en").click();
    assert.strictEqual(await page.textContent("#title"), "Route Map");
    assert.strictEqual(await page.getAttribute("html", "lang"), "en");
    const txt = await page.locator('.route[data-route-id="tr-dogu-anadolu-01"]').textContent();
    for (const s of ["Kemaliye Stone Road", "Hard", "May–October", STATUS_EN[KEMALIYE.verification.status]]) assert.ok(txt.includes(s), "missing '" + s + "'");
    assert.ok((await page.locator("#list h2").allTextContents()).includes("Black Sea"));
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
      assert.ok(txt.includes(s.title.tr), `${s.id}: title missing in popup: ${txt.slice(0, 80)}`);
      const want = STATUS_TR[s.verification.status];
      assert.ok(want, `${s.id}: unknown status ${s.verification.status}`);
      assert.ok(txt.includes(want), `${s.id}: expected status '${want}' in popup`);
      for (const other of Object.values(STATUS_TR)) if (other !== want) assert.ok(!txt.includes(other), `${s.id}: wrong status '${other}'`);
    }
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
