import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  session,
  shell,
  powerSaveBlocker,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Profiles } from "./profiles";
import { diskStatus, requireSpace } from "./store";
import { jobPrinter, selectFrame, validate, guestFrames } from "../shared/settings";
import { checkAsset, frameOpening } from "./compositor";
import { Captures } from "./captures";
import { printPhoto } from "./printing";
import { listPhotos, savedFile } from "./gallery";
import { Reprints } from "./reprints";
const root =
  process.env.EAZYBOOTH_DATA_DIR || path.join(app.getPath("appData"), "eazybooth");
app.setName("EazyBooth");
// Use the compositor's sRGB working space instead of a workstation display
// profile altering the guest preview relative to the saved sRGB photograph.
app.commandLine.appendSwitch("force-color-profile", "srgb");
app.setPath("userData", root);
app.setAppUserModelId("com.pixelprolab.eazybooth");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "eazy-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const assetRoot = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, "../..");
let win: BrowserWindow,
  store: Profiles,
  captures: Captures,
  reprints: Reprints,
  unlockedUntil = 0;
let printerBusy = false;
let configurationBusy = false;
const allowedMedia = new Set<string>();
const galleryMedia = new Set<string>();
function resolveAsset(p: string) {
  return store.asset(p);
}
function allow(file: string) {
  allowedMedia.add(path.resolve(file));
  return "eazy-media://local/" + encodeURIComponent(path.resolve(file));
}
function admin() {
  if (Date.now() > unlockedUntil) throw Error("Operator PIN required");
  unlockedUntil = Date.now() + 15 * 60 * 1000;
}
function guard() {
  if (configurationBusy) throw Error("Wait for the event configuration to finish");
  if (store.error) throw Error(store.error);
  if (!store.pinSet) throw Error("Operator setup is required before opening the booth");
}
async function print(file: string, cfg: typeof store.settings.printer) {
  if (printerBusy)
    return {
      status: "failed" as const,
      message: "Another print job is still being submitted. Wait and retry.",
    };
  printerBusy = true;
  try {
    const printers = await win.webContents.getPrintersAsync();
    if (!printers.some((p) => p.name === cfg.name))
      return {
        status: "failed" as const,
        message:
          "Selected Windows printer is unavailable. Ask the operator to select an installed printer.",
      };
    return await printPhoto(
      fs.readFileSync(file),
      cfg,
      () =>
        new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        }),
    );
  } finally {
    printerBusy = false;
  }
}
function register(
  name: string,
  handler: (...args: any[]) => unknown,
  protectedCall = false,
) {
  ipcMain.handle("eazy:" + name, async (e, ...args) => {
    if (e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame)
      throw Error("Untrusted IPC sender");
    if (protectedCall) admin();
    const configurationCall = [
      "saveSettings",
      "pickAsset",
      "createProfile",
      "switchProfile",
    ].includes(name);
    if (configurationCall) {
      if (configurationBusy || captures.busy || reprints.busy || printerBusy)
        throw Error("Wait for the current operation to finish");
      configurationBusy = true;
      try {
        return await handler(...args);
      } finally {
        configurationBusy = false;
      }
    }
    return handler(...args);
  });
}
async function assetHealth() {
  const result = { welcome: true, frame: true, background: true };
  for (const kind of ["welcome", "frame", "background"] as const) {
    if (
      (kind === "frame" && store.settings.frameMode === "none") ||
      (kind === "background" && store.settings.previewMode !== "branded")
    )
      continue;
    if (!store.settings[kind] && kind === "welcome") continue;
    try {
      await checkAsset(
        resolveAsset(store.settings[kind]),
        kind === "frame",
        store.settings.canvas,
      );
    } catch {
      result[kind] = false;
    }
  }
  for (const frame of guestFrames(store.settings)) {
    try {
      await checkAsset(resolveAsset(frame.asset), true, store.settings.canvas);
    } catch {
      result.frame = false;
    }
  }
  return result;
}
async function health() {
  let freeBytes = 0,
    writable = false;
  try {
    ({ freeBytes, writable } = diskStatus(store.settings.storage));
  } catch {}
  const stats = {
    captures: 0,
    approved: 0,
    acceptedPrints: 0,
    failedPrints: 0,
  };
  // Read small metadata only; never load guest image buffers into a long-lived cache.
  if (fs.existsSync(store.settings.storage))
    for (const item of fs.readdirSync(store.settings.storage, {
      withFileTypes: true,
    })) {
      if (!item.isDirectory() || !/^[a-f0-9-]{36}$/.test(item.name)) continue;
      try {
        const r = JSON.parse(
          fs.readFileSync(
            path.join(store.settings.storage, item.name, "record.json"),
            "utf8",
          ),
        );
        if (r.original && !r.raw) stats.captures++;
        if (r.approved) stats.approved++;
        if (r.print?.status === "accepted") stats.acceptedPrints++;
        if (r.print && r.print.status !== "accepted") stats.failedPrints++;
      } catch {}
    }
  return {
    profile: root,
    storage: store.settings.storage,
    freeBytes,
    writable,
    settingsError: store.error,
    ramGB: os.totalmem() / 1024 ** 3,
    stats,
    pinSet: store.pinSet,
    assets: await assetHealth(),
  };
}
async function boot() {
  store = new Profiles(root, path.join(assetRoot, "templates"));
  captures = new Captures(resolveAsset, print);
  reprints = new Reprints(print);
  for (const p of [
    store.settings.welcome,
    store.settings.frame,
    store.settings.background,
    ...store.settings.frames.map((f) => f.asset),
  ])
    if (p) {
      try {
        allow(resolveAsset(p));
      } catch {
        /* Readiness reports missing artwork. */
      }
    }
  protocol.handle("eazy-media", async (req) => {
    try {
      const url = new URL(req.url);
      const file = path.resolve(decodeURIComponent(url.pathname.slice(1)));
      if (
        url.hostname !== "local" ||
        (!allowedMedia.has(file) &&
          !(Date.now() <= unlockedUntil && galleryMedia.has(file)))
      )
        return new Response("Forbidden", { status: 403 });
      return await net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response("Missing media", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, cb) =>
    cb(contents === win?.webContents && permission === "media"),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) => contents === win?.webContents && permission === "media",
  );
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (details, cb) =>
      cb({
        cancel: app.isPackaged || !details.url.startsWith("http://localhost:5174/"),
      }),
  );
  win = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: "#f4f5ef",
    fullscreen: store.settings.fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  register("profiles", () => store.list(), true);
  const activate = (s: typeof store.settings) => {
    captures.reset();
    allowedMedia.clear();
    galleryMedia.clear();
    for (const p of [s.welcome, s.frame, s.background, ...s.frames.map((f) => f.asset)])
      if (p) {
        try {
          allow(resolveAsset(p));
        } catch {}
      }
    win.setFullScreen(s.fullscreen);
    return s;
  };
  register(
    "createProfile",
    (name, duplicate) => {
      if (captures.busy || reprints.busy || printerBusy)
        throw Error("Wait for the current operation");
      return activate(store.create(name, duplicate));
    },
    true,
  );
  register(
    "switchProfile",
    (id) => {
      if (captures.busy || reprints.busy || printerBusy)
        throw Error("Wait for the current operation");
      return activate(store.switch(id));
    },
    true,
  );
  register("settings", () => structuredClone(store.settings));
  register("unlock", (pin: string) => {
    store.unlock(pin);
    unlockedUntil = Date.now() + 15 * 60 * 1000;
  });
  register("lock", () => {
    if (reprints.busy) throw Error("Wait for Windows print status");
    unlockedUntil = 0;
    galleryMedia.clear();
  });
  register("setPin", (pin: string) => store.setPin(pin), true);
  register(
    "saveSettings",
    async (s) => {
      if (captures.busy || reprints.busy)
        throw Error("Wait for the current operation to finish");
      s = validate(s);
      if (s.frameMode === "overlay")
        await checkAsset(resolveAsset(s.frame), true, s.canvas);
      if (s.welcome) await checkAsset(resolveAsset(s.welcome), false);
      if (s.previewMode === "branded")
        await checkAsset(resolveAsset(s.background), false);
      for (const frame of guestFrames(s))
        await checkAsset(resolveAsset(frame.asset), true, s.canvas);
      requireSpace(s.storage);
      const saved = store.save(s);
      allowedMedia.clear();
      galleryMedia.clear();
      for (const p of [
        saved.frame,
        saved.welcome,
        saved.background,
        ...saved.frames.map((f) => f.asset),
      ])
        if (p) allow(resolveAsset(p));
      win.setFullScreen(saved.fullscreen);
      return saved;
    },
    true,
  );
  register("defaults", () => store.defaults(), true);
  register(
    "pickAsset",
    async (kind, canvas) => {
      if (!["welcome", "frame", "background"].includes(kind))
        throw Error("Invalid asset kind");
      const pick = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [
          {
            name: "Artwork",
            extensions: kind === "frame" ? ["png"] : ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (pick.canceled) return null;
      const source = pick.filePaths[0];
      const dest = await store.importAsset(source, kind, canvas);
      allow(dest);
      return dest;
    },
    true,
  );
  register("health", health);
  register("frameOpening", (asset) => frameOpening(resolveAsset(asset)), true);
  register("photos", (page) => listPhotos(store.settings.storage, page), true);
  register(
    "photo",
    async (id, original) => {
      const file = await savedFile(
        store.settings.storage,
        id,
        original ? "original.png" : "final.jpg",
      );
      galleryMedia.clear();
      galleryMedia.add(file);
      return "eazy-media://local/" + encodeURIComponent(file);
    },
    true,
  );
  register(
    "revealPhoto",
    async (id) => {
      shell.showItemInFolder(await savedFile(store.settings.storage, id, "final.jpg"));
    },
    true,
  );
  register(
    "printSaved",
    (id, requestId, copies) => {
      guard();
      if (captures.busy || testPrinting)
        throw Error("Wait for the current operation to finish");
      return reprints.print(
        store.settings.storage,
        id,
        requestId,
        jobPrinter(store.settings, copies),
      );
    },
    true,
  );
  register(
    "openStorage",
    async () => {
      const error = await shell.openPath(store.settings.storage);
      if (error) throw Error(error);
    },
    true,
  );
  register("printers", async () => {
    admin();
    return (await win.webContents.getPrintersAsync()).map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      status: Number((p as unknown as { status?: number }).status) || 0,
    }));
  });
  register(
    "sony",
    async (which) => {
      const links = {
        desktop: "https://imagingedge.sony.net/en/ie-desktop.html",
        webcam: "https://support.d-imaging.sony.co.jp/app/webcam/en/download/",
      };
      if (which !== "desktop" && which !== "webcam") throw Error("Unknown installer");
      await shell.openExternal(links[which as keyof typeof links]);
    },
    true,
  );
  register(
    "hitiDrivers",
    async () => {
      await shell.openExternal(
        "https://www.hiti.com/support/download.aspx?MenuID=72&lang=EN",
      );
    },
    true,
  );
  register("begin", (frameId) => {
    guard();
    if (reprints.busy) throw Error("Wait for Windows print status");
    return captures.begin(selectFrame(store.settings, frameId));
  });
  register("capture", async (id, bytes, raw) => {
    if (raw) admin();
    const r = await captures.capture(id, bytes, !!raw);
    return {
      id: r.id,
      url: allow(r.final || r.original!),
      width: r.width,
      height: r.height,
    };
  });
  register("approve", (id) => captures.approve(id));
  register("print", (id, copies, requestId) => {
    if (typeof requestId !== "string") throw Error("Explicit print request required");
    return captures.print(id, copies, requestId);
  });
  register("reset", () => {
    if (reprints.busy) throw Error("Wait for Windows print status");
    captures.reset();
    for (const p of [...allowedMedia])
      if (
        !p.startsWith(path.join(root, "assets")) &&
        !p.startsWith(path.join(assetRoot, "images")) &&
        ![
          ...[
            store.settings.frame,
            store.settings.welcome,
            store.settings.background,
            ...store.settings.frames.map((f) => f.asset),
          ]
            .filter(Boolean)
            .map(resolveAsset),
        ].includes(p)
      )
        allowedMedia.delete(p);
  });
  let testPrinting = false;
  register(
    "testPrint",
    async () => {
      if (testPrinting || captures.busy || reprints.busy)
        throw Error("A print operation is already running");
      testPrinting = true;
      try {
        const file = path.join(root, "test-print.jpg");
        const svg = Buffer.from(
          '<svg width="1800" height="1200"><rect x="20" y="20" width="1760" height="1160" fill="white" stroke="#006b45" stroke-width="20"/><text x="900" y="570" text-anchor="middle" font-size="90" fill="#006b45">EAZYBOOTH — PRINT TEST</text><text x="900" y="700" text-anchor="middle" font-size="45">6 × 4 inches · 1800 × 1200 · Check all four edges</text></svg>',
        );
        await sharp(svg).jpeg().toFile(file);
        return await print(file, store.settings.printer);
      } finally {
        testPrinting = false;
      }
    },
    true,
  );
  powerSaveBlocker.start("prevent-display-sleep");
  if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await win.loadFile(path.join(__dirname, "../../dist/index.html"));
  win.show();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app
    .whenReady()
    .then(boot)
    .catch((e) => {
      dialog.showErrorBox("EazyBooth — startup problem", String(e.message));
      app.quit();
    });
}
app.on("window-all-closed", () => app.quit());
