package com.skyvist.adaptivecolor.fixture;
import android.app.Activity;
import android.os.*;
import android.graphics.*;
import android.widget.*;
import android.view.*;
import android.net.Uri;
import org.json.*;
import java.io.*;
public class Fixture extends Activity {
 final Handler main=new Handler(Looper.getMainLooper());
 final Bitmap target=Bitmap.createBitmap(64,192,Bitmap.Config.ARGB_8888);
 final JSONArray frames=new JSONArray(); final JSONArray latency=new JSONArray();
 VideoView video; boolean imagePassed; int ticks=0;
 @Override public void onCreate(Bundle state){super.onCreate(state);
  FrameLayout root=new FrameLayout(this); setContentView(root);
  ImageView image=new ImageView(this); root.addView(image,new FrameLayout.LayoutParams(300,160)); image.layout(0,0,300,160);
  Bitmap white=Bitmap.createBitmap(100,100,Bitmap.Config.ARGB_8888);white.eraseColor(Color.WHITE);image.setImageBitmap(white);
  Canvas c=new Canvas(target);c.scale(64f/300,192f/160);image.draw(c);boolean light=Color.red(target.getPixel(32,96))>245;
  white.eraseColor(Color.BLACK);image.draw(c);imagePassed=light&&Color.red(target.getPixel(32,96))<10;
  video=new VideoView(this);FrameLayout.LayoutParams v=new FrameLayout.LayoutParams(400,400);v.topMargin=220;v.leftMargin=20;root.addView(video,v);
  video.setVideoURI(Uri.parse("android.resource://"+getPackageName()+"/raw/fixture"));video.setOnPreparedListener(player->{player.setVolume(0,0);video.start();main.postDelayed(this::sample,200);});
 }
 void sample(){ticks++;final long start=SystemClock.elapsedRealtimeNanos();
  PixelCopy.request(video,target,code->{if(code==PixelCopy.SUCCESS){frames.put(Color.red(target.getPixel(32,96)));latency.put((Object)Double.valueOf((SystemClock.elapsedRealtimeNanos()-start)/1e6));}
   if(ticks<24)main.postDelayed(this::sample,200);else finishTest();},main);
 }
 void finishTest(){video.stopPlayback();boolean dark=false,light=false;for(int i=0;i<frames.length();i++){int x=frames.optInt(i);dark|=x<20;light|=x>235;}
  try{JSONObject result=new JSONObject().put("imagePassed",imagePassed).put("videoPassed",dark&&light).put("videoFrames",frames).put("pixelCopyLatencyMs",latency);try(FileWriter writer=new FileWriter(new File(getFilesDir(),"results.json"))){writer.write(result.toString());}}catch(Exception e){throw new RuntimeException(e);}
 }
}
