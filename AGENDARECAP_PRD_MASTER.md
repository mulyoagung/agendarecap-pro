# AGENDARECAP PRO

## MASTER PRD & TECHNICAL BASELINE

**Document Type:** Living Product Requirements + Technical Baseline + Verification Ledger
**Project:** AgendaRecap Pro
**Current Baseline Date:** 22 September 2026
**Primary Platform:** Web/PWA + Capacitor Android
**Production Web:** Vercel
**Backend:** Supabase
**Native Runtime:** Capacitor Android
**Document Status:** MASTER SOURCE OF TRUTH

---

# 0. DOCUMENT PURPOSE

Dokumen ini adalah **single source of truth** untuk pengembangan AgendaRecap Pro.

Dokumen ini harus dibaca sebelum melakukan perubahan source code.

Tujuan dokumen:

1. Menjelaskan fungsi produk yang diharapkan.
2. Menjelaskan arsitektur teknis aktual.
3. Mencatat fitur yang sudah benar-benar terverifikasi.
4. Membedakan fitur yang baru diimplementasikan dari fitur yang sudah terbukti pada perangkat.
5. Mencatat bug dan pekerjaan yang masih terbuka.
6. Menjadi batasan agar perubahan baru tidak merusak fitur yang sudah stabil.
7. Mengurangi kebutuhan mengulang konteks teknis panjang pada setiap task Antigravity.

## RULE UTAMA

Isi dokumen ini tidak boleh dianggap sebagai bukti bahwa suatu fitur telah bekerja hanya karena fitur tersebut tercantum pada bagian Requirements.

Status setiap fitur harus mengikuti bagian:

`VERIFICATION STATUS`

---

# 1. PRODUCT OVERVIEW

AgendaRecap Pro adalah aplikasi agenda dan reminder lintas perangkat yang dirancang untuk membantu pengguna:

* mencatat agenda,
* melihat agenda berdasarkan tanggal,
* mengelola reminder,
* menerima pengingat pada perangkat,
* bekerja secara offline,
* melakukan sinkronisasi kembali ketika koneksi tersedia,
* mengakses data melalui Web/PWA,
* dan menggunakan aplikasi Android native melalui Capacitor.

Produk menggunakan pendekatan **local-first/offline-first**.

Data lokal tidak boleh bergantung sepenuhnya pada koneksi internet untuk operasi dasar pengguna.

---

# 2. PRODUCT PRINCIPLES

## 2.1 Local-first

Operasi dasar harus tetap dapat dilakukan ketika perangkat offline selama data/fitur tersebut memang dapat dijalankan secara lokal.

Contoh:

* melihat data lokal,
* membuat agenda,
* mengubah agenda,
* menghapus agenda,
* membuat reminder,
* menghapus reminder,
* native reminder yang sudah terjadwal.

## 2.2 Server synchronization

Supabase merupakan sumber sinkronisasi lintas perangkat.

Perubahan lokal yang belum tersinkronisasi disimpan dalam offline mutation queue.

Ketika autentikasi dan koneksi tersedia, queue diproses.

## 2.3 Native alarm harus internet-independent

Untuk Android native:

**AlarmManager adalah mekanisme pengingat lokal pada perangkat.**

Setelah alarm berhasil dijadwalkan, alarm tidak boleh membutuhkan koneksi internet untuk berbunyi.

Internet diperlukan untuk:

* sinkronisasi,
* mengambil data server,
* mengirim perubahan ke server,

tetapi bukan sebagai prasyarat agar alarm lokal yang sudah terjadwal dapat berbunyi.

## 2.4 Stable identity

Setiap entity harus mempertahankan canonical ID.

Khusus Agenda:

**UPDATE tidak boleh menghasilkan row baru.**

## 2.5 No silent data loss

Mutation queue tidak boleh dihapus hanya karena request tampak berhasil.

Keberhasilan operasi harus diverifikasi sesuai jenis operasi.

## 2.6 No competing reminder engines

Web foreground reminder dan Android native alarm tidak boleh menjadi dua engine yang saling menghasilkan notifikasi untuk event yang sama.

Arsitektur reminder harus memiliki sumber event yang jelas.

---

