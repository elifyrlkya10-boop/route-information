// Playwright smoke test for prototype/checklist.html
// Run: node prototype/checklist.test.js
const { chromium } = require("playwright");
const path = require("path");
const assert = require("assert");

const URL = "file://" + path.resolve(__dirname, "checklist.html");
const N_ITEMS = 6;
const KEY = "gear-checklist-v1";

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name + " -> " + e.message]); }
}

function watchErrors(page, errors) {
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(e.message));
}

(async () => {
  const browser = await chromium.launch();

  // --- main flow: progress, persistence, reset ---
  {
    const ctx = await browser.newContext({ locale: "tr-TR" });
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(URL);

    await step("sayfa yüklenir, 6 madde var", async () => {
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      assert.strictEqual(await page.textContent("#title"), "Ekipman Kontrolü");
    });

    await step("ana butonlar ve maddeler >= 64px yükseklik", async () => {
      const sels = ["#start", "#reset", "#lang"];
      for (const s of sels) {
        const h = (await page.locator(s).boundingBox()).height;
        assert.ok(h >= 64, `${s} height ${h}`);
      }
      for (const b of await page.locator("#list .item").all()) {
        const h = (await b.boundingBox()).height;
        assert.ok(h >= 64, `item height ${h}`);
      }
    });

    await step("buton ile 3 adım ilerle", async () => {
      await page.click("#start");               // starts at item 0
      await page.click("#start");               // 0 done -> 1
      await page.click("#start");               // 1 done -> 2
      assert.strictEqual(await page.locator("#list .item.done").count(), 2);
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-index"), "2");
    });

    await step("dil değişimi (EN) uygulanır", async () => {
      await page.selectOption("#lang", "en");
      assert.strictEqual(await page.textContent("#title"), "Gear Check");
    });

    await step("yenilemeden sonra durum korunur (tamamlanan, adım, dil)", async () => {
      await page.reload();
      assert.strictEqual(await page.locator("#list .item.done").count(), 2);
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-index"), "2");
      assert.strictEqual(await page.inputValue("#lang"), "en");
      assert.strictEqual(await page.textContent("#title"), "Gear Check");
      assert.strictEqual(await page.textContent("#start"), "✓ OK, next");
    });

    await step("liste sonuna kadar butonla ilerler", async () => {
      for (let i = 0; i < N_ITEMS - 2; i++) await page.click("#start");
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS);
      assert.strictEqual(await page.locator("#list .item.current").count(), 0);
      assert.strictEqual(await page.textContent("#status"), "All set. Ride safe!");
    });

    await step("tamamlanmış durum yenilemede korunur", async () => {
      await page.reload();
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS);
      assert.strictEqual(await page.textContent("#status"), "All set. Ride safe!");
    });

    await step("Sıfırla durumu ve localStorage'ı temizler", async () => {
      await page.click("#reset");
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
      assert.strictEqual(await page.locator("#list .item.current").count(), 0);
      assert.strictEqual(await page.evaluate(k => localStorage.getItem(k), KEY), null);
      await page.reload();
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
    });

    await step("ana akışta konsol hatası yok", async () => {
      assert.deepStrictEqual(errors, []);
    });
    await ctx.close();
  }

  // --- no speech APIs ---
  {
    const ctx = await browser.newContext({ locale: "tr-TR" });
    await ctx.addInitScript(() => {
      for (const k of ["speechSynthesis", "SpeechSynthesisUtterance", "SpeechRecognition", "webkitSpeechRecognition"]) {
        try { delete window[k]; } catch (_) {}
        try { Object.defineProperty(window, k, { value: undefined, configurable: true }); } catch (_) {}
      }
    });
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(URL);

    await step("ses API'leri yokken iki uyarı da görünür", async () => {
      assert.ok(await page.isVisible("#notice"));
      assert.match(await page.textContent("#notice-tts"), /speechSynthesis/);
      assert.match(await page.textContent("#notice-sr"), /SpeechRecognition/);
      assert.match(await page.textContent("#notice"), /Butonlarla devam/);
    });

    await step("ses yokken uyarı dil değişince çevrilir (EL/ES/PT)", async () => {
      for (const [l, re] of [["el", /κουμπιά/], ["es", /botones/], ["pt", /botões/], ["tr", /Butonlarla/]]) {
        await page.selectOption("#lang", l);
        assert.match(await page.textContent("#notice"), re);
      }
    });

    await step("ses yokken liste butonla baştan sona ilerler, sıfırlama çalışır", async () => {
      for (let i = 0; i < N_ITEMS + 1; i++) await page.click("#start");
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS);
      assert.strictEqual(await page.textContent("#status"), "Her şey hazır. İyi yolculuklar!");
      await page.click("#reset");
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
    });

    await step("ses yokken konsol hatası yok", async () => {
      assert.deepStrictEqual(errors, []);
    });
    await ctx.close();
  }

  // --- only SpeechRecognition missing ---
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      for (const k of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        try { delete window[k]; } catch (_) {}
        try { Object.defineProperty(window, k, { value: undefined, configurable: true }); } catch (_) {}
      }
    });
    const page = await ctx.newPage();
    await page.goto(URL);
    await step("yalnızca ses tanıma yoksa sadece o uyarı görünür", async () => {
      assert.strictEqual(await page.locator("#notice-sr").count(), 1);
      assert.strictEqual(await page.locator("#notice-tts").count(), 0);
    });
    await ctx.close();
  }

  // --- localStorage throws ---
  {
    const ctx = await browser.newContext({ locale: "tr-TR" });
    await ctx.addInitScript(() => {
      const boom = () => { throw new Error("SecurityError: storage disabled"); };
      Object.defineProperty(window, "localStorage", { get: boom, configurable: true });
    });
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(URL);
    await step("localStorage hata fırlatırsa sayfa çalışır", async () => {
      for (let i = 0; i < N_ITEMS + 1; i++) await page.click("#start");
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS);
      await page.click("#reset");
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
      assert.match(await page.textContent("#notice"), /kaydedilemiyor/);
      assert.deepStrictEqual(errors, []);
    });
    await ctx.close();
  }

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  const failed = results.filter(r => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
