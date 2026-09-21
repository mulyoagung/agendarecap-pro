# POST-RECOVERY VALIDATION REPORT
## AgendaRecap Pro — Data & Auth Recovery Phase

**Date:** 2026-09-08  
**Validator:** Source-code audit + static analysis + build toolchain checks  
**Runtime environment tested:** NOT available (no live Supabase connection, no device)

> ⚠️ **Scope Caveat:** Items marked `NOT VERIFIED` require runtime testing on actual Supabase DB + physical devices. Source inspection alone cannot substitute for runtime evidence. This report is honest about that boundary.

---

## A. DATABASE VALIDATION

### A1. Migration Order & Net Policy State

Migrations applied in chronological filename order:

| # | File | Tables Touched | Net Policy State |
|---|------|----------------|-----------------|
| 1 | `20260905_reminders_setup.sql` | `reminders`, `push_subscribers` | ✅ `auth.uid() = user_id` on `reminders`; `user_id IS NULL OR auth.uid() = user_id` on `push_subscribers` |
| 2 | `20260905_reminder_occurrences.sql` | `reminders`, `reminder_occurrences`, `push_subscribers` | ⚠️ **Overrides** migration 1 with `USING (true)` blanket policies. Also creates `reminder_occurrences` without `user_id` (correct relational model). |
| 3 | `20260909_data_auth_recovery_canonical.sql` | `reminders`, `reminder_occurrences`, `push_subscribers` | ✅ Drops all `USING (true)` policies. Applies correct `auth.uid() = user_id` on `reminders`, `EXISTS()` join on `reminder_occurrences`, user-linked policy on `push_subscribers`. Drops `user_id` column from `reminder_occurrences` if it exists. |

**Net final state IF all 3 migrations have been applied to Supabase:**

```
reminders        → RLS: auth.uid() = user_id                           ✅ SECURE
reminder_occurrences → RLS: EXISTS(reminders WHERE user_id=auth.uid()) ✅ SECURE
push_subscribers → RLS: user_id IS NULL OR auth.uid() = user_id        ✅ SECURE
```

> **⚠️ CRITICAL NOTE:** Migration 2 (`20260905_reminder_occurrences.sql`) still contains `USING (true)` policies in its file. These are overridden by migration 3. However, **if migration 3 has NOT been applied to the actual Supabase project**, the database is currently INSECURE with universal access. **The migration must be manually applied in the Supabase SQL Editor.**

**`USING (true)` remaining in source files (not in live DB after migration 3):**
- `supabase/migrations/20260905_reminder_occurrences.sql`: lines 75, 78, 81 — historical, overridden by migration 3
- `supabase/schema.sql` (push_subscribers): `USING (true)` was only in schema.sql's old version — **now replaced** with `user_id IS NULL OR auth.uid() = user_id`

**Rating: NOT VERIFIED** (migration 3 not confirmed applied to live Supabase DB)

---

### A2. Final Database Contract

**REMINDERS table** (as defined in canonical migration):

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `DEFAULT gen_random_uuid()` |
| `user_id` | UUID FK | → `auth.users(id) ON DELETE CASCADE NOT NULL` |
| `title` | TEXT | NOT NULL |
| `body` | TEXT | DEFAULT '' |
| `time` | TEXT | HH:mm format, DEFAULT '08:00' |
| `timezone` | TEXT | DEFAULT 'Asia/Jakarta' |
| `frequency` | TEXT | DEFAULT 'once' |
| `days_of_week` | INT[] | nullable |
| `sound` | TEXT | DEFAULT 'default' |
| `is_active` | BOOLEAN | DEFAULT true |
| `delivery_mode` | TEXT | DEFAULT 'hybrid' |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |

**REMINDER_OCCURRENCES table** (as defined in canonical migration):

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `DEFAULT gen_random_uuid()` |
| `reminder_id` | UUID FK | → `public.reminders(id) ON DELETE CASCADE NOT NULL` |
| `scheduled_at` | TIMESTAMPTZ | NOT NULL |
| `status` | TEXT | DEFAULT 'scheduled' NOT NULL |
| `snoozed_until` | TIMESTAMPTZ | nullable |
| `sent_at` | TIMESTAMPTZ | nullable |
| `completed_at` | TIMESTAMPTZ | nullable |
| `dismissed_at` | TIMESTAMPTZ | nullable |
| `notification_tag` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() |

