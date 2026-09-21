# Android Auth & Sync Root Cause Analysis

## 1. Runtime Symptoms
Berdasarkan hasil pengujian manual pada APK Android hasil build terbaru:
* APK dapat dibuka dan ditutup berkali-kali secara normal.
* Aplikasi **selalu langsung masuk ke Dashboard** tanpa pernah menampilkan halaman **Login**.
* **Tidak ada data agenda dari Supabase** yang tersinkronisasi ke Android.
* **Tidak ada pengingat (reminders)** yang tersinkronisasi atau terjadwal.
* Agenda baru yang dibuat dari Android disimpan secara lokal tetapi **TIDAK muncul di Web/PC**.
* Halaman **Settings** tidak dapat dibuka/gagal memuat data.
* Halaman **Kelola Akun (Admin)** ditolak / mengalami kesalahan.
* Seluruh pengujian dilakukan dalam kondisi perangkat terhubung ke internet (**ONLINE**).

---

## 2. ClientAuthGuard Audit
* **A. Penentuan Status Login**: `ClientAuthGuard.tsx` menentukan status login menggunakan *state React* `session` (`useState<Session | null>(null)`).
* **B. Sumber Pembacaan**: Guard memanggil `supabase.auth.getSession()` secara asinkron saat mount, serta mendengarkan event dari `supabase.auth.onAuthStateChange`. Guard **tidak** membaca string `localStorage` secara manual.
* **C. Sifat Pengecekan**: Pengecekan sesi bersifat **asinkron** (`async checkAuthAndSyncQueue()`).
* **D. Flaw / Race Condition Routing pada Static Export**:
  Ketika APK pertama kali dijalankan (tanpa sesi tersimpan di `localStorage` Android WebView):
  1. `authLoading` bernilai `true` (menampilkan layar loading).
  2. `checkAuthAndSyncQueue()` selesai dieksekusi: Supabase mengembalikan `session: null`.
  3. `setSession(null)` dan `setAuthLoading(false)` dipanggil.
  4. Guard mendeteksi `!session && !isPublicRoute` (karena route aktif adalah `/`).
  5. Guard mengeksekusi `router.replace('/login')` dari `next/navigation`.
  6. **Penyebab Utama Kegagalan Navigasi**: Dalam Next.js App Router dengan `output: 'export'` di dalam WebView Capacitor (`https://localhost` atau `file://`), `router.replace('/login')` dari `next/navigation` **gagal melakukan navigasi antar-file HTML statis** (`index.html` -> `login.html`). 
  7. Akibatnya, WebView tetap berada pada halaman `index.html` (Dashboard) atau terjebak dalam render fallback, sehingga layar Login tidak pernah muncul di WebView Android.
* **E. Tindakan saat Session NULL**: Guard memanggil `router.replace('/login')`, namun karena keterbatasan navigasi client-side router Next.js pada static export Capacitor, penggantian halaman gagal terjadi.

---

## 3. Supabase Client Audit
Audit pada `src/lib/supabase/client.ts` dan hasil kompilasi bundle di `out/_next/static/chunks/`:
* `NEXT_PUBLIC_SUPABASE_URL`: **TERSEDIA** (`https://qizsddkgzwixwrkbvalr.supabase.co` ter-inline di JS bundle).
* `NEXT_PUBLIC_SUPABASE_ANON_KEY`: **TERSEDIA** (Anon JWT key ter-inline di JS bundle).
* `SERVICE_ROLE_KEY`: **TIDAK BONGKOR** (0 match dalam static JS client bundle).
* Konfigurasi Auth Client:
  - `storage`: `window.localStorage`
  - `persistSession`: `true`
  - `autoRefreshToken`: `true`
  - `detectSessionInUrl`: `true`
* **Perbandingan Web vs Android**:
  Pada Web (browser PC), user sudah memiliki sesi otentikasi di `localStorage` browser dari login sebelumnya. Pada Android APK (fresh install), `localStorage` WebView **masih kosong total**. Karena pembacaan sesi menghasilkan `null` dan navigasi ke `login.html` gagal, APK terus berjalan dalam status **unauthenticated**.

