# Laporan Perbaikan Auth Redirect Capacitor Static Export

## 1. Root Cause
Pada Next.js App Router dengan `output: 'export'` di dalam Capacitor Android WebView (`https://localhost` / `file://`), fungsi client-side routing `router.replace('/login')` dari `next/navigation` tidak melakukan transisi halaman statis (`index.html` -> `login.html`). Akibatnya, pada *fresh install* saat sesi Supabase belum ada (`session = null`), aplikasi tetap tertahan di `index.html` (Dashboard) tanpa mengarahkan WebView ke `login.html`. Hal ini menyebabkan aplikasi beroperasi tanpa identitas pengguna (`user = null`), sehingga seluruh sinkronisasi Supabase ditolak oleh RLS.

## 2. Files Changed
* **`src/components/ClientAuthGuard.tsx`**: 
  - Mengimpor `isNativePlatform` dari `@/lib/native-alarm`.
  - Menambahkan pengecekan rute publik yang mendukung akhiran `.html` (`/login.html`, `/waiting-approval.html`).
  - Memisahkan mekanisme pengalihan halaman: Web tetap menggunakan `router.replace()`, sedangkan Native Capacitor menggunakan *hard browser navigation* (`window.location.replace('/login.html')` dan `/index.html`).
* **`src/app/login/actions.ts`**:
  - Mengimpor `isNativePlatform`.
  - Mengatur target alur pasca-login, signup, dan logout agar mengarah ke file statis yang tepat di Native Capacitor (`/index.html`, `/waiting-approval.html`, `/login.html`) dan tetap menggunakan rute bawaan (`/`, `/waiting-approval`, `/login`) pada Web/PWA.
* **`src/app/actions/admin.ts`**:
  - Mengembalikan direktif `"use server";` untuk menjaga kompatibilitas kompilasi Web Production Build (`npm run build`).

## 3. Auth Guard Before
Sebelum perbaikan, `ClientAuthGuard.tsx` secara tidak kondisional memanggil `router.replace('/login')` untuk seluruh platform. Pada browser Web biasa ini berjalan normal, namun pada WebView Capacitor static export, fungsi ini gagal memuat file HTML `login.html`.

## 4. Auth Guard After
`ClientAuthGuard.tsx` sekarang secara presisi memeriksa `isNativePlatform()`:
- **Web/PWA**: Mempertahankan `router.replace('/login')` dan `router.replace('/')`.
- **Native Capacitor**: Memeriksa `window.location.pathname`. Jika `!session` dan rute aktif bukan rute publik, mengeksekusi `window.location.replace('/login.html')`. Jika `session` aktif dan posisi masih di halaman login, mengeksekusi `window.location.replace('/index.html')`.

## 5. Native Redirect Mechanism
Navigasi Native Capacitor menggunakan deteksi `isNativePlatform()` (Capacitor Native Bridge). Karena aset dibundel sebagai file statis di dalam WebView Android, pengalihan secara eksplisit menyebutkan file tujuan (`/login.html` dan `/index.html`), memastikan WebView browser engine langsung memuat bundel statis yang tepat tanpa bergantung pada Next.js client-side SPA routing.

## 6. Web Behavior Preserved
Seluruh alur Web/PWA dipertahankan 100%:
- Pengujian kompilasi Web Production Build (`npm run build`) **LULUS (PASS)**.
- `ClientAuthGuard` pada browser biasa tetap menggunakan Next.js App Router navigation (`router.replace`).
- Tidak ada regresi pada alur login, reload, sync offline, maupun Supabase client versi Web.

## 7. Login Flow
1. User membuka APK fresh install -> `ClientAuthGuard` mendeteksi `session = null` pada rute protected.
2. `ClientAuthGuard` mengarahkan WebView ke `/login.html`.
3. User menginput email & password pada `login.html`.
4. `login()` memanggil `supabase.auth.signInWithPassword()` di sisi client WebView.
5. Supabase mengonfirmasi sesi dan menyimpan token otentikasi ke `window.localStorage`.
6. Aplikasi dialihkan ke `/index.html` (Dashboard).
7. `ClientAuthGuard` mendeteksi sesi valid dari `supabase.auth.getSession()` -> Dashboard dirender secara penuh.

## 8. Session Persistence
Supabase JS Client secara otomatis mengelola penyimpanan token di `window.localStorage` WebView Android dengan konfigurasi `persistSession: true` dan `autoRefreshToken: true`. Setelah login pertama kali berhasil, sesi akan bertahan permanen meskipun APK ditutup dan dibuka kembali.

## 9. Initial Sync Flow
Setelah otentikasi berhasil dan Dashboard terbuka:
1. `ClientAuthGuard` dan `useStore` memverifikasi sesi pengguna via `supabase.auth.getUser()`.
2. `user.id` yang valid tersedia untuk `syncRepository`.
3. `syncRepository.runSync()` mengunduh data remote (`agendas`, `reminders`, `reminder_occurrences`) dari Supabase, merekonsiliasi dengan IndexedDB lokal, dan memperbarui UI.
4. Mutasi lokal yang tertunda di IndexedDB diunggah ke Supabase tanpa penolakan RLS.

## 10. Web Build Result
`npm run build`: **SUCCESS (PASS, Exit Code 0)**

## 11. Native Build Result
- `npm run build:native`: **SUCCESS (PASS, Exit Code 0)**
- `npx cap sync android`: **SUCCESS (PASS)**
- `.\gradlew assembleDebug`: **SUCCESS (PASS, Exit Code 0)**

## 12. APK Path
`D:\PROGRAMMING\Agendaku\agendaku-app\android\app\build\outputs\apk\debug\app-debug.apk` (Ukuran: ~77.5 MB)

## 13. Native Features Frozen
Seluruh modul berikut **TIDAK DISENTUH** dan tetap berstatus **FROZEN** sesuai batasan cakupan (*hard scope*):
- Native AlarmManager Engine
- Android Local Notification Bridge
- Firebase Cloud Messaging (FCM) / Web Push
- Database / RLS Schema
- Admin Panel & Settings Refactoring