# 3. PLATFORM ARCHITECTURE

## 3.1 Web / PWA

Technology baseline:

* Next.js 16
* React 19
* Vercel
* Static/native export untuk Capacitor
* IndexedDB untuk local persistence
* Supabase Auth
* Supabase PostgreSQL
* Supabase Realtime untuk bagian yang menggunakannya

## 3.2 Android

Technology baseline:

* Capacitor 8.x
* Android native wrapper
* local static bundle dari `out/`
* Android AlarmManager
* Native notification system

Production/native configuration:

```text
appId = com.agendarecap.app
webDir = out
```

Native production tidak seharusnya bergantung pada remote Vercel URL untuk menjalankan UI utama.

## 3.3 Backend

Supabase digunakan untuk:

* authentication,
* persistent database,
* synchronization,
* cross-device state.

RLS harus tetap aktif.

---

# 4. DATA STORAGE ARCHITECTURE

AgendaRecap menggunakan beberapa lapisan storage.

```text
UI / Zustand
      ↓
Repository
      ↓
IndexedDB
      ↓
Offline Mutation Queue
      ↓
Supabase
```

Untuk Android reminder:

```text
Reminder Repository
      ↓
Native Alarm Bridge
      ↓
Android AlarmManager
      ↓
Notification
```

---

# 5. AUTHENTICATION

Supabase Auth digunakan sebagai authentication layer.

Native Android harus mampu:

1. login,
2. mempertahankan session,
3. memulihkan session ketika aplikasi dibuka kembali,
4. tidak menjalankan mutation queue sebelum session tersedia.

## Auth state

ClientAuthGuard harus membedakan minimal:

```text
INITIALIZING
AUTHENTICATED
UNAUTHENTICATED
```

Jangan menganggap:

```text
session === null
```

secara langsung sebagai unauthenticated apabila hydration masih berlangsung.

## Native routing

Native static export tidak boleh bergantung pada server-side navigation yang tidak tersedia pada static bundle.

---

# 6. AGENDA DATA MODEL

Canonical Agenda ID:

```text
UUID v4
```

ID dibuat hanya saat Agenda baru dibuat.

Contoh:

```ts
crypto.randomUUID()
```

Supabase:

```text
agendas.id = primary key UUID
```

IndexedDB:

```text
keyPath = id
```

Offline queue:

```text
entity_id = agenda.id
```

Realtime:

```text
payload.new.id = agenda.id
```

## ABSOLUTE RULE

Jika Agenda diedit:

```text
existing ID MUST BE PRESERVED
```

Jangan membuat UUID baru ketika UPDATE.

---

# 7. AGENDA CRUD

## CREATE

Create menghasilkan satu canonical ID.

Flow:

```text
UI
→ AgendaRepository.create()
→ IDB
→ offline queue
→ Supabase INSERT/UPSERT
```

## UPDATE

UPDATE harus menggunakan canonical ID.

Expected semantic:

```text
UPDATE agendas
SET ...
WHERE id = entity_id
```

Bukan:

```text
UPSERT payload_without_id
```

karena hal tersebut dapat menyebabkan Supabase membuat row baru.

## DELETE

DELETE harus menghapus entity berdasarkan canonical ID.

---

# 8. AGENDA DUPLICATION PROTECTION

Duplicate Agenda pernah terjadi pada versi native lama.

Root cause yang telah ditemukan pada C1.5:

```text
Agenda UPDATE queue payload tidak membawa canonical ID
+
sync menggunakan upsert tanpa ID
=
Supabase membuat row baru
```

C1.5 memperbaiki hal tersebut dengan:

```text
Agenda UPDATE
→ preserve id
→ UPDATE by id
```

## Current status

**VERIFIED — Local + Vercel**

C1.5 telah diverifikasi:

* ID sebelum dan sesudah edit sama.
* Row tidak bertambah.
* UPDATE dilakukan terhadap row existing.
* Tidak menghasilkan UUID baru.

## DO NOT CHANGE

Jangan mengubah kembali Agenda UPDATE menjadi:

```text
upsert(sanitizedPayload)
```

tanpa canonical ID.

Jangan mengubah canonical identity model tanpa audit dan regression test.

