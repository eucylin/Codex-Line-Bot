# Codex Line Bot 月度發話量統計工具

這個範例專案示範如何使用 **Google Apps Script (GAS)** 搭配 **Google Sheet** 來接收 LINE 群組的訊息事件，並統計每位成員在每個月的發話量。系統透過 LINE Messaging API 的 webhook 將訊息送進 GAS，GAS 會依照訊息時間與發話者更新試算表中的統計資料。

## 系統架構

1. **LINE Bot**：於 LINE Developers Console 建立含有 Messaging API 權限的 Channel，設定 webhook URL 指向已部署的 GAS 網址。
2. **Google Apps Script**：負責處理 webhook 事件，解析訊息，並更新 Google Sheet 中的統計資料。
3. **Google Sheet**：呈現每位成員在每個月份的發話量。

## 主要功能

- 以「年-月」為欄位，統計每位群組成員每個月的發話次數。
- 自動新增新的月份欄位與新成員列。
- 透過 LINE API 擷取群組成員顯示名稱並快取，減少 API 呼叫次數。
- 提供回填工具函式，可從原始紀錄重新建立統計表。

## 部署步驟

1. ### 建立 Google Sheet
   - 新增一個空白試算表，記下其試算表 ID（網址中 `/d/` 與 `/edit` 之間的字串）。
   - 試算表中會自動建立一個名為 `MonthlySummary` 的工作表，用於顯示統計結果。

2. ### 建立 Google Apps Script 專案
   - 在 Google Drive 中建立新的 Google Apps Script 專案，或在試算表中選擇 **Extensions → Apps Script** 建立綁定專案。
   - 將 `src/LineMonthlyCounter.gs` 內容貼上 Apps Script 編輯器。
   - 在 Apps Script 中開啟 **Project Settings**，於「Script properties」新增以下兩個參數：
     - `SPREADSHEET_ID`：剛才建立試算表的 ID。
     - `LINE_ACCESS_TOKEN`：LINE Messaging API Channel 的長期存取權杖。

3. ### 設定 Web App
   - 在 Apps Script 中選擇 **Deploy → Test deployments** 或 **Manage deployments**，新增一個 **Web app** 部署。
   - 設定如下：
     - **Execute as**：Me
     - **Who has access**：Anyone
   - 部署後取得 Web App URL。

4. ### 設定 LINE Messaging API
   - 至 LINE Developers Console 的 Messaging API 設定頁面。
   - 於 **Webhook URL** 輸入剛才取得的 Web App URL 並啟用 webhook。
   - 確認 `Use webhook` 為啟用狀態。

5. ### 測試與驗證
   - 將 Bot 加入目標聊天群組。
   - 在群組中發送訊息。GAS 會收到 webhook 事件，並在 `MonthlySummary` 工作表中新增對應的使用者列與月份欄位，累積發話次數。
   - 若需要重新統計，可在 Apps Script 執行 `rebuildSummaryFromLogs()`（需先準備 `RawLogs` 工作表並填入 `User ID`, `Display Name`, `Month`, `Count` 欄位資料）。

## 注意事項

- Apps Script 專案須開啟 `UrlFetchApp` 權限才能呼叫 LINE Profile API。
- `LINE_ACCESS_TOKEN` 建議存放於腳本屬性或 Google Cloud Secret Manager，避免硬編碼在程式碼中。
- 如果 LINE 成員變更顯示名稱，GAS 會在下一次訊息更新時同步顯示名稱。
- 若群組訊息量很大，可視情況將 RawLogs 記錄到 BigQuery 或 Cloud Storage，再定期回填試算表。

## 參考檔案

- `src/LineMonthlyCounter.gs`：主要的 Google Apps Script 程式碼。

