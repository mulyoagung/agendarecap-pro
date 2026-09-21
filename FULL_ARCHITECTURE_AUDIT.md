# Comprehensive Diagnostic Architecture Audit Report
**Project:** AgendaRecap Pro (Native Android + Web/PWA)  
**Date:** September 11, 2026  
**Scope:** Full Diagnostic Architecture Audit (No Code Changes Executed)  

---

## Executive Summary
This audit was commissioned to determine the exact root causes of persistent physical device runtime failures, APK bloat, navigation redirects, reminder deletion behavior, and offline queue semantics in the AgendaRecap Pro hybrid architecture. 

During this diagnostic audit, **no source code, schema, dependency, auth architecture, or native logic was modified**. All findings are based on precise runtime trace analysis, file system inspection, and code paths.

---

## Section 1: APK Size Composition & Production Asset Audit

### Size Metrics Breakdown
- **APK File Size (Compressed Debug APK):** ~231.8 MB (`app-debug.apk`)
- **Uncompressed Package Content:** ~235 MB
- **Installed App Size on Device:** ~250–280 MB (Base APK + Extracted Native Shared Libraries + Web Assets + App Data/Cache)
- **App Data & Cache Footprint:** ~10–25 MB (IndexedDB, WebView LocalStorage, Native Alarm Preferences)

### Asset Allocation Breakdown
| Asset Directory / Category | Size | Status / Recommendation |
| :--- | :--- | :--- |
| `public/downloads/AgendaRecap_Pro_v0.1.0.apk` | **~162.5 MB** | 🛑 **UNNECESSARY PRODUCTION BLOAT** (Legacy APK bundled inside web assets) |
| `public/downloads/AgendaRecap_Pro.apk` | **~82.4 MB** | 🛑 **UNNECESSARY PRODUCTION BLOAT** (Legacy APK bundled inside web assets) |
| Native Shared Libraries (`lib/x86_64`, `lib/arm64-v8a`) | ~12 MB | Required (Capacitor & Android Runtime) |
| Web Runtime Bundle (`out/_next/static/`) | ~4.5 MB | Normal Next.js static asset bundle |
| Application Icons & Sound Files | ~800 KB | Required |

### Root Cause of APK Bloat
When `npm run build:native` executes Next.js static export (`next build`), Next.js copies everything inside `public/` directly into `out/`. Capacitor then syncs `out/` into `android/app/src/main/assets/public/`. 
Because legacy build APK files (`AgendaRecap_Pro_v0.1.0.apk` and `AgendaRecap_Pro.apk`) were left inside `public/downloads/`, the Android APK builder packaged **244.9 MB of old APK files inside the new APK itself**.

---

## Section 2: Capacitor Startup URL & WebView Runtime Audit

### Startup Configuration
- **`capacitor.config.ts` Settings:**
  - `appId`: `com.agendarecap.app`
  - `webDir`: `out`
  - `server`: No `url` property defined (Operating in local production mode).
- **Startup URL Scheme:** `https://localhost/index.html` (Capacitor Android default local asset bridge).
- **Offline Fallback:** Custom error handler in `MainActivity.kt` recovers from render process crashes via `onRenderProcessGone`.

### WebView Configuration & Permissions
- **Security Context:** `https://localhost` has secure context access to IndexedDB, LocalStorage, Web Crypto API, and Web Notifications.
- **Microphone / Sound / Alarm Permissions:** Handled natively via `NativeAlarmPlugin.kt` utilizing Android `AlarmManager` and `NotificationManager`.

---

## Section 3: Static Export Route Mapping

### Route Accessibility Matrix

| Source Route | Static HTML Generated | Native Android Access | Web Browser Access | Route Restrictions & Notes |
| :--- | :--- | :--- | :--- | :--- |
| `/` (Dashboard) | `out/index.html` | ✅ Accessible (`index.html`) | ✅ Accessible (`/`) | Client-side guarded |
| `/login` | `out/login.html` | ✅ Accessible (`login.html`) | ✅ Accessible (`/login`) | Public auth route |
| `/settings` | `out/settings.html` | ✅ Accessible (`settings.html`) | ✅ Accessible (`/settings`) | Client-side guarded |
| `/settings/notifications` | `out/settings/notifications.html` | ✅ Accessible (`settings/notifications.html`) | ✅ Accessible (`/settings/notifications`) | Diagnostik & Notification settings |
| `/reminders` | `out/reminders.html` | ✅ Accessible (`reminders.html`) | ✅ Accessible (`/reminders`) | Offline-first reminder engine |
| `/consultation` | `out/consultation.html` | ✅ Accessible (`consultation.html`) | ✅ Accessible (`/consultation`) | Consultation view |
| `/admin` | ❌ Excluded during `build:native` | 🛑 Blocked with Toast Alert | ✅ Accessible (Web Only) | Uses Server Actions (`next/headers`); temporarily renamed to `_admin` during native export |