---

# 9. INDEXEDDB

IndexedDB digunakan sebagai local persistence.

Current known database:

```text
agendaku_pwa_db
```

Version:

```text
v3
```

Agenda store:

```text
agendas
```

Reminder store dan queue juga digunakan.

IndexedDB harus menjadi sumber local state untuk operasi offline-first.

---

# 10. OFFLINE MUTATION QUEUE

Offline queue menyimpan perubahan yang belum berhasil dikirim ke Supabase.

Minimal informasi mutation:

```text
entity_type
entity_id
operation
payload
status
retry
```

Operation dapat berupa:

```text
CREATE
UPDATE
DELETE
```

## Queue rules

### CREATE + DELETE sebelum sync

Mutation dapat dibatalkan secara lokal karena entity belum pernah perlu dipersist ke server.

### UPDATE + DELETE

UPDATE yang belum tersync dapat dihapus dari queue dan DELETE dipertahankan.

### DELETE existing server entity

DELETE harus tetap berada di queue sampai desired server state tercapai.

## AUTH RULE

Mutation queue tidak boleh diproses jika belum ada authenticated Supabase user.

Ketika:

```text
user === null
```

queue harus tetap utuh.

Jangan menghapus queue hanya karena request Supabase menghasilkan:

```text
error = null
data = []
```

---

# 11. REMINDER DATA MODEL

Canonical Reminder:

```text
id
user_id
title
body
time
timezone
frequency
days_of_week
sound
is_active
delivery_mode
created_at
updated_at
```

Occurrence:

```text
id
reminder_id
scheduled_at
status
snoozed_until
sent_at
completed_at
dismissed_at
notification_tag
created_at
updated_at
```

Occurrence ownership berasal dari parent Reminder.

---

# 12. REMINDER TIME FORMAT

User-facing Reminder time harus menggunakan:

```text
HH:mm
```

Valid range:

```text
00:00 - 23:59
```

Contoh valid:

```text
00:05
08:30
13:45
23:59
```

Contoh invalid:

```text
8:30 AM
1:45 PM
25:00
08:70
```

## Current implementation

Native/browser-dependent:

```html
<input type="time">
```

telah diganti dengan text input numeric yang memvalidasi format 24 jam.

Helper yang telah diperkenalkan:

```text
formatTimeInput()
padTime24()
isValidTime24()
```

## Status

**IMPLEMENTED — DEVICE VERIFICATION PENDING**

Build telah berhasil, tetapi tetap harus diverifikasi pada Web dan Android fisik.

---

# 13. REMINDER CREATE

Reminder dapat berupa:

* one-time,
* recurring.

## One-time

Waktu yang sudah lewat tidak boleh dibuat sebagai reminder baru.

Expected validation:

```text
scheduled time > now
```

## Recurring

Jika slot hari ini telah lewat, recurrence engine harus mencari occurrence valid berikutnya sesuai konfigurasi recurrence.

Jangan membuat fake timestamp hanya untuk melewati validasi.

---

# 14. REMINDER DELETE

Reminder DELETE harus memiliki dua konsekuensi:

## Local

Segera:

* hapus reminder dari local state,
* hapus occurrence lokal yang relevan,
* cancel native alarm yang relevan,
* masukkan mutation DELETE ke offline queue jika server state masih perlu diubah.

## Server

Ketika authenticated + online:

```text
DELETE Supabase reminder
```

## IMPORTANT

Delete tidak boleh hanya menghapus database row.

Native alarm juga harus dibatalkan.

---

# 15. NATIVE ALARM LIFECYCLE

Android menggunakan:

```text
AlarmManager
setExactAndAllowWhileIdle()
```

Native alarm harus tetap berjalan tanpa internet.

## Required behavior

```text
Reminder active
+
Alarm scheduled
+
Internet OFF
=
Alarm tetap dapat berbunyi
```

## DELETE behavior

Jika user DELETE ketika offline:

```text
Internet OFF
↓
Reminder DELETE locally
↓
Native Alarm CANCEL locally
↓
Offline queue retains DELETE
```

Jangan menunggu Supabase untuk membatalkan alarm lokal.

## Critical invariant

Offline DELETE tidak boleh menghasilkan:

