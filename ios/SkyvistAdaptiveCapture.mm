#import "SkyvistAdaptiveCapture.h"
#import <QuartzCore/CAMetalLayer.h>

UIView *SkyvistFindMetalView(UIView *view) {
  if ([view.layer isKindOfClass:CAMetalLayer.class]) return view;
  for (UIView *child in view.subviews) { UIView *found = SkyvistFindMetalView(child); if (found) return found; }
  return nil;
}
AVPlayerLayer *SkyvistFindVideoLayer(CALayer *layer) {
  if ([layer isKindOfClass:AVPlayerLayer.class]) return (AVPlayerLayer *)layer;
  for (CALayer *child in layer.sublayers) { AVPlayerLayer *found = SkyvistFindVideoLayer(child); if (found) return found; }
  return nil;
}
BOOL SkyvistDrawAdaptiveView(UIView *view, CGContextRef context, BOOL gpu) {
  if (gpu) {
    UIGraphicsPushContext(context);
    BOOL complete = [view drawViewHierarchyInRect:view.bounds afterScreenUpdates:NO];
    UIGraphicsPopContext();
    return complete;
  }
  [view.layer renderInContext:context];
  return YES;
}

@interface SkyvistAdaptiveVideoRecord : NSObject {
@public CVPixelBufferRef pixels;
@public BOOL pending;
@public BOOL disposed;
}
@property(nonatomic,strong) AVPlayerItemVideoOutput *output;
@end
@implementation SkyvistAdaptiveVideoRecord
- (void)dealloc { if (pixels) CVPixelBufferRelease(pixels); }
@end

@implementation SkyvistAdaptiveVideoSampler {
  NSMapTable<AVPlayerItem *, SkyvistAdaptiveVideoRecord *> *_records;
  dispatch_queue_t _queue;
}
- (instancetype)init {
  if ((self = [super init])) {
    _records = [NSMapTable weakToStrongObjectsMapTable];
    _queue = dispatch_queue_create("com.skyvist.adaptive-color.video", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}
- (CVPixelBufferRef)copyPixelBufferForLayer:(AVPlayerLayer *)layer {
  AVPlayerItem *item = layer.player.currentItem;
  if (!item) return NULL;
  SkyvistAdaptiveVideoRecord *record = [_records objectForKey:item];
  if (!record) { record = [SkyvistAdaptiveVideoRecord new]; [_records setObject:record forKey:item]; }
  CVPixelBufferRef ready = NULL;
  BOOL request = NO;
  @synchronized(record) {
    if (record->pixels) ready = CVPixelBufferRetain(record->pixels);
    if (!record->pending && !record->disposed) { record->pending = YES; request = YES; }
  }
  if (request) {
    CMTime time = layer.player.currentTime;
    dispatch_async(_queue, ^{
      @synchronized(record) { if (record->disposed) { record->pending = NO; return; } }
      if (!record.output) {
        record.output = [[AVPlayerItemVideoOutput alloc] initWithPixelBufferAttributes:@{(NSString *)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)}];
        [item addOutput:record.output];
      }
      CVPixelBufferRef frame = [record.output copyPixelBufferForItemTime:time itemTimeForDisplay:NULL];
      @synchronized(record) {
        if (frame && !record->disposed) {
          if (record->pixels) CVPixelBufferRelease(record->pixels);
          record->pixels = frame; frame = NULL;
        }
        record->pending = NO;
      }
      if (frame) CVPixelBufferRelease(frame);
    });
  }
  return ready;
}
- (void)releaseItem:(AVPlayerItem *)item {
  SkyvistAdaptiveVideoRecord *record = [_records objectForKey:item];
  if (!record) return;
  @synchronized(record) { record->disposed = YES; }
  [_records removeObjectForKey:item];
  dispatch_async(_queue, ^{
    if (record.output) { [item removeOutput:record.output]; record.output = nil; }
    @synchronized(record) { if (record->pixels) { CVPixelBufferRelease(record->pixels); record->pixels = NULL; } }
  });
}
- (void)releaseLayer:(AVPlayerLayer *)layer { if (layer.player.currentItem) [self releaseItem:layer.player.currentItem]; }
- (void)invalidate { for (AVPlayerItem *item in _records.keyEnumerator.allObjects) [self releaseItem:item]; }
@end