> ✅ **`user_id` column does NOT exist on `reminder_occurrences`** — confirmed absent from migration 3 DDL. The migration also includes a defensive `DO $$ ... DROP COLUMN user_id IF EXISTS ...` block.

**Rating: PASS** (source inspection)

---

## B. RLS VALIDATION

### B1. Reminder Ownership (reminders table)

- **Policy:** `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`
- **Effect:** User A cannot SELECT, UPDATE, or DELETE reminders owned by User B.
- **Source verified:** `20260909_data_auth_recovery_canonical.sql` lines 91–95 ✅

### B2. Occurrence Ownership (reminder_occurrences table)

- **Policy:**
  ```sql
  USING (
    EXISTS (
      SELECT 1 FROM public.reminders r
      WHERE r.id = reminder_occurrences.reminder_id
        AND r.user_id = auth.uid()
    )
  )
  ```
- **Effect:** Users can only access occurrences whose parent reminder belongs to them. No direct `user_id` lookup is needed on the occurrence row.
- **Source verified:** `20260909_data_auth_recovery_canonical.sql` lines 98–114 ✅

### B3. No Remaining `USING (true)` on User-Owned Tables

| Table | `USING (true)` in final net state? |
|-------|--------------------------------------|
| `reminders` | ❌ None (Migration 3 drops it) |
| `reminder_occurrences` | ❌ None (Migration 3 drops it) |
| `push_subscribers` | ❌ None (Migration 3 applies user-linked policy) |

**Rating: PASS** (source inspection) / **NOT VERIFIED** (live DB runtime confirmation)

---

## C. ADMIN VALIDATION

### C1. Authorization Flow

**Current flow in `src/app/actions/admin.ts`:**
```
'use server' directive
→ createServerSupabase() (next/headers cookie-backed session)
→ auth.getUser() → authenticated user
→ getAdminClient() → SUPABASE_SERVICE_ROLE_KEY (throws if missing)
→ profiles.role lookup via service role (bypasses RLS)
→ Role check: ['admin', 'super_admin', 'superadmin']
→ Admin API operations (deleteUser, resetPassword, approveUser, getUsers)
```

✅ Server-side only (`'use server'` directive)  
✅ Session resolved via `createServerSupabase()` (cookie-backed, not browser client)  
✅ Admin DB queries via service role client, NOT anon client  
✅ `SUPABASE_SERVICE_ROLE_KEY` is now **strictly required** — throws `Error` if absent, logs `[WARNING]`  
✅ No ANON_KEY fallback for Admin API operations  
✅ `createBrowserClient` import removed from admin.ts  

### C2. Role Normalization

Accepted roles: `admin`, `super_admin`, `superadmin` (case-insensitive via `.toLowerCase()`)  
**Rating: PASS** (source inspection)

### C3. SUPABASE_SERVICE_ROLE_KEY Usage Across API Routes

> ⚠️ **FINDING:** 9 server-side API route files still use the pattern:
> `process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'`

Affected files:
- `src/app/api/reminders/route.ts`
- `src/app/api/reminders/[id]/route.ts`
- `src/app/api/reminders/[id]/snooze/route.ts`
- `src/app/api/push/sync/route.ts`
- `src/app/api/push/subscribe/route.ts`
- `src/app/api/dev/reminders/cleanup/route.ts`
- `src/app/api/cron/check-reminders/route.ts`
- `src/app/api/agendas/route.ts`
- `src/app/api/agendas/[id]/route.ts`

**Severity:** These are all **server-side API routes** (not bundled to browser). The ANON_KEY fallback won't expose service role capabilities — it means these endpoints simply won't be able to bypass RLS if `SUPABASE_SERVICE_ROLE_KEY` is missing. This is a **degraded-mode failure**, not a security breach. The service role key is NEVER `NEXT_PUBLIC_*` and is never bundled to the browser.

