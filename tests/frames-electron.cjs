const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  sharp = require("sharp");
const evidence =
  process.env.EAZYBOOTH_FRAME_EVIDENCE ||
  path.join(
    os.tmpdir(),
    process.env.EAZYBOOTH_PACKAGED_EXE ? "eazy-frames-packaged" : "eazy-frames-source",
  );
fs.mkdirSync(evidence, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "eazy-two-frame-"));
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
async function launch() {
  const packaged = process.env.EAZYBOOTH_PACKAGED_EXE;
  const app = await electron.launch({
    executablePath: packaged || require("electron"),
    args: [
      ...(packaged ? [] : ["dist-electron/main/index.js"]),
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    env: { ...process.env, EAZYBOOTH_DATA_DIR: root },
    timeout: 30000,
  });
  await app.evaluate(({ app, BrowserWindow }) => {
    const hide = (w) => {
      w.webContents.setBackgroundThrottling(false);
      w.on("show", () => w.hide());
      w.hide();
    };
    BrowserWindow.getAllWindows().forEach(hide);
    app.on("browser-window-created", (_, w) => hide(w));
  });
  return app;
}
(async () => {
  let app;
  const checks = [],
    errors = [];
  try {
    app = await launch();
    const page = await app.firstWindow();
    page.setDefaultTimeout(25000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("heading", { name: "Set your operator PIN" }).waitFor();
    assert.equal(
      await page.getByLabel("Operator PIN", { exact: true }).getAttribute("inputmode"),
      "none",
    );
    for (const digit of "135790")
      await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Set PIN & continue" }).click();
    await page.getByRole("heading", { name: "Booth control" }).waitFor();
    const initial = await page.evaluate(() => window.booth.settings());
    assert.equal(initial.frames.length, 2);
    assert.deepEqual(initial.canvas, { width: 2400, height: 3600 });
    await app.evaluate(({ app, BrowserWindow }) => {
      globalThis.__jobs = [];
      const hook = (w) => {
        w.webContents.getPrintersAsync = async () => [
          { name: "HiTi Synthetic", displayName: "HiTi Synthetic", options: {} },
        ];
        w.webContents.print = async (opts, cb) => {
          try {
            const src = await w.webContents.executeJavaScript(
              'document.querySelector("img").src',
            );
            const pdf = await w.webContents.printToPDF({
              preferCSSPageSize: true,
              printBackground: true,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            });
            const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || [])
              .length;
            globalThis.__jobs.push({ opts, src, pages, pdf: pdf.toString("base64") });
            cb(true);
          } catch (e) {
            cb(false, String(e));
          }
        };
      };
      BrowserWindow.getAllWindows().forEach(hook);
      app.on("browser-window-created", (_, w) => hook(w));
    });
    await page.evaluate(async () => {
      const s = await window.booth.settings();
      s.camera.deviceId = (await navigator.mediaDevices.enumerateDevices()).find(
        (d) => d.kind === "videoinput",
      ).deviceId;
      s.countdown = 1;
      s.inactivity = 90;
      s.postAction = 0;
      s.fullscreen = false;
      s.printer.name = "HiTi Synthetic";
      s.printer.copies = 2;
      await window.booth.saveSettings(s);
    });
    await page.getByRole("button", { name: "Lock & return to Welcome" }).click();
    await page.addInitScript(() => {
      window.__opens = 0;
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        window.__opens++;
        return get(...args);
      };
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector("video")?.srcObject?.active);
    await page.screenshot({ path: path.join(evidence, "welcome.png") });
    for (const n of [1, 2]) {
      await page.getByRole("button", { name: "Touch anywhere to start" }).click();
      await page.getByRole("heading", { name: "Choose your frame" }).waitFor();
      assert.equal(await page.locator(".frame-choice").count(), 2);
      await page.screenshot({ path: path.join(evidence, `choices-${n}.png`) });
      await page.getByRole("button", { name: `Frame ${n}`, exact: false }).click();
      await expect(
        page.getByRole("button", { name: "Start", exact: true }),
      ).toBeEnabled();
      await page.evaluate(() => document.querySelector("video").pause());
      await page.waitForTimeout(120);
      const previewBytes = await page.locator("canvas").screenshot();
      const pm = await sharp(previewBytes).metadata();
      const preview = {
        url: "data:image/png;base64," + previewBytes.toString("base64"),
        width: pm.width,
        height: pm.height,
      };
      await page.screenshot({ path: path.join(evidence, `live-frame-${n}.png`) });
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("button", { name: "Retake", exact: true }).waitFor();
      await page.evaluate(() => document.querySelector("video").play());
      const storage = initial.storage,
        folders = fs
          .readdirSync(storage)
          .filter((id) => fs.existsSync(path.join(storage, id, "final.jpg")));
      const records = folders.map((id) => ({
        id,
        ...JSON.parse(fs.readFileSync(path.join(storage, id, "record.json"), "utf8")),
      }));
      const record = records.sort((a, b) => b.created.localeCompare(a.created))[0];
      assert.equal(record.settings.selectedFrameId, `frame-${n}`);
      const final = fs.readFileSync(path.join(storage, record.id, "final.jpg")),
        original = fs.readFileSync(path.join(storage, record.id, "original.png"));
      const m = await sharp(final).metadata();
      assert.deepEqual([m.width, m.height, m.density], [2400, 3600, 300]);
      const a = await sharp(Buffer.from(preview.url.split(",")[1], "base64"))
        .removeAlpha()
        .raw()
        .toBuffer();
      const b = await sharp(final)
        .resize(preview.width, preview.height, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
      const mae = sum / a.length;
      fs.writeFileSync(path.join(evidence, `debug-final-${n}.jpg`), final);
      fs.writeFileSync(path.join(evidence, `debug-preview-${n}.png`), previewBytes);
      assert(mae < 8, `Preview/final pixel difference too large: ${mae}`);
      fs.writeFileSync(path.join(evidence, `final-${n}.jpg`), final);
      fs.writeFileSync(
        path.join(evidence, `preview-${n}.png`),
        Buffer.from(preview.url.split(",")[1], "base64"),
      );
      await page.getByRole("button", { name: "Print 1", exact: true }).click();
      await page
        .getByRole("button", { name: "Print another copy", exact: true })
        .waitFor();
      if (n === 1) {
        await page.getByRole("button", { name: "More Prints", exact: true }).click();
        await page.getByRole("button", { name: "Clear", exact: true }).click();
        await page.getByRole("button", { name: "3", exact: true }).click();
        await page.getByRole("button", { name: "Confirm", exact: true }).click();
        await page
          .getByRole("button", { name: "Print another copy", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Print another copy", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Print another copy", exact: true })
          .waitFor();
      }
      const jobs = await app.evaluate(() => globalThis.__jobs);
      const matching = jobs.filter(
        (j) => hash(Buffer.from(j.src.split(",")[1], "base64")) === hash(final),
      );
      assert.equal(matching.length, n === 1 ? 3 : 1);
      assert.deepEqual(
        matching.map((j) => j.opts.copies),
        n === 1 ? [1, 3, 1] : [1],
      );
      for (const j of matching) {
        assert.equal(j.pages, 1);
        assert.equal(j.opts.landscape, false);
        assert.equal(j.opts.deviceName, "HiTi Synthetic");
        assert.deepEqual(j.opts.pageRanges, [{ from: 0, to: 0 }]);
        assert.equal(j.opts.pagesPerSheet, 1);
        assert.equal(j.opts.scaleFactor, 100);
      }
      fs.writeFileSync(
        path.join(evidence, `print-frame-${n}.pdf`),
        Buffer.from(matching[0].pdf, "base64"),
      );
      assert.equal(
        hash(fs.readFileSync(path.join(storage, record.id, "original.png"))),
        hash(original),
      );
      assert.equal(
        hash(fs.readFileSync(path.join(storage, record.id, "final.jpg"))),
        hash(final),
      );
      assert.equal(
        (await page.evaluate(() => window.booth.settings())).printer.copies,
        2,
      );
      await page.evaluate(() => document.querySelector("video").play());
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
      checks.push({
        frame: n,
        previewFinalMAE: mae,
        output: [m.width, m.height],
        printJobs: matching.length,
      });
    }
    assert.equal(await page.evaluate(() => window.__opens), 1);
    await page.keyboard.press("Control+Shift+G");
    for (const digit of "135790")
      await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.getByRole("heading", { name: "Saved photos", exact: true }).waitFor();
    await page.getByAltText("Saved photo thumbnail").first().click();
    await page.getByRole("button", { name: "More Prints", exact: true }).click();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.getByRole("button", { name: "4", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Print again", exact: true }).waitFor();
    assert.equal((await app.evaluate(() => globalThis.__jobs)).at(-1).opts.copies, 4);
    await page.getByRole("button", { name: "Branding", exact: true }).click();
    await page.screenshot({ path: path.join(evidence, "branding.png") });
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.screenshot({ path: path.join(evidence, "layout.png") });
    await page.getByRole("button", { name: "Profiles / Events", exact: true }).click();
    await page.getByLabel("New event name", { exact: true }).fill("Duplicated event");
    await page.getByRole("button", { name: "Duplicate Profile", exact: true }).click();
    await expect
      .poll(() => page.evaluate(async () => (await window.booth.settings()).eventName))
      .toBe("Duplicated event");
    const duplicate = await page.evaluate(() => window.booth.settings());
    assert.notEqual(duplicate.storage, initial.storage);
    assert(duplicate.frames.every((f, i) => f.asset !== initial.frames[i].asset));
    assert(
      !fs.existsSync(duplicate.storage) || fs.readdirSync(duplicate.storage).length === 0,
    );
    await page.screenshot({ path: path.join(evidence, "profiles.png") });
    await page.getByRole("button", { name: "Lock & return to Welcome" }).click();
    await app.close();
    app = await launch();
    const next = await app.firstWindow();
    await next.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
    const restored = await next.evaluate(() => window.booth.settings());
    assert.equal(restored.profileId, duplicate.profileId);
    assert.equal(restored.frames.length, 2);
    assert(restored.frames.every((f) => fs.existsSync(f.asset)));
    assert(fs.existsSync(restored.welcome));
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(evidence, "result.json"),
      JSON.stringify(
        {
          status: "PASS",
          scope:
            "Actual Electron and Sharp, supplied artwork, synthetic camera, mocked Windows submission; physical paper output unverified",
          checks,
          warmCameraOpens: 1,
          galleryCopies: 4,
          profileDuplication: true,
          restart: true,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ status: "PASS", checks, evidence }, null, 2));
  } catch (e) {
    if (app) {
      const p = app.windows()[0];
      if (p && !p.isClosed()) {
        await p.screenshot({ path: path.join(evidence, "failure.png") }).catch(() => {});
        console.error(
          await p
            .locator("body")
            .innerText()
            .catch(() => ""),
        );
      }
    }
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
