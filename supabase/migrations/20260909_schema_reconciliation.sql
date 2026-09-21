-- ============================================================================
-- Migration: Schema Reconciliation (Canonical Model Sync)
-- File: supabase/migrations/20260909_schema_reconciliation.sql
-- Purpose: Reconcile live Supabase database schema with the canonical application model:
--          1. Make legacy `reminders.scheduled_at` nullable (prevents 23502 insert blocker)
--          2. Make legacy `reminders.status` nullable (if not already)
--          3. Ensure `push_subscribers.user_id` exists as nullable FK
--          4. Ensure `reminder_occurrences` relies strictly on `reminder_id` (no `user_id`)
--          5. Explicitly rebuild RLS policies for ownership protection
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REMINDERS TABLE SCHEMA ADJUSTMENTS
-- ----------------------------------------------------------------------------

-- Drop NOT NULL constraint on legacy `scheduled_at` column.
-- Canonical code places `scheduled_at` on `reminder_occurrences`.
-- Making this nullable allows canonical reminder creation payloads to succeed.
ALTER TABLE public.reminders ALTER COLUMN scheduled_at DROP NOT NULL;

-- Ensure legacy status column on reminders is also nullable if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reminders'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE public.reminders ALTER COLUMN status DROP NOT NULL;
  END IF;
END $$;

-- Ensure canonical column `user_id` is NOT NULL (ownership required)
-- If any orphan row without user_id exists, keep default safe behavior
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reminders'
      AND column_name = 'user_id'
  ) THEN
    -- Only set NOT NULL if no NULL values exist
    IF NOT EXISTS (SELECT 1 FROM public.reminders WHERE user_id IS NULL) THEN
      ALTER TABLE public.reminders ALTER COLUMN user_id SET NOT NULL;
    END IF;
  ELSE
    ALTER TABLE public.reminders ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure canonical metadata columns exist on reminders
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS body TEXT DEFAULT '';
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Jakarta';
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS delivery_mode TEXT DEFAULT 'hybrid';
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;


-- ----------------------------------------------------------------------------
-- 2. REMINDER_OCCURRENCES TABLE SCHEMA ADJUSTMENTS
-- ----------------------------------------------------------------------------

-- Ensure user_id does NOT exist on reminder_occurrences (relational model enforced)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reminder_occurrences'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.reminder_occurrences DROP COLUMN user_id;
  END IF;
END $$;

-- Ensure FK from reminder_occurrences.reminder_id -> reminders.id ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'reminder_occurrences'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%reminder_id%'
  ) THEN
    ALTER TABLE public.reminder_occurrences
      ADD CONSTRAINT fk_reminder_occurrences_reminder
      FOREIGN KEY (reminder_id) REFERENCES public.reminders(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 3. PUSH_SUBSCRIBERS TABLE SCHEMA ADJUSTMENTS
-- ----------------------------------------------------------------------------

-- Add user_id to push_subscribers if missing (nullable FK to support optional unauthenticated push)
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

-- Ensure other columns exist on push_subscribers
ALTER TABLE public.push_subscribers ADD COLUMN IF NOT EXISTS p256dh TEXT;
ALTER TABLE public.push_subscribers ADD COLUMN IF NOT EXISTS auth TEXT;
ALTER TABLE public.push_subscribers ADD COLUMN IF NOT EXISTS subscription JSONB;
ALTER TABLE public.push_subscribers ADD COLUMN IF NOT EXISTS device_info JSONB;
ALTER TABLE public.push_subscribers ADD COLUMN IF NOT EXISTS reminders JSONB;
ALTER TABLE public.push_subscribers ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();


-- ----------------------------------------------------------------------------
-- 4. RLS POLICIES RECONCILIATION
-- ----------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscribers ENABLE ROW LEVEL SECURITY;

-- Clean up any legacy or insecure policies
DROP POLICY IF EXISTS "Universal access reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can manage their own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can manage own reminders" ON public.reminders;

DROP POLICY IF EXISTS "Universal access occurrences" ON public.reminder_occurrences;
DROP POLICY IF EXISTS "Users can manage occurrences of their reminders" ON public.reminder_occurrences;

DROP POLICY IF EXISTS "Universal access subscribers" ON public.push_subscribers;
DROP POLICY IF EXISTS "Users can manage push subscriptions" ON public.push_subscribers;
DROP POLICY IF EXISTS "Anyone can register push subscriptions" ON public.push_subscribers;
DROP POLICY IF EXISTS "Users can manage their push subscriptions" ON public.push_subscribers;

-- Apply canonical ownership policies
CREATE POLICY "Users can manage their own reminders"
  ON public.reminders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

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

CREATE POLICY "Users can manage push subscriptions"
  ON public.push_subscribers FOR ALL
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON public.reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_reminder_id ON public.reminder_occurrences(reminder_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_scheduled_at ON public.reminder_occurrences(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_occurrences_status ON public.reminder_occurrences(status);
