# Windows printing

Select the exact installed queue in Operator → Printing. Guests never use a default-printer fallback or Windows dialog. Paper presets: Automatic; HiTi/Standard 4×6 (101.6×152.4 mm); Canon SELPHY postcard (100×148 mm). Automatic detects SELPHY/CP1500 by queue name; other printers use 4×6. A queue change resets the paper preset.

Choose portrait for the supplied 2400×3600 frames. The preset canvas dimensions are independent of printer paper dimensions. Contain entire image is the safe default; Fill page/crop is an explicit operator choice for other aspect ratios. Borderless requests no application margins but cannot override every driver. Match Windows driver preferences to the actual paper/ribbon/cassette and inspect real paper output.

`printing.ts` retains Misk's hidden sandboxed print window, fixed-position block image, explicit first-page range `{from:0,to:0}`, one page per sheet, scale factor 100, exact queue, configured orientation/paper/margins and per-job copy count. Chromium PDF regressions verify one actual photo page. Windows submission is mocked in automated tests.

Print 1 always sends one copy. More Prints uses the app keypad and an integer from 1 to the event maximum (up to 10). These overrides never change the profile's default copies. After acceptance, Print another copy or More Prints creates a fresh UUID. Done returns to Welcome after the configured delay; inactivity also clears abandoned review. This gives guests time to request another print.

Both guest and saved-photo jobs read the immutable final JPEG without recompositing. A receipt is atomically written as unknown before submission; repeated delivery/restart cannot resend that UUID. Concurrent UI/main locks and a global Windows adapter lock prevent overlapping submissions. Deliberate retry uses a new UUID. An unexpected transport error or deadline after submission produces an uncertain state: inspect the Windows queue before retrying. No automatic resend occurs.

The adapter deadline covers load, decode and callback. Accepted means only **Windows accepted the print job**. Driver completion, paper feed, margins, ribbon, physical copy count and failed-queue recovery must be tested onsite. No queue purging occurs automatically.

## 1.0.1 large-photo correction

The 1.0.0 adapter embedded the full base64 JPEG inside a data-navigation URL. Real Electron reproduction accepted a 500,130-character URL but rejected 2,500,130 and 8,000,130 characters with ERR_INVALID_URL (-300). Detailed 2400×3600 photos can exceed that limit, even when simpler synthetic test images pass. The failure occurs before Windows submission; opening the saved JPEG in another application avoids this path.

1.0.1 loads only the small fixed print document, then assigns the original JPEG data directly to the image element and awaits decoding. No resampling or quality reduction is used. Print sizes, orientation, one-page settings and duplicate protection remain unchanged. Preparation timeouts are now failures with nothing sent; a late load cannot submit after timeout. Timeouts after submission remain unknown and never auto-retry.
