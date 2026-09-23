import { contextBridge, ipcRenderer } from "electron";
import type { API } from "../shared/types";
const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke("eazy:" + name, ...args);
const api: API = {
  profiles: () => invoke("profiles"),
  createProfile: (name, duplicate) => invoke("createProfile", name, duplicate),
  switchProfile: (id) => invoke("switchProfile", id),
  settings: () => invoke("settings"),
  unlock: (p) => invoke("unlock", p),
  lock: () => invoke("lock"),
  setPin: (p) => invoke("setPin", p),
  saveSettings: (s) => invoke("saveSettings", s),
  defaults: () => invoke("defaults"),
  pickAsset: (k, canvas) => invoke("pickAsset", k, canvas),
  health: () => invoke("health"),
  photos: (page) => invoke("photos", page),
  photo: (id, original) => invoke("photo", id, original),
  revealPhoto: (id) => invoke("revealPhoto", id),
  printSaved: (id, requestId, copies) => invoke("printSaved", id, requestId, copies),
  openStorage: () => invoke("openStorage"),
  printers: () => invoke("printers"),
  sony: (w) => invoke("sony", w),
  hitiDrivers: () => invoke("hitiDrivers"),
  begin: (frameId) => invoke("begin", frameId),
  frameOpening: (asset) => invoke("frameOpening", asset),
  capture: (id, bytes, raw) => invoke("capture", id, bytes, raw),
  approve: (id) => invoke("approve", id),
  print: (id, copies, requestId) => invoke("print", id, copies, requestId),
  testPrint: () => invoke("testPrint"),
  reset: () => invoke("reset"),
  media: (p) =>
    p.startsWith("eazy-media:") ? p : "eazy-media://local/" + encodeURIComponent(p),
};
contextBridge.exposeInMainWorld("booth", api);
