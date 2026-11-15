#import "SkyvistAdaptiveColor.h"
#import "SkyvistAdaptiveCapture.h"
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#include <algorithm>
#include <cmath>
#include <vector>

static UIView *FindView(UIView *view, NSString *identifier) {
  if ([view.accessibilityIdentifier isEqualToString:identifier]) return view;
  for (UIView *child in view.subviews) {
    UIView *found = FindView(child, identifier);
    if (found) return found;
  }
  return nil;
}
static NSString *JSON(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

@implementation SkyvistAdaptiveColor {
  SkyvistAdaptiveVideoSampler *_videoSampler;
  unsigned char *_pixels;
  CGContextRef _context;
  NSMapTable<NSString *, UIView *> *_views;
  double _linear[256];
  NSUInteger _captures, _failures;
  double _totalMs, _maxMs;
  CADisplayLink *_displayLink;
  CFTimeInterval _lastFrame;
  std::vector<double> _frameIntervals;
}
RCT_EXPORT_MODULE(SkyvistAdaptiveColor)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
  if ((self = [super init])) {
    _videoSampler = [SkyvistAdaptiveVideoSampler new];
    _views = [NSMapTable strongToWeakObjectsMapTable];
    _pixels = (unsigned char *)calloc(64 * 192 * 4, 1);
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    _context = CGBitmapContextCreate(_pixels, 64, 192, 8, 64 * 4, space,
      kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(space);
    for (int i = 0; i < 256; i++) {
      double c = i / 255.0;
      _linear[i] = c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
    }
  }
  return self;
}
- (UIView *)view:(NSString *)identifier window:(UIWindow *)window {
  UIView *view = [_views objectForKey:identifier];
  if (view.window != window || view.hidden) view = nil;
  if (!view) { view = FindView(window, identifier); if (view) [_views setObject:view forKey:identifier]; }
  return view;
}
- (void)capture:(NSString *)sourceId targets:(NSString *)targets resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    CFTimeInterval start = CACurrentMediaTime();
    UIWindow *window = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
      if (scene.activationState != UISceneActivationStateForegroundActive || ![scene isKindOfClass:UIWindowScene.class]) continue;
      for (UIWindow *candidate in ((UIWindowScene *)scene).windows) if (candidate.isKeyWindow) { window = candidate; break; }
    }
    UIView *container = window ? [self view:sourceId window:window] : nil;
    UIView *metal = container ? SkyvistFindMetalView(container) : nil;
    AVPlayerLayer *video = container ? SkyvistFindVideoLayer(container.layer) : nil;
    UIView *source = metal ?: container;
    if (!source || source.bounds.size.width < 1 || source.bounds.size.height < 1 || !self->_context || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
      self->_failures++; resolve(JSON(@{@"ok": @NO, @"reason": @"source-unavailable"})); return;
    }
    NSArray *entries = [NSJSONSerialization JSONObjectWithData:[targets dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (![entries isKindOfClass:NSArray.class] || entries.count > 12) { resolve(JSON(@{@"ok": @NO, @"reason": @"invalid-targets"})); return; }
    // Capture only the declared background subtree. Sibling controls cannot feed back into the decision.
    // One bounded, reused 64x192 buffer serves every registered region.
    CGContextRef ctx = self->_context;
    const double w = source.bounds.size.width, h = source.bounds.size.height;
    CVPixelBufferRef videoBuffer = video ? [self->_videoSampler copyPixelBufferForLayer:video] : NULL;
    if (video && (!videoBuffer || CVPixelBufferGetPixelFormatType(videoBuffer) != kCVPixelFormatType_32BGRA || CGRectIsEmpty(video.videoRect))) {
      if (videoBuffer) CVPixelBufferRelease(videoBuffer);
      self->_failures++; resolve(JSON(@{@"ok": @NO, @"reason": @"video-frame-unavailable"})); return;
    }
    UIColor *background = nil;
    for (UIView *ancestor = container; ancestor && !background; ancestor = ancestor.superview) {
      if (ancestor.backgroundColor && CGColorGetAlpha(ancestor.backgroundColor.CGColor) > 0.95) background = [ancestor.backgroundColor resolvedColorWithTraitCollection:container.traitCollection];
    }
    CGFloat red = 0, green = 0, blue = 0, alpha = 1;
    [(background ?: UIColor.blackColor) getRed:&red green:&green blue:&blue alpha:&alpha];
    const double backgroundLuminance = 0.2126 * self->_linear[std::clamp((int)round(red * 255), 0, 255)] + 0.7152 * self->_linear[std::clamp((int)round(green * 255), 0, 255)] + 0.0722 * self->_linear[std::clamp((int)round(blue * 255), 0, 255)];
    CGContextSaveGState(ctx);
    CGContextSetInterpolationQuality(ctx, kCGInterpolationNone);
    CGContextSetRGBFillColor(ctx, red, green, blue, 1);
    CGContextFillRect(ctx, CGRectMake(0, 0, 64, 192));
    CGContextTranslateCTM(ctx, 0, 192);
    CGContextScaleCTM(ctx, 64 / w, -192 / h);
    BOOL complete = video ? YES : SkyvistDrawAdaptiveView(source, ctx, metal != nil);
    CGContextRestoreGState(ctx);
    double captureMs = (CACurrentMediaTime() - start) * 1000;
    if (!complete) { self->_failures++; resolve(JSON(@{@"ok": @NO, @"reason": @"incomplete-capture", @"captureMs": @(captureMs)})); return; }
    if (videoBuffer) CVPixelBufferLockBaseAddress(videoBuffer, kCVPixelBufferLock_ReadOnly);
    NSMutableArray *regions = [NSMutableArray array];
    for (NSDictionary *entry in entries) {
      if (![entry[@"id"] isKindOfClass:NSString.class]) continue;
      UIView *target = [self view:entry[@"id"] window:window];
      if (!target || target.hidden || target.alpha < 0.1) continue;
      CGRect rect = video ? CGRectIntersection([target.layer convertRect:target.layer.bounds toLayer:video], video.bounds) : CGRectIntersection([target convertRect:target.bounds toView:source], source.bounds);
      if (CGRectIsNull(rect) || rect.size.width < 4 || rect.size.height < 4) continue;
      NSMutableArray *samples = [NSMutableArray arrayWithCapacity:25];
      for (int row = 0; row < 5; row++) for (int column = 0; column < 5; column++) {
        int x = std::clamp((int)((rect.origin.x + rect.size.width * (0.1 + 0.2 * column)) / w * 64), 0, 63);
        int y = std::clamp((int)((rect.origin.y + rect.size.height * (0.1 + 0.2 * row)) / h * 192), 0, 191);
        unsigned char *p = self->_pixels + (y * 64 + x) * 4;
        double luminance = 0.2126 * self->_linear[p[0]] + 0.7152 * self->_linear[p[1]] + 0.0722 * self->_linear[p[2]];
        if (videoBuffer) {
          CGPoint point = CGPointMake(rect.origin.x + rect.size.width * (0.1 + 0.2 * column), rect.origin.y + rect.size.height * (0.1 + 0.2 * row));
          luminance = backgroundLuminance;
          if (CGRectContainsPoint(video.videoRect, point)) {
            int vx = std::clamp((int)((point.x - video.videoRect.origin.x) / video.videoRect.size.width * CVPixelBufferGetWidth(videoBuffer)), 0, (int)CVPixelBufferGetWidth(videoBuffer) - 1);
            int vy = std::clamp((int)((point.y - video.videoRect.origin.y) / video.videoRect.size.height * CVPixelBufferGetHeight(videoBuffer)), 0, (int)CVPixelBufferGetHeight(videoBuffer) - 1);
            unsigned char *pixel = (unsigned char *)CVPixelBufferGetBaseAddress(videoBuffer) + vy * CVPixelBufferGetBytesPerRow(videoBuffer) + vx * 4;
            luminance = 0.2126 * self->_linear[pixel[2]] + 0.7152 * self->_linear[pixel[1]] + 0.0722 * self->_linear[pixel[0]];
          }
        }
        [samples addObject:@(luminance)];
      }
      [regions addObject:@{@"id": entry[@"id"], @"samples": samples}];
    }
    if (videoBuffer) { CVPixelBufferUnlockBaseAddress(videoBuffer, kCVPixelBufferLock_ReadOnly); CVPixelBufferRelease(videoBuffer); }
    double totalMs = (CACurrentMediaTime() - start) * 1000;
    self->_captures++; self->_totalMs += totalMs; self->_maxMs = MAX(self->_maxMs, totalMs);
    resolve(JSON(@{@"ok": @YES, @"regions": regions, @"captureMs": @(captureMs), @"mainThreadMs": @(totalMs), @"bufferBytes": @(64 * 192 * 4)}));
  });
}
- (void)frame:(CADisplayLink *)link {
  if (_lastFrame > 0) {
    double ms = (link.timestamp - _lastFrame) * 1000;
    if (ms > 0 && ms < 200 && _frameIntervals.size() < 18000) _frameIntervals.push_back(ms);
  }
  _lastFrame = link.timestamp;
}
- (void)setFrameMonitoring:(BOOL)enabled {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_displayLink invalidate]; self->_displayLink = nil; self->_lastFrame = 0;
    if (enabled) {
      self->_frameIntervals.clear();
      self->_displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(frame:)];
      [self->_displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    }
  });
}
- (void)getStats:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    auto sorted = self->_frameIntervals; std::sort(sorted.begin(), sorted.end());
    double total = 0; NSUInteger slow = 0;
    for (double ms : sorted) { total += ms; if (ms > 25) slow++; }
    resolve(JSON(@{@"captures": @(self->_captures), @"failures": @(self->_failures),
      @"mainThreadMsAvg": @(self->_captures ? self->_totalMs / self->_captures : 0), @"mainThreadMsMax": @(self->_maxMs),
      @"bufferBytes": @(64 * 192 * 4), @"frameMetric": @"display-link-callback-interval-not-presented-fps",
      @"frameCallbacks": @(sorted.size()), @"callbackFps": @(total ? 1000.0 * sorted.size() / total : 0),
      @"callbackP95Ms": @(sorted.empty() ? 0 : sorted[(size_t)ceil(sorted.size() * 0.95) - 1]), @"callbacksOver25Ms": @(slow)}));
  });
}
- (void)releaseSource:(NSString *)sourceId {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *source = [self->_views objectForKey:sourceId];
    AVPlayerLayer *layer = source ? SkyvistFindVideoLayer(source.layer) : nil;
    if (layer) [self->_videoSampler releaseLayer:layer];
    [self->_views removeObjectForKey:sourceId];
  });
}
- (void)resetStats { dispatch_async(dispatch_get_main_queue(), ^{ self->_captures = self->_failures = 0; self->_totalMs = self->_maxMs = 0; self->_frameIntervals.clear(); self->_lastFrame = 0; }); }
- (void)invalidate { [self setFrameMonitoring:NO]; dispatch_async(dispatch_get_main_queue(), ^{ [self->_videoSampler invalidate]; }); }
- (void)dealloc { [_displayLink invalidate]; if (_context) CGContextRelease(_context); free(_pixels); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeSkyvistAdaptiveColorSpecJSI>(params);
}
@end
