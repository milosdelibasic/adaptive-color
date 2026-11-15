package com.skyvist.adaptivecolor

import android.graphics.Canvas
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import kotlin.math.pow

@ReactModule(name = SkyvistAdaptiveColorModule.NAME)
class SkyvistAdaptiveColorModule(context: ReactApplicationContext) : NativeSkyvistAdaptiveColorSpec(context), LifecycleEventListener {
  private val main = Handler(Looper.getMainLooper())
  private val worker = HandlerThread("SkyvistAdaptiveColor").apply { start() }
  private val handler = Handler(worker.looper)
  private val cache = mutableMapOf<String, WeakReference<View>>()
  private val bitmap = Bitmap.createBitmap(64, 192, Bitmap.Config.ARGB_8888)
  private val pixels = IntArray(64 * 192)
  private val linear = DoubleArray(256) { i -> val c = i / 255.0; if (c <= .04045) c / 12.92 else ((c + .055) / 1.055).pow(2.4) }
  private var resumed = true
  private var inFlight = false
  private var invalidated = false
  private var captures = 0
  private var failures = 0
  private var totalMs = 0.0
  private var maxMs = 0.0
  init { context.addLifecycleEventListener(this) }
  override fun getName() = NAME
  private fun locate(root: View, id: String): View? {
    cache[id]?.get()?.let { if (it.isAttachedToWindow && it.isShown) return it }
    fun search(view: View): View? {
      if (view.getTag(com.facebook.react.R.id.view_tag_native_id) == id || view.getTag(com.facebook.react.R.id.react_test_id) == id) return view
      if (view is ViewGroup) for (i in 0 until view.childCount) search(view.getChildAt(i))?.let { return it }
      return null
    }
    cache.entries.removeAll { it.value.get()?.isAttachedToWindow != true }
    return search(root)?.also { cache[id] = WeakReference(it) }
  }
  private fun gpu(view: View): View? {
    if (view is SurfaceView || view is TextureView) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) gpu(view.getChildAt(i))?.let { return it }
    return null
  }
  override fun capture(sourceId: String, targets: String, promise: Promise) {
    main.post {
      val started = SystemClock.elapsedRealtimeNanos()
      val root = reactApplicationContext.currentActivity?.window?.decorView
      val source = root?.let { locate(it, sourceId) }
      if (!resumed || invalidated || inFlight || source == null || source.width < 1 || source.height < 1 || !source.isShown) {
        failures++; promise.resolve(JSONObject().put("ok", false).put("reason", "source-unavailable").toString()); return@post
      }
      val entries = try { JSONArray(targets) } catch (_: Exception) { JSONArray() }
      if (entries.length() > 12) { promise.resolve("{\"ok\":false}"); return@post }
      val renderer = gpu(source) ?: source
      fun unsupported(view: View): Boolean {
        if (view.javaClass.name.contains("svg", ignoreCase = true) || view is android.webkit.WebView) return true
        if (view is ViewGroup) for (i in 0 until view.childCount) if (unsupported(view.getChildAt(i))) return true
        return false
      }
      if (renderer === source && unsupported(source)) { failures++; promise.resolve("{\"ok\":false,\"reason\":\"unsupported-renderer\"}"); return@post }
      val origin = IntArray(2); renderer.getLocationInWindow(origin)
      val rectangles = mutableListOf<Pair<String, Rect>>()
      for (i in 0 until entries.length()) {
        val id = entries.optJSONObject(i)?.optString("id") ?: continue
        val view = locate(root, id) ?: continue
        if (!view.isShown || view.alpha < .1) continue
        val location = IntArray(2); view.getLocationInWindow(location)
        val rect = Rect(location[0] - origin[0], location[1] - origin[1], location[0] - origin[0] + view.width, location[1] - origin[1] + view.height)
        if (rect.intersect(0, 0, renderer.width, renderer.height) && rect.width() > 3 && rect.height() > 3) rectangles.add(id to rect)
      }
      val width = renderer.width; val height = renderer.height
      inFlight = true
      fun finish(success: Boolean, captureMs: Double, mainMs: Double) {
        if (invalidated) {
          inFlight = false; bitmap.recycle(); worker.quitSafely()
          promise.resolve("{\"ok\":false,\"reason\":\"invalidated\"}"); return
        }
        handler.post {
          val regions = JSONArray()
          if (success) {
            bitmap.getPixels(pixels, 0, 64, 0, 0, 64, 192)
            for ((id, rect) in rectangles) {
              val samples = JSONArray()
              for (row in 0..4) for (column in 0..4) {
                val x = ((rect.left + rect.width() * (.1 + .2 * column)) / width * 64).toInt().coerceIn(0, 63)
                val y = ((rect.top + rect.height() * (.1 + .2 * row)) / height * 192).toInt().coerceIn(0, 191)
                val pixel = pixels[y * 64 + x]
                samples.put(.2126 * linear[(pixel shr 16) and 255] + .7152 * linear[(pixel shr 8) and 255] + .0722 * linear[pixel and 255])
              }
              regions.put(JSONObject().put("id", id).put("samples", samples))
            }
          }
          main.post {
            inFlight = false
            if (invalidated) { bitmap.recycle(); worker.quitSafely() }
            if (success) { captures++; totalMs += mainMs; maxMs = maxOf(maxMs, mainMs) } else failures++
            promise.resolve(JSONObject().put("ok", success && resumed && !invalidated).put("regions", regions).put("captureMs", captureMs).put("mainThreadMs", mainMs).put("bufferBytes", 64 * 192 * 8).toString())
          }
        }
      }
      var issueMs = 0.0
      try {
        when (renderer) {
          is SurfaceView -> {
            PixelCopy.request(renderer, bitmap, { code -> finish(code == PixelCopy.SUCCESS, (SystemClock.elapsedRealtimeNanos() - started) / 1e6, issueMs) }, main)
            issueMs = (SystemClock.elapsedRealtimeNanos() - started) / 1e6
          }
          is TextureView -> {
            val available = renderer.isAvailable
            if (available) renderer.getBitmap(bitmap)
            val ms = (SystemClock.elapsedRealtimeNanos() - started) / 1e6
            finish(available, ms, ms)
          }
          else -> {
            bitmap.eraseColor(android.graphics.Color.TRANSPARENT)
            val canvas = Canvas(bitmap); canvas.scale(64f / width, 192f / height)
            renderer.draw(canvas)
            val ms = (SystemClock.elapsedRealtimeNanos() - started) / 1e6
            finish(true, ms, ms)
          }
        }
      } catch (_: Exception) { finish(false, (SystemClock.elapsedRealtimeNanos() - started) / 1e6, 0.0) }
    }
  }
  override fun getStats(promise: Promise) { main.post { promise.resolve(JSONObject().put("captures", captures).put("failures", failures).put("mainThreadMsAvg", if (captures > 0) totalMs / captures else 0.0).put("mainThreadMsMax", maxMs).put("bufferBytes", 64 * 192 * 8).toString()) } }
  override fun releaseSource(sourceId: String) { main.post { cache.remove(sourceId) } }
  override fun resetStats() { main.post { captures = 0; failures = 0; totalMs = 0.0; maxMs = 0.0 } }
  override fun setFrameMonitoring(enabled: Boolean) { /* Android display frames are measured externally with Perfetto. */ }
  override fun onHostResume() { resumed = true }
  override fun onHostPause() { resumed = false }
  override fun onHostDestroy() { resumed = false; cache.clear() }
  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    main.post {
      invalidated = true; resumed = false; cache.clear()
      // An in-flight PixelCopy owns the buffer until its callback completes.
      if (!inFlight) { bitmap.recycle(); worker.quitSafely() }
    }
    super.invalidate()
  }
  companion object { const val NAME = "SkyvistAdaptiveColor" }
}
