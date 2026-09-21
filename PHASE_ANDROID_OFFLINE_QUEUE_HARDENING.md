# Laporan Hardening Android Offline Queue & Auto-Sync Reconnect (Phase A)

## A. Current Runtime Evidence
- **PASS**: APK Android dapat melakukan Login dan menyimpan sesi Supabase.
- **PASS**: Data agenda dan reminder online dari Supabase muncul di Android.
- **PASS**: Native notification Android dapat muncul.
- **PASS**: Web/PWA stabil (login, reload, sync normal <-> incognito, offline mutation, reconnect auto-sync).
- **BUG DIBERSIHKAN (PHASE A)**: Sebelumnya saat Android OFFLINE dan user membuat/mengedit data, item tertahan di status `pending` UI dan tidak ter-upload ke Supabase saat koneksi internet kembali ONLINE.

---

## B. Root Cause Analysis
1. **Kegagalan Event `online` Browser pada Android WebView**:
   Chromium WebView pada Android Capacitor tidak secara konsisten menembakkan event HTML5 `window.addEventListener('online')` ketika koneksi internet (Wi-Fi / Mobile Data) dihubungkan kembali oleh OS Android.
2. **Missing Post-Sync Store Reload**:
   Meskipun proses `performSync()` berjalan di *background*, hasil pembersihan `offline_queue` di IndexedDB tidak dimuat ulang (*reload*) ke dalam memori *Zustand store* (`useStore` & `useReminderStore`), sehingga lencana (*badge*) `pending` pada UI tetap terlihat menggantung.

---

## C. Files Changed
* **`package.json`**: Menambahkan modul `@capacitor/network@^8.0.1` untuk mendeteksi perubahan status jaringan OS Android secara native via Capacitor Bridge.
* **`src/lib/sync-engine.ts`**:
  - Mengintegrasikan `Network.addListener('networkStatusChange')` dari `@capacitor/network`.
  - Menambahkan mekanisme *debounced sync* (delay 500ms) untuk mencegah eksekusi sync beruntun yang tidak perlu.
  - Menambahkan *post-sync store reload*: Memuat ulang data IndexedDB terbaru secara otomatis ke dalam `useStore` (`agendas`) dan `useReminderStore` (`reminders`) setelah `runSyncEngine()` selesai.
* **`src/components/ClientAuthGuard.tsx`**: Memperbarui event handler `handleOnline` agar memicu `runSyncEngine()` dan memperbarui indikator jumlah queue.
* **`ANDROID_WIDGET_FEASIBILITY.md`**: Dokumen analisis kelayakan teknis untuk Android Home Screen Widget (Phase D Audit).

---

## D. Android Reconnect Mechanism
Saat koneksi internet Android pulih dari kondisi offline:
1. Native Bridge Capacitor `@capacitor/network` menangkap event OS Android dan memicu callback `networkStatusChange` (`status.connected = true`).
2. Debounced runner memanggil `runSyncEngine()`.
3. Engine memeriksa ketersediaan sesi Supabase (`supabase.auth.getUser()`).
4. Jika `user.id` valid, mutasi dalam `offline_queue` dieksekusi secara otomatis.

---

## E. Queue Replay
1. `performSync()` membaca daftar `offline_queue` dari IndexedDB.
2. Memastikan `user_id` pada payload mutasi diisi dengan `user.id` dari pengguna yang sedang login.
3. Mengirimkan mutasi `.upsert()` / `.delete()` ke Supabase server.
4. Jika Supabase mengembalikan respons sukses (`200/201`), item dihapus dari `offline_queue` IndexedDB.
5. Pembaruan memori Zustand dipicu -> Indikator `pending` pada UI hilang secara otomatis dan data versi web/PC menerima perubahan.

---

## F. Reminder Time Validation (Phase B)
* **Status**: **NOT IMPLEMENTED / FROZEN IN PHASE A** (Akan diimplementasikan pada Phase B).

---

## G. 24-Hour Time Format (Phase B)
* **Status**: **NOT IMPLEMENTED / FROZEN IN PHASE A** (Akan diimplementasikan pada Phase B).

---

## H. Notification Close Behavior (Phase B)
* **Status**: **NOT IMPLEMENTED / FROZEN IN PHASE A** (Akan diimplementasikan pada Phase B).

---

## I. Agenda Without Date -> Konsultasi (Phase B)
* **Status**: **NOT IMPLEMENTED / FROZEN IN PHASE A** (Akan diimplementasikan pada Phase B).

---

## J. Download APK Menu (Phase B)
* **Status**: **NOT IMPLEMENTED / FROZEN IN PHASE A** (Akan diimplementasikan pada Phase B).

---

## K. Notification Sound Feasibility (Phase C Audit)
* **Status**: **CONFIRMED FEASIBLE** via Android Notification Channels (`agendarecap_reminder_channel_[soundKey]`).

---

## L. Widget Feasibility (Phase D Audit)
* **Status**: **CONFIRMED FEASIBLE & DOCUMENTED** di `ANDROID_WIDGET_FEASIBILITY.md`.

---

## M. Build Results
* `npm run build` (Web Production Build): **PASS (Exit Code 0)**
* `npm run build:native` (Static Export): **PASS (Exit Code 0)**
* `npx cap sync android`: **PASS (5 Capacitor Plugins Registered)**
* `.\gradlew assembleDebug`: **PASS (Exit Code 0)**

---

## N. Tests Actually Performed
* **PASS**: Validasi kompilasi kode Web Production (`npm run build`).
* **PASS**: Validasi kompilasi kode Static Export (`npm run build:native`).
* **PASS**: Pendaftaran plugin `@capacitor/network` pada native Android project.
* **PASS**: Kompilasi binary APK `app-debug.apk`.

---

## O. Remaining Unverified Tests (Pengujian Fisik Perangkat)
Perlu diuji secara manual pada perangkat fisik Android:
- **TEST A**: Android ONLINE -> create agenda -> Web melihat agenda.
- **TEST B**: Android OFFLINE -> create agenda -> pending muncul.
- **TEST C**: Android ONLINE kembali -> pending hilang -> Web melihat agenda.
- **TEST D**: Android OFFLINE -> edit agenda -> reconnect -> Web menerima edit.
- **TEST E**: Android OFFLINE -> create reminder -> reconnect -> Web menerima reminder.
- **TEST F**: Android OFFLINE -> edit reminder -> reconnect -> Web menerima perubahan.
- **TEST G**: Android OFFLINE -> delete agenda/reminder -> reconnect -> Web menerima deletion.