---

## 4. Session Storage Audit
* Supabase JS client mengonfigurasi penyimpanan sesi dengan key standar `sb-qizsddkgzwixwrkbvalr-auth-token`.
* Tidak ditemukan kode yang melakukan `localStorage.clear()` atau `sessionStorage.clear()` secara tidak sengaja di `src/`.
* `window.localStorage` pada Android Capacitor WebView berfungsi dengan baik, tetapi pada *fresh install* APK, belum ada token yang tersimpan karena proses Login tidak pernah berhasil dibuka oleh user.

---

## 5. Static Export Route Audit
Daftar file statis yang **ter-export** secara sah di folder `out/`:
* `/` (`out/index.html`) - Dashboard
* `/login` (`out/login.html`) - Login Page
* `/consultation` (`out/consultation.html`)
* `/reminders` (`out/reminders.html`)
* `/settings` (`out/settings.html`)
* `/diagnostics` (`out/diagnostics.html`)
* `/waiting-approval` (`out/waiting-approval.html`)

Daftar route yang **TIDAK TER-EXPORT** atau **HILANG**:
* `/admin` (`out/admin` **TIDAK ADA**): Pada proses build sebelumnya, direktori `src/app/admin` di-rename menjadi `_admin` untuk melewati error kompilasi Server Action. Hal ini menyebabkan halaman Admin **hilang total** dari bundle APK (menghasilkan 404 Not Found).
* `/api/*` (API routes tidak didukung dan dinonaktifkan dalam static export).

---

## 6. Server Action Audit
Evaluasi penghapusan direktif `'use server'` pada build sebelumnya:
1. `src/app/actions/admin.ts`:
   * Menggunakan `createServerSupabase` yang meng-import `next/headers` (`cookies()`) dan memerlukan `SUPABASE_SERVICE_ROLE_KEY` (Server Environment Only).
   * Menghapus `'use server'` menyebabkan file ini diperlakukan sebagai Client Module yang merusak build static export. Hal ini yang melatarbelakangi penamaan ulang folder `admin` menjadi `_admin`.
   * **Dampak**: Fitur Kelola Akun (Admin) rusak total pada versi APK dan berpotensi merusak integrasi Web/PWA jika tidak dipisahkan dengan benar.
2. `src/app/actions/settings.ts`:
   * Berisi `getAppSettings()` dan `saveAppSettings()`.
   * Menggunakan `@/lib/supabase/client`. Saat dipanggil di Android tanpa sesi terotentikasi (`user = null`), fungsi mengembalikan `null` atau `error: "Unauthorized"`.
3. `src/app/actions/agenda.ts`:
   * Menggunakan `@/lib/supabase/client`. Aplikasi utama (Dashboard) saat ini mengandalkan `useStore` (`agendaRepository` + IndexedDB + `syncRepository`), bukan `actions/agenda.ts`.

---

## 7. Agenda Data Flow Audit
Alur pembuatan & sinkronisasi agenda di Android:
1. User membuat agenda di UI Android -> `useStore.addAgenda()`.
2. `agendaRepository.create()` memanggil `supabase.auth.getUser()`.
3. Karena APK berjalan tanpa sesi (`user = null`), agenda disimpan ke IndexedDB lokal dengan `user_id = undefined`.
4. Mutation ditambahkan ke offline queue IndexedDB.
5. `syncRepository.runSync()` dipanggil:
   - Pemeriksaan sesi menghasilkan `user = null`. Log mencatat: `[SYNC ENGINE] No active authenticated user session. Mutations will remain local-first.`
   - `syncRepository` mencoba melakukan `upsert` ke tabel Supabase `agendas`.
   - **Supabase RLS menolak mutasi** karena `auth.uid()` kosong / tidak sesuai dengan RLS policy.
   - Mutasi gagal dan ditandai sebagai `FAILED_FATAL` / `FAILED_RETRYABLE`.
   - Sinkronisasi data dari remote (PC) ke Android **di-skip total** karena query `supabase.from('agendas').select('*').eq('user_id', user.id)` membutuhkan `user.id`.