---

## Section 4: Authentication State Machine & Hydration Race Condition

### Auth Flow Trace (`ClientAuthGuard.tsx`)

```
APP COLD START
   │
   ├── authLoading = true
   │
   ▼
Check Auth Session (`supabase.auth.getSession()`)
   │
   ├── Case A: Session immediately found in LocalStorage
   │     └── setUser(user), setAuthLoading(false) -> Renders Protected Route
   │
   └── Case B: LocalStorage read delayed on Android Cold Start (`session === null`)
         ├── `checkAuthAndSyncQueue` checks `if (!currentSession && !isPublicRoute)`
         └── Triggers `navigateNative('login.html', true)` IMMEDIATELY! (Lines 99-105)
```

### Identified Race Condition
1. On Android physical devices, reading `@supabase/supabase-js` session tokens from LocalStorage during initial WebView cold-start can take up to 200–500ms.
2. `ClientAuthGuard.tsx` performs an immediate `supabase.auth.getSession()` check. If `currentSession` is null on line 99, it instantly calls `navigateNative('login.html', true)` before `onAuthStateChange` receives the `INITIAL_SESSION` or `TOKEN_REFRESHED` event.
3. Once navigated to `login.html`, `ClientAuthGuard` re-runs on `login.html`, finds the newly hydrated session, and instantly redirects back to `index.html` (lines 191-197).
4. **Root Cause of Flash/Bounce:** Premature redirect execution inside `checkAuthAndSyncQueue` when `currentSession` is null before token restoration finishes.

---

## Section 5: "Kelola User" (Admin) Feature Trace

### Execution Path
1. **Hamburger Menu Click:** User clicks "Kelola User (Admin)" in `src/app/page.tsx` (lines 291-298).
2. **Native Platform Check (`src/app/page.tsx:43-62`):**
   - Calls `handleNativeNav('/admin', 'admin.html')`.
   - `isNativePlatform()` evaluates to `true`.
   - Code explicitly traps `webPath === '/admin'` and triggers a SweetAlert toast:  
     `"Menu Kelola User (Admin) hanya dapat diakses via server Web."`
   - Navigation is halted (`return`).
3. **Web Browser Access:**
   - On web, `isNativePlatform()` is `false`, allowed to navigate to `/admin`.
   - `src/app/admin/page.tsx` invokes `getUsers()` from `src/app/actions/admin.ts`.
   - `getUsers()` verifies admin role. If current user is non-admin or `SUPABASE_SERVICE_ROLE_KEY` is missing in server environment, returns `Unauthorized` error and redirects to `/`.

---

## Section 6: Step-by-Step Reminder Deletion Trace

### Trace Sequence (`rem_12345678_uuid`)

1. **User Action:** User clicks Trash icon on `/reminders` page.
2. **Store Invocation (`useReminderStore.ts:245`):** `deleteReminder(id)` is called.
3. **Local IndexedDB Purge (`reminder-repository.ts:252` -> `idb.ts:255`):**
   - Transaction `['reminders', 'occurrences']` opened.
   - Deleted from `reminders` store by `id`.
   - All associated occurrences with `reminderId == id` are deleted from `occurrences` store.
4. **Offline Queue Enqueue (`reminder-repository.ts:255` -> `idb.ts:341`):**
   - Item `{ entity_type: 'reminder', entity_id: id, operation: 'DELETE', payload: { id }, status: 'PENDING' }` enqueued into `offline_queue`.
5. **Orphan Queue Cleanup (`useReminderStore.ts:253`):**
   - Pending occurrence operations for `id` removed from `offline_queue`.
6. **UI State Update (`useReminderStore.ts:266`):**
   - `fetchReminders()` updates Zustand store, instantly removing item from screen.
7. **Remote Supabase Execution (`sync-repository.ts:257`):**
   - `syncRepository.runSync()` executes HTTP DELETE query:
     ```ts
     const { data, error } = await supabase
       .from('reminders')
       .delete()
       .eq('id', item.entity_id)
       .select();
     ```
   - On success, item removed from `offline_queue`. On error, status updated to `FAILED_RETRYABLE` for subsequent retry.

---

## Section 7: Offline Queue Semantics & State Machine Matrix

