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

  // --- conditional item: rain gear ---
  const RAIN_TEXT = { tr: "Yağmurluk / yağmur kıyafeti", en: "Rain jacket / rain gear", el: "Αδιάβροχο / ρούχα βροχής",
                      es: "Chubasquero / traje de lluvia", pt: "Capa de chuva / roupa de chuva" };
  const ids = page => page.$$eval("#list .item", bs => bs.map(b => b.dataset.id));
  {
    const ctx = await browser.newContext({ locale: "tr-TR" });
    // Capture what gets read aloud (speechSynthesis stub) so spoken text can be checked.
    await ctx.addInitScript(() => {
      window.__spoken = [];
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        cancel() {}, speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); } } });
    });
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, errors);

    await page.goto(URL);
    await step("koşullu madde varsayılan olarak listede yok", async () => {
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      assert.strictEqual(await page.locator('#list .item[data-id="rain"]').count(), 0);
      assert.deepStrictEqual(await page.evaluate(() => window.gearChecklist.conditionals()), []);
    });

    await step("?ek=yagmur ile eklenir, motor kontrolünden hemen önce", async () => {
      await page.goto(URL + "?ek=yagmur");
      const list = await ids(page);
      assert.strictEqual(list.length, N_ITEMS + 1);
      assert.deepStrictEqual(list.slice(-2), ["rain", "bike"]);
      assert.strictEqual(await page.textContent('#list .item[data-id="rain"]'), RAIN_TEXT.tr);
    });

    await step("koşullu madde metni 5 dilde", async () => {
      for (const l of ["en", "el", "es", "pt", "tr"]) {
        await page.selectOption("#lang", l);
        assert.strictEqual(await page.textContent('#list .item[data-id="rain"]'), RAIN_TEXT[l]);
      }
    });

    await step("API ile eklenen madde yenilemede korunur (URL parametresi olmadan)", async () => {
      await page.evaluate(k => localStorage.removeItem(k), KEY);
      await page.goto(URL);
      assert.strictEqual(await page.locator('#list .item[data-id="rain"]').count(), 0);
      assert.strictEqual(await page.evaluate(() => window.gearChecklist.addConditional("rain")), true);
      assert.strictEqual(await page.evaluate(() => window.gearChecklist.addConditional("rain")), false, "ikinci ekleme");
      assert.strictEqual(await page.evaluate(() => window.gearChecklist.addConditional("kar")), false, "bilinmeyen anahtar");
      assert.deepStrictEqual((await ids(page)).slice(-2), ["rain", "bike"]);
      await page.reload();
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS + 1);
      assert.deepStrictEqual((await ids(page)).slice(-2), ["rain", "bike"]);
    });

    await step("sesli okuma koşullu madde için spokenText kullanır, akış sona kadar ilerler", async () => {
      await page.evaluate(() => { window.__spoken = []; });
      for (let i = 0; i < N_ITEMS; i++) await page.click("#start"); // 1st click asks item 0; 6th asks rain (index 5)
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "rain");
      assert.strictEqual(await page.textContent("#status"), RAIN_TEXT.tr);
      const spoken = await page.evaluate(() => window.__spoken);
      assert.strictEqual(spoken[spoken.length - 1], "Yağmur bekleniyor. Yağmurluğunu ya da yağmur kıyafetini aldın mı?");
      await page.click("#start"); // rain -> bike
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "bike");
      await page.click("#start"); // finish
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS + 1);
      assert.strictEqual(await page.textContent("#status"), "Her şey hazır. İyi yolculuklar!");
    });

    await step("sesli okuma metni EN/EL/ES/PT", async () => {
      const want = { en: /Rain is expected/, el: /Αναμένεται βροχή/, es: /Se espera lluvia/, pt: /previsão de chuva/ };
      for (const l of Object.keys(want)) {
        await page.click("#reset");
        await page.selectOption("#lang", l);
        for (let i = 0; i < N_ITEMS; i++) await page.click("#start");
        const spoken = await page.evaluate(() => window.__spoken);
        assert.match(spoken[spoken.length - 1], want[l]);
      }
      await page.selectOption("#lang", "tr");
    });

    await step("tamamlanmış listeye madde eklenirse liste yeniden tamamlanmamış olur", async () => {
      await page.click("#reset");
      await page.evaluate(() => window.gearChecklist.removeConditional("rain"));
      for (let i = 0; i < N_ITEMS + 1; i++) await page.click("#start");
      assert.strictEqual(await page.textContent("#status"), "Her şey hazır. İyi yolculuklar!");
      await page.evaluate(() => window.gearChecklist.addConditional("rain"));
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS);
      assert.strictEqual(await page.textContent("#status"), "");
      await page.click("#start");
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "rain");
    });

    await step("Sıfırla ilerlemeyi siler ama koşullu maddeyi korur", async () => {
      await page.click("#reset");
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
      assert.strictEqual(await page.locator('#list .item[data-id="rain"]').count(), 1);
      const st = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
      assert.deepStrictEqual(st.extras, ["rain"]);
      assert.strictEqual(st.done, undefined);
      await page.reload();
      assert.strictEqual(await page.locator('#list .item[data-id="rain"]').count(), 1);
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
    });

    await step("removeConditional maddeyi kaldırır; Sıfırla sonra kaydı tamamen siler", async () => {
      await page.click("#start"); await page.click("#start");
      assert.strictEqual(await page.evaluate(() => window.gearChecklist.removeConditional("rain")), true);
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      assert.strictEqual(await page.locator("#list .item.done").count(), 1);
      await page.click("#reset");
      assert.strictEqual(await page.evaluate(k => localStorage.getItem(k), KEY), null);
    });

    await step("eski (v1, indeksli) kayıt bozulmaz ve yağmur eklenince kaymaz", async () => {
      // v1 save: items 0..4 done, current = 5 (motor kontrolü), English.
      await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ done: [0, 1, 2, 3, 4], current: 5, finished: false, lang: "en" })), KEY);
      await page.goto(URL + "?ek=yagmur");
      assert.strictEqual(await page.inputValue("#lang"), "en");
      assert.strictEqual(await page.locator("#list .item.done").count(), 5);
      assert.strictEqual(await page.locator('#list .item[data-id="rain"].done').count(), 0);
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "bike");
      const st = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
      assert.strictEqual(st.v, 2);
      assert.deepStrictEqual(st.done, ["intercom", "boots", "jacket", "helmet", "guards"]);
      assert.deepStrictEqual(st.extras, ["rain"], "URL ile eklenen madde kayda yazılır");
      await page.goto(URL); // parametresiz açılışta da korunur
      assert.deepStrictEqual((await ids(page)).slice(-2), ["rain", "bike"]);
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "bike");
    });

    await step("eski tamamlanmış v1 kaydı geçerli; bozuk kayıt sayfayı kırmaz", async () => {
      await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ done: [0, 1, 2, 3, 4, 5], current: -1, finished: true, lang: "tr" })), KEY);
      await page.goto(URL);
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS);
      assert.strictEqual(await page.textContent("#status"), "Her şey hazır. İyi yolculuklar!");
      await page.evaluate(k => localStorage.setItem(k, JSON.stringify({ done: [99, "x", null], current: "nope", extras: ["kar", 3] })), KEY);
      await page.goto(URL);
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
      await page.evaluate(k => localStorage.removeItem(k), KEY);
    });

    await step("?ek=-yagmur maddeyi listeden ve kayıttan kaldırır", async () => {
      await page.goto(URL + "?ek=yagmur");
      for (let i = 0; i < N_ITEMS; i++) await page.click("#start"); // rain is current, 5 done
      await page.click("#start"); // rain done, bike current
      await page.goto(URL + "?ek=-yagmur");
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      assert.strictEqual(await page.locator('#list .item[data-id="rain"]').count(), 0);
      assert.strictEqual(await page.locator("#list .item.done").count(), 5);
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "bike");
      const st = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
      assert.deepStrictEqual(st.extras, []);
      assert.ok(!st.done.includes("rain"));
      await page.goto(URL); // parametresiz açılışta geri gelmez
      assert.strictEqual(await page.locator('#list .item[data-id="rain"]').count(), 0);
      await page.goto(URL + "?ek=-yagmur"); // olmayan maddeyi kaldırmak hata vermez
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      await page.goto(URL + "?ek=yagmur,-yagmur"); // aynı istekte ekle+kaldır: sıra uygulanır, sonuç yok
      assert.strictEqual(await page.locator('#list .item[data-id="rain"]').count(), 0);
      await page.click("#reset");
      await page.evaluate(k => localStorage.removeItem(k), KEY);
    });

    await step("koşullu madde testlerinde konsol hatası yok", async () => {
      assert.deepStrictEqual(errors, []);
    });
    await ctx.close();
  }

  // --- conditional items: cold (thermal layer) and fog (reflective vest / lights) ---
  {
    const COLD_TEXT = { tr: "Termal içlik", en: "Thermal base layer", el: "Ισοθερμικά εσώρουχα",
                        es: "Capa térmica interior", pt: "Segunda pele térmica" };
    const FOG_TEXT = { tr: "Reflektif yelek / ışıklar açık", en: "Reflective vest / lights on", el: "Ανακλαστικό γιλέκο / φώτα αναμμένα",
                       es: "Chaleco reflectante / luces encendidas", pt: "Colete refletivo / faróis acesos" };
    const COLD_SPOKEN = { tr: /Hava soğuk/, en: /It is cold/, el: /Κάνει κρύο/, es: /Hace frío/, pt: /Está frio/ };
    const FOG_SPOKEN = { tr: /Sis bekleniyor/, en: /Fog is expected/, el: /Αναμένεται ομίχλη/, es: /Se espera niebla/, pt: /previsão de neblina/ };
    const ALL = ["intercom", "boots", "cold", "jacket", "helmet", "guards", "rain", "fog", "bike"];
    const ctx = await browser.newContext({ locale: "tr-TR" });
    await ctx.addInitScript(() => {
      window.__spoken = [];
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        cancel() {}, speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); } } });
    });
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, errors);

    await step("?ek=soguk termal içliği ceketten hemen önce ekler; ?ek=cold da çalışır", async () => {
      await page.goto(URL + "?ek=soguk");
      assert.deepStrictEqual(await ids(page), ["intercom", "boots", "cold", "jacket", "helmet", "guards", "bike"]);
      assert.strictEqual(await page.textContent('#list .item[data-id="cold"]'), COLD_TEXT.tr);
      await page.goto(URL + "?ek=-soguk");
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      await page.goto(URL + "?ek=cold");
      assert.deepStrictEqual((await ids(page)).slice(2, 4), ["cold", "jacket"]);
      await page.goto(URL + "?ek=-cold");
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      await page.goto(URL + "?ek=" + encodeURIComponent("SOĞUK")); // Türkçe karakter ve büyük harf
      assert.strictEqual(await page.locator('#list .item[data-id="cold"]').count(), 1);
      await page.goto(URL + "?ek=-soguk");
    });

    await step("?ek=sis reflektif yeleği motor kontrolünden hemen önce ekler; ?ek=fog da çalışır", async () => {
      await page.goto(URL + "?ek=sis");
      assert.deepStrictEqual((await ids(page)).slice(-2), ["fog", "bike"]);
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS + 1);
      assert.strictEqual(await page.textContent('#list .item[data-id="fog"]'), FOG_TEXT.tr);
      await page.goto(URL + "?ek=-sis");
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      await page.goto(URL + "?ek=fog");
      assert.deepStrictEqual((await ids(page)).slice(-2), ["fog", "bike"]);
      await page.goto(URL + "?ek=-fog");
      assert.strictEqual(await page.locator('#list .item[data-id="fog"]').count(), 0);
    });

    await step("üç madde birlikte: tablo sırası (yağmur, sonra sis), ekleme sırasından bağımsız", async () => {
      await page.goto(URL + "?ek=sis,soguk,yagmur");
      assert.deepStrictEqual(await ids(page), ALL);
      await page.goto(URL + "?ek=-yagmur,-sis,-soguk");
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      await page.goto(URL); // parametresiz aç: yenilemede URL komutu tekrar uygulanmasın
      // API ile ters sırada eklense de sıra aynı
      for (const k of ["fog", "cold", "rain"]) assert.strictEqual(await page.evaluate(k => window.gearChecklist.addConditional(k), k), true);
      assert.deepStrictEqual(await ids(page), ALL);
      assert.deepStrictEqual(await page.evaluate(() => window.gearChecklist.available()), ["rain", "cold", "fog"]);
      await page.reload();
      assert.deepStrictEqual(await ids(page), ALL);
    });

    await step("soğuk ve sis maddesi metni 5 dilde", async () => {
      for (const l of ["en", "el", "es", "pt", "tr"]) {
        await page.selectOption("#lang", l);
        assert.strictEqual(await page.textContent('#list .item[data-id="cold"]'), COLD_TEXT[l]);
        assert.strictEqual(await page.textContent('#list .item[data-id="fog"]'), FOG_TEXT[l]);
      }
    });

    await step("sesli okuma soğuk/sis için spokenText kullanır (5 dil), liste sona kadar ilerler", async () => {
      for (const l of ["tr", "en", "el", "es", "pt"]) {
        await page.click("#reset");
        await page.selectOption("#lang", l);
        await page.evaluate(() => { window.__spoken = []; });
        for (let i = 0; i < ALL.length; i++) await page.click("#start");
        const order = await page.evaluate(() => window.__spoken);
        assert.strictEqual(order.length, ALL.length);
        assert.match(order[ALL.indexOf("cold")], COLD_SPOKEN[l]);
        assert.match(order[ALL.indexOf("fog")], FOG_SPOKEN[l]);
        assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "bike");
      }
      await page.selectOption("#lang", "tr");
      await page.click("#start");
      assert.strictEqual(await page.locator("#list .item.done").count(), ALL.length);
      assert.strictEqual(await page.textContent("#status"), "Her şey hazır. İyi yolculuklar!");
    });

    await step("Sıfırla soğuk/sis maddelerini korur; kayıt biçimi aynı (v2, id'ler)", async () => {
      await page.click("#reset");
      const st = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
      assert.deepStrictEqual(Object.keys(st).sort(), ["extras", "v"]);
      assert.strictEqual(st.v, 2);
      assert.deepStrictEqual([...st.extras].sort(), ["cold", "fog", "rain"]);
      await page.reload();
      assert.deepStrictEqual(await ids(page), ALL);
      assert.strictEqual(await page.locator("#list .item.done").count(), 0);
      await page.click("#start"); await page.click("#start"); await page.click("#start"); // intercom, boots done; cold current
      const st2 = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
      assert.deepStrictEqual(st2.done, ["intercom", "boots"]);
      assert.strictEqual(st2.current, "cold");
    });

    await step("?ek=-soguk sorulmakta olan maddeyi kaldırır; diğer işaretler ve sis kalır", async () => {
      await page.goto(URL + "?ek=-soguk");
      assert.deepStrictEqual(await ids(page), ALL.filter(x => x !== "cold"));
      assert.strictEqual(await page.locator("#list .item.done").count(), 2);
      assert.strictEqual(await page.locator("#list .item.current").count(), 0);
      await page.click("#start");
      assert.strictEqual(await page.getAttribute("#list .item.current", "data-id"), "jacket");
      await page.goto(URL + "?ek=-sis,-yagmur");
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS);
      await page.click("#reset");
      assert.strictEqual(await page.evaluate(k => localStorage.getItem(k), KEY), null);
    });

    await step("soğuk/sis testlerinde konsol hatası yok", async () => {
      assert.deepStrictEqual(errors, []);
    });
    await ctx.close();
  }

  // --- conditional item without speech APIs and without storage ---
  {
    const ctx = await browser.newContext({ locale: "tr-TR" });
    await ctx.addInitScript(() => {
      for (const k of ["speechSynthesis", "SpeechSynthesisUtterance", "SpeechRecognition", "webkitSpeechRecognition"]) {
        try { delete window[k]; } catch (_) {}
        try { Object.defineProperty(window, k, { value: undefined, configurable: true }); } catch (_) {}
      }
      Object.defineProperty(window, "localStorage", { get: () => { throw new Error("SecurityError"); }, configurable: true });
    });
    const page = await ctx.newPage();
    const errors = [];
    watchErrors(page, errors);
    await page.goto(URL + "?ek=yagmur");
    await step("ses ve kayıt yokken koşullu maddeli liste butonla tamamlanır", async () => {
      assert.strictEqual(await page.locator("#list .item").count(), N_ITEMS + 1);
      for (let i = 0; i < N_ITEMS + 2; i++) await page.click("#start");
      assert.strictEqual(await page.locator("#list .item.done").count(), N_ITEMS + 1);
      assert.strictEqual(await page.textContent("#status"), "Her şey hazır. İyi yolculuklar!");
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
