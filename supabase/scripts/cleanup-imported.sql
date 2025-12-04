-- ============================================
-- 資料庫修復腳本：清理 imported_ 記錄
-- 請在 Supabase Dashboard > SQL Editor 執行
-- ============================================

-- Step 1: 查看所有 imported_ 記錄
SELECT 
  mc.id,
  mc.user_id,
  mc.count,
  mc.year_month,
  un.user_name as imported_name
FROM message_counts mc
LEFT JOIN user_names un ON mc.user_id = un.user_id
WHERE mc.user_id LIKE 'imported_%'
ORDER BY mc.count DESC;

-- Step 2: 查看所有真實用戶（用於比對）
SELECT user_id, user_name 
FROM user_names 
WHERE user_id NOT LIKE 'imported_%'
ORDER BY user_name;

-- ============================================
-- Step 3: 刪除所有 imported_ 記錄
-- （因為這些是匯入時建立的假 ID，且可能與真實用戶重複）
-- ============================================

-- 刪除 message_counts 中的 imported_ 記錄
DELETE FROM message_counts 
WHERE user_id LIKE 'imported_%';

-- 刪除 user_names 中的 imported_ 記錄
DELETE FROM user_names 
WHERE user_id LIKE 'imported_%';

-- Step 4: 驗證清理結果
SELECT COUNT(*) as remaining_imported 
FROM message_counts 
WHERE user_id LIKE 'imported_%';
