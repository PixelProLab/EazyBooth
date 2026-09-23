import { it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Profiles } from "../src/main/profiles";
import { defaults, validate, jobPrinter } from "../src/shared/settings";
import { composite, checkAsset } from "../src/main/compositor";
import { photoRect, photoClip, cameraGeometry, drawPhoto } from "../src/shared/geometry";
import { Captures } from "../src/main/captures";
const roots: string[] = [];
function temp() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "eazy-events-"));
  roots.push(p);
  return p;
}
afterEach(() => {
  for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true });
});
const image = () =>
  sharp({ create: { width: 480, height: 320, channels: 3, background: "#e03030" } })
    .png()
    .toBuffer();
async function frame(file: string, w: number, h: number) {
  await sharp(
    Buffer.from(
      `<svg width="${w}" height="${h}"><path fill="#203ce0" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z M30 30V${h - 30}H${w - 30}V30Z"/></svg>`,
    ),
  )
    .png()
    .toFile(file);
}
it("creates, duplicates and switches isolated profiles without copying photos; survives restart", async () => {
  const root = temp(),
    p = new Profiles(root),
    first = p.settings.profileId;
  p.unlock("135790");
  p.save({ ...p.settings, eventName: "First event", countdown: 7 });
  fs.mkdirSync(p.settings.storage, { recursive: true });
  fs.writeFileSync(path.join(p.settings.storage, "private-photo"), "first only");
  const source = path.join(root, "source.webp");
  await sharp(await image())
    .webp()
    .toFile(source);
  const artwork = await p.importAsset(source, "welcome", p.settings.canvas);
  p.save({ ...p.settings, welcome: artwork });
  fs.unlinkSync(source);
  const second = p.create("Second event", first);
  expect(second.profileId).not.toBe(first);
  expect(second.countdown).toBe(7);
  expect(second.welcome).not.toBe(artwork);
  expect(fs.existsSync(second.welcome)).toBe(true);
  expect(fs.existsSync(second.storage)).toBe(false);
  p.save({ ...second, countdown: 2 });
  const restarted = new Profiles(root);
  expect(restarted.settings.profileId).toBe(second.profileId);
  expect(restarted.settings.countdown).toBe(2);
  expect(restarted.pinSet).toBe(true);
  restarted.unlock("135790");
  expect(restarted.switch(first).countdown).toBe(7);
  expect(
    fs.readFileSync(path.join(restarted.settings.storage, "private-photo"), "utf8"),
  ).toBe("first only");
  expect(() => restarted.save(second)).toThrow("another event");
  expect(() => restarted.switch("../outside")).toThrow("Invalid");
});
it("retains corrupted event configuration until explicit save and keeps a backup", () => {
  const p = new Profiles(temp()),
    cfg = path.join(p.folder(), "settings.json");
  fs.writeFileSync(cfg, "damaged");
  const next = new Profiles(p.root);
  expect(next.error).toContain("preserved");
  expect(fs.readFileSync(cfg, "utf8")).toBe("damaged");
  next.save(next.settings);
  expect(
    fs.readdirSync(next.folder()).some((n) => n.startsWith("settings.corrupt-")),
  ).toBe(true);
});
it.each(["welcome", "frame", "background"] as const)(
  "copies and decodes %s before activation; invalid import preserves previous artwork",
  async (kind) => {
    const p = new Profiles(temp()),
      source = path.join(p.root, "upload.png");
    await frame(source, 1800, 1200);
    const imported = await p.importAsset(source, kind, p.settings.canvas);
    p.save({ ...p.settings, [kind]: imported });
    fs.unlinkSync(source);
    expect(new Profiles(p.root).settings[kind]).toBe(imported);
    await checkAsset(imported, kind === "frame", p.settings.canvas);
    fs.writeFileSync(source, "invalid image");
    await expect(p.importAsset(source, kind, p.settings.canvas)).rejects.toThrow();
    expect(p.settings[kind]).toBe(imported);
    expect(() => p.save({ ...p.settings, [kind]: source })).toThrow("managed");
  },
);
it("rejects external photo storage and foreign event assets", async () => {
  const p = new Profiles(temp()),
    id = p.settings.profileId,
    source = path.join(p.root, "source.png");
  await frame(source, 1800, 1200);
  const asset = await p.importAsset(source, "frame", p.settings.canvas);
  p.create("Another");
  expect(() => p.save({ ...p.settings, frame: asset })).toThrow("managed");
  expect(() =>
    p.save({ ...p.settings, storage: path.join(p.folder(id), "photos") }),
  ).toThrow("isolated");
});
it.each([
  [1800, 1200],
  [1200, 1800],
  [1920, 1080],
  [1600, 1600],
  [720, 950],
])("composes frame-free %sx%s output without requiring artwork", async (w, h) => {
  const s = defaults(temp());
  s.canvas = { width: w, height: h };
  s.geometry.opening = { x: 0, y: 0, width: w, height: h };
  validate(s);
  const resolve = vi.fn(() => {
    throw Error("No artwork expected");
  });
  const output = await composite(await image(), s, resolve);
  const m = await sharp(output).metadata();
  expect([m.width, m.height, m.density]).toEqual([w, h, 300]);
  expect(resolve).not.toHaveBeenCalled();
});
it.each([
  [600, 400],
  [400, 600],
])("composes transparent %sx%s frame above the unmirrored artwork", async (w, h) => {
  const s = defaults(temp());
  s.canvas = { width: w, height: h };
  s.geometry.opening = { x: 0, y: 0, width: w, height: h };
  s.frameMode = "overlay";
  s.frame = path.join(s.storage, "frame.png");
  await frame(s.frame, w, h);
  const output = await composite(await image(), s, (p) => p);
  const edge = await sharp(output)
    .extract({ left: 4, top: 4, width: 1, height: 1 })
    .raw()
    .toBuffer();
  expect(edge[2]).toBeGreaterThan(180);
  const middle = await sharp(output)
    .extract({ left: 100, top: 100, width: 1, height: 1 })
    .raw()
    .toBuffer();
  expect(middle[0]).toBeGreaterThan(180);
  await expect(checkAsset(s.frame, true, { width: h, height: w })).rejects.toThrow(
    "transparent",
  );
});
it.each([false, true])(
  "clips camera to the same shared rectangle above background, frame=%s",
  async (withFrame) => {
    const s = defaults(temp());
    s.canvas = { width: 600, height: 400 };
    s.previewMode = "branded";
    s.geometry.opening = { x: 100, y: 80, width: 240, height: 240 };
    s.background = path.join(s.storage, "background.png");
    await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#20d020" },
    })
      .png()
      .toFile(s.background);
    if (withFrame) {
      s.frameMode = "overlay";
      s.frame = path.join(s.storage, "frame.png");
      await frame(s.frame, 600, 400);
    }
    const rect = photoRect(480, 320, cameraGeometry(s)),
      clip = photoClip(rect, s);
    expect(clip).toEqual(s.geometry.opening);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawPhoto(ctx, {} as CanvasImageSource, rect, true);
    expect(ctx.translate).toHaveBeenCalledWith(rect.x + rect.width, rect.y);
    const output = await composite(await image(), s, (p) => p);
    const outside = await sharp(output)
      .extract({ left: 70, top: 100, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(outside[1]).toBeGreaterThan(150);
    const inside = await sharp(output)
      .extract({ left: 110, top: 100, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(inside[0]).toBeGreaterThan(180);
  },
);
it("rejects huge/fractional canvases and invalid copy counts", () => {
  const s = defaults(temp());
  for (const canvas of [
    { width: 4096, height: 4096 },
    { width: 1200.5, height: 800 },
    { width: 100, height: 600 },
  ])
    expect(() => validate({ ...s, canvas })).toThrow();
  for (const n of [0, 11, 1.5, NaN, Infinity]) expect(() => jobPrinter(s, n)).toThrow();
  expect(jobPrinter(s, 3).copies).toBe(3);
  expect(s.printer.copies).toBe(1);
});
it("Print 1 and More Prints have durable request IDs, immutable finals and per-job copies", async () => {
  const s = defaults(temp());
  s.printer.copies = 4;
  const send = vi.fn(async () => ({
    status: "accepted" as const,
    message: "Windows accepted the print job",
  }));
  const c = new Captures((p) => p, send),
    id = c.begin(s),
    bytes = Uint8Array.from(await image()).buffer;
  const record = await c.capture(id, bytes),
    before = fs.readFileSync(record.final!);
  const request = crypto.randomUUID();
  await Promise.all([c.print(id, 1, request), c.print(id, 1, request)]);
  expect(send).toHaveBeenCalledTimes(1);
  await c.print(id, 1, request);
  expect(send).toHaveBeenCalledTimes(1);
  await c.print(id, 3, crypto.randomUUID());
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.map((args: any) => args[1].copies)).toEqual([1, 3]);
  expect(s.printer.copies).toBe(4);
  expect(fs.readFileSync(record.final!)).toEqual(before);
  expect(() => c.print(id, 11, crypto.randomUUID())).toThrow();
});
