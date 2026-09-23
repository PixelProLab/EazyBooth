# Camera behavior

One Windows video stream is owned by `renderer/camera.ts`, ported from Misk. Camera preferences request capture resolution and at most 30 fps; diagnostics report what the driver actually delivers. The original PNG is a video frame, not a Sony sensor RAW photograph.

The stream warms behind Welcome, stays open while choosing frames and across Retake/Done, and closes only on explicit stop, faults, configuration/profile changes or shutdown. Sony/Imaging Edge-labelled sources require operator visual confirmation once per connection. Until then no guest camera frame is drawn and capture is disabled. A reconnect clears confirmation. Software cannot reliably distinguish an advancing Sony logo from an advancing scene.

Camera → select source → Save → Test live view → visually verify a moving real scene → Confirm live scene. Test both frame layouts with a person/asymmetric chart; compare the printed result. Reconnect and Stop test are available. Automatic selection requires exactly one Sony-labelled device and never silently chooses another camera.

Continuous autofocus is requested only if exposed. Diagnostics report capability, not an unsupported promise that autofocus is active. Fault handling covers mute, ended tracks and roughly 10 seconds without advancing video time. Late permission responses are stopped; concurrent opens/captures coalesce.

See [Sony setup](SONY-SETUP.md). Physical focus, lighting, USB stability, continuous power, thermal behavior and event-length endurance remain on-device acceptance steps.
