-- Enable RLS on tables that were missing it
ALTER TABLE group_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE allowed_groups ENABLE ROW LEVEL SECURITY;

-- Grant service_role full access (matching message_counts pattern)
CREATE POLICY "Service role has full access" ON group_names
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role has full access" ON user_names
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role has full access" ON allowed_groups
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