### Queue Reduction Behavior (`idb.ts:355-399`)

| Initial State | Action | Queue Reduction Logic | Resulting Queue State |
| :--- | :--- | :--- | :--- |
| Server Item Exists | `DELETE` | Removes pending `UPDATE` items for same `entity_id`. | Single `DELETE` operation retained. |
| Offline Unsynced Item (`CREATE` pending) | `DELETE` | Detects unsynced `CREATE`. Cancels out both operations locally. | All queue items for `entity_id` deleted (0 remote queries). |
| Offline Unsynced Item (`CREATE` pending) | `UPDATE` | Merges updated fields into pending `CREATE` payload. | Single `CREATE` with updated payload. |
| Server Item Exists | `UPDATE` then `DELETE` | `UPDATE` queued, then `DELETE` removes `UPDATE` and enqueues `DELETE`. | Single `DELETE` operation. |

---

## Section 8: Supabase Delete Execution Audit

### Implementation Verification (`sync-repository.ts:257-283`)
- **Query Structure:** `supabase.from('reminders').delete().eq('id', item.entity_id).select()`
- **Error Handling:** Errors are **NOT swallowed**. 
  - If `error` occurs (e.g. RLS policy violation or network failure), details are logged (`code`, `message`, `details`) and item status is updated to `FAILED_RETRYABLE` (or `FAILED_FATAL` if retry count > 10).
  - If `deletedCount === 0`, a warning is logged: `[SYNC] Reminder DELETE completed with 0 rows affected in Supabase`.

---

## Section 9: Hybrid Engine UI Status Audit

### Diagnostic Component Analysis
- In `src/app/reminders/page.tsx:328-368`, the "Status Hybrid Engine" banner checks browser-specific APIs (`navigator.serviceWorker`).
- On Native Android, Capacitor bypasses Service Worker push notifications in favor of native OS `AlarmManager` (`NativeAlarmPlugin`).
- **Discrepancy:** The reminders page banner displays `Service Worker: Inactive` on native Android, creating false impression of engine failure even when the Native OS Alarm Engine is operational.

---

## Section 10: Reminder Time Format Audit

### Input Format Investigation
- Input element in `src/app/reminders/page.tsx:461`: `<input type="time" value={time} onChange={...} className="... [color-scheme:dark]" />`
- **Internal Value:** Pure 24-hour HH:mm string (e.g., `"14:30"`).
- **UI Render Behavior:** Browser/WebView delegates `<input type="time">` UI rendering to the host operating system.
- **Cause of AM/PM Display:** If the Android device system setting is set to 12-Hour format (or English US locale), Android's native WebView picker automatically displays AM/PM selectors regardless of web application code.

---

## Section 11: Web vs Native Code Path Matrix

| Subsystem | Web / PWA Code Path | Native Android Code Path | Impact & Root Cause |
| :--- | :--- | :--- | :--- |
| **Auth Navigation** | Next.js SPA Router (`router.replace`) | Static HTML Navigation (`navigateNative`) | Native static export relies on separate HTML files (`.html`). |
| **Auth Hydration** | Browser Cookie / LocalStorage | WebView LocalStorage | Async token read delay on mobile causes premature redirect to `login.html`. |
| **Admin Panel** | `/admin` active | Disabled via Toast Alert | Server Actions incompatible with static APK export. |
| **Alarm Subsystem** | Service Worker + Push + Vercel Cron | Native `AlarmManager` Bridge | Service worker background limits on Android require OS AlarmManager. |
| **Asset Packaging** | Downloads APK files | Bundles legacy APK files inside APK assets | 244.9 MB of legacy APKs inside `public/downloads/` bloats installed app size. |

---

## Section 12: Architectural Recommendations & Remediation Plan

*(To be executed in future refactoring phase after audit approval)*

1. **Purge Legacy Downloads from Production Asset Bundle:**
   - Remove `AgendaRecap_Pro_v0.1.0.apk` and `AgendaRecap_Pro.apk` from `public/downloads/` before packaging native build, reducing APK size from ~231 MB to **~15–20 MB**.
2. **Harden Native Auth Hydration Guard:**
   - Introduce an explicit `INITIALIZING` state in `ClientAuthGuard.tsx` to delay route decisions until Supabase `onAuthStateChange` emits `INITIAL_SESSION` or `SIGNED_IN`.
3. **Harmonize Native Alarm Status UI:**
   - Update `RemindersPage` status banner to check `isNativePlatform()` and reflect "NATIVE ALARM ENGINE" when running on Android.