```text
Reminder sudah dihapus
tetapi native notification tetap muncul
```

---

# 16. NATIVE ALARM IDENTIFICATION

Native alarm cancellation harus menggunakan identity yang sama dengan alarm yang dijadwalkan.

Audit harus mempertahankan mapping:

```text
Reminder / Occurrence
        ↓
Native alarm ID
```

Jangan membuat cancellation ID berbeda dari scheduling ID.

Cancellation harus idempotent.

Jika alarm sudah tidak ada:

```text
cancel()
```

tetap dianggap aman.

---

# 17. STALE ALARM PROTECTION

Problem historis:

```text
Reminder DELETE
↓
IDB deleted
↓
Supabase deleted
↓
Android AlarmManager alarm masih ada
↓
old notification tetap muncul
```

C2.1 telah menambahkan explicit native alarm cancellation ketika Reminder dihapus.

## Status

**IMPLEMENTED — DEVICE VERIFICATION PENDING**

Build/native sync telah PASS.

Physical verification wajib dilakukan sebelum status final dianggap VERIFIED.

---

# 18. REMINDER REACTIVATION

Reminder inactive dapat diaktifkan kembali.

## Recurring reminder

Reactivate harus mencari next valid occurrence berdasarkan recurrence configuration.

## One-time reminder future

Jika waktu belum lewat:

```text
Reactivate
→ activate existing schedule
```

## One-time reminder expired

Jika waktu sudah lewat:

User harus mendapat confirmation.

Expected UX:

```text
Waktu pengingat ini sudah lewat.
Jadwalkan kembali besok pukul HH:mm?
```

Jika user memilih lanjut:

```text
tomorrow
+
same local time
+
is_active = true
```

Jika batal:

```text
remain inactive
```

Tidak boleh ada uncaught runtime error.

## Current implementation

`reactivateReminder(id, options)` telah diperkenalkan.

`handleReactivate()` menggunakan SweetAlert untuk expired reminder.

`ReminderRepository.create()` memiliki safe fallback untuk expired one-time reactivation.

## Status

**IMPLEMENTED — DEVICE VERIFICATION PENDING**

---

# 19. REMINDER NOTIFICATION ACTIONS

Native notification architecture mendukung konsep:

```text
COMPLETE / CLOSE
SNOOZE 5 MIN
SNOOZE 15 MIN
```

Native action state disimpan untuk diproses kembali oleh JavaScript/local repository.

## IMPORTANT

Perubahan pada action behavior harus menjaga:

* offline behavior,
* occurrence status,
* local state,
* sync queue.

---

# 20. BOOT / RESTART BEHAVIOR

Native implementation memiliki BootReceiver untuk event seperti:

```text
BOOT_COMPLETED
MY_PACKAGE_REPLACED
QUICKBOOT_POWERON
```

Tujuannya adalah memastikan alarm yang memang masih valid dapat direkonstruksi setelah device restart/update.

## Critical rule

Alarm untuk Reminder yang sudah:

```text
deleted
inactive
completed
```

tidak boleh direstore secara salah.

---

# 21. SUPABASE RLS

RLS merupakan bagian penting dari security model.

Current known Reminder policy:

```text
auth.uid() = user_id
```

Agenda juga menggunakan ownership sesuai user.

## RULE

Jangan menonaktifkan RLS untuk menyelesaikan bug synchronization.

Jangan mengubah policy hanya karena DELETE menghasilkan:

```text
0 rows
```

Audit authentication dan affected rows terlebih dahulu.

---

# 22. REALTIME

Supabase Realtime saat ini digunakan pada bagian Agenda.

Reminder tidak boleh diasumsikan menggunakan Realtime jika implementation aktual tidak menggunakannya.

Remote reconciliation harus tetap menghormati pending local mutation.

---

# 23. REMOTE RECONCILIATION

Reconciliation menyelaraskan:

```text
Supabase
↔
IndexedDB
↔
Zustand
```

## Pending DELETE protection

Sebelum reconciliation, queue harus diperiksa.

Jika terdapat:

```text
entity_type = reminder
operation = DELETE
```

