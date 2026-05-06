-- ═══════════════════════════════════════════════════
-- NutriTrack — Supabase Schema Setup
-- Run this in your Supabase SQL Editor (Dashboard → SQL)
-- ═══════════════════════════════════════════════════

-- 1. Create app_users table
CREATE TABLE IF NOT EXISTS app_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  calorie_goal INTEGER NOT NULL DEFAULT 2200,
  protein_goal INTEGER NOT NULL DEFAULT 180,
  fat_goal INTEGER NOT NULL DEFAULT 70,
  carbs_goal INTEGER NOT NULL DEFAULT 220,
  ai_provider TEXT NOT NULL DEFAULT 'openai',
  api_key TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Add user_id column to food_logs (if it doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'food_logs' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE food_logs ADD COLUMN user_id UUID REFERENCES app_users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Disable RLS on new tables (matching existing food_logs setup)
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Allow anon access (matching your existing setup)
CREATE POLICY "Allow all on app_users" ON app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on user_settings" ON user_settings FOR ALL USING (true) WITH CHECK (true);

-- Update food_logs policy if needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'food_logs' AND policyname = 'Allow all on food_logs'
  ) THEN
    CREATE POLICY "Allow all on food_logs" ON food_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Done! You can now use the admin panel to create users.