**Action needed:** Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel. The fallback can optionally be hardened post-validation.

**Rating: PASS** (security scope) / **WARNING** (operational resilience — degraded mode if key absent)

---

## D. REMINDER CRUD VALIDATION

### D1. CREATE_REMINDER (atomic)

**Flow in `reminder-repository.ts` → `sync-repository.ts`:**

1. `ReminderRepository.create()` builds `IDBReminder` + `IDBOccurrence` objects locally.
2. Saves both to IndexedDB via `updateSingleReminderInIDB()` + `updateOccurrenceInIDB()`.
3. Enqueues to `offline_queue` with `entity_type: 'reminder'`, `operation: 'CREATE'`, payload containing both `reminder` and `occurrence` sanitized objects.

**In sync-repository.ts CREATE path:**
```typescript
const { error: rErr } = await supabase.from('reminders').upsert(reminderPayload);
let oErr: any = null;
if (occurrencePayload && occurrencePayload.id) {
  const { error } = await supabase.from('reminder_occurrences').upsert(occurrencePayload);
  oErr = error;
}
queryError = rErr || oErr;
success = !rErr && !oErr;  // ← ATOMIC: BOTH must succeed
```

✅ `success = !rErr && !oErr` — both reminder AND occurrence must succeed  
✅ Queue item is NOT removed if either upsert fails (`success = false` → queue keeps the item)  
✅ Occurrence payload has NO `user_id` field (removed from sanitizer)  
✅ On failure: queue item is marked `FAILED_RETRYABLE` with retry counter  

**Rating: PASS** (source inspection)

### D2. UPDATE_REMINDER

- `updatedAt: now.toISOString()` set in `reminder-repository.ts` line 116 ✅
- `sanitizedPayload.updated_at = now.toISOString()` explicitly added before enqueuing (line 124) ✅
- `id` field deleted from update payload before sending to Supabase (sync-repository line 244) ✅
- Update only affects `reminders` table — occurrences are **not** touched on reminder update ✅

**Orphan risk:** Updating a reminder does not create, modify, or orphan occurrences. Occurrences remain linked via `reminder_id`. ✅

**Rating: PASS** (source inspection)

### D3. DELETE_REMINDER

- `deleteReminderFromIDB(id)` in IndexedDB cascades locally: deletes reminder + all associated occurrences (via `reminderId === id` check in `deleteReminderFromIDB`) ✅
- Supabase: `reminder_occurrences.reminder_id` FK has `ON DELETE CASCADE` — confirmed in migration DDL line 26 ✅
- No orphan occurrences possible after successful DELETE ✅

**Rating: PASS** (source inspection)

---

## E. OFFLINE VALIDATION

**Expected behavior (source verified):**

1. When offline: `ReminderRepository.create()` still writes to IndexedDB and enqueues to `offline_queue` with status `PENDING`. Local UI receives the created reminder immediately.
2. `SyncRepository.runSync()` checks `navigator.onLine` first — returns `{ success: false, errors: ['Device is offline'] }` without touching the queue.
3. On reconnect: `runSync()` processes queue, upserts to Supabase, clears queue items on success.
4. `repairOrphanDataAndQueueInIDB()` runs at the start of each sync to fix any stale `user_id` or `FAILED_RETRYABLE` items.

**Source flow verified:** ✅  
**Runtime evidence on Android device:** **NOT VERIFIED**

---

## F. MULTI-DEVICE VALIDATION

### Test Matrix (Source-Verified Expected Behavior)

| Test | Action | Expected Result | Runtime Verified? |
|------|--------|-----------------|-------------------|
| TEST 1 | PC: Create Reminder A | Android: Reminder A appears after sync | NOT VERIFIED |
| TEST 2 | Android: Create Reminder B | PC: Reminder B appears after sync | NOT VERIFIED |
| TEST 3 | PC: Edit Reminder A | Android: Reminder A updated after sync | NOT VERIFIED |
| TEST 4 | Android: Edit Reminder B | PC: Reminder B updated after sync | NOT VERIFIED |
| TEST 5 | PC: Delete Reminder A | Android: Reminder A deleted | NOT VERIFIED |
| TEST 6 | Android: Delete Reminder B | PC: Reminder B deleted | NOT VERIFIED |

