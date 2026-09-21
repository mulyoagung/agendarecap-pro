# Phase C1.5 Implementation Report: Canonical Agenda Identity & Sync Duplication Fix

**Project:** AgendaRecap Pro (Web/PWA + Native Android Capacitor)  
**Phase:** C1.5 — Controlled Implementation  
**Date:** September 22, 2026  
**Status:** BUILD PASS (Awaiting Physical Device Runtime Validation)

---

## 1. Root Cause Analysis

### Confirmed Exact Root Cause
When an existing agenda was edited:
1. `agendaRepository.update(id, updates)` called `addToOfflineQueue({ entity_type: 'agenda', entity_id: id, operation: 'UPDATE', payload: updates })`.
2. The `updates` object (passed as `payload`) contained modified fields (e.g. `{ title: "Rapat Rektor + Yayasan", location: "Ruang Rektor" }`), **but did NOT contain the `id` field**.
3. During background synchronization, `syncRepository.performSync()` executed:
   ```ts
   if (item.operation === 'CREATE' || item.operation === 'UPDATE') {
     const sanitizedPayload = sanitizeAgendaForSupabase(item.payload);
     const { error } = await supabase.from('agendas').upsert(sanitizedPayload);
   }
   ```
4. `sanitizeAgendaForSupabase(item.payload)` sanitized `item.payload` (which lacked an `id` field), returning `{ title: "...", location: "..." }` with `sanitizedPayload.id === undefined`.
5. When `supabase.from('agendas').upsert(sanitizedPayload)` was executed with `sanitizedPayload.id === undefined`, PostgreSQL treated it as an `INSERT` statement without specifying the primary key `id` column.
6. PostgreSQL evaluated the default column expression `id = gen_random_uuid()`, **inserting a BRAND NEW row with a NEW random UUID in Supabase** instead of updating the existing row `id`.
7. Subsequent remote data fetches (`supabase.from('agendas').select('*')`) returned **BOTH** the original row (e.g. `id: A123`) AND the newly inserted duplicate row (e.g. `id: B456`). Both were written to IndexedDB and displayed in the UI, causing one logical agenda to become TWO visible agenda records.

---

## 2. Canonical Agenda Identity Specification

```text
Agenda ID Field:       id
Type:                  string (UUID v4)
Generated Where:       agendaRepository.create() via crypto.randomUUID()
Generated When:        Initial agenda creation ONLY (NEVER regenerated on edit)
Database Column:       agendas.id (Primary Key, UUID)
IndexedDB Key:         agendas store ({ keyPath: 'id' })
Queue entity_id:       offline_queue.entity_id === agenda.id
Realtime Identity:     payload.new.id === agenda.id
```

---

## 3. Lifecycle Comparison: Before vs After

### Before Fix Flow (Buggy Lifecycle)
```text
CREATE Agenda (id: A123)
  └─► Supabase Row Inserted (id: A123, title: "Rapat Rektor")
EDIT Agenda A123 (title: "Rapat Rektor + Yayasan")
  └─► Queue Item Enqueued (operation: 'UPDATE', entity_id: 'A123', payload: { title: "Rapat Rektor + Yayasan" })
SYNC Engine Runs
  └─► Calls sanitizeAgendaForSupabase(payload) -> { title: "Rapat Rektor + Yayasan" } (NO id!)
  └─► Calls supabase.from('agendas').upsert(payload_without_id)
  └─► Postgres inserts NEW ROW with NEW UUID B456!
FETCH / REALTIME
  └─► Supabase returns BOTH row A123 AND row B456
  └─► IndexedDB receives A123 AND B456
  └─► UI renders 2 duplicate agendas!
```

### After Fix Flow (Corrected Lifecycle)
```text
CREATE Agenda (id: A123)
  └─► Supabase Row Inserted (id: A123, title: "Rapat Rektor")
EDIT Agenda A123 (title: "Rapat Rektor + Yayasan")
  └─► Local IDB Agenda A123 Updated In-Place (id: A123 preserved)
  └─► Queue Item Enqueued (operation: 'UPDATE', entity_id: 'A123', payload: { title: "...", id: 'A123' })
SYNC Engine Runs
  └─► Detects operation === 'UPDATE'
  └─► Sanitizes payload and strips id column to avoid PK overwrite
  └─► Calls supabase.from('agendas').update(sanitizedPayload).eq('id', 'A123')
  └─► Supabase updates row A123 IN-PLACE in PostgreSQL!
FETCH / REALTIME
  └─► Supabase returns 1 updated row (id: A123)
  └─► IndexedDB overwrites A123 in-place
  └─► UI renders EXACTLY 1 updated agenda!
```

