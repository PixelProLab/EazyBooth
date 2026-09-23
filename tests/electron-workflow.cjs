const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const evidence =
  process.env.EAZYBOOTH_EVIDENCE_DIR || path.join(os.tmpdir(), "eazy-electron-evidence");
fs.mkdirSync(evidence, { recursive: true });
async function launch(root) {
  const packaged = process.env.EAZYBOOTH_PACKAGED_EXE;
  const instance = await electron.launch({
    executablePath: packaged || require("electron"),
    args: [
      ...(packaged ? [] : ["dist-electron/main/index.js"]),
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    env: { ...process.env, EAZYBOOTH_DATA_DIR: root },
    timeout: 30000,
  });
  // Keep native desktop input out of the synthetic test. Background throttling
  // is disabled by the app, so hidden-window camera/canvas timers still run.
  await instance.evaluate(({ app, BrowserWindow }) => {
    const hide = (win) => {
      win.webContents.setBackgroundThrottling(false);
      win.on("show", () => win.hide());
      win.hide();
    };
    BrowserWindow.getAllWindows().forEach(hide);
    app.on("browser-window-created", (_event, win) => hide(win));
  });
  return instance;
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "eazy-workflow-"));
  let app;
  const errors = [];
  const checks = [];
  try {
    app = await launch(root);
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("heading", { name: "Set your operator PIN" }).waitFor();
    assert.equal(await page.title(), "EazyBooth");
    for (const digit of "135790")
      await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Set PIN & continue" }).click();
    await page.getByRole("heading", { name: "Booth control" }).waitFor();
    // Denied mutation while locked is checked after setup. OS printing is mocked at the Electron boundary.
    await app.evaluate(({ app, BrowserWindow }, evidence) => {
      globalThis.__printCalls = [];
      globalThis.__pdfChecks = [];
      globalThis.__printMode = "failed";
      globalThis.__pendingPrint = null;
      const hook = (win) => {
        win.webContents.getPrintersAsync = async () => [
          {
            name: "EazyBooth Synthetic Printer",
            displayName: "EazyBooth Synthetic Printer",
            description: "Mock only",
            options: {},
          },
          {
            name: "Canon SELPHY CP1500",
            displayName: "Canon SELPHY CP1500",
            description: "Mock only",
            options: {},
          },
          {
            name: "HiTi P525L",
            displayName: "HiTi P525L",
            description: "Mock only",
            options: {},
          },
        ];
        win.webContents.print = async (opts, cb) => {
          globalThis.__printCalls.push(opts);
          // Render the REAL print HTML with Chromium's printing engine. Only
          // the final Windows submission is mocked; no paper is consumed.
          try {
            const pdf = await win.webContents.printToPDF({
              preferCSSPageSize: true,
              printBackground: true,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            });
            const text = pdf.toString("latin1");
            const pages = (text.match(/\/Type\s*\/Page\b/g) || []).length;
            const images = (text.match(/\/Subtype\s*\/Image\b/g) || []).length;
            globalThis.__pdfChecks.push({ pages, images });
            if (pages !== 1 || images < 1)
              throw Error("Print document must contain exactly one page with the photo");
            if (opts.pageRanges?.[0]?.from !== 0 || opts.pageRanges?.[0]?.to !== 0)
              throw Error("Windows submission must select only the photo page");
            globalThis.__lastPDF = pdf.toString("base64");
            globalThis.__firstPDF ||= globalThis.__lastPDF;
          } catch (e) {
            cb(false, String(e));
            return;
          }
          if (globalThis.__printMode === "hold") globalThis.__pendingPrint = cb;
          else
            cb(
              globalThis.__printMode === "accepted",
              globalThis.__printMode === "failed" ? "Synthetic offline printer" : "",
            );
        };
      };
      BrowserWindow.getAllWindows().forEach(hook);
      app.on("browser-window-created", (_e, w) => hook(w));
    }, evidence);
    await page.evaluate(async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "videoinput",
      );
      const s = await window.booth.settings();
      s.frames = [];
      s.canvas = { width: 1800, height: 1200 };
      s.geometry.opening = { x: 0, y: 0, width: 1800, height: 1200 };
      s.printer.orientation = "landscape";
      s.camera.deviceId = devices[0].deviceId;
      s.countdown = 1;
      s.inactivity = 15;
      s.postAction = 0;
      s.fullscreen = false;
      s.printer.name = "EazyBooth Synthetic Printer";
      await window.booth.saveSettings(s);
    });
    await page.getByRole("button", { name: "Lock & return to Welcome" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
    const denied = await page.evaluate(async () => {
      try {
        await window.booth.saveSettings(await window.booth.settings());
        return false;
      } catch {
        return true;
      }
    });
    assert(denied);
    checks.push("main-process PIN gate");
    await page.addInitScript(() => {
      window.__cameraOpens = 0;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        window.__cameraOpens++;
        return original(...args);
      };
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector("video")?.srcObject?.active);
    await page.screenshot({ path: path.join(evidence, "welcome.png") });
    const start = async () => {
      await page.getByRole("button", { name: "Touch anywhere to start" }).click();
      await page.getByRole("button", { name: "Start", exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector("button.start").disabled);
    };
    const shoot = async () => {
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page
        .getByRole("button", { name: "Retake", exact: true })
        .waitFor({ timeout: 15000 });
    };
    await start();
    await page.screenshot({ path: path.join(evidence, "preview.png") });
    await shoot();
    await page.screenshot({ path: path.join(evidence, "review.png") });
    checks.push("Welcome → framed live preview → countdown → saved review");
    assert.equal(await page.evaluate(() => window.__cameraOpens), 1);
    const storage = await page.evaluate(
      async () => (await window.booth.settings()).storage,
    );
    const folders = () =>
      fs
        .readdirSync(storage)
        .filter((p) => fs.existsSync(path.join(storage, p, "record.json")));
    let first = folders()[0];
    assert(fs.existsSync(path.join(storage, first, "original.png")));
    const meta = await sharp(path.join(storage, first, "final.jpg")).metadata();
    assert.deepEqual([meta.width, meta.height], [1800, 1200]);
    await page.getByRole("button", { name: "Retake", exact: true }).click();
    await shoot();
    assert.equal(await page.evaluate(() => window.__cameraOpens), 1);
    assert.equal(folders().length, 2);
    checks.push("retake preserves originals and retains exactly one stream");
    await page.getByRole("button", { name: "Print 1", exact: true }).click();
    await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
    assert(await page.getByAltText("Your final photograph").isVisible());
    await page.screenshot({ path: path.join(evidence, "print-failure.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Print 1", exact: true }).waitFor();
    await app.evaluate(() => {
      globalThis.__printMode = "hold";
    });
    await page.getByRole("button", { name: "Print 1", exact: true }).click();
    await page.getByText("Waiting for Windows to accept the print job…").waitFor();
    await page.waitForTimeout(16000);
    assert(
      await page.getByText("Waiting for Windows to accept the print job…").isVisible(),
    );
    await app.evaluate(() => globalThis.__pendingPrint(true));
    await page.getByRole("button", { name: "Print another copy", exact: true }).waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
    checks.push(
      "failed print stays on review; Cancel; no inactivity reset before Windows acceptance",
    );
    await start();
    await shoot();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
    checks.push("Done approves and resets");
    await start();
    await page.waitForTimeout(16000);
    await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
    assert(await page.evaluate(() => document.querySelector("video").srcObject.active));
    assert.equal(await page.evaluate(() => window.__cameraOpens), 1);
    checks.push("abandoned preview clears guest state while retaining one warm camera");
    await start();
    await page.evaluate(() => {
      document
        .querySelector("video")
        .srcObject.getVideoTracks()[0]
        .dispatchEvent(new Event("ended"));
    });
    await page.getByRole("button", { name: "Reconnect camera" }).waitFor();
    await page.getByRole("button", { name: "Reconnect camera" }).click();
    await page.waitForFunction(() => !document.querySelector("button.start")?.disabled);
    await shoot();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    checks.push("camera disconnect recovery");
    const memorySamples = [];
    for (let cycle = 0; cycle < 8; cycle++) {
      console.log(`Repeated guest cycle ${cycle + 1}/8`);
      await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
      await start();
      await shoot();
      if (cycle === 0) {
        const opens = await page.evaluate(() => window.__cameraOpens);
        await page.evaluate(() =>
          document
            .querySelector("video")
            .srcObject.getVideoTracks()[0]
            .dispatchEvent(new Event("ended")),
        );
        await page.waitForFunction(
          () => document.querySelector("video").srcObject === null,
        );
        await page.getByRole("button", { name: "Retake", exact: true }).click();
        await page.waitForFunction(
          () =>
            document.querySelector("button.start") &&
            !document.querySelector("button.start").disabled,
        );
        await shoot();
        assert.equal(await page.evaluate(() => window.__cameraOpens), opens + 1);
      }
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
      assert(await page.evaluate(() => document.querySelector("video").srcObject.active));
      assert.equal(
        await page.evaluate(
          () => document.querySelector("video").srcObject.getVideoTracks().length,
        ),
        1,
      );
      memorySamples.push(
        await app.evaluate(({ app, BrowserWindow }) => {
          if (BrowserWindow.getAllWindows().length !== 1)
            throw Error("Leaked print window");
          return app.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize, 0);
        }),
      );
    }
    checks.push(
      "8 repeated guest resets retain exactly one warm track with no leaked windows; camera loss during review recovers on Retake",
    );
    await page.keyboard.press("Control+Shift+A");
    for (const digit of "135790")
      await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.getByRole("button", { name: "Printing", exact: true }).click();
    await page
      .getByLabel("Windows printer", { exact: true })
      .selectOption("Canon SELPHY CP1500");
    await page
      .getByLabel("Paper preset", { exact: true })
      .selectOption("selphy-postcard");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.booth.settings()).printer.paper),
      )
      .toBe("selphy-postcard");
    await page.getByLabel("Windows printer", { exact: true }).selectOption("HiTi P525L");
    await expect(page.getByLabel("Paper preset", { exact: true })).toHaveValue("auto");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect
      .poll(() => page.evaluate(async () => (await window.booth.settings()).printer.name))
      .toBe("HiTi P525L");
    await page.screenshot({ path: path.join(evidence, "hiti-printing.png") });
    checks.push(
      "switching Canon to HiTi clears the postcard preset and persists HiTi with Automatic 4x6",
    );
    await page.getByRole("button", { name: "Saved photos", exact: true }).click();
    await page.getByAltText("Saved photo thumbnail").first().waitFor();
    await page.screenshot({ path: path.join(evidence, "gallery.png") });
    await page.getByAltText("Saved photo thumbnail").first().click();
    await page.getByAltText("Saved framed photo").waitFor();
    await page.getByRole("button", { name: "View original", exact: true }).click();
    await page.getByAltText("Saved original photo").waitFor();
    checks.push("saved photos gallery opens framed and original photos");
    const reprintBefore = await app.evaluate(() => globalThis.__printCalls.length);
    const photosBeforeReprint = folders().length;
    await app.evaluate(() => {
      globalThis.__printMode = "failed";
    });
    await page.getByRole("button", { name: "Print framed photo", exact: true }).click();
    await page.getByRole("button", { name: "Retry print", exact: true }).waitFor();
    assert(await page.getByAltText("Saved original photo").isVisible());
    await page.getByRole("button", { name: "Cancel retry", exact: true }).click();
    await app.evaluate(() => {
      globalThis.__printMode = "hold";
      globalThis.__pendingPrint = null;
    });
    await page
      .getByRole("button", { name: "Print framed photo", exact: true })
      .dblclick();
    await page.getByText("Waiting for Windows to accept the saved photo…").waitFor();
    assert(
      await page
        .getByRole("button", { name: "Lock & return to Welcome", exact: true })
        .isDisabled(),
    );
    assert(
      await page
        .getByRole("button", { name: "Back to photos", exact: true })
        .isDisabled(),
    );
    await page.keyboard.press("Control+Shift+A");
    assert.equal(await page.getByLabel("Operator PIN", { exact: true }).count(), 0);
    const blockedReset = await page.evaluate(async () => {
      try {
        await window.booth.reset();
        return false;
      } catch {
        return true;
      }
    });
    assert(blockedReset);
    await expect
      .poll(() => app.evaluate(() => !!globalThis.__pendingPrint), { timeout: 15000 })
      .toBe(true);
    assert.equal(
      await app.evaluate(() => globalThis.__printCalls.length),
      reprintBefore + 2,
    );
    await app.evaluate(() => globalThis.__pendingPrint(true));
    await page.getByRole("button", { name: "Print again", exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, "gallery-print.png") });
    await app.evaluate(() => {
      globalThis.__printMode = "accepted";
    });
    await page.getByRole("button", { name: "Print again", exact: true }).click();
    await page.getByRole("button", { name: "Print again", exact: true }).waitFor();
    assert.equal(
      await app.evaluate(() => globalThis.__printCalls.length),
      reprintBefore + 3,
    );
    const reprintOptions = await app.evaluate(
      (_, offset) => globalThis.__printCalls.slice(offset),
      reprintBefore,
    );
    for (const opts of reprintOptions) {
      assert.equal(opts.deviceName, "HiTi P525L");
      assert.deepEqual(opts.pageSize, { width: 101600, height: 152400 });
      assert.equal(opts.landscape, true);
      assert.equal(opts.copies, 1);
    }
    assert.equal(folders().length, photosBeforeReprint);
    const receipts = folders().flatMap((id) =>
      fs.readdirSync(path.join(storage, id)).filter((f) => f.startsWith("reprint-")),
    );
    assert.equal(receipts.length, 5);
    checks.push(
      "older framed photos print directly; failure/cancel/retry, duplicate-click prevention, accepted reprint and durable receipts",
    );
    await page.getByRole("button", { name: "Camera", exact: true }).click();
    await app.evaluate(() => {
      globalThis.__printMode = "accepted";
    });
    const paperTests = await page.evaluate(async () => {
      const original = await window.booth.settings();
      const results = [];
      for (const paper of ["4x6", "selphy-postcard"]) {
        for (const orientation of ["landscape", "portrait"]) {
          const s = structuredClone(original);
          s.printer.paper = paper;
          s.printer.orientation = orientation;
          s.printer.borderless = orientation === "landscape";
          await window.booth.saveSettings(s);
          results.push(await window.booth.testPrint());
        }
      }
      await window.booth.saveSettings(original);
      return results;
    });
    assert(paperTests.every((r) => r.status === "accepted"));
    await page.getByRole("button", { name: "Test live view", exact: true }).click();
    await page.getByRole("button", { name: "Raw capture test" }).click();
    await page.getByAltText("Original raw camera test").waitFor();
    checks.push("operator live/raw tests");
    await page.getByRole("button", { name: "Readiness", exact: true }).click();
    await page.screenshot({ path: path.join(evidence, "admin-health.png") });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(700, 600),
    );
    await page.getByRole("button", { name: "Camera", exact: true }).click();
    await page.screenshot({ path: path.join(evidence, "admin-compact.png") });
    const footer = await page
      .getByRole("button", { name: "Save settings", exact: true })
      .boundingBox();
    assert(footer && footer.y + footer.height <= 600);
    checks.push("operator controls at 1366×900 and 700×600");
    await page.getByRole("button", { name: "Lock & return to Welcome" }).click();
    const galleryDenied = await page.evaluate(async () => {
      try {
        await window.booth.photos(0);
        return false;
      } catch {
        return true;
      }
    });
    assert(galleryDenied);
    const printDenied = await page.evaluate(async (id) => {
      try {
        await window.booth.printSaved(id, crypto.randomUUID());
        return false;
      } catch {
        return true;
      }
    }, first);
    assert(printDenied);
    const pdfChecks = await app.evaluate(() => globalThis.__pdfChecks);
    assert(pdfChecks.length >= 2);
    assert(pdfChecks.every((p) => p.pages === 1 && p.images > 0));
    fs.writeFileSync(
      path.join(evidence, "print-layout.pdf"),
      Buffer.from(await app.evaluate(() => globalThis.__lastPDF), "base64"),
    );
    fs.writeFileSync(
      path.join(evidence, "print-photo.pdf"),
      Buffer.from(await app.evaluate(() => globalThis.__firstPDF), "base64"),
    );
    checks.push(
      "real Chromium print documents contain one photo page; Windows submission limited to that page",
    );
    await page.addInitScript(() => {
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await get(...args);
        stream
          .getVideoTracks()
          .forEach((t) =>
            Object.defineProperty(t, "label", { value: "Sony Camera (Imaging Edge)" }),
          );
        return stream;
      };
    });
    await page.reload();
    await page.getByRole("button", { name: "Touch anywhere to start" }).click();
    await page.getByText("Please ask the operator to confirm the live view.").waitFor();
    assert(await page.getByRole("button", { name: "Start", exact: true }).isDisabled());
    await page.screenshot({ path: path.join(evidence, "camera-wait.png") });
    await page.keyboard.press("Control+Shift+A");
    for (const digit of "135790")
      await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.getByRole("button", { name: "Camera", exact: true }).click();
    await page
      .getByRole("button", { name: "Confirm live scene — ready for guests", exact: true })
      .click();
    await page.getByRole("button", { name: "Lock & return to Welcome" }).click();
    await start();
    await shoot();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
    assert.equal(await page.evaluate(() => window.__cameraOpens), 1);
    checks.push(
      "Sony-labelled startup concealed until operator confirmation; confirmed stream survives guest reset",
    );
    await app.close();
    app = await launch(root);
    const next = await app.firstWindow();
    await next.getByRole("button", { name: "Touch anywhere to start" }).waitFor();
    const saved = await next.evaluate(() => window.booth.settings());
    assert.equal(saved.countdown, 1);
    assert.equal(saved.printer.name, "HiTi P525L");
    assert(fs.existsSync(path.join(storage, first, "original.png")));
    checks.push("restart preserves settings, PIN and photos");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(evidence, "result.json"),
      JSON.stringify(
        {
          scope: "SYNTHETIC camera and mocked Windows printer; no physical acceptance",
          packaged: !!process.env.EAZYBOOTH_PACKAGED_EXE,
          checks,
          errors,
          printDocuments: pdfChecks,
          combinedWorkingSetKiB: memorySamples,
          profile: root,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ status: "PASS", checks, evidence }, null, 2));
  } catch (error) {
    if (app) {
      const current = app.windows()[0];
      if (current && !current.isClosed()) {
        await current
          .screenshot({ path: path.join(evidence, "failure.png") })
          .catch(() => {});
        console.error(
          await current
            .locator("body")
            .innerText()
            .catch(() => ""),
        );
      }
    }
    throw error;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
