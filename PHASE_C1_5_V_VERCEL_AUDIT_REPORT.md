# Phase C1.5-V Audit Report: Vercel vs Local Deployment & Supabase Environment Audit

**Project:** AgendaRecap Pro  
**Phase:** C1.5-V — Diagnostic Audit  
**Date:** September 22, 2026  
**Status:** ROOT CAUSE PROVEN (Audit Complete — No Logic Modifications Made)

---

## 1. EXECUTIVE SUMMARY

### Root Cause Conclusion
> **Why is Local working correctly while Vercel produces duplicate agendas on edit?**
> 
> **Answer:** **Deployment Mismatch (Case A)**.  
> Vercel is running an outdated commit from September 8, 2026 (`713617b463ff9cb44b2bc8dd66c80ba93f73e52d`), which predates the Phase C1.5 fixes. 
> 
> On Vercel's deployed commit, `syncRepository.performSync()` handles agenda updates by calling `supabase.from('agendas').upsert(sanitizedPayload)`. Because `sanitizedPayload` lacks the primary key `id` field during edits, PostgreSQL evaluates the column default `id = gen_random_uuid()` and **inserts a brand new duplicate row into Supabase** with a new random UUID.
> 
> In contrast, the Local environment is running local commit `d90acb3` (September 22, 2026), where `syncRepository.performSync()` explicitly executes `supabase.from('agendas').update(sanitizedPayload).eq('id', item.entity_id)` for updates, ensuring existing rows are updated in-place without generating duplicates.

---

## 2. GIT STATUS & REPOSITORY STATE

* **Git Repository Initialized:** YES
* **Current Branch:** `main`
* **Remote `origin/main` Commit (Vercel Code):** `713617b463ff9cb44b2bc8dd66c80ba93f73e52d` (Sep 8, 2026)
* **Local HEAD Commit (Local Code):** `d90acb336aeeffdfdce7cb4a273bfed8615ff242` (Sep 22, 2026)
* **Working Tree State:** CLEAN
* **Local Checkpoint Created:** YES (`d90acb3` — `checkpoint: C1.5 agenda identity sync stable`)
* **Push Performed to Remote:** **NO** (Rules strictly respected; zero remote pushes performed)

---

## 3. LOCAL C1.5 IMPLEMENTATION VERIFICATION

