-- ============================================================================
-- Migration: Supplemental Schema Fix for Runtime Compatibility
-- File: supabase/migrations/20260909_supplemental_schema_fix.sql
-- Reason: Live DB reminders table retains old migration 1 columns (scheduled_at
--         NOT NULL, status, etc.). Code sends only the canonical columns.
--         This migration makes scheduled_at nullable and adds user_id to
--         push_subscribers using safe ALTER TABLE IF NOT EXISTS patterns.
-- ============================================================================

-- 1. Make scheduled_at nullable on reminders (it is NOT part of canonical schema)
--    Code does not send this column. NOT NULL constraint causes every insert to fail.
ALTER TABLE public.reminders ALTER COLUMN scheduled_at DROP NOT NULL;

-- 2. Add user_id to push_subscribers if it doesn't exist
--    Migration 3's CREATE TABLE IF NOT EXISTS did not execute because table existed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'push_subscribers'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.push_subscribers
      ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Ensure user_id exists on reminders (should already exist from migration 1,
--    but guard with IF NOT EXISTS for safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reminders'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.reminders
      ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Ensure delivery_mode exists on reminders
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS delivery_mode TEXT DEFAULT 'hybrid';

-- 5. Ensure body exists on reminders
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS body TEXT DEFAULT '';

-- 6. Ensure timezone exists on reminders
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Jakarta';

-- 7. Re-drop and re-apply RLS policies to ensure they are correct
--    (idempotent - safe to run multiple times)

-- reminders
DROP POLICY IF EXISTS "Universal access reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can manage their own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can manage own reminders" ON public.reminders;
CREATE POLICY "Users can manage their own reminders"
  ON public.reminders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- reminder_occurrences
DROP POLICY IF EXISTS "Universal access occurrences" ON public.reminder_occurrences;
DROP POLICY IF EXISTS "Users can manage occurrences of their reminders" ON public.reminder_occurrences;
CREATE POLICY "Users can manage occurrences of their reminders"
  ON public.reminder_occurrences FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.reminders r
      WHERE r.id = reminder_occurrences.reminder_id
        AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reminders r
      WHERE r.id = reminder_occurrences.reminder_id
        AND r.user_id = auth.uid()
    )
  );

-- push_subscribers
DROP POLICY IF EXISTS "Universal access subscribers" ON public.push_subscribers;
DROP POLICY IF EXISTS "Users can manage push subscriptions" ON public.push_subscribers;
DROP POLICY IF EXISTS "Anyone can register push subscriptions" ON public.push_subscribers;
DROP POLICY IF EXISTS "Users can manage their push subscriptions" ON public.push_subscribers;
CREATE POLICY "Users can manage push subscriptions"
  ON public.push_subscribers FOR ALL
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- 8. Ensure RLS is enabled
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscribers ENABLE ROW LEVEL SECURITY;
