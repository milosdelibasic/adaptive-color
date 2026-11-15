# Validation — 0.1.0

Measured 2026-11-15 in the Skyvist debug app with React Native 0.88.1, Android 14
arm64 emulator and iPhone 17 simulator. Eight 30-second runs, OFF/ON/ON/OFF on each
platform, with repeated alternating globe pans in the same binary. Other simulator
and background applications were running on the Mac. No builds during final runs.

| Metric | Android | iOS simulator |
| --- | --- | --- |
| Mean process CPU, OFF → ON (100% = one core) | 41.3% → 43.1% | 32.5% → 33.2% |
| Measured main-thread capture averages | 0.68 ms; separate settled check 0.35 ms | 25.96 ms / 32.36 ms |
| Largest measured capture in paired runs | 1.73 ms | 35.95 ms |
| Display FPS, OFF → ON (includes idle time) | 45.02 → 44.55 | unavailable |

These short simulator measurements do not establish statistical significance or
zero overhead. Android memory grew in OFF runs too and fell between runs; this
experiment cannot isolate allocation overhead or rule out leaks. Android frame
classifications were 99.5–99.9% late in both modes; those emulator traces cannot
establish real-device smoothness. FPS is device-wide, not app-attributed.

The iOS sampler exceeded its budget and was suspended after two breaches. Its ON
CPU values therefore measure the guarded implementation, not continuous adaptation.
Optional CADisplayLink callback timings are not presented FPS. Physical devices,
release builds and arbitrary backgrounds remain unverified.

Three matching contrast readings, improvement thresholds and a minimum switch
interval prevented repeated toggles in observed pans. Mixed map imagery may still
have poor contrast; retain a translucent or opaque contrast surface beneath text.
Known-color/vector backgrounds should use the provided fallback instead of capture.

TypeScript and 11 library tests (contrast and scheduling) passed; the app's two
WorldTabs tests also passed. iOS signed simulator and Android arm64 debug builds
succeeded and were installed. Light/dark Discover search, My World controls and
Memories fallback were visually checked. Tests are included in the source project;
the npm package ships only runtime source, native code, license and release docs.


## General backgrounds — 0.2.0

Native renderer fixtures used the same iOS capture helper and the Android Canvas/
PixelCopy paths. A 160×160, 4-second H.264 clip changed from black to white. Ordinary
UIImageView/ImageView fixtures were checked in both colors. Both platforms passed.
This verifies native rendering paths; it is not a compatibility claim for every
third-party React Native player or DRM content.

The first synchronous iOS video-output setup took 116.6 ms. Setup and acquisition
were moved to a serial worker queue before release. In the repeated simulator
fixture, requesting the latest completed frame on the UI thread had a 0.30 ms
median and 1.08 ms maximum. These request timings exclude worker preparation and
the JS/region-analysis pipeline. The Android PixelCopy callback latency had a
1.53 ms median; this is wall latency, not UI-thread occupancy. These numbers are
not directly comparable and do not measure playback FPS or physical devices.

Source fixtures and raw synthetic results are retained under tests/native in the
source project, excluded from npm. They contain no real video or user content.
