-- Add tables for caching group names and user names
-- This reduces LINE API calls by caching names with expiration

-- Table for caching group names (refreshed every 14 days)
CREATE TABLE IF NOT EXISTS group_names (
  group_id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for caching user names (refreshed every 7 days)
CREATE TABLE IF NOT EXISTS user_names (
  user_id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_group_names_updated_at ON group_names(updated_at);
CREATE INDEX IF NOT EXISTS idx_user_names_updated_at ON user_names(updated_at);

-- Function to get or fetch group name
CREATE OR REPLACE FUNCTION get_group_name(p_group_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_name TEXT;
  v_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Try to get from cache
  SELECT group_name, updated_at INTO v_group_name, v_updated_at
  FROM group_names
  WHERE group_id = p_group_id;
  
  -- Return cached name if it exists and is not expired (14 days)
  IF FOUND AND v_updated_at > NOW() - INTERVAL '14 days' THEN
    RETURN v_group_name;
  END IF;
  
  -- Return NULL to indicate need to fetch from LINE API
  RETURN NULL;
END;
$$;

-- Function to get or fetch user name
CREATE OR REPLACE FUNCTION get_user_name(p_user_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_name TEXT;
  v_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Try to get from cache
  SELECT user_name, updated_at INTO v_user_name, v_updated_at
  FROM user_names
  WHERE user_id = p_user_id;
  
  -- Return cached name if it exists and is not expired (7 days)
  IF FOUND AND v_updated_at > NOW() - INTERVAL '7 days' THEN
    RETURN v_user_name;
  END IF;
  
  -- Return NULL to indicate need to fetch from LINE API
  RETURN NULL;
END;
$$;

-- Function to upsert group name
CREATE OR REPLACE FUNCTION upsert_group_name(p_group_id TEXT, p_group_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO group_names (group_id, group_name, updated_at)
  VALUES (p_group_id, p_group_name, NOW())
  ON CONFLICT (group_id)
  DO UPDATE SET
    group_name = EXCLUDED.group_name,
    updated_at = NOW();
END;
$$;

-- Function to upsert user name
CREATE OR REPLACE FUNCTION upsert_user_name(p_user_id TEXT, p_user_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_names (user_id, user_name, updated_at)
  VALUES (p_user_id, p_user_name, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    user_name = EXCLUDED.user_name,
    updated_at = NOW();
END;
$$;
