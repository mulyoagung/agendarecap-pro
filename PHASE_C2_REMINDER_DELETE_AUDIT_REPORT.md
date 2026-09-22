# PHASE C2 — REMINDER DELETE AUDIT REPORT

**Project:** AgendaRecap Pro  
**Phase:** C2 — Reminder Delete Audit & Root Cause Analysis  
**Date:** September 22, 2026  
**Status:** ROOT CAUSE PROVEN (Audit Complete — No Logic Modifications Made)

---

## 1. Executive Summary

> **Why did deleting a reminder on Android previously fail to remove it from Web/Supabase?**
>
> **Root Cause Summary:**
> The failure is caused by a **dual flaw in `syncRepository.performSync()`** during offline queue mutation processing and remote reconciliation:
> 
> 1. **False Positive Success on 0 Rows Deleted:** When a DELETE mutation is processed while the Supabase client auth session is unauthenticated or pending hydration, Supabase RLS silently filters out the request, returning `data = []` (0 rows deleted) with `error = null`. The sync engine evaluates `success = !error` as `true`, marking the DELETE mutation as successful and **destroying the queue item from IndexedDB** even though 0 rows were deleted in Supabase.
> 2. **Re-Insertion via Remote Reconciliation:** In the subsequent step of `performSync()`, the sync engine fetches active reminders from Supabase. Because the reminder was never deleted from Supabase (0 rows deleted) AND its queue item was already removed from `offline_queue`, the reconciliation engine treats the reminder as an active remote entity and **re-inserts it back into IndexedDB**. The UI then re-loads the local database, causing the deleted reminder to reappear.

---

## 2. Git State

* **Branch:** `main`
* **HEAD:** `30dfd2744b924b6712b6a330c0191beeb13de24e` (`checkpoint: C1.5 agenda identity sync stable`)
* **Working Tree:** `clean` (untracked audit report artifacts only)
* **Remote:** `https://github.com/mulyoagung/agendarecap-pro.git` (`origin/main` synchronized)
* **Changes Made:** Zero application logic changes
* **Push Performed:** **NO** (Rules strictly respected; zero remote pushes performed)

---

## 3. Delete Pipeline

The actual traced Reminder DELETE pipeline:

```text
User clicks Delete (UI)
        │
        ▼
useReminderStore.deleteReminder(id)
        │
        ├── 1. reminderRepository.delete(id)
        │         ├─► deleteReminderFromIDB(id) [removes reminder & occurrences from IDB]
        │         └─► addToOfflineQueue({ entity_type: 'reminder', entity_id: id, operation: 'DELETE', payload: { id } })
        │
        ├── 2. Clean orphan occurrence queue items in IDB
        ├── 3. fetchReminders() [UI updates immediately, reminder disappears locally]
        └── 4. syncRepository.runSync() (if online)
                │
                ▼
        syncRepository.performSync()
                │
                ├── Step 1: Process offline_queue
                │     └─► supabase.from('reminders').delete().eq('id', item.entity_id).select()
                │          ├─► If user session valid: deletes row from Supabase (deletedCount = 1)
                │          └─► If unauthenticated/RLS mismatch: deletes 0 rows (deletedCount = 0, error = null)
                │          └─► Evaluates success = !error (TRUE even when deletedCount = 0!)
                │          └─► Removes DELETE queue item from IndexedDB
                │
                └── Step 2: Remote Reconciliation
                      └─► Fetches remoteReminders from Supabase
                      └─► If row was not deleted in Supabase (deletedCount = 0), re-inserts reminder into IndexedDB!
                      └─► Store re-fetches from IndexedDB -> DELETED REMINDER REAPPEARS ON UI!
```

---

## 4. Reminder ID Trace

| Stage | ID Source | ID Value / Format | Same ID? |
| :--- | :--- | :--- | :--- |
| **UI** | `reminder.id` from store | UUID string (e.g. `'r123-abc...'`) | YES |
| **Store** | `deleteReminder(id)` parameter | Same UUID string | YES |
| **Repository** | `reminderRepository.delete(id)` | Same UUID string | YES |
| **IndexedDB Store** | `deleteReminderFromIDB(id)` | Same UUID string | YES |
| **Offline Queue** | `entity_id` & `payload.id` | Same UUID string | YES |
| **SyncRepository** | `item.entity_id` | Same UUID string | YES |
| **Supabase DELETE Query** | `.eq('id', item.entity_id)` | Same UUID string | YES |