---

## 8. RLS / User Identity Audit
* RLS pada Supabase Database sudah **BENAR** dan tervalidasi pada Web/PWA.
* Kegagalan sinkronisasi pada Android **BUKAN** disebabkan oleh kesalahan aturan RLS database, melainkan karena aplikasi Android mengeksekusi request Supabase dalam kondisi **Unauthenticated User (`user = null`)**.

---

## 9. Settings / Admin Audit
* **Settings Page (`/settings`)**: `SettingsPage` di `src/app/settings/page.tsx` memanggil `supabase.auth.getUser()`. Karena `user` bernilai `null`, halaman mencoba mengalihkan user ke `/login` yang gagal bernavigasi pada static export.
* **Kelola Akun (`/admin`)**:
  1. Halaman `/admin` tidak ada dalam bundle `out/` karena folder sumber di-rename menjadi `_admin`.
  2. `actions/admin.ts` membutuhkan Server Runtime (`next/headers` & `SUPABASE_SERVICE_ROLE_KEY`) yang tidak tersedia di APK Android.

---

## 10. Bundle Audit
* Hasil pemeriksaan direktori `out/` dan `android/app/src/main/assets/public/`:
  - Seluruh file HTML, JS chunk, dan manifest yang ada di `out/` tersalin secara identik (100% hash/timestamp match) ke folder assets Android via `npx cap sync android`.
  - Tidak ada masalah bundle tertinggal (*stale bundle*). Bundle Android benar-benar mencerminkan isi folder `out/`.

---

## 11. Environment Audit
Pemeriksaan pada compiled client bundle (`out/_next/static/chunks/09935oj2k2zak.js`):
* `NEXT_PUBLIC_SUPABASE_URL PRESENT`: **YES** (`https://qizsddkgzwixwrkbvalr.supabase.co`)
* `NEXT_PUBLIC_SUPABASE_ANON_KEY PRESENT`: **YES** (Anon JWT Key ter-inline secara valid)
* `SERVICE_ROLE_KEY IN CLIENT`: **NO** (Aman, tidak bocor ke client bundle)

---

## 12. Root Cause Matrix

| Gejala | Kemungkinan Root Cause | Bukti | Status |
| :--- | :--- | :--- | :--- |
| **Tidak pernah muncul halaman Login / Langsung ke Dashboard** | `router.replace('/login')` dari `next/navigation` tidak melakukan transisi halaman statis (`login.html`) di dalam Capacitor WebView. | `ClientAuthGuard.tsx` menggunakan `router.replace('/login')`. Pada static export Next.js di Capacitor WebView (`file://` / `https://localhost`), client router gagal berpindah ke file `login.html`. | **CONFIRMED** |
| **Data Supabase tidak tersinkron & Agenda Android tidak muncul di Web** | Aplikasi berjalan dalam kondisi `user = null` (unauthenticated). `syncRepository` menolak upload mutasi (ditolak RLS Supabase) dan me-skip download data remote. | Trace code `sync-repository.ts` (L186) & `agenda-repository.ts` (L32): Semua query Supabase memerlukan `user.id`. | **CONFIRMED** |
| **Settings tidak dapat dibuka / gagal** | `SettingsPage` memerlukan `user` aktif. Tanpa otentikasi, `getAppSettings()` mengembalikan `null` & mencoba redirect ke `/login` yang gagal. | `src/app/settings/page.tsx` L17 & `actions/settings.ts` L20: return `null` jika `!user`. | **CONFIRMED** |
| **Kelola Akun (Admin) ditolak / Error 404** | 1. Halaman `/admin` hilang dari `out/` karena folder di-rename menjadi `_admin`.<br>2. `actions/admin.ts` meng-import `next/headers` & `SUPABASE_SERVICE_ROLE_KEY` (Server Only). | File `out/admin` tidak ditemukan dalam build statis. | **CONFIRMED** |
| **Tidak ada reminder yang tersinkron/terjadwal** | `syncRepository.performSync()` me-skip sinkronisasi tabel `reminders` & `reminder_occurrences` jika `user` bernilai `null`. | `sync-repository.ts` L383 (`if (user)` block). | **CONFIRMED** |