dan mutation masih pending/retrying, Reminder tersebut tidak boleh direintroduksi ke local state dari server.

## Important

Reconciliation tidak boleh mengalahkan mutation lokal yang belum terselesaikan.

---

# 24. WEB NOTIFICATION STATUS

## Current product direction

Web reminder notification yang menggunakan foreground popup/alert lama **tidak boleh dianggap sebagai canonical production notification engine**.

Masalah historis:

* popup salah waktu,
* popup dapat muncul berulang,
* lifecycle tidak konsisten.

## Planned architecture

Web/PC:

```text
Web Push
```

Android:

```text
Native AlarmManager
```

Kedua channel harus menggunakan canonical Reminder state.

## Status

**PLANNED**

Web Push belum dianggap selesai.

Jangan mengimplementasikan Web Push sebagai bagian dari task yang tidak terkait notification.

---

# 25. ANDROID WIDGETS

Planned widgets:

1. Agenda Today + Tomorrow.
2. Konsultasi.

## Status

**PLANNED / FEASIBILITY DISCUSSED**

Belum dianggap implemented.

Jangan menyatakan widget tersedia hanya karena feasibility document atau architecture telah dibuat.

---

# 26. CUSTOM NOTIFICATION SOUND

Custom native notification sound merupakan planned feature.

## Status

**PLANNED / FEASIBILITY DISCUSSED**

Native default channel behavior yang sudah berjalan jangan dirusak ketika feature ini belum dikerjakan.

---

# 27. APK SIZE

C1 cleanup menghapus legacy APK yang sebelumnya tersimpan di project assets.

Legacy APK files telah dihapus dari:

```text
public/downloads/
out/downloads/
android/app/src/main/assets/public/downloads/
```

Current native APK build sekitar:

```text
~6.29 MB
```

## Important

Jangan menyimpan APK build lama di static web assets.

APK download feature tetap dapat menggunakan:

```text
public/downloads/AgendaRecap_Pro.apk
```

hanya jika file tersebut memang sengaja disediakan sebagai download artifact.

---

# 28. NATIVE BUILD

Native build pipeline:

```text
npm run build
npm run build:native
npx cap sync android
Gradle assembleDebug
```

Native WebView menggunakan local static export:

```text
out/
```

## Important

Setelah perubahan Web source yang ditujukan untuk Android:

```text
build
→ build:native
→ cap sync
→ Gradle build
```

harus dilakukan sebelum APK dianggap berisi perubahan terbaru.

---

# 29. NATIVE APK VERSION PROVENANCE

Karena APK lama pernah digunakan dalam testing, setiap device verification harus mencatat:

```text
APK version
versionCode
build date
Git commit
```

Jika duplicate terjadi hanya pada APK lama sementara Local/Vercel aman:

**jangan langsung menyimpulkan source code saat ini rusak.**

Pertama verifikasi provenance APK.

---

# 30. CURRENT VERIFICATION LEDGER

## C1 — APK Asset Cleanup

Status:

**VERIFIED**

Evidence:

* legacy APK assets removed,
* native build berhasil,
* APK size turun drastis,
* current build sekitar 6 MB.

---

## C1.5 — Agenda Canonical Identity

Status:

**VERIFIED — LOCAL + VERCEL**

Verified:

* canonical Agenda ID dipertahankan,
* UPDATE menggunakan ID existing,
* tidak menghasilkan duplicate row,
* Vercel production telah diverifikasi.

Important commit:

```text
30dfd27
checkpoint: C1.5 agenda identity sync stable
```

---

## C2 — Reminder DELETE Reliability

Status:

**IMPLEMENTED / BUILD VERIFIED**

Root causes addressed:

1. mutation queue diproses tanpa authenticated user,
2. DELETE 0-row dianggap sukses,
3. reconciliation menghidupkan kembali reminder yang masih pending DELETE.

C2-FIX commit:

```text
4642f4c
fix: make reminder delete sync reliable
```

Push:

```text
NO
```

Deployment:

```text
NO
```

Physical device verification:

**PENDING**

---

## C2.1 — Reminder & Native Agenda Stability

Status:

**PRODUCTION VERIFIED — C2.1 COMPLETE**

Implemented & Verified:

