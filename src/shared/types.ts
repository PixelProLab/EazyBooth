export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Settings {
  guestFramesEnabled?: boolean;
  frames: {
    id: string;
    label: string;
    asset: string;
    canvas?: Settings["canvas"];
    geometry: Settings["geometry"];
  }[];
  selectedFrameId?: string;
  version: 2;
  profileId: string;
  eventName: string;
  canvas: { width: number; height: number };
  frameMode: "none" | "overlay";
  previewMode: "full" | "overlay" | "branded";
  background: string;
  welcomeFit: "cover" | "contain";
  welcomeText: string;
  preparingText: string;
  maxGuestCopies: number;
  camera: {
    deviceId: string;
    previewWidth: number;
    previewHeight: number;
    captureWidth: number;
    captureHeight: number;
    autofocus: boolean;
  };
  geometry: {
    opening: Rect;
    zoom: number;
    offsetX: number;
    offsetY: number;
    previewMirror: boolean;
    outputMirror: boolean;
  };
  countdown: number;
  inactivity: number;
  postAction: number;
  welcome: string;
  frame: string;
  storage: string;
  fullscreen: boolean;
  printer: {
    name: string;
    paper: "auto" | "4x6" | "selphy-postcard";
    copies: number;
    orientation: "landscape" | "portrait";
    borderless: boolean;
    fit: "contain" | "cover";
  };
}
export interface Capture {
  id: string;
  url: string;
  width: number;
  height: number;
}
export interface Printer {
  name: string;
  displayName: string;
  status: number;
}
export interface SavedPhoto {
  id: string;
  created: string;
  approved: boolean;
  printStatus: string;
  thumbnail: string;
}
export interface PhotoPage {
  items: SavedPhoto[];
  total: number;
  page: number;
}
export interface Health {
  assets: { welcome: boolean; frame: boolean; background: boolean };
  profile: string;
  storage: string;
  freeBytes: number;
  writable: boolean;
  settingsError: string;
  ramGB: number;
  stats: {
    captures: number;
    approved: number;
    acceptedPrints: number;
    failedPrints: number;
  };
  pinSet: boolean;
}
export interface PrintResult {
  status: "accepted" | "failed" | "unknown";
  message: string;
}
export interface API {
  profiles(): Promise<{ id: string; name: string; error?: string }[]>;
  createProfile(name: string, duplicate?: string): Promise<Settings>;
  switchProfile(id: string): Promise<Settings>;
  settings(): Promise<Settings>;
  unlock(pin: string): Promise<void>;
  lock(): Promise<void>;
  setPin(pin: string): Promise<void>;
  saveSettings(s: Settings): Promise<Settings>;
  defaults(): Promise<Settings>;
  pickAsset(
    kind: "welcome" | "frame" | "background",
    canvas: Settings["canvas"],
  ): Promise<string | null>;
  frameOpening(asset: string): Promise<Rect>;
  health(): Promise<Health>;
  photos(page: number): Promise<PhotoPage>;
  photo(id: string, original?: boolean): Promise<string>;
  revealPhoto(id: string): Promise<void>;
  printSaved(id: string, requestId: string, copies?: number): Promise<PrintResult>;
  openStorage(): Promise<void>;
  printers(): Promise<Printer[]>;
  sony(which: "desktop" | "webcam"): Promise<void>;
  hitiDrivers(): Promise<void>;
  begin(frameId?: string): Promise<string>;
  capture(id: string, bytes: ArrayBuffer, raw?: boolean): Promise<Capture>;
  approve(id: string): Promise<void>;
  print(id: string, copies: number, requestId: string): Promise<PrintResult>;
  testPrint(): Promise<PrintResult>;
  reset(): Promise<void>;
  media(path: string): string;
}
declare global {
  interface Window {
    booth: API;
  }
}