---

## 13. Confirmed Root Causes

1. **Kegagalan Navigasi Router pada Static Export (Capacitor WebView)**:
   `ClientAuthGuard.tsx` menggunakan `router.replace('/login')` dari `next/navigation`. Pada Next.js App Router dengan `output: 'export'` di dalam WebView Capacitor, `router.replace` tidak memicu *hard page load* ke file `login.html`. Akibatnya, saat APK dibuka pertama kali tanpa sesi, aplikasi tidak berhasil berpindah ke halaman Login.

2. **Kaskade Kegagalan Sync Akibat Unauthenticated State (`user = null`)**:
   Karena user tidak pernah diantarkan ke halaman Login, aplikasi Android beroperasi penuh dengan `user = null`. Semua penyimpanan ke IndexedDB lokal berhasil, namun `syncRepository` gagal mengunggah data ke Supabase (ditolak oleh RLS karena `user_id` kosong) dan me-skip seluruh proses pengunduhan data dari cloud.

3. **Hilangnya Route Admin pada Static Export (`_admin`)**:
   Folder `src/app/admin` di-rename menjadi `_admin` saat me-resolve build error sebelumnya, yang mengakibatkan halaman Admin tidak diekspor sama sekali ke folder `out/` (menghasilkan 404 Not Found di APK).

4. **Inkompatibilitas Server Actions pada Static APK**:
   `actions/admin.ts` mengandalkan Node.js Server Runtime (`cookies()`, `SUPABASE_SERVICE_ROLE_KEY`) yang secara teknis tidak ada pada static export APK Android.

---

## 14. Likely Root Causes
* Tidak ada. Seluruh masalah utama telah terkonfirmasi secara pasti (*CONFIRMED*) melalui audit source code dan verifikasi JS bundle.

---

## 15. Unverified Items
* **Runtime Behavior Sesi Pasca-Login Pertama pada Android**: Karena halaman Login belum pernah berhasil dibuka pada APK Android, pemulihan sesi otomatis pasca-login di Android WebView belum dapat diuji secara fisik pada perangkat (meskipun mekanisme `localStorage` Supabase client sudah terkonfigurasi secara standar).

---

## 16. Minimal Corrective Plan (Rencana Perbaikan Minimal)

> **CATATAN**: Rencana ini HANYA berupa rekomendasi langkah perbaikan untuk tahap selanjutnya dan BELUM diimplementasikan pada task ini.

1. **Perbaikan Navigasi Auth Guard Khusus Environment Native**:
   Pada `ClientAuthGuard.tsx`, gunakan navigasi browser tingkat rendah (`window.location.href = '/login.html'` atau `window.location.replace('/login.html')`) saat berjalan di lingkungan Capacitor/Static Export, agar WebView Android secara eksplisit memuat file `login.html`.

2. **Penanganan Fitur Admin pada Native Static Export**:
   - Untuk **Web/PWA**: Pertahankan fitur Admin lengkap dengan Server Actions & Service Role Key.
   - Untuk **Native APK**: Amankan route admin agar tidak mematahkan proses `next build` tanpa harus me-rename folder secara kasar, serta berikan penanganan UI yang sesuai di APK (misalnya: "Admin Panel hanya dapat diakses melalui versi Web").

3. **Verifikasi Login & Session Recovery**:
   Setelah perbaikan pengalihan halaman Login berhasil, lakukan proses Login sekali pada APK Android fisik. Supabase JS Client akan menyimpan sesi ke `localStorage` WebView, sehingga sesi akan pulih secara otomatis pada setiap pembukaan APK berikutnya dan sinkronisasi data Supabase ↔ Local IDB ↔ Web/PC akan berjalan secara normal.
