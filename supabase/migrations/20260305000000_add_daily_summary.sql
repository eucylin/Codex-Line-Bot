-- Add daily summary feature: store group messages and track summary state
-- Enables the bot to generate daily chat summaries using AI

-- Table to store group messages for daily summary generation
CREATE TABLE group_messages (
  id BIGSERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_group_messages_group_sent ON group_messages(group_id, sent_at);
CREATE INDEX idx_group_messages_created_at ON group_messages(created_at);

ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access" ON group_messages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE group_messages IS 'Stores group chat messages for daily summary generation (retained 60 days)';

-- Table to track daily summary claim state per group
CREATE TABLE daily_summary_state (
  group_id TEXT NOT NULL,
  summary_date TEXT NOT NULL,  -- YYYY-MM-DD (JST)
  status TEXT NOT NULL DEFAULT 'claimed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, summary_date)
);

ALTER TABLE daily_summary_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access" ON daily_summary_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE daily_summary_state IS 'Tracks daily summary generation state per group to prevent duplicate summaries';

-- Atomic claim for daily summary generation
-- Returns TRUE if this call successfully claimed, FALSE if already claimed
CREATE OR REPLACE FUNCTION try_claim_daily_summary(
  p_group_id TEXT,
  p_summary_date TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO daily_summary_state (group_id, summary_date, status)
  VALUES (p_group_id, p_summary_date, 'claimed')
  ON CONFLICT (group_id, summary_date) DO NOTHING;

  RETURN FOUND;
END;
$$;

-- Store a group message with probabilistic cleanup
CREATE OR REPLACE FUNCTION store_group_message(
  p_group_id TEXT,
  p_user_id TEXT,
  p_message_text TEXT,
  p_sent_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Insert the message
  INSERT INTO group_messages (group_id, user_id, message_text, sent_at)
  VALUES (p_group_id, p_user_id, p_message_text, p_sent_at);

  -- Probabilistic cleanup: ~0.5% of calls clean up old entries
  IF random() < 0.005 THEN
    DELETE FROM group_messages
    WHERE created_at < NOW() - INTERVAL '60 days';

    DELETE FROM daily_summary_state
    WHERE created_at < NOW() - INTERVAL '90 days';
  END IF;
END;
$$;
