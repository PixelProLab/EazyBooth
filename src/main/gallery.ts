import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SavedPhoto, PhotoPage } from "../shared/types";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Never follow a record's stored absolute image path or a linked session folder.
export async function savedFile(
  storage: string,
  id: string,
  name: "final.jpg" | "original.png" | "record.json",
) {
  if (!uuid.test(id)) throw Error("Invalid photo ID");
  const root = await fs.realpath(storage);
  const folder = path.join(root, id);
  const dir = await fs.lstat(folder);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error("Invalid photo folder");
  const file = path.join(folder, name);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (await fs.realpath(file)) !== file)
    throw Error("Invalid photo file");
  return file;
}

export async function listPhotos(storage: string, page = 0): Promise<PhotoPage> {
  if (!Number.isInteger(page) || page < 0) throw Error("Invalid gallery page");
  const entries = await fs
    .readdir(storage, { withFileTypes: true })
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
  const rows: SavedPhoto[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !uuid.test(entry.name)) continue;
    try {
      const file = await savedFile(storage, entry.name, "record.json");
      if ((await fs.stat(file)).size > 128 * 1024) continue;
      const record = JSON.parse(await fs.readFile(file, "utf8"));
      if (!record.final || record.raw || !Number.isFinite(Date.parse(record.created)))
        continue;
      let printStatus = record.print?.status || "not printed",
        latest = -Infinity;
      for (const name of await fs.readdir(path.dirname(file))) {
        if (!/^reprint-[a-f0-9-]{36}\.json$/i.test(name)) continue;
        try {
          const log = path.join(path.dirname(file), name),
            stat = await fs.lstat(log);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) continue;
          const receipt = JSON.parse(await fs.readFile(log, "utf8"));
          if (
            stat.mtimeMs >= latest &&
            ["accepted", "failed", "unknown"].includes(receipt.result?.status)
          ) {
            latest = stat.mtimeMs;
            printStatus = receipt.result.status;
          }
        } catch {
          /* Ignore a damaged receipt, preserving the original capture. */
        }
      }
      rows.push({
        id: entry.name,
        created: record.created,
        approved: !!record.approved,
        printStatus,
        thumbnail: "",
      });
    } catch {
      /* A damaged/in-progress record must not hide other photos. */
    }
  }
  rows.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
  const selected = rows.slice(page * 24, (page + 1) * 24);
  // Sequential, bounded thumbnails. No long-lived full-image cache.
  for (const row of selected) {
    try {
      const bytes = await sharp(await savedFile(storage, row.id, "final.jpg"), {
        limitInputPixels: 24000000,
      })
        .resize({ width: 360, height: 240, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      row.thumbnail = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    } catch {
      /* Metadata remains visible if a photo needs recovery. */
    }
  }
  return { items: selected, total: rows.length, page };
}
