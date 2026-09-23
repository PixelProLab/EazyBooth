import fs from "node:fs";
import path from "node:path";
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { defaults, validate } from "../shared/settings";
import type { Settings } from "../shared/types";
export function atomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function writeImage(file: string, data: Buffer) {
  const fd = fs.openSync(file, "wx");
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
export class Store {
  settings: Settings;
  error = "";
  private credential?: { salt: string; hash: string };
  private failures = 0;
  private lockedUntil = 0;
  constructor(readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
    this.settings = defaults(path.join(root, "photos"));
    const cfg = path.join(root, "settings.json");
    if (fs.existsSync(cfg)) {
      try {
        this.settings = validate(JSON.parse(fs.readFileSync(cfg, "utf8")));
      } catch {
        this.error =
          "Saved settings are unreadable. Original file preserved; operator must restore or explicitly save reviewed settings.";
      }
    }
    const pin = path.join(root, "operator.json");
    if (fs.existsSync(pin)) {
      const c = JSON.parse(fs.readFileSync(pin, "utf8"));
      if (!/^[a-f0-9]{32}$/.test(c.salt) || !/^[a-f0-9]{64}$/.test(c.hash))
        throw Error("Operator credentials damaged; restore the private profile backup");
      this.credential = c;
    }
  }
  get pinSet() {
    return !!this.credential;
  }
  save(input: unknown) {
    const s = validate(input);
    if (!path.isAbsolute(s.storage)) throw Error("Choose an absolute storage folder");
    const previous = path.join(this.root, "settings.json");
    if (this.error && fs.existsSync(previous))
      fs.copyFileSync(
        previous,
        path.join(this.root, "settings.corrupt-" + Date.now() + ".json"),
      );
    if (!this.error && fs.existsSync(previous))
      fs.copyFileSync(previous, previous + ".bak");
    atomic(previous, s);
    this.settings = s;
    this.error = "";
    return structuredClone(s);
  }
  setPin(pin: string) {
    if (!/^\d{6,12}$/.test(pin)) throw Error("Use 6–12 digits for the operator PIN");
    const salt = randomBytes(16).toString("hex");
    const credential = {
      salt,
      hash: scryptSync(pin, salt, 32).toString("hex"),
    };
    atomic(path.join(this.root, "operator.json"), credential);
    this.credential = credential;
  }
  unlock(pin: string) {
    if (Date.now() < this.lockedUntil) throw Error("Too many attempts. Wait 30 seconds.");
    if (!this.credential) {
      this.setPin(pin);
      return;
    }
    const ok =
      typeof pin === "string" &&
      pin.length <= 12 &&
      timingSafeEqual(
        scryptSync(pin, this.credential.salt, 32),
        Buffer.from(this.credential.hash, "hex"),
      );
    if (!ok) {
      if (++this.failures >= 5) {
        this.lockedUntil = Date.now() + 30000;
        this.failures = 0;
      }
      throw Error("Incorrect operator PIN");
    }
    this.failures = 0;
  }
}
export function diskStatus(folder: string) {
  fs.mkdirSync(folder, { recursive: true });
  const stats = fs.statfsSync(folder);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const probe = path.join(folder, ".write-" + randomUUID());
  let writable = false;
  try {
    writeImage(probe, Buffer.from("ok"));
    writable = true;
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }
  return { freeBytes, writable };
}
export function requireSpace(folder: string) {
  const s = diskStatus(folder);
  if (!s.writable || s.freeBytes < 512 * 1024 * 1024)
    throw Error("DISK-01: At least 512 MB of free, writable storage is required");
  return s;
}
