package com.choi.chrona.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.choi.chrona.R

/** 콤팩트 위젯 (2x2): 다음 수업 + 임박 과제 */
class ChronaCompactProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_compact)
            val data = WidgetData.read(context)
            val next = data?.optJSONObject("nextClass")
            val task = data?.optJSONArray("tasks")?.optJSONObject(0)

            if (next != null) {
                views.setViewVisibility(R.id.compact_next_group, View.VISIBLE)
                views.setTextViewText(R.id.compact_next_time, next.optString("time"))
                views.setTextViewText(R.id.compact_next_title, next.optString("label"))
            } else {
                views.setViewVisibility(R.id.compact_next_group, View.GONE)
            }
            if (task != null) {
                views.setTextViewText(
                    R.id.compact_task,
                    task.optString("dday") + " " + task.optString("title")
                )
                views.setViewVisibility(R.id.compact_task, View.VISIBLE)
            } else {
                views.setViewVisibility(R.id.compact_task, View.GONE)
            }
            if (next == null && task == null) {
                views.setTextViewText(R.id.compact_next_title, "오늘은 여유롭네요")
                views.setViewVisibility(R.id.compact_next_group, View.VISIBLE)
            }

            val open = Intent(Intent.ACTION_VIEW, Uri.parse("chrona://calendar"))
            views.setOnClickPendingIntent(
                R.id.compact_root,
                PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_IMMUTABLE)
            )
            manager.updateAppWidget(id, views)
        }
    }
}