*Conclusion:* The Reminder ID remains 100% canonical and intact across the entire pipeline. ID truncation or mismatch is **NOT** the cause of failure.

---

## 5. Online Delete Audit

* **Immediate Local Action:** Reminder and associated occurrences are immediately purged from local IndexedDB (`deleteReminderFromIDB`).
* **Queue Placement:** A mutation item `{ entity_type: 'reminder', entity_id: id, operation: 'DELETE', payload: { id } }` is enqueued into `offline_queue`.
* **Immediate Sync Trigger:** `syncRepository.runSync()` is called immediately if `navigator.onLine` is true.
* **Query Execution:** Executes `supabase.from('reminders').delete().eq('id', item.entity_id).select()`.
* **Vulnerability:** If executed when the Supabase client auth token is unauthenticated/expired or before session hydration completes, Supabase RLS returns `data = []` (0 rows deleted) with `error = null`. The code treats `error = null` as success (`success = !error`), deletes the queue item, and allows the subsequent remote reconciliation step to fetch the surviving remote row and re-insert it locally.

---

## 6. Offline Delete Audit

* **Local Behavior:** Reminder is removed from IndexedDB; DELETE item is enqueued into `offline_queue`.
* **Queue Retention:**
  * If a pending unsynced `CREATE` exists for the entity, `addToOfflineQueue` cancels both items cleanly without remote mutation.
  * If the entity was already synced to the server, `addToOfflineQueue` purges any pending `UPDATE` items and retains the `DELETE` item.
* **Reconnection Replay:** Upon network reconnection, `performSync()` processes the pending `DELETE` item.
* **Vulnerability:** If the network reconnects before the Supabase auth session is fully hydrated (`user` is null), `performSync()` still attempts the mutation without an auth session, causing Supabase RLS to return 0 rows affected, destroying the queue item, and re-inserting the reminder during remote reconciliation.

---

## 7. Queue Reduction & Deduplication Analysis

* **CREATE + DELETE (Unsynced):** Handled correctly by `addToOfflineQueue` (both cancelled locally).
* **UPDATE + DELETE:** Handled correctly by `addToOfflineQueue` (UPDATE removed, DELETE retained).
* **Existing Server Reminder + DELETE:** Retained in `offline_queue`.
* **Conclusion:** Queue reduction logic is **NOT** destroying valid DELETE operations prematurely. The deletion of the queue item occurs inside `performSync()` after receiving a false-positive `success = true` response from Supabase.

---

## 8. Supabase DELETE Query Audit

* **Query Executed:** `supabase.from('reminders').delete().eq('id', item.entity_id).select()`
* **Target Table:** `public.reminders`
* **Filter Condition:** `.eq('id', item.entity_id)`
* **Foreign Key Behavior:** `public.reminder_occurrences` has `ON DELETE CASCADE` referencing `public.reminders(id)`. Deleting a row in `reminders` automatically deletes all child occurrences in PostgreSQL.
* **Response Evaluation Flaw:** Line 280 in `sync-repository.ts` sets `success = !error`. When PostgreSQL returns 0 deleted rows (due to unauthenticated session or RLS mismatch), `error` is `null`, causing `success` to evaluate to `true` instead of checking `data && data.length > 0`.

---

## 9. RLS Policy Audit

* **Table:** `public.reminders`
* **Policy Name:** `"Users can manage their own reminders"`
* **Policy Definition:**
  ```sql
  CREATE POLICY "Users can manage their own reminders"
    ON public.reminders FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  ```
* **Authorization Requirement:** `auth.uid()` MUST match `reminders.user_id`.
* **Audit Finding:** RLS is functioning correctly as designed. Unauthenticated queries fail silently (0 rows affected). The client application flaw is failing to require `user_id` validation and treating 0 rows affected as a successful deletion.

