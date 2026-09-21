# 🛡️ DATA & AUTH RECOVERY REPORT — AgendaRecap Pro

> **Status:** AUDIT & RECOVERY PLAN READY FOR EXECUTION  
> **Target:** Stabilize Database Schema, Relational RLS, Sync Engine, Error Reporting, and Admin Role Normalization.

---

## 🔍 1. AUDIT FINDINGS (Categorized by Severity)

### 🚨 CRITICAL (Fatal Security & Data Corruption Risks)
1. **RLS Bypass & Insecure Data Exposure (`20260905_reminder_occurrences.sql`)**
   - **Finding:** The migration script applied `USING (true)` policies (`Universal access reminders`, `Universal access occurrences`, `Universal access subscribers`).
   - **Impact:** Any user could potentially view, modify, or delete any other user's reminders, occurrences, and push subscription endpoints.

2. **Schema Column Mismatch on `reminder_occurrences` (`user_id` column)**
   - **Finding:** `reminder_occurrences` DB table does NOT contain a `user_id` column. However, `sync-repository.ts`, `sanitizer.ts`, `reminder-repository.ts`, and `idb.ts` were attempting to populate and send `user_id` in occurrence payload.
   - **Impact:** PostgreSQL rejected occurrence sync requests with error: `column "user_id" of relation "reminder_occurrences" does not exist`.

3. **Non-Atomic Sync Mutation Queue Cleanup (Data Loss Risk)**
   - **Finding:** In `sync-repository.ts`, when creating a reminder, the sync engine performed two separate upserts: `reminders` first, then `reminder_occurrences`. If the occurrence upsert failed (due to column mismatch or RLS), the error was swallowed, `success` returned `true`, and the operation was removed from the local offline queue.
   - **Impact:** `reminders` parent record reached Supabase, but `reminder_occurrences` child record was dropped. Reminders appeared incomplete or sync failed silently across devices.

---

### ⚠️ HIGH SEVERITY (Feature Outages & Broken User Experience)
4. **Mysterious "Error 1" Displayed on Mobile UI**
   - **Finding:** Unhandled or raw error objects in `SyncRepository.performSync()` returned numerical error codes or stringified object indexes (`res.errors[0]`). `ConnectivityBanner.tsx` displayed this directly to users at the top of the mobile viewport.
   - **Impact:** Users saw confusing `"error 1"` banners whenever sync failed or offline retry encountered an error.

5. **Super Admin Access Denied to "Kelola User"**
   - **Finding:** `src/app/actions/admin.ts` strictly enforced `if (profile?.role !== 'admin')`. Super admins with role `'super_admin'` or `'superadmin'` in the `profiles` table were blocked with `"Unauthorized. Admin only. Reason: Role is not admin: super_admin"`.
   - **Impact:** Super admin users could not open or manage users in the Admin Panel (`/admin`).

6. **Fallback to `ANON_KEY` for Admin Service Operations**
   - **Finding:** `getAdminClient()` in `admin.ts` fell back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` if `SUPABASE_SERVICE_ROLE_KEY` was missing on Vercel.
   - **Impact:** Admin server actions (such as user deletion or password reset via Supabase Auth Admin API) failed due to invalid administrative privileges.

---

### ℹ️ MEDIUM / LOW SEVERITY (Maintainability & Cleanliness)
7. **`schema.sql` vs Migration Inconsistency**
   - **Finding:** `supabase/schema.sql` was missing the `reminder_occurrences` table structure, creating a drift between initial schema and active migrations.
8. **IndexedDB Local Data Repair Required**
   - **Finding:** Local IndexedDB instances on client devices may contain orphan occurrences or queue items marked with invalid `user_id` or `FAILED_FATAL` status from past sync attempts.

---

## 🎯 2. ROOT CAUSE ANALYSIS

| Issue | Root Cause |
|---|---|
| **RLS Security Breach** | Migration `20260905_reminder_occurrences.sql` used temporary `USING (true)` blanket policies to bypass initial development sync issues. |
| **`user_id` Column Error** | Code attempted to treat `reminder_occurrences` as a flat user-owned entity rather than a relational child of `reminders`. |
| **Sync Data Loss** | Lack of atomic transaction handling and failure to check `occurrence` upsert error before deeming queue item successful. |
| **"Error 1" Banner** | Incomplete error serialization in `sync-repository.ts` combined with fallback rendering in `ConnectivityBanner.tsx`. |
| **Super Admin Block** | Strict string check `role === 'admin'` without supporting `'super_admin'` and `'superadmin'` roles. |

---

## 🛠️ 3. PROPOSED RECOVERY FIX PLAN

### Phase 1: Database Migration & Schema Unification
1. Create `supabase/migrations/20260909_data_auth_recovery_canonical.sql` containing:
   - Canonical `reminders` table (`user_id` FK to `auth.users`).
   - Canonical `reminder_occurrences` table (relational FK `reminder_id` to `reminders.id`, **NO `user_id` column**).
   - Relational RLS Policy for `reminders`: `USING (auth.uid() = user_id)`.
   - Relational RLS Policy for `reminder_occurrences`: `USING (EXISTS (SELECT 1 FROM public.reminders r WHERE r.id = reminder_occurrences.reminder_id AND r.user_id = auth.uid()))`.
   - RLS Policy for `push_subscribers`: `USING (user_id IS NULL OR auth.uid() = user_id)`.
2. Update `supabase/schema.sql` to match the canonical structure.

### Phase 2: Sanitizer & Data Layer Alignment
1. Update `src/lib/repositories/sanitizer.ts`:
   - Remove `user_id` from `SupabaseOccurrencePayload` and `sanitizeOccurrenceForSupabase` to prevent SQL column mismatch errors.
2. Update `src/lib/repositories/sync-repository.ts`:
   - Ensure `user_id` is NOT appended to occurrence payloads during sync.
   - Enforce atomic sync validation: if occurrence upsert fails, treat the entire mutation as FAILED so it remains in the queue for retry.
   - Enhanced error serializer: return structured, human-readable error messages (e.g. `"Authentication required"`, `"Network connection error"`, `"Database sync error: [details]"`), eliminating `"error 1"`.

### Phase 3: Super Admin & Role Normalization
1. Update `src/app/actions/admin.ts`:
   - Support `['admin', 'super_admin', 'superadmin']` in `checkIsAdmin()`.
   - Provide clear environment variable warnings if `SUPABASE_SERVICE_ROLE_KEY` is missing.
2. Update `src/app/admin/page.tsx`:
   - Recognize `super_admin` and `superadmin` in role badges and action permissions.

### Phase 4: Local Client & Queue Self-Healing
1. Update `src/lib/idb.ts`:
   - Update `repairOrphanDataAndQueueInIDB()` to strip invalid `user_id` fields from occurrences and reset retryable failed queue items.
2. Update `ConnectivityBanner.tsx`:
   - Render clean, actionable error messages with direct retry actions.

---

## 📊 4. CANONICAL SCHEMA MATRIX

| Table | Ownership Model | RLS Policy Strategy |
|---|---|---|
| `reminders` | Direct (`user_id`) | `auth.uid() = user_id` |
| `reminder_occurrences` | Relational (`reminder_id` → `reminders.id`) | `EXISTS (SELECT 1 FROM reminders WHERE id = occurrence.reminder_id AND user_id = auth.uid())` |
| `push_subscribers` | Direct / Shared (`user_id`) | `user_id IS NULL OR auth.uid() = user_id` |
| `profiles` | Direct (`id`) | `auth.uid() = id` (Service Role for Admin Panel) |

---
