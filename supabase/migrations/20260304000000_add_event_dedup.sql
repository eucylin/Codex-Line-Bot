-- Add deduplication for LINE webhook events
-- LINE retries webhook delivery on timeout, causing duplicate message counts.
-- This migration adds a processed_events table and an atomic dedup+increment RPC.

-- Table to track processed message IDs
CREATE TABLE IF NOT EXISTS processed_events (
  message_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries
CREATE INDEX idx_processed_events_processed_at ON processed_events(processed_at);

-- Enable RLS
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;

-- Service role full access (consistent with other tables)
CREATE POLICY "Service role has full access" ON processed_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE processed_events IS 'Tracks processed LINE message IDs to prevent duplicate counting on webhook retries';

-- Atomic dedup + increment RPC
-- Returns TRUE if message was new and counted, FALSE if duplicate was skipped
CREATE OR REPLACE FUNCTION increment_message_count_dedup(
  p_group_id TEXT,
  p_user_id TEXT,
  p_year_month TEXT,
  p_message_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Probabilistic cleanup: ~1% of calls clean up old entries (> 24 hours)
  IF random() < 0.01 THEN
    DELETE FROM processed_events
    WHERE processed_at < NOW() - INTERVAL '24 hours';
  END IF;

  -- Attempt to insert the message_id; does nothing if already exists
  INSERT INTO processed_events (message_id)
  VALUES (p_message_id)
  ON CONFLICT (message_id) DO NOTHING;

  -- FOUND is true if the INSERT actually inserted a row (new message)
  IF FOUND THEN
    -- New message: increment count
    INSERT INTO message_counts (group_id, user_id, year_month, count)
    VALUES (p_group_id, p_user_id, p_year_month, 1)
    ON CONFLICT (group_id, user_id, year_month)
    DO UPDATE SET count = message_counts.count + 1;

    RETURN TRUE;
  ELSE
    -- Duplicate message: skip
    RETURN FALSE;
  END IF;
END;
$$;

-- Manual cleanup utility function
CREATE OR REPLACE FUNCTION cleanup_processed_events(
  p_older_than_hours INTEGER DEFAULT 24
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM processed_events
  WHERE processed_at < NOW() - (p_older_than_hours || ' hours')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