* 24-hour Reminder input,
* native alarm cancellation on Reminder DELETE,
* expired one-time Reactivate UX,
* C2.1-FIX: Reactivate scheduled date editing & occurrence reconciliation fix,
* native Agenda duplicate audit,
* fresh native APK build (~6.29 MB, commit `bd8f160`),
* production Vercel deployment & verification (`https://agendarecap.vercel.app`).

Current APK build:

```text
~6.29 MB (6,593,418 bytes)
```

Physical device installation & Production status:

**VERIFIED ON PHYSICAL DEVICE & PRODUCTION DEPLOYED**

---

# 31. C2.1 DEVICE VERIFICATION REQUIRED

Before C2.1 is marked VERIFIED, test:

## Reminder

### Test R1

Input:

```text
08:30
```

Expected:

```text
08:30
```

### Test R2

Input:

```text
23:45
```

Expected:

```text
23:45
```

### Test R3

Create reminder → offline → wait until time.

Expected:

```text
notification appears
```

### Test R4

Create reminder → schedule native alarm → offline → DELETE.

Expected:

```text
no notification at original time
```

### Test R5

Delete online → reopen app.

Expected:

```text
reminder remains deleted
```

### Test R6

Reactivate expired one-time reminder.

Expected:

```text
confirmation
→ tomorrow same time
```

No runtime error.

### Test R7

Reactivate recurring reminder.

Expected:

```text
next valid occurrence
```

---

# 32. AGENDA NATIVE DEVICE VERIFICATION

Install the fresh APK built from current source.

Do not use an old installed APK for final verification.

Test:

```text
Create Agenda
↓
Edit Agenda
↓
Save
↓
Refresh/reopen
```

Expected:

```text
one Agenda
same canonical ID
no duplicate
```

Also test:

```text
offline edit
↓
online sync
↓
refresh
```

Expected:

```text
same canonical ID
no duplicate
```

If duplicate occurs:

DO NOT immediately modify C1.5.

First capture:

```text
APK version
Git commit
Agenda ID before edit
Agenda ID after edit
IDB state
queue state
Supabase rows
```

---

# 33. KNOWN OPEN FEATURES

These are NOT currently implemented unless explicitly marked otherwise.

## A. Calendar Density Bars

Replace simple calendar dots with density indicators representing agenda count per day.

Initial semantics:

```text
count of Agenda items
```

Do not infer duration unless duration data exists.

Status:

**PLANNED**

---

# 34. AGENDA TIME TYPES

Planned time semantics:

## EXACT

Example:

```text
08:30
```

## FLEX

Flexible time within a day.

## ALL_DAY

Agenda occupies the entire day.

## UNSCHEDULED

Date may exist, but time/place is not yet confirmed.

Do not represent UNSCHEDULED as:

```text
00:00
```

Place confirmation and time confirmation should be conceptually separable.

## Drag/reorder

FLEX and ALL_DAY items may be manually reordered within a day without inventing fake timestamps.

Status:

**PLANNED**

---

# 35. AGENDA EXPORT

Planned export feature:

User selects:

```text
start date
end date
```

Output should include:

* export timestamp,
* date,
* agenda information,
* schedule,
* place,
* relevant status,
* clean structured table,
* days without agenda,
* agendas without schedule.

Target audience includes Rector/leadership, therefore output should be concise and presentation-ready.

Status:

**PLANNED**

---

# 36. PUBLIC READ-ONLY AGENDA SHARE

Planned capability:

A user can generate a shareable public read-only link for selected agenda information.

Requirements:

* no login for recipient,
* read-only,
* secure random share token,
* no exposure of unnecessary user identity,
* ability to revoke/expire share,
* server-side authorization,
* public endpoint must expose only intended agenda data.

Likely requires:

* schema changes,
* RLS/public access design,
* secure token handling.

Status:

**PLANNED**

Do not implement casually inside an unrelated phase.

---

# 37. FUTURE DEVELOPMENT ROADMAP

Suggested sequence:

```text
C2.1
↓
C2.1 DEVICE VERIFICATION
↓
C2.2 PUSH/NOTIFICATION ARCHITECTURE
↓
C3 AGENDA UX
↓
C4 EXPORT
↓
C5 PUBLIC SHARE
↓
C6 ANDROID WIDGETS
↓
C7 CUSTOM SOUND
```

