package com.choi.chrona.widget

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * JS가 filesDir/widget-data.json 에 내려둔 데이터를 읽는다.
 * (SharedPreferences 대신 파일 — RN쪽이 expo-file-system만으로 쓸 수 있어 브릿지 최소화)
 */
object WidgetData {
    fun read(context: Context): JSONObject? {
        return try {
            val f = File(context.filesDir, "widget-data.json")
            if (!f.exists()) null else JSONObject(f.readText())
        } catch (e: Exception) {
            null
        }
    }
}
