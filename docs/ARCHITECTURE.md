# Architecture

Electron main owns the private data directory, versioned profiles, credentials, artwork imports, immutable capture transactions, Sharp composition, protected gallery and Windows printing. The sandboxed renderer owns a single MediaStream camera and React UI. Preload exposes a narrow IPC API; Node integration is off, context isolation on, navigation/new windows denied, and runtime HTTP(S) blocked. Only explicit operator vendor-help actions open fixed official URLs externally.

`Profiles` wraps the proven atomic `Store` and its salted scrypt PIN. One application-wide PIN protects all event administration. An atomic index selects one UUID event; each event has its own `settings.json`, `assets/` and `photos/`. Damaged event configuration is preserved and blocks capture until reviewed settings are explicitly saved. Damaged credentials/index fail closed. Settings have version 2; the profile index has version 1. No Misk settings migration is attempted.

Configuration mutations serialize at IPC; profile changes cannot overlap capture or print operations. Imported artwork is decoded, normalized and copied under a unique managed filename. Foreign-profile and external asset paths are rejected. Duplication copies configuration/artwork, never guest images or receipts. Storage is deliberately a fixed managed subfolder per event to prevent cross-event overlap.

`Camera` retains the Misk owner, watchdogs, open/capture coalescing, generation invalidation, exact device constraints and Sony confirmation. Guest state has its own generation and action lock. Returning to Welcome resets the capture transaction but retains the warm stream. Profile changes stop the old stream; the new profile warms on launch. Preview rendering pauses outside the live/countdown screens while the camera remains owned.

`cameraGeometry`, `photoRect` and `photoClip` define the same output-space position, scale and clipping for browser canvas and Sharp. Canvas presets include landscape, portrait, widescreen and square, with custom whole-pixel sizes up to 4096 per side and 12 MP total. Source decode is capped at 24 MP, resized camera buffers at 64 MP, preview at 1200 pixels wide with its configured height budget and about 20 fps. Sharp cache is disabled and concurrency is two.

Frame choices carry IDs, labels, managed assets and independent geometry. Main validates the selected ID and snapshots its effective configuration at Begin. The final record retains profile identity, chosen frame, configuration, delivered source dimensions and operation outcomes. Original/final bytes never change after creation. Gallery/guest print requests share the durable receipt adapter and global Windows submission lock.

Gallery reads bounded metadata and at most 24 thumbnails per page, generated sequentially without a retained full-image cache. Files resolve only under validated UUID directories using fixed filenames. Gallery media requires a live operator session; changing profiles/locking revokes access.

See [release gates](RELEASE-CHECKLIST.md). No native Sony shutter SDK, cloud sharing, printer consumable telemetry or guaranteed physical completion is implemented.
