const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  { spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const root = path.resolve("out/installer"),
  exe = path.join(root, "win-unpacked", "EazyBooth.exe"),
  archive = path.join(root, "win-unpacked", "resources", "app.asar");
assert(fs.existsSync(exe), "Build installer first");
const packageData = JSON.parse(asar.extractFile(archive, "package.json").toString());
assert.equal(packageData.name, "eazybooth");
const files = asar.listPackage(archive).map((file) => file.replaceAll("\\", "/"));
for (const p of files)
  assert(
    !/\/((?:captures|profiles|private|vendor-installers|mediapipe)\/|operator\.json|settings\.json)/i.test(
      p,
    ),
    `Unexpected private/unneeded package member: ${p}`,
  );
const main = asar
  .extractFile(archive, path.join("dist-electron", "main", "index.js"))
  .toString();
assert(main.includes("com.pixelprolab.eazybooth"));
assert(main.includes("EAZYBOOTH_DATA_DIR"));
assert(!main.includes("PHOTOBOOTH_ALLOW_LIVE_REMOVAL"));
assert(!main.includes("cloudinary"));
for (const f of [
  "templates/starter.json",
  "templates/namq-keeta/frame-1.png",
  "templates/namq-keeta/frame-2.png",
  "templates/namq-keeta/welcome.jpeg",
  "SONY-SETUP.txt",
  "HITI-SETUP.txt",
  "HiTi Driver Downloads.url",
  "Sony Imaging Edge Desktop.url",
  "Sony Imaging Edge Webcam.url",
])
  assert(
    fs.existsSync(path.join(root, "win-unpacked", "resources", f)),
    `Missing resource ${f}`,
  );
const setup = path.join(root, "EazyBooth-Setup-1.0.0.exe");
assert(fs.existsSync(setup));
const hash = crypto.createHash("sha256").update(fs.readFileSync(setup)).digest("hex");
const result = spawnSync(process.execPath, ["tests/electron-workflow.cjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    EAZYBOOTH_PACKAGED_EXE: exe,
    EAZYBOOTH_EVIDENCE_DIR:
      process.env.EAZYBOOTH_EVIDENCE_DIR ||
      path.join(require("node:os").tmpdir(), "eazy-packaged-evidence"),
  },
});
assert.equal(result.status, 0, "Packaged workflow failed");
const frames = spawnSync(process.execPath, ["tests/frames-electron.cjs"], {
  stdio: "inherit",
  env: { ...process.env, EAZYBOOTH_PACKAGED_EXE: exe },
});
assert.equal(frames.status, 0, "Packaged two-frame workflow failed");
console.log(
  JSON.stringify(
    {
      status: "PASS",
      setup,
      sha256: hash,
      scope:
        "NSIS built; archive audited; packaged app tested. Clean-machine NSIS wizard and physical devices NOT tested.",
    },
    null,
    2,
  ),
);