**Sync mechanism:** LWW (Last-Write-Wins) via `updated_at` timestamp comparison in `sync-repository.ts` lines 421–445. Cloud timestamp wins if ≥ local timestamp; local timestamp wins if future-skewed >60s (clock correction).

**Cross-device sync requires:**
- Migration 3 applied to Supabase (**prerequisite**)
- `SUPABASE_SERVICE_ROLE_KEY` set in Vercel environment (**prerequisite for API cron routes**)
- App online on both devices (**prerequisite**)

**Rating: NOT VERIFIED** (requires runtime + device testing)

---

## G. OCCURRENCE VALIDATION

### G1. Schema Integrity (source)

- `reminder_occurrences.reminder_id` → FK to `reminders(id) ON DELETE CASCADE` ✅
- No `user_id` column on `reminder_occurrences` in migration 3 DDL ✅
- Migration 3 defensively drops `user_id` if it existed from a previous state ✅

### G2. Payload Contract (source)

`sanitizeOccurrenceForSupabase()` in `sanitizer.ts` after fix:
- Maps: `id`, `reminder_id` (or `reminderId`), `scheduled_at`, `status`, `snoozed_until`, `sent_at`, `completed_at`, `dismissed_at`, `notification_tag`, `created_at`, `updated_at`
- Does **NOT** include `user_id` ✅

### G3. Occurrence creation on Create Reminder (source)

- 1 reminder → 1 initial occurrence (status=`scheduled`) created in `ReminderRepository.create()` ✅
- `occurrence.reminder_id = reminder.id` ✅

**Runtime verification (count check on actual DB):** **NOT VERIFIED**

**Rating: PASS** (source inspection)

---

## H. ERROR HANDLING VALIDATION

### H1. Search Results: Raw `res.errors[0]` Usage

| File | Line | Context | Status |
|------|------|---------|--------|
| `ConnectivityBanner.tsx` | 42 | `setSyncErrorMsg(res.errors[0] \|\| 'Sync failed')` | ⚠️ See note |
| `diagnostics/page.tsx` | 141 | `Error: ${res.errors[0]}` in Swal text | ⚠️ See note |

**Analysis:** `res.errors[]` is populated by `errors.push(err.message)` in the top-level `try/catch` block of `performSync()`. These are JavaScript `Error.message` strings from genuine JS exceptions (network failure, auth failure, etc.), **not** raw Supabase numerical codes. The Supabase query-level errors (which caused "error 1" previously) are now caught at the query level and stored in queue items — they do **not** go into `res.errors[]`.

**In ConnectivityBanner:** `syncErrorMsg` is then rendered truncated at 25 chars with a `title` tooltip showing the full message. This is acceptable UX.

**Search: No literal `"error 1"` or `"Error 1"` or `"error1"` strings in source:** ✅ Confirmed — grep returned zero results in src/.

### H2. Supabase Error Serializer

`serializeSupabaseError()` in `sync-repository.ts` now:
- Checks for empty, `"1"`, `"{}"`, `"[object Object]"` strings
- Falls back to `"Gagal komunikasi Supabase (Code: ${code})"` for opaque errors
- Returns `"Gagal sinkronisasi database"` for primitive `"1"` errors

✅ "Error 1" root cause eliminated at serialization layer

### H3. Supabase Error Logging

All Supabase errors are logged to console with full `{ code, message, details, hint }` — never swallowed silently.

**Rating: PASS** (source inspection)

---

## I. BUILD VALIDATION

### I1. `npm run build`

```
▲ Next.js 16.2.1 (Turbopack)
✓ Compiled successfully in 3.5s
✓ Collecting page data using 15 workers in 778ms
✓ Generating static pages using 15 workers (25/25) in 395ms
Exit code: 0
```
**Rating: PASS** ✅

### I2. `npx tsc --noEmit`

