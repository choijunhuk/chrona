package com.choi.chrona.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import com.choi.chrona.R

/** 오늘 일정 리스트 위젯 (4x2, 스크롤) */
class ChronaWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_list)
            val data = WidgetData.read(context)
            views.setTextViewText(R.id.widget_date, data?.optString("today") ?: "Chrona")

            // 리스트 어댑터 연결
            val svcIntent = Intent(context, ChronaWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                setData(Uri.parse(toUri(Intent.URI_INTENT_SCHEME)))
            }
            views.setRemoteAdapter(R.id.widget_list, svcIntent)
            views.setEmptyView(R.id.widget_list, R.id.widget_empty)

            // 항목 탭 → 딥링크 템플릿 (FLAG_IMMUTABLE — Android 12+)
            val template = Intent(Intent.ACTION_VIEW, Uri.parse("chrona://calendar"))
            views.setPendingIntentTemplate(
                R.id.widget_list,
                PendingIntent.getActivity(
                    context, 0, template,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                )
            )
            // 헤더 탭 → 앱 열기
            val open = Intent(Intent.ACTION_VIEW, Uri.parse("chrona://calendar"))
            views.setOnClickPendingIntent(
                R.id.widget_date,
                PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_IMMUTABLE)
            )

            manager.updateAppWidget(id, views)
            manager.notifyAppWidgetViewDataChanged(id, R.id.widget_list)
        }
    }
}
