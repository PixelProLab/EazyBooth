import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { atomic, writeImage, requireSpace } from "./store";
import { Reprints } from "./reprints";
import { jobPrinter } from "../shared/settings";
import { composite } from "./compositor";
import type { Settings, PrintResult } from "../shared/types";
interface RecordData {
  id: string;
  created: string;
  settings: Settings;
  original?: string;
  final?: string;
  width?: number;
  height?: number;
  approved?: boolean;
  raw?: boolean;
  print?: PrintResult;
  printing?: boolean;
}
export class Captures {
  active: string | null = null;
  private record?: RecordData;
  private pending?: Promise<RecordData>;
  private printing?: Promise<PrintResult>;
  private requests: Reprints;
  constructor(
    private resolveAsset: (p: string) => string,
    private printImage: (file: string, cfg: Settings["printer"]) => Promise<PrintResult>,
  ) {
    this.requests = new Reprints(printImage);
  }
  begin(settings: Settings) {
    if (this.pending || this.printing)
      throw Error("Previous operation is still finishing");
    requireSpace(settings.storage);
    const id = randomUUID();
    const record = {
      id,
      created: new Date().toISOString(),
      settings: structuredClone(settings),
    };
    fs.mkdirSync(path.join(settings.storage, id));
    this.persist(record);
    this.record = record;
    this.active = id;
    return id;
  }
  private get(id: string) {
    if (!this.record || id !== this.active || id !== this.record.id)
      throw Error("Session expired");
    return this.record;
  }
  private persist(r: RecordData) {
    atomic(path.join(r.settings.storage, r.id, "record.json"), r);
  }
  capture(id: string, bytes: ArrayBuffer, raw = false) {
    const r = this.get(id);
    if (this.pending) return this.pending;
    if (r.final || r.raw) return Promise.resolve(r);
    const task = async () => {
      if (
        !(bytes instanceof ArrayBuffer) ||
        bytes.byteLength > 32 * 1024 * 1024 ||
        bytes.byteLength < 100
      )
        throw Error("Invalid capture payload");
      requireSpace(r.settings.storage);
      const buffer = Buffer.from(bytes);
      const meta = await sharp(buffer, {
        limitInputPixels: 24000000,
      }).metadata();
      if (meta.format !== "png" || !meta.width || !meta.height)
        throw Error("Expected original PNG video frame");
      // Save original before any frame decoding/composition; never replace on retake or failure.
      const folder = path.join(r.settings.storage, id);
      r.original = path.join(folder, "original.png");
      writeImage(r.original, buffer);
      r.width = meta.width;
      r.height = meta.height;
      r.raw = raw;
      this.persist(r);
      if (!raw) {
        const result = await composite(buffer, r.settings, this.resolveAsset);
        requireSpace(r.settings.storage);
        r.final = path.join(folder, "final.jpg");
        writeImage(r.final, result);
        this.persist(r);
      }
      return r;
    };
    this.pending = task().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  approve(id: string) {
    const r = this.get(id);
    if (!r.final) throw Error("Final photograph is not saved");
    r.approved = true;
    this.persist(r);
  }
  print(id: string, copies?: number, requestId = id) {
    const r = this.get(id);
    if (this.printing) return this.printing;
    const config = jobPrinter(r.settings, copies);
    if (!r.final) throw Error("Final photograph is not saved");
    this.approve(id);
    r.printing = true;
    this.persist(r);
    this.printing = this.requests
      .print(r.settings.storage, id, requestId, config)
      .then((result) => {
        r.printing = false;
        r.print = result;
        this.persist(r);
        return result;
      })
      .finally(() => {
        this.printing = undefined;
      });
    return this.printing;
  }
  reset() {
    if (this.printing) throw Error("Wait for Windows print status");
    this.active = null;
    this.record = undefined;
  }
  get busy() {
    return !!this.pending || !!this.printing;
  }
}
