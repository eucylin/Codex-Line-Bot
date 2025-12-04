-- Add table for allowed groups (whitelist)
-- Only groups in this list can use the bot services

CREATE TABLE IF NOT EXISTS allowed_groups (
  group_id TEXT PRIMARY KEY,
  group_name TEXT,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  added_by TEXT DEFAULT 'admin'
);

-- Create index for faster lookup
CREATE INDEX IF NOT EXISTS idx_allowed_groups_group_id ON allowed_groups(group_id);

-- Function to check if a group is allowed
CREATE OR REPLACE FUNCTION is_group_allowed(p_group_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM allowed_groups WHERE group_id = p_group_id
  );
END;
$$;

-- Insert initial allowed group (the one you already have)
-- You can add more groups by running:
-- INSERT INTO allowed_groups (group_id, group_name) VALUES ('Cxxxxxxxx', '群組名稱');
INSERT INTO allowed_groups (group_id, group_name) 
VALUES ('C8e03257f4d4fd101e9c83f69fa9297fe', '清新•正直•不嘴砲')
ON CONFLICT (group_id) DO NOTHING;
