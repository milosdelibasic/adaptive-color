# @skyvist/adaptive-color

Adaptive brand colors for React Native text, icons and controls over **images,
videos, maps and ordinary native views**. Choose your own foreground for a dark
or light background; the library samples the region beneath each control.

Native sampling, shared scheduling, hysteresis and measured capture budgets keep
updates bounded. No image renderer, video player, Mapbox or Expo dependency is added.

## Install

```sh
npm install @skyvist/adaptive-color
cd ios && pod install
```

Requires React Native's New Architecture and a native rebuild. Expo development
builds can include it; Expo Go cannot load the native module.

## Use

```tsx
import { AdaptiveColorSource, adaptiveColor, useAdaptiveForeground } from '@skyvist/adaptive-color';

// A native background view and sibling overlay controls:
<AdaptiveColorSource id="hero-background" active={isVisible}>
  <View style={styles.hero}>
    <View nativeID="hero-background" testID="hero-background" collapsable={false}>
      <Image source={photo} style={styles.image}
        onLoad={() => adaptiveColor.invalidate('hero-background')} />
    </View>
    <HeroAction />
  </View>
</AdaptiveColorSource>

function HeroAction() {
  const { color, targetProps } = useAdaptiveForeground({
    onDark: '#FFFFFF', onLight: '#348AFA', fallback: '#FFFFFF',
  });
  return <Pressable {...targetProps} onPress={onAction}><Text style={[styles.label, { color }]}>Open</Text></Pressable>;
}
```

The source ID must identify a **native background subtree**. Controls should be
siblings of that subtree; capturing the controls would create a feedback loop.
Spread all targetProps on the native control wrapper (nativeID, testID,
collapsable, onLayout). IDs must be unique among active sources and controls.

Call `adaptiveColor.invalidate(id)` after an image loads, content changes or map
camera moves. Normal sources wait for 300 ms of quiet, then take a few readings
and stop. For changing video frames, enable continuous sampling while playing:

```tsx
<AdaptiveColorSource id="video-background" active={isVisible} continuous={isPlaying}>
  {/* Native player view with the matching nativeID/testID, plus sibling controls. */}
</AdaptiveColorSource>
```

Continuous mode shares the same approximately 3 Hz scheduler and pauses in the
background. Stop or deactivate the source when it is hidden. It does not require
a per-frame JS callback from the player. Missing or protected frames retain the
last foreground/fallback; protected content is never bypassed.

## Supported backgrounds

| Background | iOS | Android |
| --- | --- | --- |
| Native image/ordinary view | CALayer rendering | Canvas rendering |
| GPU surface, including maps | Metal view readback | SurfaceView PixelCopy / TextureView bitmap |
| Native video | AVPlayerLayer / AVPlayerItemVideoOutput | SurfaceView / TextureView |

Ordinary image and actual non-protected H.264 video fixtures were verified on an
iOS simulator and Android emulator. Video player implementations must expose one
of these native renderers. Browser/HTML video and arbitrary web views are not a
generic supported source. Android CPU SVG trees are intentionally skipped to avoid
expensive full-tree drawing. Use a known theme-based fallback for such surfaces.

**iOS map readback remains experimental:** simulator snapshots exceeded the
capture budget. This limitation does not mean image/video capture uses the same
snapshot path. Verify on target devices and keep a suitable fallback surface.

## Stability and cost

- Up to 12 target regions share a capture. Each region contributes 25 native
  luminance samples; only foreground changes notify React.
- Default switching requires three consistent readings, a meaningful contrast
  improvement and at least 600 ms since the previous change. A small map icon can
  opt into `confirmations: 1` after camera movement settles; values 1–3 are supported.
- A capture over 12 ms, or three over 6 ms, pauses the source for five seconds.
  A second breach suspends it for that unchanged content. New content changes can
  retry; no infinite polling of the same expensive idle view.
- Video output setup and acquisition run on an iOS worker queue; the UI reads the
  latest completed frame. Outputs and cached frames are released on source cleanup
  and backgrounding. A short frame delay is expected.
- Scratch buffers are 48 KiB (iOS) and 96 KiB (Android), **not total memory use**.
  Video frame buffers and platform GPU/readback intermediates may be much larger.

For prescribed brand palettes, `strategy: 'background'` chooses by the background
rather than maximum foreground contrast: below 14% linear-light luminance is dark,
above 22% is light, and the band between retains the previous tone. The default
`strategy: 'contrast'` still selects the better contrast. Use a contrast surface
when a prescribed brand color is not dark/light enough for the underlying image.

Both chosen colors can have inadequate contrast over mixed imagery. This is not
an accessibility guarantee; use a scrim/contrast surface where needed. Pure colors
must be opaque `#RRGGBB` values.

## Diagnostics

`adaptiveColor.getStats()` reports native capture timings, failures, foreground
changes, per-target contrast estimates and suspended sources. `setEnabled(false)`
provides a fixed fallback for paired measurements. No screenshots, video files,
authentication or user content are written by the runtime sampler.

Debug builds expose `globalThis.__skyvistAdaptiveColor`. The development-only
`scripts/runtime.cjs` helper is kept in the source project and is not shipped.
The optional iOS CADisplayLink monitor reports callback intervals, not presented FPS.

See [VALIDATION.md](./VALIDATION.md) for measured results and remaining limitations.
