# Production failures retained as regression requirements

Reference inspected read-only: Misk v1.0.2 at `fac79221fb480d2a59d5ef20e00aa24f6016d236`, recent history, HANDOFF, LESSONS-LEARNED, PRINTING, CAMERA-PIPELINE, SONY-SETUP, VALIDATION, RELEASE-CHECKLIST, full runtime and tests.

| Failure seen in deployment | Required retained behavior |
| --- | --- |
| Camera enumerated but Sony logo shown | Guest concealment until operator confirms actual scene; reconnect invalidates confirmation |
| Camera restarted between guests/Retake | One persistent owner; warm Welcome; reuse healthy stream |
| Wrong laptop camera selected | Exact saved source; automatic Sony selection only when exactly one match exists |
| Camera stops/mutes/stalls | Track/watchdog fault, generation invalidation and explicit recovery |
| Preview crop differs from print | Shared integer geometry/clipping and selected-frame snapshot; print saved final bytes |
| Blank second print page | Fixed-position image, page 1 only, one page per sheet, 100% scale |
| Canon paper settings leaked to HiTi | Queue change resets paper preset; exact Windows queue; explicit 4×6 and 100×148 presets |
| Driver callback overstated success | “Windows accepted the print job”; physical acceptance separate |
| Duplicate print after repeated tap/crash | UI/main locks; durable unknown-before-send UUID receipt; explicit new action for more prints |
| Timeout caused automatic duplicate | Unknown queue state requires explicit check/retry; never automatically resend |
| Original lost on failed composition/Retake | UUID original saved first, immutable final separately; failure retains original |
| Old asynchronous result restored prior guest | Generation checks, capture coalescing and owned timers |
| Corrupt/partial settings destroyed configuration | Atomic fsync/temp/rename, backups, preserved corrupt file and reviewed recovery |
| USB/Desktop artwork disappeared | Managed profile copies validated before activation |
| Gallery exposed guest photos or consumed RAM | PIN-gated file/media access, fixed UUID paths, 24 thumbnails per page |
| Copied EXE failed elsewhere | Full per-user NSIS package, runtime retained, no private setup embedded |

New EazyBooth regressions extend these requirements to isolated events, two portrait guest frame choices, other canvas sizes, background clipping, keypad entry and per-request quantities. Source and packaged tests use synthetic camera input and mocked Windows submission. They cannot establish physical Sony/HiTi performance.