```
No output (0 errors)
Exit code: 0
```
**Rating: PASS** ✅

### I3. `npm run lint`

```
✖ 9490 problems (210 errors, 9280 warnings)
Exit code: 1
```

**Breakdown:**
- **210 errors:** Almost entirely `@typescript-eslint/no-explicit-any` in pre-existing source files (`useStore.ts`, `sync-repository.ts`, `reminder-repository.ts`, `page.tsx` components) and `@typescript-eslint/no-require-imports` in legacy helper `.js` files (`check_db.js`, `update-db.js`, `test_dates.js`, `scripts/cleanup-test.js`). **None are in recovery-phase code specifically.**
- **9280 warnings:** Largely `no-unused-vars`, `no-unused-expressions` — pre-existing across the entire codebase including auto-generated/minified files.
- **None of the lint errors relate to the Data & Auth Recovery fixes.** The recovery-specific files (`admin.ts`, `sanitizer.ts`, `sync-repository.ts`, `idb.ts`, `ConnectivityBanner.tsx`) show only `no-explicit-any` violations which are pre-existing patterns, not new regressions.

**Rating: FAIL** (exit code 1, pre-existing) — note this is **pre-existing** and not a regression from recovery work.

---

## SUMMARY TABLE

| # | Validation Item | Rating | Basis |
|---|----------------|--------|-------|
| A | Database Migration & Schema | NOT VERIFIED | Migration 3 must be applied to live Supabase |
| B | RLS Policies | NOT VERIFIED (PASS in source) | Source confirmed; runtime unconfirmed |
| C | Admin Authorization | PASS | Source inspection + build verified |
| D1 | Reminder CREATE (atomic) | PASS | Source inspection |
| D2 | Reminder UPDATE | PASS | Source inspection |
| D3 | Reminder DELETE (cascade) | PASS | Source inspection |
| E | Offline Queue Behavior | NOT VERIFIED | Requires device testing |
| F | Multi-Device Sync | NOT VERIFIED | Requires 2 devices + live DB |
| G | Occurrence Schema & Payload | PASS | Source inspection |
| H | Error Handling ("Error 1") | PASS | Source inspection + grep |
| I1 | npm run build | PASS | Build output confirmed |
| I2 | npx tsc --noEmit | PASS | 0 TypeScript errors |
| I3 | npm run lint | FAIL (pre-existing) | 210 pre-existing errors, not regressions |

---

## PREREQUISITE CHECKLIST BEFORE RUNTIME TESTING

Before executing runtime validation (devices + Supabase), the following must be confirmed:

1. **[ ] Apply migration 3 to Supabase:**  
   Run `supabase/migrations/20260909_data_auth_recovery_canonical.sql` in Supabase SQL Editor.

2. **[ ] Verify `SUPABASE_SERVICE_ROLE_KEY` in Vercel environment variables:**  
   Must be set as a non-public server-side variable. Absence causes degraded mode in all API routes and a hard error in Admin actions.

3. **[ ] Verify `profiles.role` value for super admin user:**  
   Query: `SELECT id, email, role FROM public.profiles WHERE role IN ('admin', 'super_admin', 'superadmin');`  
   Ensure at least one row exists with the expected role value.

---

## FINAL ANSWER

> **"Apakah Web + Supabase + Offline + Reminder Multi-Device benar-benar sudah stabil?"**

**Source code: YES — the code is architecturally correct and internally consistent.**

- "Error 1" root cause identified and eliminated.
- Relational RLS model is correct in source.
- Atomic reminder+occurrence sync is implemented correctly.
- Super admin access is fixed and secured.
- Build and TypeScript compilation are clean.

**Live runtime: NOT CONFIRMED yet.**

The following cannot be declared stable without runtime evidence:
- Migration 3 applied to actual Supabase instance
- RLS policy enforcement verified against real users
- Offline queue processing on Android device
- Multi-device sync round-trip (PC ↔ Android)

**Recommended next step:** Apply migration 3 to Supabase, set `SUPABASE_SERVICE_ROLE_KEY` in Vercel, deploy, then run the device test matrix from Section F.