The exact numbering may change.

The roadmap is planning information, not implementation status.

---

# 38. DO NOT BREAK LIST

The following are protected components.

## Agenda

Do not break:

* canonical UUID identity,
* UPDATE-by-ID,
* offline queue,
* IDB key identity,
* Vercel behavior.

## Reminder

Do not break:

* offline-first behavior,
* native AlarmManager,
* offline native notification,
* DELETE queue,
* recurrence logic,
* occurrence lifecycle.

## Authentication

Do not break:

* Supabase session persistence,
* native authentication,
* auth hydration,
* queue auth guard.

## Database

Do not:

* disable RLS,
* modify schema casually,
* replace server-side ownership checks with client trust.

## Native

Do not:

* reintroduce remote Vercel dependency,
* remove AlarmManager,
* require internet for an already scheduled local alarm,
* reintroduce legacy APK assets.

---

# 39. CHANGE CONTROL

Every future task must answer:

1. Apa yang ingin diubah?
2. Bagian mana dari PRD yang terkena?
3. Apakah menyentuh protected component?
4. Apa regression risk?
5. Apa test yang diperlukan?
6. Apakah perubahan source atau hanya device verification?

## Minimal development cycle

```text
READ MASTER PRD
↓
IDENTIFY TARGET
↓
IMPLEMENT MINIMAL CHANGE
↓
TEST
↓
BUILD
↓
UPDATE PRD STATUS
↓
LOCAL COMMIT
↓
DEVICE VERIFICATION
↓
PUSH / DEPLOY ONLY AFTER APPROVAL
```

---

# 40. GIT POLICY

Git digunakan sebagai checkpoint dan rollback mechanism.

Rules:

* jangan force push,
* jangan rewrite history tanpa alasan kuat,
* jangan push feature yang belum diverifikasi sesuai kebutuhan,
* jangan deploy production hanya karena build lokal PASS.

Current relevant commits:

```text
30dfd27
checkpoint: C1.5 agenda identity sync stable

4642f4c
fix: make reminder delete sync reliable
```

C2-FIX dan C2.1 harus diperlakukan sebagai candidate changes sampai device verification selesai.

---

# 41. DEPLOYMENT POLICY

Local build PASS tidak otomatis berarti production-ready.

Urutan:

```text
Source change
↓
Local test
↓
Build
↓
Native sync jika relevan
↓
Device verification
↓
Review diff
↓
Commit
↓
Push
↓
Vercel deployment
↓
Production verification
```

Jangan melewati tahap verification untuk perubahan yang mempengaruhi runtime.

---

# 42. REPORTING STANDARD

Setiap phase harus menghasilkan report singkat.

Format minimum:

```text
PHASE:
STATUS:

OBJECTIVE:

ROOT CAUSE:

CHANGES:

FILES:

TESTS:

BUILD:

DEVICE VERIFICATION:

GIT COMMIT:

PUSH:

DEPLOY:

KNOWN LIMITATIONS:
```

Report harus membedakan:

```text
CODE VERIFIED
BUILD VERIFIED
DEVICE VERIFIED
PRODUCTION VERIFIED
```

Keempat status tersebut tidak boleh disamakan.

---

# 43. STATUS TERMINOLOGY

Gunakan terminologi berikut secara konsisten.

## VERIFIED

Berarti behavior sudah benar-benar diuji pada environment yang disebutkan.

## BUILD VERIFIED

Berarti source berhasil dikompilasi/build, tetapi belum membuktikan runtime.

## DEVICE VERIFIED

Berarti diuji pada perangkat fisik.

## PRODUCTION VERIFIED

Berarti sudah deployed dan diuji pada production environment.

## AUDITED

Berarti source/architecture telah diperiksa, tetapi tidak otomatis berarti runtime PASS.

## IMPLEMENTED

Berarti code path telah dibuat.

Jangan menggunakan "VERIFIED" hanya karena code compilation berhasil.

---

# 44. CURRENT PROJECT STATE — 22 SEPTEMBER 2026

## Stable / Protected

