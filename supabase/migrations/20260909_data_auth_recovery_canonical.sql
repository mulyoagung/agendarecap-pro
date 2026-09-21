-- ============================================================================
-- Migration: Data & Auth Recovery - Canonical Schema & Relational RLS
-- File: supabase/migrations/20260909_data_auth_recovery_canonical.sql
-- ============================================================================

-- 1. Ensure Table Structure for Reminders
CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  time TEXT DEFAULT '08:00',
  timezone TEXT DEFAULT 'Asia/Jakarta',
  frequency TEXT DEFAULT 'once',
  days_of_week INT[],
  sound TEXT DEFAULT 'default',
  is_active BOOLEAN DEFAULT true,
  delivery_mode TEXT DEFAULT 'hybrid',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Ensure Table Structure for Reminder Occurrences (Relational child of reminders)
CREATE TABLE IF NOT EXISTS public.reminder_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID REFERENCES public.reminders(id) ON DELETE CASCADE NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled' NOT NULL,
  snoozed_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  notification_tag TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- If user_id column accidentally exists on reminder_occurrences from legacy scripts, drop it to enforce relational model
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

-- 3. Ensure Table Structure for Push Subscribers
CREATE TABLE IF NOT EXISTS public.push_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  device_info JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add user_id to push_subscribers if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'push_subscribers' 
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.push_subscribers ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscribers ENABLE ROW LEVEL SECURITY;

-- 5. Revoke Insecure Blanket Policies
DROP POLICY IF EXISTS "Universal access reminders" ON public.reminders;
DROP POLICY IF EXISTS "Universal access occurrences" ON public.reminder_occurrences;
DROP POLICY IF EXISTS "Universal access subscribers" ON public.push_subscribers;
DROP POLICY IF EXISTS "Users can manage their own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can manage occurrences of their reminders" ON public.reminder_occurrences;
DROP POLICY IF EXISTS "Users can manage push subscriptions" ON public.push_subscribers;

-- 6. Apply Secure Relational RLS Policies

-- Reminders: Direct Ownership via user_id
CREATE POLICY "Users can manage their own reminders"
  ON public.reminders
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Reminder Occurrences: Relational Ownership via parent reminder_id
CREATE POLICY "Users can manage occurrences of their reminders"
  ON public.reminder_occurrences
  FOR ALL
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

-- Push Subscribers: User specific or anonymous
CREATE POLICY "Users can manage push subscriptions"
  ON public.push_subscribers
  FOR ALL
  USING (user_id IS NULL OR auth.uid() = user_id)
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- 7. High-Performance Relational Indexes
CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON public.reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_reminder_id ON public.reminder_occurrences(reminder_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_status ON public.reminder_occurrences(status);
CREATE INDEX IF NOT EXISTS idx_occurrences_scheduled_at ON public.reminder_occurrences(scheduled_at);

-- 8. Updated Atomic Claim Function
CREATE OR REPLACE FUNCTION public.claim_due_occurrences(
  p_now TIMESTAMPTZ DEFAULT NOW(),
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  reminder_id UUID,
  scheduled_at TIMESTAMPTZ,
  status TEXT,
  notification_tag TEXT,
  title TEXT,
  body TEXT,
  sound TEXT,
  timezone TEXT,
  user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH target_occurrences AS (
    SELECT o.id
    FROM public.reminder_occurrences o
    JOIN public.reminders r ON r.id = o.reminder_id
    WHERE r.is_active = true
      AND (
        (o.status = 'scheduled' AND o.scheduled_at <= p_now)
        OR
        (o.status = 'snoozed' AND o.snoozed_until <= p_now)
      )
    ORDER BY o.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF o SKIP LOCKED
  ),
  updated_occurrences AS (
    UPDATE public.reminder_occurrences o
    SET 
      status = 'processing',
      updated_at = NOW()
    FROM target_occurrences t
    WHERE o.id = t.id
    RETURNING o.id, o.reminder_id, o.scheduled_at, o.status, o.notification_tag
  )
  SELECT 
    uo.id,
    uo.reminder_id,
    uo.scheduled_at,
    uo.status,
    uo.notification_tag,
    r.title,
    r.body,
    r.sound,
    r.timezone,
    r.user_id
  FROM updated_occurrences uo
  JOIN public.reminders r ON r.id = uo.reminder_id;
END;
$$;
