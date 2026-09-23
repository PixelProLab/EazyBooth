import { beforeAll, describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { defaults, validate } from "../src/shared/settings";
import { photoRect } from "../src/shared/geometry";
import { Store, atomic, requireSpace } from "../src/main/store";
import { composite, checkAsset } from "../src/main/compositor";
import { Captures } from "../src/main/captures";
import { printPhoto, paperSize, type PrintWindow } from "../src/main/printing";
import { listPhotos, savedFile } from "../src/main/gallery";
import { Reprints } from "../src/main/reprints";
beforeAll(async () => {
  fs.mkdirSync(".evidence/fixtures", { recursive: true });
  await sharp(
    Buffer.from(
      '<svg width="1800" height="1200"><path fill="white" fill-rule="evenodd" d="M0 0H1800V1200H0Z M220 165V1035H1580V165Z"/></svg>',
    ),
  )
    .png()
    .toFile(".evidence/fixtures/frame.png");
  await sharp({
    create: { width: 1800, height: 1200, channels: 3, background: "#ffffff" },
  })
    .png()
    .toFile(".evidence/fixtures/welcome.png");
});
const roots: string[] = [];
function temp() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "eazy-test-"));
  roots.push(p);
  return p;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
describe("saved photo printing", () => {
  async function fixture() {
    const storage = temp(),
      id = crypto.randomUUID();
    const folder = path.join(storage, id);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "final.jpg"), "saved framed photo");
    fs.writeFileSync(path.join(folder, "original.png"), "untouched original");
    atomic(path.join(folder, "record.json"), {
      created: new Date().toISOString(),
      final: "final.jpg",
    });
    return {
      storage,
      id,
      folder,
      config: { ...defaults(storage).printer, name: "HiTi P525L", copies: 2 },
    };
  }
  it("prints an older final with current settings and preserves both image files", async () => {
    const f = await fixture(),
      send = vi.fn(async () => ({
        status: "accepted" as const,
        message: "Windows accepted the print job",
      }));
    const printer = new Reprints(send),
      request = crypto.randomUUID();
    const result = await printer.print(f.storage, f.id, request, f.config);
    expect(result.status).toBe("accepted");
    expect(send).toHaveBeenCalledWith(
      await fs.promises.realpath(path.join(f.folder, "final.jpg")),
      f.config,
    );
    expect(fs.readFileSync(path.join(f.folder, "final.jpg"), "utf8")).toBe(
      "saved framed photo",
    );
    expect(fs.readFileSync(path.join(f.folder, "original.png"), "utf8")).toBe(
      "untouched original",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(f.folder, `reprint-${request}.json`), "utf8"))
        .result.status,
    ).toBe("accepted");
    expect((await listPhotos(f.storage)).items[0].printStatus).toBe("accepted");
    await new Reprints(send).print(f.storage, f.id, request, f.config);
    expect(send).toHaveBeenCalledTimes(1);
    await printer.print(f.storage, f.id, crypto.randomUUID(), f.config);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("coalesces repeated requests and blocks a second job while Windows is pending", async () => {
    const f = await fixture();
    let accept!: (r: any) => void;
    const send = vi.fn(
      () =>
        new Promise<any>((resolve) => {
          accept = resolve;
        }),
    );
    const printer = new Reprints(send),
      request = crypto.randomUUID();
    const pending = printer.print(f.storage, f.id, request, f.config);
    expect(printer.print(f.storage, f.id, request, f.config)).toBe(pending);
    expect(() => printer.print(f.storage, f.id, crypto.randomUUID(), f.config)).toThrow(
      "Wait",
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(printer.busy).toBe(true);
    // A restarted process sees the pre-submission unknown receipt and cannot duplicate the request.
    expect(
      (await new Reprints(send).print(f.storage, f.id, request, f.config)).status,
    ).toBe("unknown");
    accept({ status: "accepted", message: "Windows accepted" });
    await pending;
    expect(printer.busy).toBe(false);
  });
  it("allows a deliberate retry after rejection and reports transport errors as unknown", async () => {
    const f = await fixture();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ status: "failed", message: "Offline" })
      .mockRejectedValueOnce(Error("Transport closed"))
      .mockResolvedValue({ status: "accepted", message: "Windows accepted" });
    const printer = new Reprints(send);
    expect(
      (await printer.print(f.storage, f.id, crypto.randomUUID(), f.config)).status,
    ).toBe("failed");
    expect(
      (await printer.print(f.storage, f.id, crypto.randomUUID(), f.config)).status,
    ).toBe("unknown");
    expect(
      (await printer.print(f.storage, f.id, crypto.randomUUID(), f.config)).status,
    ).toBe("accepted");
  });
  it("rejects invalid IDs and missing final photos before submitting", async () => {
    const f = await fixture(),
      send = vi.fn(),
      printer = new Reprints(send);
    expect(() => printer.print(f.storage, f.id, "../bad", f.config)).toThrow(
      "Invalid print request",
    );
    await expect(
      printer.print(f.storage, "../bad", crypto.randomUUID(), f.config),
    ).rejects.toThrow("Invalid photo ID");
    fs.unlinkSync(path.join(f.folder, "final.jpg"));
    await expect(
      printer.print(f.storage, f.id, crypto.randomUUID(), f.config),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
describe("settings and profile safeguards", () => {
  it("persists atomically outside the app and survives restart", () => {
    const dir = temp(),
      s = new Store(dir);
    s.settings.countdown = 6;
    s.save(s.settings);
    expect(new Store(dir).settings.countdown).toBe(6);
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });
  it("preserves corrupt settings until explicit reviewed save, retaining a backup", () => {
    const dir = temp();
    fs.writeFileSync(path.join(dir, "settings.json"), "broken");
    const s = new Store(dir);
    expect(s.error).toContain("preserved");
    expect(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).toBe("broken");
    s.save(s.settings);
    expect(fs.readdirSync(dir).some((p) => p.startsWith("settings.corrupt-"))).toBe(true);
  });
  it("failed atomic rename leaves the previous file readable", () => {
    const dir = temp(),
      file = path.join(dir, "settings.json");
    atomic(file, { countdown: 3 });
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Error("disk fault");
    });
    expect(() => atomic(file, { countdown: 9 })).toThrow();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).countdown).toBe(3);
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });
  it("hashes the PIN, survives restart, and rate limits incorrect attempts", () => {
    const dir = temp(),
      s = new Store(dir);
    s.unlock("135790");
    expect(fs.readFileSync(path.join(dir, "operator.json"), "utf8")).not.toContain(
      "135790",
    );
    const next = new Store(dir);
    expect(() => next.unlock("135790")).not.toThrow();
    for (let i = 0; i < 5; i++) expect(() => next.unlock("000000")).toThrow();
    expect(() => next.unlock("135790")).toThrow("Wait 30");
  });
  it("does not replace damaged operator credentials", () => {
    const dir = temp(),
      file = path.join(dir, "operator.json");
    fs.writeFileSync(file, "{}");
    expect(() => new Store(dir)).toThrow("damaged");
    expect(fs.readFileSync(file, "utf8")).toBe("{}");
  });
  it.each([NaN, Infinity, -1, 100])("rejects invalid countdown %s", (v) => {
    const s = defaults(temp());
    s.countdown = v;
    expect(() => validate(s)).toThrow();
  });
  it("rejects mismatched mirrors and oversized apertures", () => {
    const s = defaults(temp());
    s.geometry.outputMirror = false;
    expect(() => validate(s)).toThrow("mirror");
    s.geometry.outputMirror = true;
    s.geometry.opening.x = 1;
    expect(() => validate(s)).toThrow("inside");
  });
  it("blocks low disk before new captures", () => {
    vi.spyOn(fs, "statfsSync").mockReturnValue({
      bavail: 1,
      bsize: 4096,
    } as ReturnType<typeof fs.statfsSync>);
    expect(() => requireSpace(temp())).toThrow("512 MB");
  });
});
describe("canonical frame geometry and output", () => {
  it("covers the measured opening and scales offsets in output coordinates", () => {
    const g = defaults(temp()).geometry;
    g.opening = { x: 220, y: 165, width: 1360, height: 870 };
    expect(photoRect(1920, 1080, g)).toEqual({
      x: 127,
      y: 165,
      width: 1547,
      height: 870,
    });
    g.zoom = 2;
    g.offsetX = 30;
    expect(photoRect(1920, 1080, g).x).toBe(-616);
  });
  it("validates the supplied transparent 1800x1200 frame", async () => {
    const m = await checkAsset(".evidence/fixtures/frame.png", true);
    expect(m.width).toBe(1800);
    expect(m.hasAlpha).toBe(true);
  });
  it("rejects opaque artwork as a frame", async () => {
    await expect(checkAsset(".evidence/fixtures/welcome.png", true)).rejects.toThrow(
      "transparent",
    );
  });
  it("composites photo below artwork, preserving mirrored scene geometry and 300 DPI", async () => {
    const s = defaults(temp());
    const original = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#e02030" },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 300,
              height: 400,
              channels: 3,
              background: "#1030e0",
            },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const output = await composite(
      original,
      {
        ...s,
        frameMode: "overlay",
        frame: ".evidence/fixtures/frame.png",
        previewMode: "overlay",
        geometry: {
          ...s.geometry,
          opening: { x: 220, y: 165, width: 1360, height: 870 },
        },
      },
      (p) => p,
    );
    const m = await sharp(output).metadata();
    expect([m.width, m.height, m.density]).toEqual([1800, 1200, 300]);
    const pixel = async (x: number, y: number) => [
      ...(await sharp(output)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer()),
    ];
    expect((await pixel(400, 600))[0]).toBeGreaterThan(180);
    expect((await pixel(1400, 600))[2]).toBeGreaterThan(180);
    expect((await pixel(500, 50)).every((n) => n > 240)).toBe(true);
  });
});
describe("durable session transactions", () => {
  async function fixture() {
    const root = temp(),
      settings = defaults(root),
      print = vi.fn(async () => ({
        status: "accepted" as const,
        message: "Windows accepted",
      }));
    const c = new Captures(() => path.resolve(".evidence/fixtures/frame.png"), print);
    const bytes = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#abcdef" },
    })
      .png()
      .toBuffer();
    return { c, settings, print, bytes: Uint8Array.from(bytes).buffer };
  }
  it("saves original and final independently; coalesces duplicate capture and print", async () => {
    const { c, settings, print, bytes } = await fixture();
    const id = c.begin(settings);
    const first = c.capture(id, bytes);
    expect(c.capture(id, bytes)).toBe(first);
    const r = await first;
    expect(fs.existsSync(r.original!)).toBe(true);
    expect(fs.existsSync(r.final!)).toBe(true);
    const gallery = await listPhotos(settings.storage);
    expect(gallery.total).toBe(1);
    expect(gallery.items[0].id).toBe(id);
    expect(gallery.items[0].thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    // The async native resolver expands Windows 8.3 aliases; the JS sync
    // resolver can retain them. Compare with the same canonical resolver.
    expect(await savedFile(settings.storage, id, "original.png")).toBe(
      await fs.promises.realpath(r.original!),
    );
    await Promise.all([c.print(id), c.print(id)]);
    expect(print).toHaveBeenCalledTimes(1);
    await c.print(id);
    expect(print).toHaveBeenCalledTimes(1);
  });
  it("retake creates a new capture without overwriting abandoned original", async () => {
    const { c, settings, bytes } = await fixture();
    const first = c.begin(settings);
    const a = await c.capture(first, bytes);
    const hash = fs.readFileSync(a.original!);
    const second = c.begin(settings);
    await c.capture(second, bytes);
    expect(first).not.toBe(second);
    expect(fs.readFileSync(a.original!)).toEqual(hash);
    expect(() => c.approve(first)).toThrow("expired");
  });
  it("reset invalidates late results without deleting the saved original", async () => {
    const { c, settings, bytes } = await fixture();
    const id = c.begin(settings);
    const pending = c.capture(id, bytes);
    c.reset();
    const r = await pending;
    expect(fs.existsSync(r.original!)).toBe(true);
    expect(c.active).toBeNull();
    expect(() => c.approve(id)).toThrow("expired");
  });
  it("retains original when composition fails", async () => {
    const { settings, bytes } = await fixture();
    settings.frameMode = "overlay";
    settings.frame = "missing.png";
    const c = new Captures(() => "/missing-frame.png", vi.fn());
    const id = c.begin(settings);
    await expect(c.capture(id, bytes)).rejects.toThrow();
    expect(fs.existsSync(path.join(settings.storage, id, "original.png"))).toBe(true);
  });
  it("raw diagnostic saves only the original", async () => {
    const { c, settings, bytes } = await fixture();
    const id = c.begin(settings),
      r = await c.capture(id, bytes, true);
    expect(r.original).toBeTruthy();
    expect(r.final).toBeUndefined();
    expect(() => c.print(id)).toThrow("Final");
  });
  it("print failure retries only the final file, never capturing again", async () => {
    const { settings, bytes } = await fixture();
    let attempt = 0;
    const print = vi.fn(async () => ({
      status: ++attempt === 1 ? ("failed" as const) : ("accepted" as const),
      message: "test",
    }));
    const c = new Captures(() => path.resolve(".evidence/fixtures/frame.png"), print);
    const id = c.begin(settings);
    await c.capture(id, bytes);
    expect((await c.print(id)).status).toBe("failed");
    expect((await c.print(id, 1, crypto.randomUUID())).status).toBe("accepted");
    expect(print.mock.calls[0]).toEqual(print.mock.calls[1]);
  });
});
describe("Windows print adapter", () => {
  it("uses CP1500 postcard dimensions automatically and preserves explicit paper choices", () => {
    const cfg = defaults(temp()).printer;
    cfg.name = "Canon SELPHY CP1500";
    expect(paperSize(cfg)).toEqual({ width: 100000, height: 148000 });
    cfg.paper = "4x6";
    expect(paperSize(cfg)).toEqual({ width: 101600, height: 152400 });
    const old = defaults(temp()) as any;
    delete old.printer.paper;
    expect(validate(old).printer.paper).toBe("auto");
  });
  function mock() {
    const win = {
      loadURL: vi.fn(async () => {}),
      webContents: {
        executeJavaScript: vi.fn(async () => {}),
        print: vi.fn((_o: unknown, cb: (s: boolean, r?: string) => void) => cb(true)),
      },
      destroy: vi.fn(),
      isDestroyed: () => false,
    };
    return win;
  }
  it("reports Windows acceptance with selected printer, copies and 4x6 paper", async () => {
    const win = mock(),
      cfg = defaults(temp()).printer;
    cfg.name = "HiTi P525L";
    cfg.copies = 2;
    const result = await printPhoto(Buffer.from("test"), cfg, () => win);
    expect(result.status).toBe("accepted");
    expect(win.webContents.print.mock.calls[0][0]).toMatchObject({
      silent: true,
      deviceName: "HiTi P525L",
      copies: 2,
      landscape: true,
      pageSize: { width: 101600, height: 152400 },
      pageRanges: [{ from: 0, to: 0 }],
      pagesPerSheet: 1,
      scaleFactor: 100,
    });
    expect(win.destroy).toHaveBeenCalled();
  });
  it("keeps large JPEGs out of navigation URLs and passes the exact image to decoding", async () => {
    const win = mock(),
      cfg = defaults(temp()).printer;
    cfg.name = "HiTi";
    const image = Buffer.alloc(4 * 1024 * 1024, 173);
    await printPhoto(image, cfg, () => win);
    const url = (win.loadURL.mock.calls as unknown as [string][])[0][0];
    expect(url.length).toBeLessThan(2048);
    const script = (
      win.webContents.executeJavaScript.mock.calls as unknown as [string][]
    )[0][0];
    expect(script).toContain(image.toString("base64"));
    expect(script).toContain("await image.decode()");
  });
  it("never submits a late load after the preparation deadline", async () => {
    const win = mock(),
      cfg = defaults(temp()).printer;
    cfg.name = "HiTi";
    let finish!: () => void;
    win.loadURL.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    expect((await printPhoto(Buffer.from("x"), cfg, () => win, 20)).status).toBe(
      "failed",
    );
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(win.webContents.print).not.toHaveBeenCalled();
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
  });
  it("keeps a missing Windows callback uncertain without automatically resending", async () => {
    const win = mock(),
      cfg = defaults(temp()).printer;
    cfg.name = "HiTi";
    win.webContents.print.mockImplementation(() => {});
    expect((await printPhoto(Buffer.from("x"), cfg, () => win, 20)).status).toBe(
      "unknown",
    );
    expect(win.webContents.print).toHaveBeenCalledTimes(1);
  });
  it("does not use a default printer when selection is empty", async () => {
    const create = vi.fn();
    expect(
      (await printPhoto(Buffer.from("x"), defaults(temp()).printer, create)).status,
    ).toBe("failed");
    expect(create).not.toHaveBeenCalled();
  });
  it("preserves the actual Windows failure reason", async () => {
    const win = mock();
    win.webContents.print.mockImplementation((_o, cb) =>
      cb(false, "Printer unavailable"),
    );
    const cfg = defaults(temp()).printer;
    cfg.name = "Epson";
    expect(await printPhoto(Buffer.from("x"), cfg, () => win)).toEqual({
      status: "failed",
      message: "Printer unavailable",
    });
  });
  it("bounds load failure text so errors cannot flood the operator UI", async () => {
    const win = mock(),
      cfg = defaults(temp()).printer;
    cfg.name = "HiTi";
    win.loadURL.mockRejectedValue(Error("ERR_INVALID_URL " + "A".repeat(3000000)));
    const result = await printPhoto(Buffer.from("x"), cfg, () => win);
    expect(result.status).toBe("failed");
    expect(result.message.length).toBeLessThanOrEqual(600);
    expect(win.webContents.print).not.toHaveBeenCalled();
  });
  it("times out preparation as failed without submitting to Windows", async () => {
    const win = mock();
    win.loadURL.mockImplementation(() => new Promise(() => {}));
    const cfg = defaults(temp()).printer;
    cfg.name = "Epson";
    expect((await printPhoto(Buffer.from("x"), cfg, () => win, 20)).status).toBe(
      "failed",
    );
    expect(win.destroy).toHaveBeenCalled();
  });
  it("treats a throwing submission boundary as uncertain rather than retryable rejection", async () => {
    const win = mock(),
      cfg = defaults(temp()).printer;
    cfg.name = "HiTi";
    win.webContents.print.mockImplementation(() => {
      throw Error("Transport closed after submission");
    });
    const result = await printPhoto(Buffer.from("x"), cfg, () => win);
    expect(result.status).toBe("unknown");
    expect(result.message).toContain("Check the Windows queue");
  });
});
describe("saved photo browsing boundaries", () => {
  it("rejects traversal and invalid pages", async () => {
    const root = temp();
    expect((await listPhotos(path.join(root, "not-created-yet"))).total).toBe(0);
    await expect(savedFile(root, "../private", "final.jpg")).rejects.toThrow(
      "Invalid photo ID",
    );
    await expect(listPhotos(root, -1)).rejects.toThrow("Invalid gallery page");
  });
  it("paginates newest first, skips broken metadata, and uses fixed local image paths", async () => {
    const root = temp();
    for (let n = 0; n < 26; n++) {
      const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
      fs.mkdirSync(path.join(root, id));
      atomic(path.join(root, id, "record.json"), {
        created: new Date(2026, 0, 1, 0, n).toISOString(),
        final: "C:/private/never-read.jpg",
      });
    }
    const first = await listPhotos(root),
      second = await listPhotos(root, 1);
    expect(first.total).toBe(26);
    expect(first.items).toHaveLength(24);
    expect(second.items).toHaveLength(2);
    expect(first.items[0].id).toMatch(/25$/);
    expect(first.items.every((p) => p.thumbnail === "")).toBe(true);
    fs.writeFileSync(path.join(root, first.items[0].id, "record.json"), "broken");
    expect((await listPhotos(root)).total).toBe(25);
  });
});