```text
C1 APK cleanup
C1.5 Agenda canonical identity
C1.5 Vercel deployment
Offline-first architecture
Supabase ownership/RLS
Native AlarmManager architecture
```

## Recently Implemented

```text
C2 Reminder DELETE reliability
C2.1 24-hour reminder input
C2.1 native alarm cancellation
C2.1 expired reminder reactivation
```

## Needs Physical Verification

```text
C2-FIX
C2.1
fresh Android APK
offline delete + alarm cancellation
offline reminder firing
reactivation UX
native agenda duplicate behavior
```

## Planned

```text
Web Push
Calendar density bars
Agenda time types
Agenda drag/reorder semantics
Agenda export
Public read-only sharing
Android widgets
Custom notification sound
```

---

# 45. MASTER RULE FOR ANTIGRAVITY

Sebelum melakukan coding:

```text
READ THIS DOCUMENT FIRST.
```

Kemudian:

1. Jangan menganggap PLANNED sebagai implemented.
2. Jangan menganggap BUILD VERIFIED sebagai DEVICE VERIFIED.
3. Jangan mengubah PROTECTED component tanpa alasan teknis yang jelas.
4. Jangan mengulang architecture yang sudah tercatat di dokumen ini dalam task prompt.
5. Fokus hanya pada scope task yang diberikan.
6. Jangan melakukan refactor besar jika targeted fix sudah cukup.
7. Jangan push/deploy kecuali task secara eksplisit mengizinkannya.
8. Setelah perubahan selesai, update status dokumentasi.
9. Jika hasil implementasi bertentangan dengan dokumen ini, laporkan konflik sebelum memperluas scope.
10. Jangan mengklaim feature VERIFIED tanpa evidence.

---

# 46. PHASE C3.1 — WEB PUSH SUBSCRIPTION INTEGRATION

Status:

**C3.1 = PRODUCTION VERIFIED**

Checkpoint Status:
* C3.1.1 Service Worker Registration Audit: `VERIFIED`
* C3.1.2 Status UI Clarification: `VERIFIED`
* Physical Browser Verification: `VERIFIED`
* Checkpoint Status: `COMMITTED + PUSHED + DEPLOYED`

Summary of Verified Capabilities:
* User-gesture Web Push activation button (`Aktifkan Notifikasi PC`) present and functioning on `/settings/notifications`.
* Web Push state detection handling 6 states (`NOT_SUPPORTED`, `PERMISSION_DEFAULT`, `PERMISSION_DENIED`, `NOT_SUBSCRIBED`, `SUBSCRIBED`, `SUBSCRIPTION_ERROR`).
* Service Worker (`public/sw.js` v5) registered with full PushManager subscription flow via `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
* Persistence to Supabase `push_subscribers` via `POST /api/push/subscribe` with multi-device isolation.
* Test Push capability via `/api/push/send-test` functioning while tab is open or closed.
* Zero changes to Android Native OS AlarmEngine or C1.5 / C2 / C2.1 canonical architecture.

---

# 48. PHASE C3.1.2 — WEB PUSH STATUS UI CLARIFICATION

Status:

**C3.1.2 = VERIFIED**

Summary of Disambiguation & Verification:
* Separated Service Worker registration state (`Active`, `Inactive`, `Disabled in development`, `Unavailable`) from Web Push Subscription status (`TERDAFTAR` vs `BELUM TERDAFTAR`).
* Replaced blocking `await navigator.serviceWorker.ready` in diagnostic checks with non-blocking `navigator.serviceWorker.getRegistration()`.
* Absence of `PushSubscription` no longer misreports `Service Worker: Inactive`.
* Physical browser verification passed cleanly on `/settings/notifications`.
* Preserved `public/sw.js`, `ServiceWorkerRegistration.tsx`, Android code, API endpoints, and database schemas completely untouched.

---

# 49. CURRENT IMMEDIATE PRIORITY

Prioritas terdekat:

```text
1. Phase C3.2 — Vercel Cron & Production Push Scheduler Integration
2. Configure vercel.json cron frequency & endpoint security (CRON_SECRET)
3. End-to-end production Push notification smoke testing
```

---

# END OF MASTER PRD
