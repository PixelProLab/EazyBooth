# EazyBooth

Reusable, offline Windows photobooth by Pixel Pro Lab. Install once; create or duplicate an event, import branding, position the camera, select the Windows camera and printer, test, then launch.

The supplied NAMQ × Keeta welcome artwork and two transparent portrait frames are included as an editable starter profile. A new installation copies them into its private managed profile. Existing installations and events are never overwritten. Create Event starts with neutral EazyBooth branding and no mandatory frame.

## Guest experience

Welcome → choose a frame (when configured) → live preview inside that frame → Start → countdown → saved final → Retake / Done / Print 1 / More Prints. Each frame can have its own camera window and crop. Printing always uses the immutable saved JPEG. A successful submission says **Windows accepted the print job**; it does not report physical completion.

## Operator

Create a 6–12 digit PIN on first launch. `Ctrl+Shift+A` opens Profiles / Events; `Ctrl+Shift+G` opens Recent/Saved Photos after PIN authentication. Five taps in the top-right corner open operator access. PIN and print quantity have a built-in touch keypad.

Operator sections: Profiles / Events, Saved Photos, Branding, Camera, Layout, Printing, Session & Storage, Readiness. Save changes before switching events or launching. For Sony/Imaging Edge, visually confirm a real live scene once per connection. The camera stays warm behind Welcome.

## Development

Windows x64, Node.js 24. Dependencies are pinned in `package-lock.json`.

```powershell
npm ci
npm run ensure:electron
npm run dev
npm run verify
npm run test:electron
npm run test:frames
npm run build:installer
npm run test:installer
```

Installer output: `out/installer/EazyBooth-Setup-1.0.0.exe`. Do not distribute an unpacked EXE without its sibling files. No cloud account, API, auto-updater or vendor driver is required by the application; camera/printer drivers are installed separately.

Runtime data: `%APPDATA%\eazybooth`. `EAZYBOOTH_DATA_DIR` provides an isolated test profile. Never point tests at live guest data. Back up the full data directory with the application closed. Upgrades and uninstall preserve this directory.

See [architecture](docs/ARCHITECTURE.md), [profiles](docs/EVENT-PROFILES.md), [operator guide](docs/OPERATOR-GUIDE.md), [printing](docs/PRINTING.md), [camera](docs/CAMERA.md), [validation](docs/VALIDATION.md), and [release checklist](docs/RELEASE-CHECKLIST.md).

Technical baseline: [`PixelProLab/misk-photobooth`](https://github.com/PixelProLab/misk-photobooth), commit `fac79221fb480d2a59d5ef20e00aa24f6016d236` (v1.0.2). Misk's source/profile were not modified. See [production lessons retained](docs/LESSONS-FROM-MISK.md).
