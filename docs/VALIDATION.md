# Validation — 23 September 2026

Version 1.0.0, Windows x64. Baseline: Misk v1.0.2 at `fac79221fb480d2a59d5ef20e00aa24f6016d236`, inspected and left unchanged.

| Check | Evidence and scope |
| --- | --- |
| Clean dependency installation | `npm ci`; pinned Electron runtime installed explicitly. Dependency audit reported zero vulnerabilities. |
| TypeScript, unit/component regression, production build | PASS: 69 tests in five files; renderer, main and preload compiled. |
| Native source workflow | PASS: inherited 16 checks, eight extra guest cycles, Sony startup concealment/confirmation, retake/reconnect, original preservation, PIN denial, print failure/locking, one-page PDF and reprints. |
| Supplied frame workflow | PASS in source and packaged Electron: both original 2400×3600 transparent frames and welcome JPEG. Packaged preview/final mean RGB error: Frame 1 5.383/255, Frame 2 5.238/255; both below 8/255. Chosen frame metadata and exact immutable JPEG bytes sent to printing verified. |
| Per-job quantities | Print 1 sends 1 despite profile default 2; More Prints sends 3; explicit another copy sends 1; gallery More Prints sends 4. Default remains 2. |
| Profiles | Create/duplicate/switch isolation, asset-copy persistence, failed import preservation, corrupted settings backup and restart verified. Guest photographs are not duplicated. |
| Touch/web UI | Python Playwright headless browser checks passed for desktop and 700×600 choices and numeric PIN. Browser IPC is mocked; native workflows cover actual IPC. |
| Packaged Windows application | PASS: NSIS built; archive identity, resource inclusion and private-data exclusions audited. Both native workflow suites passed against the packaged executable. |
| Physical acceptance | NOT RUN: actual Sony scene/focus, printer paper/copies/cutting/driver behavior, clean-machine install wizard and event-length endurance. |

Installer: `out/installer/EazyBooth-Setup-1.0.0.exe`, **119,233,064 bytes**, **NotSigned**.

SHA-256: `5B735C513EF5DA22990109273DA85ADD1DEBA06FF11CF5246D45656303D66D00`.

Synthetic evidence stays outside Git: temporary `eazy-electron-evidence`, `eazy-packaged-evidence`, `eazy-frames-source`, `eazy-frames-packaged`, and ignored `.evidence/web-ui`. Each native suite records its result JSON; frame suites retain live/final screenshots and actual one-page Chromium PDFs. The frame test requires mean absolute preview/final RGB error below 8/255 after scaling (browser/Sharp resampling and JPEG can differ at edges). It separately hashes final bytes against the print image, with exact equality required. Physical color reproduction is not established by those checks.

The two supplied frames have different transparent openings: Frame 1 `(298,299,1804,2366)` and Frame 2 `(367,271,1633,2270)` in 2400×3600 coordinates. Their original artwork remains unchanged. sRGB is enforced for preview consistency with saved composition. Selected-frame settings are memoized so countdown updates do not restart artwork decoding. A regression holds one preview initialization through countdown.

Code/UI review corrected uncertain print exceptions, profile mutation concurrency, numeric keypad labels, preview color space, countdown settings identity, portrait layout proportions and frame-choice fit. Shared geometry, bounded image processing, durable print receipts, media/PIN boundaries, settings preservation and neutral reusable defaults remain in place. This is a bounded review, not a claim that every possible fault is excluded.

Known operating boundaries: Windows driver acceptance is not physical completion. Artwork dimension changes require matching frame reimports. Storage stays isolated under each event; a cross-machine profile export/import wizard is not included. The welcome image supplied by the user contains “share” wording as artwork; the application has no cloud sharing feature.
