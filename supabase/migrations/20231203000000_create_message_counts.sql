-- Create table for tracking monthly message counts per user per group
CREATE TABLE IF NOT EXISTS message_counts (
  id BIGSERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  year_month TEXT NOT NULL, -- Format: YYYY-MM
  count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint for group + user + month combination
  CONSTRAINT unique_group_user_month UNIQUE (group_id, user_id, year_month)
);

-- Create indexes for faster queries
CREATE INDEX idx_message_counts_group_id ON message_counts(group_id);
CREATE INDEX idx_message_counts_user_id ON message_counts(user_id);
CREATE INDEX idx_message_counts_year_month ON message_counts(year_month);
CREATE INDEX idx_message_counts_group_month ON message_counts(group_id, year_month);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_message_counts_updated_at
  BEFORE UPDATE ON message_counts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create or replace function to increment message count (upsert)
CREATE OR REPLACE FUNCTION increment_message_count(
  p_group_id TEXT,
  p_user_id TEXT,
  p_year_month TEXT
)
RETURNS void AS $$
BEGIN
  INSERT INTO message_counts (group_id, user_id, year_month, count)
  VALUES (p_group_id, p_user_id, p_year_month, 1)
  ON CONFLICT (group_id, user_id, year_month)
  DO UPDATE SET count = message_counts.count + 1;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security (RLS)
ALTER TABLE message_counts ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role full access
CREATE POLICY "Service role has full access" ON message_counts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Comment on table
COMMENT ON TABLE message_counts IS 'Tracks monthly message counts per user per LINE group';
COMMENT ON COLUMN message_counts.group_id IS 'LINE Group ID';
COMMENT ON COLUMN message_counts.user_id IS 'LINE User ID';
COMMENT ON COLUMN message_counts.year_month IS 'Year and month in YYYY-MM format';
COMMENT ON COLUMN message_counts.count IS 'Number of messages sent by user in the group during the month';
