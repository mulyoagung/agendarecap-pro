package com.agendarecap.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * ConsultationWidgetService
 * RemoteViewsService backing the scrollable ListView in ConsultationWidgetProvider.
 */
public class ConsultationWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new ConsultationRemoteViewsFactory(this.getApplicationContext());
    }

    static class ConsultationItem {
        String title;
        String notes;
        int count;

        ConsultationItem(String title, String notes, int count) {
            this.title = title;
            this.notes = notes;
            this.count = count;
        }
    }

    public static class ConsultationRemoteViewsFactory implements RemoteViewsService.RemoteViewsFactory {

        private final Context mContext;
        private final List<ConsultationItem> mItems = new ArrayList<>();

        public ConsultationRemoteViewsFactory(Context context) {
            mContext = context;
        }

        @Override
        public void onCreate() {
            loadData();
        }

        @Override
        public void onDataSetChanged() {
            loadData();
        }

        @Override
        public void onDestroy() {
            mItems.clear();
        }

        @Override
        public int getCount() {
            return mItems.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews rv = new RemoteViews(mContext.getPackageName(), R.layout.consultation_widget_item);
            if (position >= mItems.size()) return rv;

            ConsultationItem item = mItems.get(position);
            rv.setTextViewText(R.id.consultation_item_title, item.title);

            if (item.notes != null && !item.notes.trim().isEmpty()) {
                rv.setTextViewText(R.id.consultation_item_notes, item.notes.trim());
                rv.setViewVisibility(R.id.consultation_item_notes, View.VISIBLE);
            } else {
                rv.setViewVisibility(R.id.consultation_item_notes, View.GONE);
            }

            // Fill-in intent for item clicks
            Bundle extras = new Bundle();
            extras.putString("target_route", "consultation");
            extras.putInt("clickedItem", position);
            Intent fillInIntent = new Intent();
            fillInIntent.putExtras(extras);
            rv.setOnClickFillInIntent(R.id.consultation_item_container, fillInIntent);

            return rv;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        private void loadData() {
            mItems.clear();
            try {
                String jsonStr = ConsultationWidgetProvider.getConsultationData(mContext);
                JSONArray array = new JSONArray(jsonStr);
                for (int i = 0; i < array.length(); i++) {
                    JSONObject obj = array.getJSONObject(i);
                    String title = obj.optString("title", "Konsultasi");
                    String notes = obj.optString("notes", "");
                    int count = obj.optInt("count", 1);
                    mItems.add(new ConsultationItem(title, notes, count));
                }
            } catch (Exception ignored) {}
        }
    }
}

