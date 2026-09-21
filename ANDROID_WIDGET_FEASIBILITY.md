# Android Home Screen Widget Feasibility Audit

## 1. Overview & Objectives
Dokumen ini menyajikan analisis kelayakan teknis (*feasibility audit*) untuk pengembangan **Android Home Screen Widget** pada aplikasi AgendaRecap Pro berbasis Capacitor.

Dua widget yang direncanakan di masa mendatang:
1. **Widget 1: "Agenda Hari Ini & Besok"** — Menampilkan daftar agenda terdekat yang dijadwalkan untuk hari ini dan besok.
2. **Widget 2: "Konsultasi"** — Menampilkan agenda tanpa tanggal (*unscheduled / pending consultation*).

Prinsip utama: Data widget **wajib dapat diakses 100% secara offline** dari penyimpanan lokal perangkat tanpa bergantung pada koneksi internet.

---

## 2. Android Native Technologies Required
- **AppWidgetProvider (Framework Standar Android)**: Komponen OS Android (`BroadcastReceiver`) yang bertanggung jawab atas siklus hidup widget (update, enable, disable, resize).
- **Jetpack Glance (Rekomendasi Modern)**: Framework UI modern berbasis Jetpack Compose dari Google khusus untuk AppWidget Android, yang menyederhanakan pembuatan UI responsif dan manajemen state asynchronous (`GlanceAppWidget` & `GlanceAppWidgetReceiver`).
- **RemoteViews**: Digunakan jika memilih AppWidget klasik tanpa Jetpack Compose.

---

## 3. Storage & Data Sharing Architecture (IndexedDB -> Native)

### Tantangan Utama
Chromium WebView menyimpan data IndexedDB di dalam direktori internal WebView (`/app_webview/IndexedDB/...`) dengan format database LevelDB internal yang **tidak dapat dan tidak boleh dibaca langsung secara native** oleh Java/Kotlin process lain tanpa resiko corrupt data.

### Opsi Solusi Arsitektur Terbaik: Shared Local Storage (Capacitor Plugin Bridge)

```
[ Web Layer / React / IndexedDB ]
         │
         ▼ (Setiap kali Agenda/Reminder bertambah, diedit, atau disinkronkan)
[ Capacitor Native Bridge Plugin / NativeStorage ]
         │
         ▼ (Bridge menulis JSON terkompresi / SQLite ringan)
[ Android SharedPreferences / EncryptedSharedPreferences / Room DB ]
         │
         ▼ (Diakses langsung oleh Android OS Process)
[ AppWidgetProvider / Jetpack Glance ]
         │
         ▼
[ Home Screen UI Widget ]
```

1. **SharedPreferences Bridge (Rekomendasi Utama - Ringan & Cepat)**:
   - Setiap kali `agendaRepository` menambah/mengubah data di IndexedDB, panggil metode Native Bridge sederhana yang menyimpan ringkasan agenda hari ini/besok dan konsultasi ke `SharedPreferences` Android (format JSON string).
   - `AppWidgetProvider` membaca `SharedPreferences` ini secara instan (< 5ms) tanpa membutuhkan koneksi internet atau pembukaan WebView.

2. **SQLite / Room Database Bridge (Opsi Lanjutan)**:
   - Jika jumlah data sangat besar (> 1000 item), `Capacitor SQLite Plugin` dapat digunakan sebagai *shared local store* yang dibaca baik oleh Web maupun Native AppWidget.

---

## 4. Refresh Strategy & Lifecycle Management
Widget Android memerlukan strategi pembaruan data yang efisien agar tidak memboroskan baterai:
- **Event-Driven Update (Immediate)**: Saat pengguna menambah/mengedit agenda di aplikasi, panggilan `AppWidgetManager.getInstance(context).notifyAppWidgetViewDataChanged(...)` dipicu secara native sehingga UI widget langsung ter-refresh (< 100ms).
- **Periodic Alarm Refresh (Midnight Rollover)**: Gunakan `AlarmManager` / `WorkManager` internal untuk memicu refresh otomatis pada pukul `00:00` malam, sehingga agenda hari ini berganti secara presisi saat pergantian hari.
- **Boot Completed Receiver**: Memasang `ACTION_BOOT_COMPLETED` receiver agar widget langsung terisi data dari `SharedPreferences` saat ponsel baru dinyalakan.

---

## 5. Offline Behavior & Security
- **100% Offline Functional**: Karena data dibaca langsung dari `SharedPreferences` internal aplikasi, widget dapat menampilkan agenda secara lengkap meskipun perangkat berada di mode Pesawat (*Airplane Mode*) atau tanpa kuota data.
- **Security Considerations**:
  - Store data di `Context.MODE_PRIVATE` `SharedPreferences` agar app lain di ponsel tidak dapat membaca isi agenda.
  - Hapus isi `SharedPreferences` widget saat user melakukan `logout` dari aplikasi.

---

## 6. Kesimpulan & Rekomendasi Arsitektur
1. **Kelayakan (Feasibility)**: **100% FEASIBLE** (Sangat Layak). Proyek Capacitor saat ini sudah memiliki modul Native Plugin tersendiri (`NativeAlarmPlugin`), sehingga penambahan `AppWidgetProvider` / `Glance` dapat diintegrasikan dengan sangat rapi tanpa merusak arsitektur Next.js Web.
2. **Estimasi Kompleksitas**: Sedang (*Medium*). Membutuhkan pembuatan 1 file Java/Kotlin `AppWidgetProvider` + 1 layout XML/Glance + 1 helper method di Native Bridge.
3. **Status Task Saat Ini**: **FROZEN / AUDIT ONLY** (Belum dikodekan pada fase ini sesuai arahan user).
