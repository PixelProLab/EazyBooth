import type { Settings, PrintResult } from "../shared/types";
export interface PrintWindow {
  loadURL(url: string): Promise<unknown>;
  webContents: {
    executeJavaScript(code: string): Promise<unknown>;
    print(options: unknown, callback: (success: boolean, reason?: string) => void): void;
  };
  destroy(): void;
  isDestroyed(): boolean;
}
// A fixed image has no inline baseline or flow height that can paginate into
// blank sheets. Percentages fit the printable area, including driver margins.
export function paperSize(config: Settings["printer"]) {
  const selphy =
    config.paper === "selphy-postcard" ||
    ((!config.paper || config.paper === "auto") && /selphy|cp\s*1500/i.test(config.name));
  return selphy ? { width: 100000, height: 148000 } : { width: 101600, height: 152400 };
}
export function photoPrintHTML(
  image: Buffer,
  landscape: boolean,
  paper = { width: 101600, height: 152400 },
  fit: "contain" | "cover" = "contain",
) {
  const w = (landscape ? paper.height : paper.width) / 1000;
  const h = (landscape ? paper.width : paper.height) / 1000;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}img{position:fixed;inset:0;display:block;width:100%;height:100%;object-fit:${fit === "cover" ? "cover" : "contain"}}</style></head><body><img src="data:image/jpeg;base64,${image.toString("base64")}"></body></html>`;
}
export async function printPhoto(
  image: Buffer,
  config: Settings["printer"],
  create: () => PrintWindow,
  timeout = 60000,
): Promise<PrintResult> {
  if (!config.name)
    return {
      status: "failed",
      message: "Select a Windows printer in operator settings",
    };
  const win = create();
  let submitted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One watchdog covers window loading, image decoding AND Windows callback.
  const deadline = new Promise<PrintResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          status: "unknown",
          message:
            "Windows print status is unknown. Check the Windows queue before retrying to avoid duplicate prints.",
        }),
      timeout,
    );
  });
  const work = async (): Promise<PrintResult> => {
    const landscape = config.orientation === "landscape";
    const paper = paperSize(config);
    const html = photoPrintHTML(image, landscape, paper, config.fit);
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await win.webContents.executeJavaScript('document.querySelector("img").decode()');
    if (win.isDestroyed())
      return {
        status: "unknown",
        message: "Print window closed; check Windows queue",
      };
    return new Promise((resolve) => {
      submitted = true;
      win.webContents.print(
        {
          silent: true,
          deviceName: config.name,
          copies: config.copies,
          landscape,
          printBackground: true,
          pageRanges: [{ from: 0, to: 0 }],
          pagesPerSheet: 1,
          scaleFactor: 100,
          header: "",
          footer: "",
          margins: { marginType: config.borderless ? "none" : "default" },
          pageSize: paper,
        },
        (success, reason) =>
          resolve(
            success
              ? {
                  status: "accepted",
                  message: "Windows accepted the print job",
                }
              : {
                  status: "failed",
                  message: reason || "Windows rejected the print job",
                },
          ),
      );
    });
  };
  try {
    return await Promise.race([
      work().catch((e) => ({
        status: submitted ? ("unknown" as const) : ("failed" as const),
        message: submitted
          ? "Windows submission could not be confirmed. Check the Windows queue before retrying."
          : String(e.message || e),
      })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}
