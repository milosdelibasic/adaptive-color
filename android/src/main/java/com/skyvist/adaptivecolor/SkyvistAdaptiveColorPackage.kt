package com.skyvist.adaptivecolor

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SkyvistAdaptiveColorPackage : BaseReactPackage() {
  override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
    if (name == SkyvistAdaptiveColorModule.NAME) SkyvistAdaptiveColorModule(context) else null
  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(SkyvistAdaptiveColorModule.NAME to ReactModuleInfo(
      SkyvistAdaptiveColorModule.NAME, SkyvistAdaptiveColorModule.NAME, false, false, false, true
    ))
  }
}
