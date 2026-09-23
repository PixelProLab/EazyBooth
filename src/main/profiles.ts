import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Store, atomic } from "./store";
import { defaults, validate } from "../shared/settings";
import { checkAsset } from "./compositor";
import type { Settings } from "../shared/types";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class Profiles {
  private auth: Store;
  private current: Store;
  private id: string;
  constructor(
    readonly root: string,
    templateRoot?: string,
  ) {
    this.auth = new Store(root);
    fs.mkdirSync(path.join(root, "profiles"), { recursive: true });
    const index = path.join(root, "profiles.json");
    if (fs.existsSync(index)) {
      const data = JSON.parse(fs.readFileSync(index, "utf8"));
      if (data.version !== 1 || !uuid.test(data.active))
        throw Error(
          "Profile index damaged. Restore profiles.json from your private backup; event files were preserved.",
        );
      this.id = data.active;
      if (!fs.existsSync(path.join(this.folder(this.id), "settings.json")))
        throw Error(
          "Active event configuration is missing; restore your private backup.",
        );
      this.current = this.load(this.id);
    } else {
      this.id = randomUUID();
      this.current = new Store(this.folder(this.id));
      const initial = { ...this.current.settings, profileId: this.id };
      if (templateRoot && fs.existsSync(path.join(templateRoot, "starter.json"))) {
        const template = JSON.parse(
          fs.readFileSync(path.join(templateRoot, "starter.json"), "utf8"),
        );
        const assets = path.join(this.folder(), "assets");
        fs.mkdirSync(assets, { recursive: true });
        const copy = (name: string) => {
          if (
            typeof name !== "string" ||
            !/^[a-z0-9./-]+$/.test(name) ||
            name.includes("..")
          )
            throw Error("Invalid starter artwork");
          const dest = path.join(assets, randomUUID() + path.extname(name));
          fs.copyFileSync(
            path.join(templateRoot, name),
            dest,
            fs.constants.COPYFILE_EXCL,
          );
          return dest;
        };
        initial.eventName = template.eventName;
        initial.canvas = template.canvas;
        initial.geometry.opening = { x: 0, y: 0, ...initial.canvas };
        initial.welcome = copy(template.welcome);
        initial.welcomeFit = "contain";
        initial.printer.orientation = "portrait";
        initial.frames = template.frames.map((f: Settings["frames"][number]) => ({
          ...f,
          asset: copy(f.asset),
        }));
      }
      this.current.save(initial);
      atomic(index, { version: 1, active: this.id });
    }
  }
  folder(id = this.id) {
    if (!uuid.test(id)) throw Error("Invalid event ID");
    const dir = path.join(this.root, "profiles", id);
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink())
      throw Error("Linked event folders are not allowed");
    return dir;
  }
  private load(id: string) {
    const store = new Store(this.folder(id));
    if (store.error) {
      store.settings.profileId = id;
      return store;
    }
    if (
      store.settings.profileId !== id ||
      path.resolve(store.settings.storage) !== path.join(this.folder(id), "photos")
    )
      throw Error("Event configuration identity or storage does not match its folder");
    return store;
  }
  get settings() {
    return this.current.settings;
  }
  get error() {
    return this.current.error;
  }
  get pinSet() {
    return this.auth.pinSet;
  }
  unlock(pin: string) {
    return this.auth.unlock(pin);
  }
  setPin(pin: string) {
    return this.auth.setPin(pin);
  }
  list() {
    return fs
      .readdirSync(path.join(this.root, "profiles"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && uuid.test(e.name))
      .map((e) => {
        try {
          const s = this.load(e.name);
          return { id: e.name, name: s.settings.eventName, error: s.error };
        } catch {
          return {
            id: e.name,
            name: "Damaged event — restore backup",
            error: "Configuration unavailable",
          };
        }
      });
  }
  switch(id: string) {
    if (!fs.existsSync(path.join(this.folder(id), "settings.json")))
      throw Error("Event does not exist");
    const next = this.load(id);
    atomic(path.join(this.root, "profiles.json"), { version: 1, active: id });
    this.current = next;
    this.id = id;
    return structuredClone(this.settings);
  }
  create(name: string, duplicate?: string) {
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      throw Error("Enter an event name of 1–100 characters");
    const id = randomUUID(),
      folder = this.folder(id);
    const sourceStore = duplicate ? this.load(duplicate) : undefined;
    if (sourceStore?.error)
      throw Error("Restore the damaged event before duplicating it");
    const config = sourceStore
      ? structuredClone(sourceStore.settings)
      : defaults(path.join(folder, "photos"));
    config.profileId = id;
    config.eventName = name.trim();
    config.storage = path.join(folder, "photos");
    validate(config);
    fs.mkdirSync(path.join(folder, "assets"), { recursive: true });
    if (duplicate)
      for (const key of ["welcome", "frame", "background"] as const) {
        if (!config[key]) continue;
        const source = this.asset(config[key], duplicate);
        const dest = path.join(folder, "assets", randomUUID() + ".png");
        fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
        config[key] = dest;
      }
    if (duplicate)
      for (const frame of config.frames) {
        const source = this.asset(frame.asset, duplicate),
          dest = path.join(folder, "assets", randomUUID() + ".png");
        fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
        frame.asset = dest;
      }
    new Store(folder).save(config);
    return this.switch(id);
  }
  asset(file: string, id = this.id) {
    const base = path.join(this.folder(id), "assets"),
      resolved = path.resolve(file);
    if (
      !resolved.startsWith(base + path.sep) ||
      path.dirname(resolved) !== base ||
      !fs.existsSync(resolved) ||
      fs.lstatSync(resolved).isSymbolicLink() ||
      (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink())
    )
      throw Error("Artwork must be imported into this event's managed assets");
    return resolved;
  }
  async importAsset(
    source: string,
    kind: "welcome" | "frame" | "background",
    canvas: Settings["canvas"],
  ) {
    const id = this.id;
    const probe = defaults(this.settings.storage);
    probe.canvas = canvas;
    probe.geometry.opening = { x: 0, y: 0, ...canvas };
    validate(probe);
    await checkAsset(source, kind === "frame", canvas);
    const dir = path.join(this.folder(id), "assets");
    fs.mkdirSync(dir, { recursive: true });
    if (fs.lstatSync(dir).isSymbolicLink())
      throw Error("Linked asset folders are not allowed");
    const dest = path.join(dir, randomUUID() + ".png");
    // Normalize orientation/format and strip metadata. Immutable unique names.
    const bytes = await sharp(source, { limitInputPixels: 24000000 })
      .rotate()
      .png()
      .toBuffer();
    fs.writeFileSync(dest, bytes, { flag: "wx" });
    await checkAsset(dest, kind === "frame", canvas);
    if (this.id !== id)
      throw Error("Event changed during artwork import; please try again");
    return dest;
  }
  save(input: unknown) {
    const s = validate(input);
    if (
      s.profileId !== this.id ||
      path.resolve(s.storage) !== path.join(this.folder(), "photos")
    )
      throw Error("Cannot save another event or change its isolated photo folder");
    for (const key of ["welcome", "frame", "background"] as const)
      if (s[key]) this.asset(s[key]);
    for (const frame of s.frames) this.asset(frame.asset);
    return this.current.save(s);
  }
  defaults() {
    return {
      ...defaults(path.join(this.folder(), "photos")),
      profileId: this.id,
      eventName: this.settings.eventName,
    };
  }
}
