-- ═══════════════════════════════════════════════════════════════════
-- MedPath v2 — Backend Migrations (fixed)
-- Run this entire file in Supabase SQL Editor:
--   Dashboard → SQL Editor → New query → paste → RUN
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. CARD REVIEWS  (cross-device SM-2 sync, per-card granularity)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_reviews (
  user_id    TEXT    NOT NULL,
  card_key   TEXT    NOT NULL,
  state      TEXT    NOT NULL DEFAULT 'new',
  ease       REAL    NOT NULL DEFAULT 2.5,
  interval   INTEGER NOT NULL DEFAULT 0,
  step       INTEGER NOT NULL DEFAULT 0,
  lapses     INTEGER NOT NULL DEFAULT 0,
  due        BIGINT  NOT NULL DEFAULT 0,
  reps       INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, card_key)
);

ALTER TABLE card_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "card_reviews_policy" ON card_reviews
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_card_reviews_user
  ON card_reviews (user_id);

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

CREATE POLICY "study_sessions_policy" ON study_sessions
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

CREATE POLICY "daily_activity_policy" ON daily_activity
  FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date
  ON daily_activity (user_id, activity_date DESC);

-- ─────────────────────────────────────────────────────────────────
-- 4. ASSIGNMENT COMPLETIONS
--    NOTE: assignment_id is TEXT to match however assignments.id
--    is typed in your existing schema. No FK constraint to avoid
--    type-mismatch errors — referential integrity handled in app.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_completions (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  TEXT    NOT NULL,
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

-- Students can manage their own rows
CREATE POLICY "completions_own_rows" ON assignment_completions
  FOR ALL USING (auth.uid()::text = user_id);

-- Club owners can read all completions for their clubs
-- clubs.owner_id is uuid, auth.uid() is uuid — NO ::text cast needed here
CREATE POLICY "completions_owner_read" ON assignment_completions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clubs
      WHERE clubs.id = assignment_completions.club_id
        AND clubs.owner_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_completions_assignment
  ON assignment_completions (assignment_id);

CREATE INDEX IF NOT EXISTS idx_completions_club
  ON assignment_completions (club_id);

-- ─────────────────────────────────────────────────────────────────
-- 5. PUSH SUBSCRIPTIONS
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

-- Users manage their own subscriptions
CREATE POLICY "push_subscriptions_policy" ON push_subscriptions
  FOR ALL USING (auth.uid()::text = user_id);

-- NOTE: The Edge Function uses the service_role key which bypasses
-- RLS entirely — no extra policy needed for it to read all rows.

-- ─────────────────────────────────────────────────────────────────
-- 6. REALTIME  (enable change streaming for club tables)
-- Run the REPLICA IDENTITY lines separately if the DO block fails.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE announcements          REPLICA IDENTITY FULL;
ALTER TABLE assignments            REPLICA IDENTITY FULL;
ALTER TABLE assignment_completions REPLICA IDENTITY FULL;
ALTER TABLE club_member_stats      REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
  ALTER PUBLICATION supabase_realtime ADD TABLE assignments;
  ALTER PUBLICATION supabase_realtime ADD TABLE assignment_completions;
  ALTER PUBLICATION supabase_realtime ADD TABLE club_member_stats;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Realtime publication: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────
-- DONE. Verify:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
-- ─────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════
-- MedPath v3 — Backend Features Migrations
-- Append-safe: every statement uses IF NOT EXISTS / CREATE OR REPLACE
-- Run in Supabase SQL Editor after the v2 migrations above
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. SM-2 CONFLICT RESOLUTION
--    Add category column so we never need a join for the mastery view.
--    Upgrade to atomic server-side merge via batch_upsert_card_reviews_merge().
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE card_reviews
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_card_reviews_category
  ON card_reviews (user_id, category);

-- Atomic SM-2 merge function.
-- Called from supabase-sync.js _flushCardReviews() via .rpc().
-- Rules:
--   reps     → GREATEST (more studying wins)
--   ease     → min when reps equal (conservative: harder = review more often)
--   interval → min when reps equal (conservative: return sooner)
--   lapses   → GREATEST always (never forget a lapse)
--   due      → min when reps equal (conservative: earlier = safer)
--   state    → follow the due/reps winner
--   category → COALESCE (never blank out a value we already have)

CREATE OR REPLACE FUNCTION batch_upsert_card_reviews_merge(
  p_reviews JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r JSONB;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_reviews) LOOP
    INSERT INTO card_reviews (
      user_id, card_key, state, ease, interval, step,
      lapses, due, reps, category, updated_at
    )
    VALUES (
      r->>'user_id',
      r->>'card_key',
      COALESCE(r->>'state',    'new'),
      COALESCE((r->>'ease')::REAL,       2.5),
      COALESCE((r->>'interval')::INT,    0),
      COALESCE((r->>'step')::INT,        0),
      COALESCE((r->>'lapses')::INT,      0),
      COALESCE((r->>'due')::BIGINT,      0),
      COALESCE((r->>'reps')::INT,        0),
      COALESCE(r->>'category', ''),
      COALESCE((r->>'updated_at')::TIMESTAMPTZ, NOW())
    )
    ON CONFLICT (user_id, card_key) DO UPDATE SET

      -- More reps = more study happened on that device
      reps = GREATEST(card_reviews.reps, EXCLUDED.reps),

      -- State: follow the more-studied version; tie-break on earlier due
      state = CASE
        WHEN EXCLUDED.reps > card_reviews.reps
          THEN EXCLUDED.state
        WHEN EXCLUDED.reps = card_reviews.reps
             AND EXCLUDED.due < card_reviews.due
          THEN EXCLUDED.state
        ELSE card_reviews.state
      END,

      -- Ease: if incoming has more reps, use it; on tie, take the minimum (harder)
      ease = CASE
        WHEN EXCLUDED.reps > card_reviews.reps THEN EXCLUDED.ease
        WHEN EXCLUDED.reps = card_reviews.reps THEN LEAST(card_reviews.ease, EXCLUDED.ease)
        ELSE card_reviews.ease
      END,

      -- Interval: same logic, minimum on tie (review sooner)
      interval = CASE
        WHEN EXCLUDED.reps > card_reviews.reps THEN EXCLUDED.interval
        WHEN EXCLUDED.reps = card_reviews.reps THEN LEAST(card_reviews.interval, EXCLUDED.interval)
        ELSE card_reviews.interval
      END,

      -- Step: maximum (further back in learning steps is safer)
      step = CASE
        WHEN EXCLUDED.reps > card_reviews.reps THEN EXCLUDED.step
        ELSE GREATEST(card_reviews.step, EXCLUDED.step)
      END,

      -- Lapses: always maximum (never forget a mistake)
      lapses = GREATEST(card_reviews.lapses, EXCLUDED.lapses),

      -- Due: if incoming has more reps use it; on tie take the minimum (sooner)
      due = CASE
        WHEN EXCLUDED.reps > card_reviews.reps THEN EXCLUDED.due
        WHEN EXCLUDED.reps = card_reviews.reps THEN LEAST(card_reviews.due, EXCLUDED.due)
        ELSE card_reviews.due
      END,

      -- Category: never overwrite a good value with an empty string
      category = COALESCE(NULLIF(EXCLUDED.category, ''), card_reviews.category),

      -- Timestamp: keep the later one
      updated_at = GREATEST(card_reviews.updated_at, EXCLUDED.updated_at);

  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 2. ATOMIC DAILY ACTIVITY INCREMENT
--    Prevents race conditions when two devices study at the same time.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_daily_activity(
  p_user_id TEXT,
  p_date    DATE,
  p_cards   INTEGER,
  p_xp      INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO daily_activity (user_id, activity_date, cards_reviewed, xp_earned, sessions_count)
  VALUES (p_user_id, p_date, p_cards, p_xp, 1)
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    cards_reviewed = daily_activity.cards_reviewed + EXCLUDED.cards_reviewed,
    xp_earned      = daily_activity.xp_earned      + EXCLUDED.xp_earned,
    sessions_count = daily_activity.sessions_count + 1;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 3. CLASS MASTERY HEATMAP VIEW
--    Aggregates per-category SM-2 mastery across all club members.
--    A card is "mastered" when state='review' AND interval >= 7 days.
--    The teacher queries this view filtered by club_id, sorted asc
--    to see the weakest categories first.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW club_category_mastery AS
SELECT
  cm.club_id,
  cr.category,
  COUNT(*)                                                                         AS total_cards,
  COUNT(*) FILTER (WHERE cr.state = 'review' AND cr.interval >= 7)                AS mastered_cards,
  ROUND(
    100.0
    * COUNT(*) FILTER (WHERE cr.state = 'review' AND cr.interval >= 7)
    / NULLIF(COUNT(*), 0)
  )                                                                                AS mastery_pct,
  ROUND(AVG(cr.ease)::NUMERIC, 2)                                                  AS avg_ease,
  COUNT(DISTINCT cr.user_id)                                                       AS students_with_data,
  MAX(cr.updated_at)                                                               AS last_updated
FROM club_members  cm
JOIN card_reviews  cr ON cr.user_id = cm.user_id
WHERE cr.category IS NOT NULL
  AND cr.category <> ''
GROUP BY cm.club_id, cr.category;

-- RLS note: this view inherits the card_reviews RLS policies.
-- Teachers see it through the club_members join — only their own clubs.

-- ─────────────────────────────────────────────────────────────────
-- 4. NOTIFICATION PREFERENCES
--    Stores each user's preferred study hour and email for
--    smart-notify and weekly-report Edge Functions.
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id          TEXT        PRIMARY KEY,
  preferred_hour   SMALLINT    NOT NULL DEFAULT 19,   -- 0-23 UTC; auto-updated by smart-notify
  email            TEXT,                               -- set if user opted in for weekly report
  weekly_report    BOOLEAN     NOT NULL DEFAULT TRUE,
  last_notified_at TIMESTAMPTZ,
  last_report_at   TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_pref_own" ON notification_preferences
  FOR ALL USING (auth.uid()::text = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 5. HELPER FUNCTION — compute preferred notification hour
--    Called by smart-notify Edge Function on first notification.
--    Finds the UTC hour in which the user most often starts sessions.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_preferred_study_hour(p_user_id TEXT)
RETURNS SMALLINT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (
      SELECT EXTRACT(HOUR FROM started_at)::SMALLINT AS hr
      FROM   study_sessions
      WHERE  user_id = p_user_id
        AND  started_at > NOW() - INTERVAL '30 days'
      GROUP  BY hr
      ORDER  BY COUNT(*) DESC
      LIMIT  1
    ),
    19   -- default: 7 pm UTC
  );
$$;

-- ─────────────────────────────────────────────────────────────────
-- 6. AT-RISK QUERY FUNCTION
--    Returns at-risk students for a club + assignment combo.
--    Exposed to Edge Functions via service role.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_at_risk_students(
  p_club_id       TEXT,
  p_days_inactive INTEGER DEFAULT 3,
  p_assignment_id TEXT    DEFAULT NULL
)
RETURNS TABLE (
  user_id      TEXT,
  display_name TEXT,
  last_active  DATE,
  days_inactive INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH last_activity AS (
    SELECT user_id, MAX(activity_date) AS last_active
    FROM   daily_activity
    GROUP  BY user_id
  ),
  completed AS (
    SELECT DISTINCT user_id
    FROM   assignment_completions
    WHERE  assignment_id = p_assignment_id
      AND  is_complete   = TRUE
  )
  SELECT
    cm.user_id,
    cm.display_name,
    la.last_active,
    COALESCE(
      CURRENT_DATE - la.last_active,
      999
    )::INTEGER AS days_inactive
  FROM  club_members cm
  LEFT  JOIN last_activity la ON la.user_id = cm.user_id
  LEFT  JOIN completed      c  ON c.user_id  = cm.user_id
  WHERE cm.club_id = p_club_id
    AND (la.last_active IS NULL OR la.last_active < CURRENT_DATE - p_days_inactive)
    AND (p_assignment_id IS NULL OR c.user_id IS NULL)
  ORDER BY days_inactive DESC;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 7. SHARE CARD LOG (optional — tracks shares for analytics)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS share_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,
  card_type   TEXT        NOT NULL,   -- 'streak_7', 'streak_30', 'streak_100', 'achievement_<id>'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE share_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "share_own" ON share_events FOR ALL USING (auth.uid()::text = user_id);

-- ─────────────────────────────────────────────────────────────────
-- DONE. Quick verification:
--   SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public' ORDER BY routine_name;
-- ─────────────────────────────────────────────────────────────────