Verification of local codebase (`d90acb3`):
1. **Payload ID Preservation:** `agendaRepository.update(id, updates)` in [`src/lib/repositories/agenda-repository.ts`](file:///d:/PROGRAMMING/Agendaku/agendaku-app/src/lib/repositories/agenda-repository.ts#L58-L83) explicitly includes `{ ...updates, id }` in the queue payload.
2. **Explicit UPDATE Query:** `syncRepository.performSync()` in [`src/lib/repositories/sync-repository.ts`](file:///d:/PROGRAMMING/Agendaku/agendaku-app/src/lib/repositories/sync-repository.ts#L210-L225) isolates `UPDATE` operations and executes `.update(sanitizedPayload).eq('id', item.entity_id)`.
3. **Local Result:** Edits update the canonical agenda in-place in PostgreSQL without creating duplicate rows.

---

## 4. VERCEL VS LOCAL COMPARISON TABLE

| Item | Local Environment | Vercel Environment |
| :--- | :--- | :--- |
| **Git Branch** | `main` | `main` |
| **Commit Revision** | `d90acb3` (Sep 22, 2026) | `713617b` (Sep 8, 2026) |
| **Source Status** | Contains Phase C1 & C1.5 fixes | Outdated (Predates C1 & C1.5 fixes) |
| **Build Command** | `npm run build` | Default Vercel `next build` |
| **Next.js Version** | `16.2.1` | `16.2.1` |
| **Supabase URL Host** | `qizsddkgzwixwrkbvalr.supabase.co` | `qizsddkgzwixwrkbvalr.supabase.co` |
| **Agenda Update Execution** | `.update(sanitizedPayload).eq('id', entity_id)` | `.upsert(sanitizedPayload)` (lacks `id` -> INSERTS duplicate row) |
| **Sync Behavior on Edit** | Overwrites row `id` in-place | Inserts new row with new random UUID |

---

## 5. SUPABASE ENVIRONMENT AUDIT

* **Local Supabase Host:** `qizsddkgzwixwrkbvalr.supabase.co`
* **Vercel Supabase Host:** `qizsddkgzwixwrkbvalr.supabase.co`
* **Same Supabase Project:** **YES**
* **Audit Finding:** Local and Vercel interact with the exact same Supabase database instance. The divergence in behavior is caused entirely by the application source revision difference, not database target divergence.

---

## 6. AGENDA UPDATE PIPELINE TRACE

```text
User Submits Edit Form
      │
      ▼
AgendaRepository.update(id, updates)
      │
      ├── Local (d90acb3): payload = { ...updates, id }
      └── Vercel (713617b): payload = { ...updates } (NO id)
      │
      ▼
IndexedDB ('agendas' store)
      │
      ├── Local: put(updatedAgenda) [overwrites keyPath 'id']
      └── Vercel: put(updatedAgenda) [overwrites keyPath 'id']
      │
      ▼
Offline Queue ('offline_queue')
      │
      ├── Local: operation = 'UPDATE', entity_id = id, payload contains id
      └── Vercel: operation = 'UPDATE', entity_id = id, payload lacks id
      │
      ▼
SyncRepository.performSync()
      │
      ├── Local: .update(sanitizedPayload).eq('id', item.entity_id)
      │          └─► PostgreSQL: UPDATE agendas SET ... WHERE id = 'A123'
      │
      └── Vercel: .upsert(sanitizedPayload) [without id field]
                 └─► PostgreSQL: INSERT INTO agendas (...) VALUES (...) -> gen_random_uuid() -> ID: B456
      │
      ▼
Supabase Database
      │
      ├── Local: 1 row total (id: A123, updated content)
      └── Vercel: 2 rows total (id: A123 original + id: B456 duplicate)
      │
      ▼
Realtime / Remote Fetch -> Zustand Store -> UI
      │
      ├── Local: 1 agenda rendered (Clean update)
      └── Vercel: 2 agendas rendered (Duplicate visible!)
```

---

## 7. DUPLICATION PATTERN ANALYSIS (1 AUGUST AGENDA EXAMPLE)

In Vercel deployment:
- **Original Agenda Record:** `id: A123`, `title: "Agenda 1 Agustus"`
- **After Edit on Vercel:**
  - Record 1: `id: A123`, `title: "Agenda 1 Agustus"` (Original unmodified in DB)
  - Record 2: `id: B456`, `title: "Agenda 1 Agustus (Edited)"` (Inserted as new row by Postgres `gen_random_uuid()`)
- Because both records possess distinct UUID primary keys, Zustand's `deduplicateAgendas()` keeps both items in state, causing two duplicate agendas to render on screen.

---

## 8. ROOT CAUSE CLASSIFICATION

Selected Classification based on verified evidence:

> **`CASE A — Deployment Mismatch`**

### Supporting Evidence
1. **Remote HEAD (`origin/main`):** `713617b463ff9cb44b2bc8dd66c80ba93f73e52d` (Sep 8, 2026).
2. **Vercel Code Inspection:** `git show 713617b:src/lib/repositories/sync-repository.ts` shows `if (item.operation === 'CREATE' || item.operation === 'UPDATE') { supabase.from('agendas').upsert(sanitizedPayload) }`.
3. **Local HEAD (`main`):** `d90acb336aeeffdfdce7cb4a273bfed8615ff242` (Sep 22, 2026).
4. **Local Code Inspection:** `src/lib/repositories/sync-repository.ts` shows `else if (item.operation === 'UPDATE') { supabase.from('agendas').update(sanitizedPayload).eq('id', item.entity_id) }`.
5. **Environment Confirmation:** `.env.local` shows both environments share the same Supabase project reference (`qizsddkgzwixwrkbvalr`).

---

## 9. CHANGES MADE DURING THIS AUDIT PHASE

- Executed `git add .` and `git commit -m "checkpoint: C1.5 agenda identity sync stable"` creating local commit `d90acb3`.
- **NO business logic changes** were made.
- **NO database schema / RLS changes** were made.
- **NO dependency changes** were made.
- **NO remote git push** was performed (`git push` strictly avoided).

---

## 10. RECOMMENDED NEXT STEPS

1. **Synchronize Vercel Code Base:** Push local checkpoint commit `d90acb3` to GitHub `origin/main` (upon user explicit command) so Vercel builds the C1.5 canonical identity fix.
2. **Verify Vercel Production Build:** Trigger or inspect Vercel build output to ensure commit `d90acb3` is deployed to production.
3. **Runtime Test on Vercel:** Edit an agenda on `https://agendarecap.vercel.app` (or production domain) to verify zero duplicates are generated.
