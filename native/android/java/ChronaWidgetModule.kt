package com.choi.chrona.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import com.choi.chrona.R
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

/** JS → 위젯 갱신 브로드캐스트. 데이터 자체는 filesDir/widget-data.json (JS가 씀) */
class ChronaWidgetModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "ChronaWidget"

    @ReactMethod
    fun updateWidgets(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            val manager = AppWidgetManager.getInstance(ctx)
            val listIds = manager.getAppWidgetIds(ComponentName(ctx, ChronaWidgetProvider::class.java))
            val compactIds = manager.getAppWidgetIds(ComponentName(ctx, ChronaCompactProvider::class.java))
            if (listIds.isNotEmpty()) {
                manager.notifyAppWidgetViewDataChanged(listIds, R.id.widget_list)
                ChronaWidgetProvider().onUpdate(ctx, manager, listIds)
            }
            if (compactIds.isNotEmpty()) {
                ChronaCompactProvider().onUpdate(ctx, manager, compactIds)
            }
            promise.resolve(listIds.size + compactIds.size)
        } catch (e: Exception) {
            promise.reject("widget_update_failed", e)
        }
    }
}
