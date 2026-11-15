#import <UIKit/UIKit.h>
#import <AVFoundation/AVFoundation.h>
#import "SkyvistAdaptiveCapture.h"

@interface FixtureScene : UIResponder <UIWindowSceneDelegate>
@property(nonatomic,strong) UIWindow *window;
@property(nonatomic,strong) AVPlayer *player;
@property(nonatomic,strong) NSTimer *timer;
@property(nonatomic,strong) SkyvistAdaptiveVideoSampler *sampler;
@property(nonatomic,strong) AVPlayerLayer *videoLayer;
@property(nonatomic,strong) NSMutableArray *frames;
@property(nonatomic,strong) NSMutableArray *costs;
@property(nonatomic,assign) BOOL imagePassed;
@property(nonatomic,assign) NSInteger ticks;
@end
@implementation FixtureScene
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
 self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
 UIViewController *vc = [UIViewController new]; vc.view.backgroundColor = UIColor.grayColor;
 self.window.rootViewController = vc; [self.window makeKeyAndVisible];
 unsigned char pixels[64*192*4] = {0};
 CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
 CGContextRef ctx = CGBitmapContextCreate(pixels,64,192,8,64*4,space,kCGImageAlphaPremultipliedLast|kCGBitmapByteOrder32Big);
 CGColorSpaceRelease(space);
 UIImageView *image = [[UIImageView alloc] initWithFrame:CGRectMake(0,60,300,160)];
 UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(100,100)];
 image.image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *c){[UIColor.whiteColor setFill]; UIRectFill(CGRectMake(0,0,100,100));}];
 [vc.view addSubview:image]; CGContextScaleCTM(ctx,64.0/300,192.0/160); SkyvistDrawAdaptiveView(image,ctx,NO);
 BOOL white = pixels[(96*64+32)*4]>245;
 image.image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *c){[UIColor.blackColor setFill]; UIRectFill(CGRectMake(0,0,100,100));}];
 SkyvistDrawAdaptiveView(image,ctx,NO); self.imagePassed = white && pixels[(96*64+32)*4]<10;
 CGContextRelease(ctx);
 UIView *videoView = [[UIView alloc] initWithFrame:CGRectMake(20,280,320,320)]; [vc.view addSubview:videoView];
 self.player = [AVPlayer playerWithURL:[NSBundle.mainBundle URLForResource:@"fixture" withExtension:@"mp4"]]; self.player.muted = YES;
 self.videoLayer = [AVPlayerLayer playerLayerWithPlayer:self.player]; self.videoLayer.frame=videoView.bounds; self.videoLayer.videoGravity=AVLayerVideoGravityResizeAspect;
 [videoView.layer addSublayer:self.videoLayer]; self.sampler = [SkyvistAdaptiveVideoSampler new]; self.frames=[NSMutableArray array]; self.costs=[NSMutableArray array];
 [self.player play];
 self.timer = [NSTimer scheduledTimerWithTimeInterval:.2 target:self selector:@selector(sample) userInfo:nil repeats:YES];
}
- (void)sample {
 self.ticks++;
 CFTimeInterval start = CACurrentMediaTime();
 CVPixelBufferRef frame = [self.sampler copyPixelBufferForLayer:self.videoLayer];
 if (frame) {
  CVPixelBufferLockBaseAddress(frame,kCVPixelBufferLock_ReadOnly);
  unsigned char *p = (unsigned char *)CVPixelBufferGetBaseAddress(frame) + CVPixelBufferGetBytesPerRow(frame)*(CVPixelBufferGetHeight(frame)/2)+(CVPixelBufferGetWidth(frame)/2)*4;
  [self.frames addObject:@(p[0])]; CVPixelBufferUnlockBaseAddress(frame,kCVPixelBufferLock_ReadOnly); CVPixelBufferRelease(frame);
 }
 [self.costs addObject:@((CACurrentMediaTime()-start)*1000)];
 if(self.ticks>=24) {
  [self.timer invalidate]; [self.player pause]; [self.sampler invalidate];
  BOOL dark=NO,light=NO; for(NSNumber*n in self.frames){if(n.intValue<20)dark=YES;if(n.intValue>235)light=YES;}
  NSDictionary *result=@{@"imagePassed":@(self.imagePassed),@"videoPassed":@(dark&&light),@"videoFrames":self.frames,@"captureMs":self.costs};
  NSData *json=[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
  NSString *path=[NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject stringByAppendingPathComponent:@"results.json"];
  [json writeToFile:path atomically:YES]; NSLog(@"Adaptive fixture finished: %@",path);
 }
}
@end
@interface FixtureApp : UIResponder <UIApplicationDelegate> @end
@implementation FixtureApp
- (UISceneConfiguration *)application:(UIApplication *)app configurationForConnectingSceneSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options { UISceneConfiguration *c=[[UISceneConfiguration alloc] initWithName:@"Fixture" sessionRole:session.role];c.delegateClass=FixtureScene.class;return c; }
@end
int main(int argc,char **argv){@autoreleasepool{return UIApplicationMain(argc,argv,nil,NSStringFromClass(FixtureApp.class));}}
