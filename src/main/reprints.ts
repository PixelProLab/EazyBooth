import fs from "node:fs/promises";
import path from "node:path";
import { savedFile } from "./gallery";
import { atomic } from "./store";
import type { PrintResult, Settings } from "../shared/types";

export class Reprints {
  private pending?: { key: string; result: Promise<PrintResult> };
  constructor(
    private send: (file: string, printer: Settings["printer"]) => Promise<PrintResult>,
  ) {}
  get busy() {
    return !!this.pending;
  }
  print(
    storage: string,
    id: string,
    requestId: string,
    printer: Settings["printer"],
  ): Promise<PrintResult> {
    if (
      typeof requestId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)
    )
      throw Error("Invalid print request");
    const key = JSON.stringify([storage, id, requestId]);
    if (this.pending) {
      if (this.pending.key === key) return this.pending.result;
      throw Error("Wait for the current print job to finish");
    }
    const config = structuredClone(printer);
    const work = async (): Promise<PrintResult> => {
      // Only an existing final can be printed. Originals are never reframed or overwritten.
      const file = await savedFile(storage, id, "final.jpg");
      const log = path.join(path.dirname(file), `reprint-${requestId}.json`);
      try {
        const stat = await fs.lstat(log);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
          throw Error("Invalid saved print receipt");
        const previous = JSON.parse(await fs.readFile(log, "utf8"));
        if (!["accepted", "failed", "unknown"].includes(previous.result?.status))
          throw Error("Invalid saved print receipt");
        return previous.result;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const receipt = {
        id,
        requestId,
        created: new Date().toISOString(),
        printer: config,
        result: {
          status: "unknown",
          message: "Print status is unknown. Check the Windows queue before retrying.",
        } as PrintResult,
      };
      // Persist the request before submission: a replay after a crash must not
      // silently send the same job again. A deliberate retry gets a new UUID.
      atomic(log, receipt);
      try {
        receipt.result = await this.send(file, config);
      } catch {
        // An unexpected transport error may occur after Windows has accepted.
        receipt.result = {
          status: "unknown",
          message:
            "Print status could not be confirmed. Check the Windows queue before retrying.",
        };
      }
      try {
        atomic(log, receipt);
      } catch {
        receipt.result = {
          ...receipt.result,
          message: `${receipt.result.message}. The local print receipt could not be updated.`,
        };
      }
      return receipt.result;
    };
    const result = work().finally(() => {
      if (this.pending?.key === key) this.pending = undefined;
    });
    this.pending = { key, result };
    return result;
  }
}
