# EazyBooth maintenance

Read README, docs/ARCHITECTURE.md, docs/LESSONS-FROM-MISK.md and docs/VALIDATION.md before modifying the runtime.

Keep Misk and OT repositories and profiles untouched. EazyBooth identity is com.pixelprolab.eazybooth; test override is EAZYBOOTH_DATA_DIR. All verification must use disposable synthetic profiles and mocked printer submission.

Preserve one persistent camera owner, Sony visual scene confirmation, shared preview/final geometry, immutable captures, request receipts, print locking, exact Windows device selection, first-page-only printing, PIN gates and atomic settings. Artwork is profile data, never hardcoded into guest logic.

Guest frame selection must be snapshotted by the main process. Reprints must submit existing final bytes. Never recomposite an old photo or automatically retry uncertain printing.

Use npm run verify, test:electron and test:frames. Changes to packaging also require build:installer and test:installer. Synthetic tests do not establish hardware or clean-machine acceptance. Stage explicit source paths, exclude profiles/photos/evidence/vendor installers/builds, and never force-push.
