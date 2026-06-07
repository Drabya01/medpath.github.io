-- ═══════════════════════════════════════════════════════════════════
-- MedPath v2 — Backend Migrations
-- Run this entire file in Supabase SQL Editor:
--   Dashboard → SQL Editor → New query → paste → RUN
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. CARD REVIEWS  (cross-device SM-2 sync, per-card granularity)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_reviews (
  user_id    TEXT    NOT NULL,
  card_key   TEXT    NOT NULL,  -- format: 'fc:CardTerm'
  state      TEXT    NOT NULL DEFAULT 'new',
  ease       REAL    NOT NULL DEFAULT 2.5,
  interval   INTEGER NOT NULL DEFAULT 0,
  step       INTEGER NOT NULL DEFAULT 0,
  lapses     INTEGER NOT NULL DEFAULT 0,
  due        BIGINT  NOT NULL DEFAULT 0,  -- epoch ms
  reps       INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, card_key)
);

ALTER TABLE card_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_reviews: users own their rows" ON card_reviews
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_card_reviews_user
  ON card_reviews (user_id);

CREATE INDEX IF NOT EXISTS idx_card_reviews_due
  ON card_reviews (user_id, due)
  WHERE state IN ('review','relearning');

-- ─────────────────────────────────────────────────────────────────
-- 2. STUDY SESSIONS  (session-level analytics)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_sessions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT    NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  cards_reviewed   INTEGER NOT NULL DEFAULT 0,
  xp_earned        INTEGER NOT NULL DEFAULT 0,
  category         TEXT    NOT NULL DEFAULT 'All',
  screen           TEXT    NOT NULL DEFAULT 'flashcards',
  duration_seconds INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_sessions: users own their rows" ON study_sessions
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user_time
  ON study_sessions (user_id, started_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- 3. DAILY ACTIVITY  (streak verification + per-day analytics)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_activity (
  user_id        TEXT NOT NULL,
  activity_date  DATE NOT NULL,
  cards_reviewed INTEGER NOT NULL DEFAULT 0,
  xp_earned      INTEGER NOT NULL DEFAULT 0,
  sessions_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, activity_date)
);

ALTER TABLE daily_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_activity: users own their rows" ON daily_activity
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date
  ON daily_activity (user_id, activity_date DESC);

-- ─────────────────────────────────────────────────────────────────
-- 4. ASSIGNMENT COMPLETIONS  (per-student assignment progress)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_completions (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  UUID    NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id        TEXT    NOT NULL,
  club_id        TEXT    NOT NULL,
  cards_done     INTEGER NOT NULL DEFAULT 0,
  total_cards    INTEGER NOT NULL DEFAULT 0,
  is_complete    BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, user_id)
);

ALTER TABLE assignment_completions ENABLE ROW LEVEL SECURITY;

-- Teachers (club owners) can read all completions for their club
CREATE POLICY "completions: club owners can read" ON assignment_completions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clubs
      WHERE clubs.id = assignment_completions.club_id
        AND clubs.owner_id = auth.uid()::text
    )
  );

-- Students can insert/update their own completion rows
CREATE POLICY "completions: students manage own rows" ON assignment_completions
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_completions_assignment
  ON assignment_completions (assignment_id);

CREATE INDEX IF NOT EXISTS idx_completions_user_club
  ON assignment_completions (user_id, club_id);

-- ─────────────────────────────────────────────────────────────────
-- 5. PUSH SUBSCRIPTIONS  (Web Push / PWA notifications)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id          TEXT NOT NULL,
  endpoint         TEXT NOT NULL,
  p256dh           TEXT NOT NULL,
  auth_key         TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subscriptions: users own their rows" ON push_subscriptions
  FOR ALL USING (auth.uid()::text = user_id);

-- Service role can read all (needed by Edge Function to send notifications)
CREATE POLICY "push_subscriptions: service role can read" ON push_subscriptions
  FOR SELECT USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────
-- 6. REALTIME SUPPORT  (enable change streaming for club tables)
-- Run each line separately if you hit issues.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE announcements         REPLICA IDENTITY FULL;
ALTER TABLE assignments           REPLICA IDENTITY FULL;
ALTER TABLE assignment_completions REPLICA IDENTITY FULL;
ALTER TABLE club_member_stats     REPLICA IDENTITY FULL;

-- Add the tables to the realtime publication
-- (Run this in: Dashboard → Database → Replication → supabase_realtime → Tables)
-- Or via SQL:
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
  ALTER PUBLICATION supabase_realtime ADD TABLE assignments;
  ALTER PUBLICATION supabase_realtime ADD TABLE assignment_completions;
  ALTER PUBLICATION supabase_realtime ADD TABLE club_member_stats;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Publication update: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- DONE. Verify by running:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
-- ─────────────────────────────────────────────────────────────────
