#import <UIKit/UIKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>

UIView *SkyvistFindMetalView(UIView *view);
AVPlayerLayer *SkyvistFindVideoLayer(CALayer *layer);
BOOL SkyvistDrawAdaptiveView(UIView *view, CGContextRef context, BOOL gpu);

@interface SkyvistAdaptiveVideoSampler : NSObject
- (CVPixelBufferRef)copyPixelBufferForLayer:(AVPlayerLayer *)layer CF_RETURNS_RETAINED;
- (void)releaseLayer:(AVPlayerLayer *)layer;
- (void)invalidate;
@end