---

## 10. Realtime & Re-Fetch Audit

* **Realtime Subscription:** Active for `agendas` table only; `reminders` table does not use Supabase Realtime subscriptions.
* **Re-Fetch Mechanism:** After queue processing completes in `performSync()`, Step 2 (Remote Reconciliation) queries `supabase.from('reminders').select('*').eq('user_id', user.id)`.
* **Re-Insertion Flow:** If Supabase DELETE affected 0 rows, the row remains in Supabase. Because the `DELETE` item was removed from `offline_queue`, `pendingDeleteReminderIds` no longer contains the entity ID. Reconciliation fetches the row from Supabase and calls `saveRemindersToIDB()`, restoring the deleted reminder to IndexedDB and UI.

---

## 11. Web vs Capacitor Android Comparison

| Component | Web | Capacitor Android |
| :--- | :--- | :--- |
| **Reminder UI** | `src/app/reminders/page.tsx` | `src/app/reminders/page.tsx` (Shared PWA bundle) |
| **Reminder Store** | `useReminderStore.ts` | `useReminderStore.ts` (Shared) |
| **Reminder Repository** | `reminderRepository` | `reminderRepository` (Shared) |
| **IndexedDB** | IndexedDB (`idb.ts`) | IndexedDB (`idb.ts` in Android WebView) |
| **SyncRepository** | `syncRepository.ts` | `syncRepository.ts` (Shared) |
| **Supabase Client** | `src/lib/supabase/client.ts` | `src/lib/supabase/client.ts` (Shared) |
| **Native Alarm Engine** | N/A (Web Notifications) | `NativeAlarmPlugin` (Android AlarmManager) |

*Conclusion:* Web and Android share 100% identical data, store, repository, and sync code paths. The issue occurs on both platforms when session hydration or mutation evaluation fails.

---

## 12. Build Verification

* **Command:** `npm run build`
* **Result:** ✅ PASS (25 routes compiled cleanly with 0 errors).

---

## 13. Root Cause Classification

Selected Classification based on verified evidence:

> **`J — Multiple causes`**
> (Primary: **`C — DELETE queue improperly cleared on 0 rows affected`** + **`F — Stale server data reintroduced during reconciliation`**)

### Evidence Summary
1. **Line 280 of `src/lib/repositories/sync-repository.ts`:**
   `success = !error` considers 0 rows affected as successful, clearing the `DELETE` queue item even if Supabase did not delete the row.
2. **Line 187-194 of `src/lib/repositories/sync-repository.ts`:**
   `performSync()` proceeds to execute queue mutations even when `user` is null (unauthenticated session).
3. **Line 498-528 of `src/lib/repositories/sync-repository.ts`:**
   Remote reconciliation re-inserts any reminder found in Supabase if its ID is not currently in `pendingDeleteReminderIds`.

---

## 14. Changes Made During This Phase

* Created `PHASE_C2_REMINDER_DELETE_AUDIT_REPORT.md`.
* **No application logic changes** were made.
* **No database schema / RLS changes** were made.
* **No dependency changes** were made.
* **No Android native changes** were made.
* **No remote git push** was performed.

---

## 15. Recommended Minimum Safe Fix (For Next Phase)

> **DO NOT IMPLEMENT YET — AWAITING USER INSTRUCTION**

When authorized, the minimal safe fix consists of two targeted adjustments in `src/lib/repositories/sync-repository.ts`:

1. **Require Authenticated Session for Queue Processing:**
   In `performSync()`, if `!user` (session unauthenticated or hydrating), pause mutation queue processing and return early so local queue items remain safely queued in IndexedDB until an authenticated session is active.

2. **Verify Deleted Row Count for DELETE Mutations:**
   In `performSync()` during `item.operation === 'DELETE'`:
   ```ts
   const deletedCount = data ? data.length : 0;
   success = !error && deletedCount > 0;
   ```
   If `deletedCount === 0`, do NOT remove the queue item from IndexedDB; retain it for retry or handle appropriately so it continues blocking re-insertion during remote reconciliation.
