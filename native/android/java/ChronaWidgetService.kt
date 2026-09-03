package com.choi.chrona.widget

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.choi.chrona.R
import org.json.JSONArray

class ChronaWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        ChronaWidgetFactory(applicationContext)
}

class ChronaWidgetFactory(private val context: android.content.Context) :
    RemoteViewsService.RemoteViewsFactory {

    private var events = JSONArray()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        events = WidgetData.read(context)?.optJSONArray("events") ?: JSONArray()
    }

    override fun getCount(): Int = events.length()

    override fun getViewAt(position: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_list_item)
        val e = events.optJSONObject(position) ?: return views
        views.setTextViewText(R.id.item_time, e.optString("time"))
        views.setTextViewText(R.id.item_title, e.optString("title"))
        try {
            views.setInt(R.id.item_bar, "setBackgroundColor", Color.parseColor(e.optString("color", "#6C7BFF")))
        } catch (_: Exception) {}

        // 항목 탭 → 일정 상세 딥링크 (fill-in)
        val fill = Intent().apply {
            data = Uri.parse("chrona://event/" + e.optString("id"))
        }
        views.setOnClickFillInIntent(R.id.item_root, fill)
        return views
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false
    override fun onDestroy() {}
}
