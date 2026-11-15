# Changelog

## 0.2.1

- Release native video frames and source caches when the application enters the background; recreate them on return.

## 0.2.0

General background support: ordinary native views/images, iOS AVPlayerLayer video
frames, Android raster views and existing SurfaceView/TextureView video paths.
Continuous video sampling is opt-in. iOS video preparation/acquisition runs off the
UI thread, with lifecycle cleanup. Maps remain supported; iOS snapshot costs remain
an explicit limitation. Expanded documentation and actual image/video fixtures.

## 0.1.1

Allow settled icon sampling with configurable confirmations (default remains three).
Retry suspended sources when content changes again, while preserving the idle capture budget.

## 0.1.0

Initial experimental release: native GPU map sampling, per-control brand foregrounds,
shared debounce/batching, contrast hysteresis, lifecycle cleanup, performance budget
backoff/suspension and diagnostics. iOS GPU readback remains experimental.
