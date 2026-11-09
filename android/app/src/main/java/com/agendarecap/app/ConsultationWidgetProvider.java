package com.agendarecap.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;

/**
 * ConsultationWidgetProvider
 * Displays a scrollable list of active consultation items on the Android home screen
 * using a ListView backed by ConsultationWidgetService (RemoteViewsService).
 * Provides a "+ Catatan" button to open the consultation page for adding notes.
 * Data is fed by NativeAlarmPlugin.updateConsultationWidgetData().
 */
public class ConsultationWidgetProvider extends AppWidgetProvider {

    private static final String CONSULTATION_PREFS = "agendarecap_consultation_widget_prefs";
    private static final String KEY_CONSULTATION_JSON = "consultation_items_json";

    public static void saveConsultationData(Context context, String json) {
        context.getSharedPreferences(CONSULTATION_PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_CONSULTATION_JSON, json).apply();
    }

    public static String getConsultationData(Context context) {
        return context.getSharedPreferences(CONSULTATION_PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CONSULTATION_JSON, "[]");
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAllWidgets(Context context) {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName componentName = new ComponentName(context, ConsultationWidgetProvider.class);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(componentName);
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.consultation_widget);

        // Dynamic app branding
        String appName = NativeAlarmPlugin.getSavedAppName(context);
        views.setTextViewText(R.id.consultation_widget_title, appName.toUpperCase());

        // Tap on widget body / header → open consultation page
        Intent consultIntent = new Intent(context, MainActivity.class);
        consultIntent.putExtra("target_route", "consultation");
        PendingIntent consultPendingIntent = PendingIntent.getActivity(
                context,
                0,
                consultIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.consultation_widget_container, consultPendingIntent);

        // "+ Catatan" button → open consultation page for adding notes
        Intent addNoteIntent = new Intent(context, MainActivity.class);
        addNoteIntent.putExtra("target_route", "consultation");
        addNoteIntent.putExtra("action", "add_note");
        PendingIntent addNotePendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId + 100,
                addNoteIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.consultation_btn_add_note, addNotePendingIntent);

        int count = 0;
        try {
            String jsonStr = getConsultationData(context);
            JSONArray array = new JSONArray(jsonStr);
            count = array.length();
        } catch (Exception ignored) {}

        views.setTextViewText(R.id.consultation_count_badge, String.valueOf(count));

        if (count > 0) {
            // Set up RemoteAdapter for scrollable ListView
            Intent serviceIntent = new Intent(context, ConsultationWidgetService.class);
            serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
            serviceIntent.setData(Uri.fromParts("content", String.valueOf(appWidgetId), null));
            views.setRemoteAdapter(R.id.consultation_list_view, serviceIntent);

            // Pending intent template for item clicks → open consultation in main app
            Intent itemClickIntent = new Intent(context, MainActivity.class);
            PendingIntent itemPendingIntent = PendingIntent.getActivity(
                    context,
                    appWidgetId + 200,
                    itemClickIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setPendingIntentTemplate(R.id.consultation_list_view, itemPendingIntent);

            views.setViewVisibility(R.id.consultation_list_view, View.VISIBLE);
            views.setViewVisibility(R.id.consultation_empty_text, View.GONE);

            // Refresh list view data
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.consultation_list_view);
        } else {
            views.setViewVisibility(R.id.consultation_list_view, View.GONE);
            views.setViewVisibility(R.id.consultation_empty_text, View.VISIBLE);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
