-- 1. Tabel Profiles 
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'user' NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabel Agendas
CREATE TABLE IF NOT EXISTS public.agendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT,
  include_notes_in_share BOOLEAN DEFAULT false,
  is_completed BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'confirmed',
  "privateNotes" TEXT,
  "isShareable" BOOLEAN DEFAULT true,
  "groupId" UUID,
  "isOnline" BOOLEAN DEFAULT false,
  "onlineLink" TEXT,
  "meetingId" TEXT,
  "meetingPasscode" TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabel Reminders (Cross-Device Personal Reminders Definition)
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
  is_active BOOLEAN DEFAULT true NOT NULL,
  delivery_mode TEXT DEFAULT 'hybrid',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabel Reminder Occurrences (Relational child of reminders)
CREATE TABLE IF NOT EXISTS public.reminder_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID REFERENCES public.reminders(id) ON DELETE CASCADE NOT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'scheduled' NOT NULL,
  snoozed_until TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  notification_tag TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabel Push Subscribers (Web Push Notifications)
CREATE TABLE IF NOT EXISTS public.push_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys JSONB NOT NULL,
  device_info JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Mengaktifkan Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscribers ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
CREATE POLICY "User can view own profile" ON public.profiles FOR SELECT USING ( auth.uid() = id );
CREATE POLICY "User can update own profile" ON public.profiles FOR UPDATE USING ( auth.uid() = id );

CREATE POLICY "Users can manage own agendas" ON public.agendas FOR ALL 
USING ( auth.uid() = user_id ) WITH CHECK ( auth.uid() = user_id );

-- Reminders: Direct Ownership via user_id
CREATE POLICY "Users can manage own reminders" ON public.reminders FOR ALL 
USING ( auth.uid() = user_id ) WITH CHECK ( auth.uid() = user_id );

-- Reminder Occurrences: Relational Ownership via parent reminder_id
CREATE POLICY "Users can manage occurrences of their reminders" ON public.reminder_occurrences FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.reminders r
    WHERE r.id = reminder_occurrences.reminder_id
      AND r.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.reminders r
    WHERE r.id = reminder_occurrences.reminder_id
      AND r.user_id = auth.uid()
  )
);

-- Push Subscribers: User specific or anonymous
CREATE POLICY "Users can manage push subscriptions" ON public.push_subscribers FOR ALL 
USING ( user_id IS NULL OR auth.uid() = user_id ) WITH CHECK ( user_id IS NULL OR auth.uid() = user_id );

-- Trigger agar user auth otomatis masuk ke tb profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 8. Tabel App Settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  app_name TEXT DEFAULT 'AgendaRecap',
  app_logo TEXT,
  share_order JSONB DEFAULT '["title", "time", "location"]'::jsonb,
  is_watermark_enabled BOOLEAN DEFAULT true,
  watermark_text TEXT DEFAULT 'Dibuat oleh AgendaRecap Pro',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own app settings" 
ON public.app_settings FOR ALL 
USING ( auth.uid() = user_id )
WITH CHECK ( auth.uid() = user_id );

-- Trigger Settings Otomatis
CREATE OR REPLACE FUNCTION public.handle_new_user_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_settings (user_id)
  VALUES (new.id);
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_settings ON auth.users;
CREATE TRIGGER on_auth_user_created_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_settings();