---

## 4. Files Changed

1. [`src/lib/repositories/agenda-repository.ts`](file:///d:/PROGRAMMING/Agendaku/agendaku-app/src/lib/repositories/agenda-repository.ts#L58-L83)
   - Updated `update()` method to explicitly preserve `id` on the `updatedAgenda` object.
   - Updated `addToOfflineQueue()` payload to explicitly include `{ ...updates, id }`.

2. [`src/lib/repositories/sync-repository.ts`](file:///d:/PROGRAMMING/Agendaku/agendaku-app/src/lib/repositories/sync-repository.ts#L203-L226)
   - Separated `CREATE` and `UPDATE` sync branches for `entity_type === 'agenda'`.
   - `CREATE`: Guarantees `sanitizedPayload.id = item.entity_id` and calls `upsert()`.
   - `UPDATE`: Strips `id` from payload (`delete sanitizedPayload.id`) and calls `.update(sanitizedPayload).eq('id', item.entity_id)`.

---

## 5. Component Audits & Verification

### A. IndexedDB Verification
- Store name: `'agendas'`
- KeyPath: `{ keyPath: 'id' }`
- `updateSingleAgendaInIDB()` calls `store.put(agenda)`. Because `agenda.id` is preserved during updates, IndexedDB overwrites the single record with matching primary key `id`.

### B. Supabase Database Verification
- `CREATE` branch uses `.upsert(sanitizedPayload)` with explicit canonical `id: entity_id`.
- `UPDATE` branch uses `.update(sanitizedPayload).eq('id', item.entity_id)`.
- Existing row `id` in PostgreSQL is modified in place; no duplicate rows are generated.

### C. Offline Queue Verification
- `addToOfflineQueue()` handles two sub-cases for `UPDATE`:
  - If a pending `CREATE` exists for `entity_id`, updates are merged into the pending `CREATE` payload while preserving `id`.
  - If no pending `CREATE` exists, an `UPDATE` item is enqueued with `entity_id = id` and `payload = { ...updates, id }`.

### D. Realtime & Store Deduplication Verification
- `subscribeRealtime()` triggers `fetchAgendas()`.
- `useStore.deduplicateAgendas()` merges agendas using `Map<string, Agenda>` keyed strictly by canonical `a.id`.
- Since only one row with `id` exists in Supabase, Realtime and refetch receive exactly one row.

---

## 6. Build & Packaging Verification

| Verification Test | Command Executed | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Next.js Production Build** | `npm run build` | ✅ PASS | 25 static & dynamic routes compiled cleanly. |
| **Native Static Export** | `npm run build:native` | ✅ PASS | 24 static pages exported to `out/`. |
| **Capacitor Asset Sync** | `npx cap sync android` | ✅ PASS | Synced `out/` to Android assets in 188ms. |
| **Gradle Debug APK Build** | `gradlew clean assembleDebug` | ✅ PASS | `app-debug.apk` compiled in 31s (Exit code: 0). |
| **APK Size Verification** | `Get-ChildItem android/.../app-debug.apk` | ✅ PASS | **6.28 MB** (6,589,450 bytes). C1 asset cleanup preserved. |

---

## 7. Status & Next Steps

* **Codebase & Compiler Status:** **BUILD PASS**
* **Physical Hardware Validation:** **PENDING USER VALIDATION**

### Recommended Physical Device Test Matrix
1. **Normal Edit Test:** Create agenda -> sync -> edit -> save -> close app -> reopen. (Verify: 1 agenda, same ID, updated content).
2. **Offline Edit Test:** Existing agenda -> turn off network -> edit -> close app -> reopen -> turn on network. (Verify: 1 agenda, updated content synced).
3. **Multiple Sequential Edits Test:** Edit agenda multiple times -> sync -> reopen. (Verify: 1 agenda, latest edits preserved).
4. **Cross-Platform Sync Test (Web <-> Android):** Edit on Android -> open Web (or vice versa). (Verify: same canonical ID updated without duplicate entries).

> **STOP CONDITION REACHED:** Phase C1.5 implementation is complete. No changes were made to NativeAlarmPlugin, reminder DELETE logic, Admin architecture, time pickers, sound settings, or Android widgets. Awaiting physical device runtime validation from user.
