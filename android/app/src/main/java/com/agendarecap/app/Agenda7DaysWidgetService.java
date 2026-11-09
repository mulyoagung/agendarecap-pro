package com.agendarecap.app;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Agenda7DaysWidgetService
 * Provides RemoteViewsFactory for the scrollable ListView in the Agenda 7 Days Widget.
 * All agenda items for the next 7 days are loaded from SharedPreferences (saved by NativeAlarmPlugin).
 */
public class Agenda7DaysWidgetService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Agenda7DaysRemoteViewsFactory(this.getApplicationContext());
    }

    /**
     * Holds the actual data for each ListView row.
     */
    static class AgendaItem {
        String dateLabel;
        String time;
        String title;
        int dateColor;

        AgendaItem(String dateLabel, String time, String title, int dateColor) {
            this.dateLabel = dateLabel;
            this.time = time;
            this.title = title;
            this.dateColor = dateColor;
        }
    }

    /**
     * Factory that produces RemoteViews rows for the scrollable widget ListView.
     */
    public static class Agenda7DaysRemoteViewsFactory implements RemoteViewsService.RemoteViewsFactory {

        private final Context mContext;
        private final List<AgendaItem> mItems = new ArrayList<>();

        public Agenda7DaysRemoteViewsFactory(Context context) {
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
            RemoteViews rv = new RemoteViews(mContext.getPackageName(), R.layout.agenda_7days_widget_item);
            if (position >= mItems.size()) return rv;

            AgendaItem item = mItems.get(position);
            rv.setTextViewText(R.id.agenda7_item_date, item.dateLabel);
            rv.setTextColor(R.id.agenda7_item_date, item.dateColor);
            rv.setTextViewText(R.id.agenda7_item_time, item.time);
            rv.setTextViewText(R.id.agenda7_item_title, item.title);

            // Tap on item → open main app
            Bundle extras = new Bundle();
            extras.putInt("clickedItem", position);
            Intent fillInIntent = new Intent();
            fillInIntent.putExtras(extras);
            rv.setOnClickFillInIntent(R.id.agenda7_item_title, fillInIntent);

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
                String jsonStr = Agenda7DaysWidgetProvider.getAgendaData(mContext);
                JSONArray allItems = new JSONArray(jsonStr);

                SimpleDateFormat keyFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
                SimpleDateFormat labelFmt = new SimpleDateFormat("d/M", Locale.getDefault());

                Calendar today = Calendar.getInstance();
                Calendar endDay = Calendar.getInstance();
                endDay.add(Calendar.DAY_OF_YEAR, 8);

                String todayKey = keyFmt.format(today.getTime());
                String endKey = keyFmt.format(endDay.getTime());

                for (int i = 0; i < allItems.length(); i++) {
                    JSONObject obj = allItems.getJSONObject(i);
                    String itemDate = obj.optString("date", "");

                    if (itemDate.compareTo(todayKey) >= 0 && itemDate.compareTo(endKey) <= 0) {
                        String time = obj.optString("time", "--:--");
                        String title = obj.optString("title", "Agenda");

                        String dateLabel;
                        int dateColor;

                        if (todayKey.equals(itemDate)) {
                            dateLabel = "Hari\nini";
                            dateColor = Color.parseColor("#4ADE80"); // Bright emerald green for Today
                        } else {
                            try {
                                java.util.Date d = keyFmt.parse(itemDate);
                                Calendar cal = Calendar.getInstance();
                                if (d != null) {
                                    cal.setTime(d);
                                    int dayOfWeek = cal.get(Calendar.DAY_OF_WEEK);

                                    String dayName;
                                    String colorHex;

                                    switch (dayOfWeek) {
                                        case Calendar.MONDAY:
                                            dayName = "Senin";
                                            colorHex = "#38BDF8"; // Sky Blue
                                            break;
                                        case Calendar.TUESDAY:
                                            dayName = "Selasa";
                                            colorHex = "#F472B6"; // Pink / Rose
                                            break;
                                        case Calendar.WEDNESDAY:
                                            dayName = "Rabu";
                                            colorHex = "#FBBF24"; // Amber Yellow
                                            break;
                                        case Calendar.THURSDAY:
                                            dayName = "Kamis";
                                            colorHex = "#A78BFA"; // Lavender / Purple
                                            break;
                                        case Calendar.FRIDAY:
                                            dayName = "Jumat";
                                            colorHex = "#2DD4BF"; // Teal / Turquoise
                                            break;
                                        case Calendar.SATURDAY:
                                            dayName = "Sabtu";
                                            colorHex = "#FB923C"; // Warm Orange
                                            break;
                                        case Calendar.SUNDAY:
                                        default:
                                            dayName = "Minggu";
                                            colorHex = "#F87171"; // Coral Red
                                            break;
                                    }

                                    dateLabel = dayName + "\n" + labelFmt.format(d);
                                    dateColor = Color.parseColor(colorHex);
                                } else {
                                    dateLabel = itemDate.substring(5);
                                    dateColor = Color.parseColor("#94A3B8");
                                }
                            } catch (Exception ex) {
                                dateLabel = itemDate.length() >= 10 ? itemDate.substring(5) : itemDate;
                                dateColor = Color.parseColor("#94A3B8");
                            }
                        }

                        mItems.add(new AgendaItem(dateLabel, time, title, dateColor));
                    }
                }
            } catch (Exception e) {
                // leave mItems empty; widget shows empty state
            }
        }
    }
}
