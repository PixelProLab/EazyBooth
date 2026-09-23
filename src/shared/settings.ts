import type { Settings } from "./types";
export function defaults(storage: string): Settings {
  return {
    version: 2,
    frames: [],
    profileId: "default",
    eventName: "My first event",
    canvas: { width: 1800, height: 1200 },
    frameMode: "none",
    previewMode: "full",
    background: "",
    welcomeFit: "cover",
    welcomeText: "Step in. Make a memory.",
    preparingText: "Getting the camera ready…",
    maxGuestCopies: 10,
    camera: {
      deviceId: "auto-sony",
      previewWidth: 1280,
      previewHeight: 720,
      captureWidth: 1920,
      captureHeight: 1080,
      autofocus: true,
    },
    geometry: {
      opening: { x: 0, y: 0, width: 1800, height: 1200 },
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      previewMirror: true,
      outputMirror: true,
    },
    countdown: 3,
    inactivity: 90,
    postAction: 2,
    welcome: "",
    frame: "",
    storage,
    fullscreen: true,
    printer: {
      name: "",
      paper: "auto",
      copies: 1,
      orientation: "landscape",
      borderless: true,
      fit: "contain",
    },
  };
}
export function validate(input: unknown): Settings {
  const s = structuredClone(input) as Settings;
  function number(v: unknown, min: number, max: number) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
      throw Error("Setting is outside its allowed range");
  }
  function bool(v: unknown) {
    if (typeof v !== "boolean") throw Error("Invalid boolean setting");
  }
  function str(v: unknown) {
    if (typeof v !== "string" || v.length > 4096 || v.includes("\0"))
      throw Error("Invalid text setting");
  }
  if (s?.version !== 2 || !s.camera || !s.geometry?.opening || !s.printer || !s.canvas)
    throw Error("Invalid settings format");
  // Never silently import settings from another product.
  s.printer.paper ??= "auto";
  if (!["auto", "4x6", "selphy-postcard"].includes(s.printer.paper))
    throw Error("Invalid paper preset");
  for (const k of [
    "previewWidth",
    "previewHeight",
    "captureWidth",
    "captureHeight",
  ] as const)
    number(s.camera[k], 240, 4096);
  if (s.camera.captureWidth * s.camera.captureHeight > 9000000)
    throw Error("Capture preference exceeds memory budget");
  str(s.camera.deviceId);
  bool(s.camera.autofocus);
  number(s.canvas.width, 240, 4096);
  number(s.canvas.height, 240, 4096);
  if (
    !Number.isInteger(s.canvas.width) ||
    !Number.isInteger(s.canvas.height) ||
    s.canvas.width * s.canvas.height > 12000000
  )
    throw Error("Canvas must use whole pixels and stay within 12 megapixels");
  if (
    !["none", "overlay"].includes(s.frameMode) ||
    !["full", "overlay", "branded"].includes(s.previewMode) ||
    !["cover", "contain"].includes(s.welcomeFit) ||
    !["contain", "cover"].includes(s.printer.fit)
  )
    throw Error("Invalid presentation mode");
  for (const v of [
    s.profileId,
    s.eventName,
    s.background,
    s.welcomeText,
    s.preparingText,
  ])
    str(v);
  if (
    !/^(default|[a-f0-9-]{36})$/.test(s.profileId) ||
    !s.eventName.trim() ||
    s.eventName.length > 100 ||
    s.welcomeText.length > 160 ||
    s.preparingText.length > 160
  )
    throw Error("Invalid event identity or text");
  if (s.frameMode === "overlay" && !s.frame)
    throw Error("Choose a transparent frame or select None");
  if (s.previewMode === "overlay" && s.frameMode !== "overlay")
    throw Error("Camera + overlay mode requires a frame");
  if (s.previewMode === "branded" && !s.background)
    throw Error("Choose background artwork for the branded stage");
  number(s.maxGuestCopies, 1, 10);
  if (!Number.isInteger(s.maxGuestCopies))
    throw Error("Maximum copies must be a whole number");
  const r = s.geometry.opening;
  number(r.x, 0, s.canvas.width - 1);
  number(r.y, 0, s.canvas.height - 1);
  number(r.width, 1, s.canvas.width);
  number(r.height, 1, s.canvas.height);
  if (
    Object.values(r).some((v) => !Number.isInteger(v)) ||
    r.x + r.width > s.canvas.width ||
    r.y + r.height > s.canvas.height
  )
    throw Error("Photo opening must be inside the output canvas, in whole pixels");
  number(s.geometry.zoom, 0.5, 3);
  number(s.geometry.offsetX, -s.canvas.width, s.canvas.width);
  number(s.geometry.offsetY, -s.canvas.height, s.canvas.height);
  bool(s.geometry.previewMirror);
  bool(s.geometry.outputMirror);
  if (s.geometry.previewMirror !== s.geometry.outputMirror)
    throw Error("Preview and output mirror must match for this event");
  number(s.countdown, 1, 15);
  number(s.inactivity, 15, 900);
  number(s.postAction, 0, 15);
  number(s.printer.copies, 1, 10);
  if (s.printer.copies > s.maxGuestCopies)
    throw Error("Default copies cannot exceed maximum guest copies");
  if (!Number.isInteger(s.countdown) || !Number.isInteger(s.printer.copies))
    throw Error("Countdown and copies must be whole numbers");
  if (!["landscape", "portrait"].includes(s.printer.orientation))
    throw Error("Invalid print orientation");
  bool(s.printer.borderless);
  bool(s.fullscreen);
  for (const v of [s.welcome, s.frame, s.storage, s.printer.name]) str(v);
  if (!s.storage) throw Error("Storage location is required");
  s.frames ??= [];
  if (!Array.isArray(s.frames) || s.frames.length > 8)
    throw Error("Use up to 8 guest frame choices");
  const ids = new Set<string>();
  for (const frame of s.frames) {
    if (
      !frame ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(frame.id) ||
      ids.has(frame.id) ||
      typeof frame.label !== "string" ||
      !frame.label.trim() ||
      frame.label.length > 60
    )
      throw Error("Invalid or duplicate frame choice");
    ids.add(frame.id);
    str(frame.asset);
    if (!frame.asset) throw Error("Frame artwork is required");
    validate({
      ...s,
      frames: [],
      frameMode: "overlay",
      frame: frame.asset,
      geometry: frame.geometry,
    });
  }
  return s;
}

export function selectFrame(s: Settings, id?: string): Settings {
  if (!s.frames.length) {
    if (id) throw Error("This event has no guest frame choices");
    return structuredClone(s);
  }
  const choice = s.frames.find((f) => f.id === id);
  if (!choice) throw Error("Choose an event frame before capture");
  return {
    ...structuredClone(s),
    selectedFrameId: choice.id,
    frame: choice.asset,
    frameMode: "overlay",
    previewMode: s.previewMode === "branded" ? "branded" : "overlay",
    geometry: structuredClone(choice.geometry),
  };
}

export function jobPrinter(s: Settings, copies = s.printer.copies): Settings["printer"] {
  if (!Number.isInteger(copies) || copies < 1 || copies > s.maxGuestCopies)
    throw Error(`Choose between 1 and ${s.maxGuestCopies} copies`);
  return { ...s.printer, copies };
}
