# Event profiles and artwork

```
eazybooth/
  operator.json             # salted PIN hash; private
  profiles.json             # version 1, active event UUID
  profiles/<event UUID>/
    settings.json           # version 2 event configuration
    settings.json.bak       # previous valid saved configuration
    assets/<unique name>    # managed artwork
    photos/<capture UUID>/
      original.png
      final.jpg
      record.json
      reprint-<request UUID>.json
```

Create Event uses neutral defaults. Duplicate Profile uses saved settings and physically copies managed artwork into the new event. It never copies photos or receipts. Edit the event name and save. The active profile persists across restart. The fixed photo subfolder is visible in Session & Storage and opens from Saved Photos/Readiness.

Frame-free output works without any artwork. A single frame can be configured, or up to 8 guest-selectable frames. Use Photo layout to enable Frames or disable all overlays with Camera only / Background with camera window. Disabling frames keeps their managed artwork and calibration; the saved guestFramesEnabled flag persists across restart and duplication. Older profiles retain their existing behavior. Each choice has a separately editable label and camera geometry. Layout → Edit camera layout for selects the frame being calibrated. The frame is drawn above the camera and never mirrors.

Use transparent PNG at exactly the configured canvas size. This release deliberately rejects mismatched frames; it does not silently rescale them. Select the intended canvas first, then import matching frames. Welcome/background accept still PNG, JPEG and WebP. Imports are decoded before activation, copied and orientation-normalized. Failed imports leave the old active configuration intact. Save commits changes; Discard restores the previous configuration.

The included starter event uses the user's original 2400×3600 PNGs and 1600×900 welcome JPEG. Their alpha openings are measured separately; the actual alpha mask in the artwork preserves irregular curves and overlaid lettering. The starter manifest is portable and contains no machine paths. It initializes only a fresh data directory. The application UI stays generic; future events need no source changes.

Branded Stage stretches background artwork to the output canvas; author it at matching dimensions to avoid distortion. The camera is clipped to its configured window, and the optional frame is drawn last. Welcome artwork has a separate Cover/Contain choice; the supplied landscape welcome defaults to Contain to retain all artwork.

Backup/restore: close the application, copy the full private data directory, preserve the folder structure, and restore on the same intended installation/account. Paths in runtime settings are local; moving the data directory across machines requires reviewing/reimporting artwork and selecting current device IDs. A portable profile export/import wizard is not implemented. Never publish runtime data or PIN files.
