-- Fix "Function Search Path Mutable" warnings from Supabase Security Advisor
-- Lock search_path to 'public' for all custom functions

ALTER FUNCTION increment_message_count_dedup(TEXT, TEXT, TEXT, TEXT) SET search_path = public;
ALTER FUNCTION cleanup_processed_events(INTEGER) SET search_path = public;
ALTER FUNCTION is_group_allowed(TEXT) SET search_path = public;
ALTER FUNCTION upsert_group_name(TEXT, TEXT) SET search_path = public;
ALTER FUNCTION upsert_user_name(TEXT, TEXT) SET search_path = public;
ALTER FUNCTION update_updated_at_column() SET search_path = public;
ALTER FUNCTION increment_message_count(TEXT, TEXT, TEXT) SET search_path = public;
ALTER FUNCTION get_group_name(TEXT) SET search_path = public;
ALTER FUNCTION get_user_name(TEXT) SET search_path = public;
