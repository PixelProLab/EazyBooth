# Release checklist

- Confirm repository is PixelProLab/EazyBooth; Misk/OT remain untouched.
- Clean isolated `npm ci`, `npm run ensure:electron`, `npm run verify`.
- `npm run test:electron`: inherited camera/reprint/fault/retake/restart workflow.
- `npm run test:frames`: supplied welcome and both portrait frames, preview/final agreement, exact JPEG printing, touch quantities, fast gallery, profile duplication and restart.
- Python Playwright web UI checks when changing screen layout; inspect source/packaged screenshots.
- `npm run build:installer`, `npm run test:installer`: audit packaged identity, starter artwork, private exclusions and run both suites against Windows x64 packaged executable.
- Record actual installer size, SHA-256 and Authenticode result. A build log saying “signing” does not prove a signature.
- Separately test a clean-machine install wizard, upgrade/uninstall preservation, shortcuts and startup.
- On actual hardware: Sony real scene/focus/resolution/USB/reconnect, both frames' live/saved/printed crop, HiTi/SELPHY paper/orientation/copies, unknown queue recovery and event-length endurance.
- Review explicit source inclusion, secret/machine-path checks, and staged diff. Never publish guest photos, runtime configuration/PIN, synthetic profiles/evidence or vendor installers. Push normally and verify remote SHA/CI.

Automated software checks cannot mark physical camera, paper output, clean-machine or endurance gates complete.
