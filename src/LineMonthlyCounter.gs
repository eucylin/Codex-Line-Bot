const TIMEZONE = 'Asia/Taipei';
const SUMMARY_SHEET_NAME = 'MonthlySummary';

const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
const SPREADSHEET_ID = SCRIPT_PROPERTIES.getProperty('SPREADSHEET_ID');
const CHANNEL_ACCESS_TOKEN = SCRIPT_PROPERTIES.getProperty('LINE_ACCESS_TOKEN');
const BOT_DISPLAY_NAME = SCRIPT_PROPERTIES.getProperty('BOT_DISPLAY_NAME') || '';
const CACHE = CacheService.getScriptCache();
const ALLOWED_GROUP_IDS = (SCRIPT_PROPERTIES.getProperty('ALLOWED_GROUP_IDS') || '')
  .split(',')
  .map(function(id) { return id.trim(); })
  .filter(Boolean);

/**
 * Entry point for LINE webhook calls. Handles message events and updates the
 * monthly summary sheet with message counts per user.
 *
 * @param {GoogleAppsScript.Events.DoPost} e Incoming webhook payload.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  Logger.log('=== Incoming LINE Webhook Request === | Post Data: ' + (e.postData ? e.postData.contents : 'No post data') + ' | =====================================');
  
  if (!e || !e.postData || !e.postData.contents) {
    Logger.log('Invalid request: missing postData');
    return createResponse_(400, 'Invalid request');
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
    Logger.log('Parsed payload: ' + JSON.stringify(payload, null, 2));
  } catch (error) {
    Logger.log('Failed to parse payload: ' + error);
    return createResponse_(400, 'Bad request');
  }

  if (!payload.events || !payload.events.length) {
    Logger.log('No events in payload');
    return createResponse_(200, 'No events');
  }

  const sheet = getSummarySheet_();
  const spreadsheet = sheet.getParent();
  const botUserId = payload.destination || '';
  let botDisplayName = null;

  payload.events.forEach(function(event) {
    if (event.type !== 'message') {
      return;
    }

    if (!event.source || event.source.type !== 'group') {
      return;
    }

    const userId = event.source.userId;
    const groupId = event.source.groupId;

    if (!userId || !groupId) {
      return;
    }

    if (ALLOWED_GROUP_IDS.length && ALLOWED_GROUP_IDS.indexOf(groupId) === -1) {
      Logger.log('Skipping event from unauthorized group: ' + groupId);
      return;
    }

    const message = event.message;

    // Only count text messages, skip stickers, images, etc.
    if (!message || message.type !== 'text') {
      return;
    }

    const timestamp = new Date(event.timestamp);
    const monthKey = Utilities.formatDate(timestamp, TIMEZONE, 'yyyy-MM');
    
    // 使用平行化 API 呼叫同時取得 groupName 和 displayName
    const names = fetchNamesInParallel_(groupId, userId);
    const groupName = names.groupName;
    const displayName = names.displayName;
    const monthCommand = extractMonthCommand_(message.text, event.timestamp);

    incrementMessageCount_(sheet, monthKey, userId, displayName, {
      groupId: groupId,
      groupName: groupName
    });

    if (monthCommand) {
      if (botDisplayName === null) {
        botDisplayName = getBotDisplayName_();
      }

      if (isBotMentioned_(message, botUserId, botDisplayName)) {
        const replyText = buildMonthlyReport_(spreadsheet, groupId, groupName, monthCommand);
        replyMessage_(event.replyToken, replyText);
      }
    }
  });

  return createResponse_(200, 'OK');
}

/**
 * Fetches and caches the display name for a LINE group member.
 *
 * @param {string} groupId LINE group ID.
 * @param {string} userId LINE user ID.
 * @return {string}
 */
function getDisplayName_(groupId, userId) {
  const cacheKey = groupId + ':' + userId;
  const cached = CACHE.get(cacheKey);
  if (cached) {
    Logger.log('Display name from cache - User ID: ' + userId + ', Display Name: ' + cached);
    return cached;
  }

  if (!CHANNEL_ACCESS_TOKEN) {
    Logger.log('No access token - User ID: ' + userId);
    return userId;
  }

  const url = 'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/member/' + encodeURIComponent(userId);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Failed to fetch display name - User ID: ' + userId + ', Error: ' + response.getContentText());
    return userId;
  }

  const data = JSON.parse(response.getContentText());
  const name = data.displayName || userId;
  CACHE.put(cacheKey, name, 21600); // Cache for 6 hours
  Logger.log('Display name fetched - User ID: ' + userId + ', Display Name: ' + name);
  return name;
}

/**
 * Fetches and caches the group name for a LINE group.
 *
 * @param {string} groupId
 * @return {string}
 */
function getGroupName_(groupId) {
  const cacheKey = 'groupName:' + groupId;
  const cached = CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!CHANNEL_ACCESS_TOKEN) {
    Logger.log('No access token to fetch group name - Group ID: ' + groupId);
    return groupId;
  }

  const url = 'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/summary';
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Failed to fetch group name - Group ID: ' + groupId + ', Error: ' + response.getContentText());
    return groupId;
  }

  const data = JSON.parse(response.getContentText());
  const name = data.groupName || groupId;
  CACHE.put(cacheKey, name, 21600); // cache for 6 hours
  return name;
}

/**
 * Fetches group name and display name in parallel using UrlFetchApp.fetchAll.
 * Falls back to cached values or IDs if API calls fail.
 *
 * @param {string} groupId LINE group ID.
 * @param {string} userId LINE user ID.
 * @return {{groupName: string, displayName: string}}
 */
function fetchNamesInParallel_(groupId, userId) {
  const groupCacheKey = 'groupName:' + groupId;
  const userCacheKey = groupId + ':' + userId;
  
  const cachedGroupName = CACHE.get(groupCacheKey);
  const cachedDisplayName = CACHE.get(userCacheKey);
  
  // If both are cached, return immediately
  if (cachedGroupName && cachedDisplayName) {
    Logger.log('Both names from cache - Group: ' + cachedGroupName + ', User: ' + cachedDisplayName);
    return { groupName: cachedGroupName, displayName: cachedDisplayName };
  }
  
  if (!CHANNEL_ACCESS_TOKEN) {
    Logger.log('No access token for parallel fetch');
    return { 
      groupName: cachedGroupName || groupId, 
      displayName: cachedDisplayName || userId 
    };
  }
  
  const requests = [];
  const requestMap = {}; // Track which request is for what
  
  if (!cachedGroupName) {
    requests.push({
      url: 'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/summary',
      method: 'get',
      headers: { Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN },
      muteHttpExceptions: true
    });
    requestMap[requests.length - 1] = 'group';
  }
  
  if (!cachedDisplayName) {
    requests.push({
      url: 'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/member/' + encodeURIComponent(userId),
      method: 'get',
      headers: { Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN },
      muteHttpExceptions: true
    });
    requestMap[requests.length - 1] = 'user';
  }
  
  let groupName = cachedGroupName || groupId;
  let displayName = cachedDisplayName || userId;
  
  if (requests.length > 0) {
    const responses = UrlFetchApp.fetchAll(requests);
    
    for (var i = 0; i < responses.length; i++) {
      const response = responses[i];
      const type = requestMap[i];
      
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        
        if (type === 'group') {
          groupName = data.groupName || groupId;
          CACHE.put(groupCacheKey, groupName, 21600);
          Logger.log('Group name fetched in parallel: ' + groupName);
        } else if (type === 'user') {
          displayName = data.displayName || userId;
          CACHE.put(userCacheKey, displayName, 21600);
          Logger.log('Display name fetched in parallel: ' + displayName);
        }
      } else {
        Logger.log('Parallel fetch failed for ' + type + ': ' + response.getContentText());
      }
    }
  }
  
  return { groupName: groupName, displayName: displayName };
}

/**
 * Ensures the sheet contains the header row and returns it.
 *
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSummarySheet_() {
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID is not configured in Script Properties.');
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SUMMARY_SHEET_NAME);
  }
  ensureSummaryHeader_(sheet);
  return sheet;
}

/**
 * Makes sure the first row of the summary sheet always contains the required
 * header values. If the sheet was cleared manually, this repopulates the base
 * columns before we attempt to write counts.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureSummaryHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['User ID', 'Display Name']);
    return;
  }

  const lastColumn = Math.max(sheet.getLastColumn(), 2);
  const headerValues = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  if (headerValues[0] !== 'User ID') {
    sheet.getRange(1, 1).setValue('User ID');
  }

  if (headerValues[1] !== 'Display Name') {
    sheet.getRange(1, 2).setValue('Display Name');
  }
}

/**
 * Returns the bot's display name from script properties or the LINE Bot Info API.
 *
 * @return {string}
 */
function getBotDisplayName_() {
  const cacheKey = 'botDisplayName';
  const cached = CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (BOT_DISPLAY_NAME) {
    CACHE.put(cacheKey, BOT_DISPLAY_NAME, 21600);
    return BOT_DISPLAY_NAME;
  }

  if (!CHANNEL_ACCESS_TOKEN) {
    Logger.log('Cannot fetch bot display name: missing LINE access token.');
    return '';
  }

  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Failed to fetch bot display name: ' + response.getContentText());
    return '';
  }

  const data = JSON.parse(response.getContentText());
  const name = data.displayName || '';
  if (name) {
    CACHE.put(cacheKey, name, 21600);
  }
  return name;
}

/**
 * Checks if the incoming message explicitly mentions the bot.
 *
 * @param {GoogleAppsScript.Events.MessageEvent.TextMessage} message
 * @param {string} botUserId LINE bot user ID (payload.destination).
 * @param {string} botDisplayName Bot display name fallback for text-based mention.
 * @return {boolean}
 */
function isBotMentioned_(message, botUserId, botDisplayName) {
  if (!message || message.type !== 'text') {
    return false;
  }

  if (message.mention && message.mention.mentionees && message.mention.mentionees.length) {
    for (var i = 0; i < message.mention.mentionees.length; i++) {
      const mentionee = message.mention.mentionees[i];
      if (mentionee.userId && botUserId && mentionee.userId === botUserId) {
        return true;
      }
      if (mentionee.type && mentionee.type.toLowerCase() === 'bot') {
        return true;
      }
    }
  }

  if (botDisplayName && message.text.indexOf('@' + botDisplayName) !== -1) {
    return true;
  }

  return false;
}

/**
 * Parses a month report command (e.g. "11月發話" or "11月發話量統計") from text.
 *
 * @param {string} text
 * @param {number} timestampMs Event timestamp in milliseconds.
 * @return {{monthKey: string, monthLabel: string}|null}
 */
function extractMonthCommand_(text, timestampMs) {
  if (!text) {
    return null;
  }

  const match = text.match(/(\d{1,2})\s*月\s*發話(?:量統計?|量)?/);
  if (!match) {
    return null;
  }

  const monthNumber = Number(match[1]);
  if (!monthNumber || monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const baseDate = timestampMs ? new Date(timestampMs) : new Date();
  const monthKey = Utilities.formatDate(new Date(baseDate.getFullYear(), monthNumber - 1, 1), TIMEZONE, 'yyyy-MM');
  return {
    monthKey: monthKey,
    monthLabel: monthNumber + '月'
  };
}

/**
 * Normalizes a header cell value so we can reliably compare stored month
 * labels even if Sheets auto-formats them as dates.
 *
 * @param {*} value
 * @return {string}
 */
function normalizeHeaderValue_(value) {
  if (value === null || value === '') {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM');
  }

  return String(value).trim();
}

/**
 * Increments the message count for a given user and month.
 * Optimized: Only writes to per-group monthly sheet, skips MonthlySummary for better performance.
 * MonthlySummary can be rebuilt later using rebuildSummaryFromGroupSheets() if needed.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The summary sheet (used to get parent spreadsheet).
 * @param {string} monthKey Month identifier in yyyy-MM format.
 * @param {string} userId LINE user ID.
 * @param {string} displayName User display name.
 * @param {{groupId: string, groupName: string}=} options Additional options for per-group sheets.
 */
function incrementMessageCount_(sheet, monthKey, userId, displayName, options) {
  // 只寫入 per-group sheet，跳過 MonthlySummary 以提升效能
  if (options && options.groupId) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    
    try {
      incrementGroupMonthlyCount_(
        sheet.getParent(),
        options.groupId,
        options.groupName || options.groupId,
        monthKey,
        userId,
        displayName
      );
    } finally {
      lock.releaseLock();
    }
  }
}

/**
 * [DEPRECATED] Original function that writes to both MonthlySummary and per-group sheets.
 * Use this if you need to maintain MonthlySummary data.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The summary sheet.
 * @param {string} monthKey Month identifier in yyyy-MM format.
 * @param {string} userId LINE user ID.
 * @param {string} displayName User display name.
 * @param {{groupId: string, groupName: string}=} options Additional options for per-group sheets.
 */
function incrementMessageCountWithSummary_(sheet, monthKey, userId, displayName, options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    ensureSummaryHeader_(sheet);

    const lastColumn = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    
    // 批次讀取所有資料
    const allData = lastRow > 1 
      ? sheet.getRange(1, 1, lastRow, lastColumn).getValues()
      : [sheet.getRange(1, 1, 1, lastColumn).getValues()[0]];
    
    const headers = allData[0];
    const normalizedHeaders = headers.map(normalizeHeaderValue_);

    let monthColumnIndex = normalizedHeaders.indexOf(monthKey) + 1;
    if (monthColumnIndex === 0) {
      monthColumnIndex = lastColumn + 1;
      const headerRange = sheet.getRange(1, monthColumnIndex);
      headerRange.setNumberFormat('@');
      headerRange.setValue(monthKey);
    }

    // 找使用者 row
    let rowIndex = -1;
    let currentDisplayName = '';
    let currentCount = 0;
    
    for (var i = 1; i < allData.length; i++) {
      if (allData[i][0] === userId) {
        rowIndex = i + 1;
        currentDisplayName = allData[i][1];
        currentCount = (monthColumnIndex <= allData[i].length) 
          ? Number(allData[i][monthColumnIndex - 1]) || 0 
          : 0;
        break;
      }
    }

    if (rowIndex === -1) {
      // 新使用者
      rowIndex = lastRow + 1;
      const newRow = [userId, displayName];
      // 填充到月份欄位
      while (newRow.length < monthColumnIndex - 1) {
        newRow.push('');
      }
      newRow.push(1);
      sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
    } else {
      // 現有使用者
      const updates = [];
      
      if (displayName && currentDisplayName !== displayName) {
        sheet.getRange(rowIndex, 2).setValue(displayName);
      }
      
      sheet.getRange(rowIndex, monthColumnIndex).setValue(currentCount + 1);
    }

    if (options && options.groupId) {
      incrementGroupMonthlyCount_(
        sheet.getParent(),
        options.groupId,
        options.groupName || options.groupId,
        monthKey,
        userId,
        displayName
      );
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Utility to return a text response with custom HTTP status code.
 *
 * @param {number} status HTTP status code.
 * @param {string} message Response message.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function createResponse_(status, message) {
  // Apps Script web apps always return HTTP 200, so we include the status in the payload instead.
  const payload = JSON.stringify({ status: status, message: message });
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Backfill helper that recalculates the summary sheet from a raw log sheet.
 * The raw log sheet is optional but can be used for debugging or reprocessing
 * historical data.
 */
function rebuildSummaryFromLogs() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const logSheet = spreadsheet.getSheetByName('RawLogs');
  if (!logSheet) {
    throw new Error('RawLogs sheet does not exist.');
  }

  const summarySheet = getSummarySheet_();
  summarySheet.clear();
  summarySheet.appendRow(['User ID', 'Display Name']);

  const data = logSheet.getDataRange().getValues();
  if (data.length <= 1) {
    return;
  }

  const header = data[0];
  const userIdIndex = header.indexOf('User ID');
  const displayNameIndex = header.indexOf('Display Name');
  const monthIndex = header.indexOf('Month');
  const countIndex = header.indexOf('Count');

  if (userIdIndex === -1 || displayNameIndex === -1 || monthIndex === -1 || countIndex === -1) {
    throw new Error('RawLogs sheet must contain columns: User ID, Display Name, Month, Count');
  }

  const aggregated = {};
  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const key = row[userIdIndex];
    const name = row[displayNameIndex];
    const month = row[monthIndex];
    const count = Number(row[countIndex]) || 0;

    if (!aggregated[key]) {
      aggregated[key] = { name: name, counts: {} };
    }
    aggregated[key].counts[month] = (aggregated[key].counts[month] || 0) + count;
  }

  Object.keys(aggregated).forEach(function(userId) {
    const info = aggregated[userId];
    Object.keys(info.counts).forEach(function(month) {
      incrementMessageCountWithSummary_(summarySheet, month, userId, info.name);
      const cell = summarySheet.getRange(findRow_(summarySheet, userId), findColumn_(summarySheet, month));
      cell.setValue(info.counts[month]);
    });
  });
}

/**
 * Rebuilds the MonthlySummary sheet from all per-group monthly sheets.
 * Use this function if you need to regenerate the summary after using the
 * optimized incrementMessageCount_ that skips summary updates.
 */
function rebuildSummaryFromGroupSheets() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const summarySheet = getSummarySheet_();
  summarySheet.clear();
  summarySheet.appendRow(['User ID', 'Display Name']);

  const sheets = spreadsheet.getSheets();
  const groupSheetPattern = /-\d{2}-\d{2}$/; // Matches sheets ending with -YY-MM

  const aggregated = {};

  sheets.forEach(function(sheet) {
    const sheetName = sheet.getName();
    if (!groupSheetPattern.test(sheetName)) {
      return;
    }

    // Extract month from sheet name (last 5 chars are -YY-MM)
    const suffix = sheetName.slice(-5);
    const yearSuffix = suffix.substring(0, 2);
    const monthPart = suffix.substring(3, 5);
    const monthKey = '20' + yearSuffix + '-' + monthPart;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return;
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    data.forEach(function(row) {
      const userId = row[0];
      const displayName = row[1];
      const count = Number(row[2]) || 0;

      if (!userId) {
        return;
      }

      if (!aggregated[userId]) {
        aggregated[userId] = { displayName: displayName, months: {} };
      }

      if (!aggregated[userId].months[monthKey]) {
        aggregated[userId].months[monthKey] = 0;
      }
      aggregated[userId].months[monthKey] += count;

      // Update display name to the latest
      if (displayName) {
        aggregated[userId].displayName = displayName;
      }
    });
  });

  // Write aggregated data to summary sheet
  const allMonths = new Set();
  Object.keys(aggregated).forEach(function(userId) {
    Object.keys(aggregated[userId].months).forEach(function(month) {
      allMonths.add(month);
    });
  });

  const sortedMonths = Array.from(allMonths).sort();

  // Write header
  if (sortedMonths.length > 0) {
    const headerRow = ['User ID', 'Display Name'].concat(sortedMonths);
    summarySheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
  }

  // Write data rows
  const userIds = Object.keys(aggregated);
  if (userIds.length > 0) {
    const dataRows = userIds.map(function(userId) {
      const userData = aggregated[userId];
      const row = [userId, userData.displayName];
      sortedMonths.forEach(function(month) {
        row.push(userData.months[month] || 0);
      });
      return row;
    });
    summarySheet.getRange(2, 1, dataRows.length, dataRows[0].length).setValues(dataRows);
  }

  Logger.log('Summary rebuilt from ' + Object.keys(aggregated).length + ' users across ' + sortedMonths.length + ' months.');
}

function findRow_(sheet, userId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return -1;
  }

  const userIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < userIds.length; i++) {
    if (userIds[i][0] === userId) {
      return i + 2;
    }
  }
  return -1;
}

function findColumn_(sheet, monthKey) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 3) {
    return -1;
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (normalizeHeaderValue_(headers[i]) === monthKey) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Ensures the per-group monthly sheet is created and returns it.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} groupId
 * @param {string} groupName
 * @param {string} monthKey yyyy-MM
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getGroupMonthSheet_(spreadsheet, groupId, groupName, monthKey) {
  const sheetName = getGroupMonthSheetName_(groupId, groupName, monthKey);

  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  ensureGroupMonthHeader_(sheet);
  return sheet;
}

/**
 * Makes sure a per-group monthly sheet has the expected header row.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureGroupMonthHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['User ID', 'Display Name', 'Count']);
    return;
  }

  const lastColumn = Math.max(sheet.getLastColumn(), 3);
  const headerValues = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  if (headerValues[0] !== 'User ID') {
    sheet.getRange(1, 1).setValue('User ID');
  }

  if (headerValues[1] !== 'Display Name') {
    sheet.getRange(1, 2).setValue('Display Name');
  }

  if (headerValues[2] !== 'Count') {
    sheet.getRange(1, 3).setValue('Count');
  }
}

/**
 * Increments the per-group monthly count for a user.
 * Optimized with batch read to minimize API calls.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} groupId
 * @param {string} groupName
 * @param {string} monthKey yyyy-MM
 * @param {string} userId
 * @param {string} displayName
 */
function incrementGroupMonthlyCount_(spreadsheet, groupId, groupName, monthKey, userId, displayName) {
  const sheet = getGroupMonthSheet_(spreadsheet, groupId, groupName, monthKey);
  const lastRow = sheet.getLastRow();
  const dataRowCount = Math.max(lastRow - 1, 0);
  
  // 一次讀取所有資料（User ID, Display Name, Count）
  const allData = dataRowCount > 0 
    ? sheet.getRange(2, 1, dataRowCount, 3).getValues() 
    : [];

  let rowIndex = -1;
  let currentCount = 0;
  let currentDisplayName = '';
  
  for (var i = 0; i < allData.length; i++) {
    if (allData[i][0] === userId) {
      rowIndex = i + 2;
      currentDisplayName = allData[i][1];
      currentCount = Number(allData[i][2]) || 0;
      break;
    }
  }

  if (rowIndex === -1) {
    // 新使用者：一次寫入整行
    rowIndex = lastRow + 1;
    sheet.getRange(rowIndex, 1, 1, 3).setValues([[userId, displayName, 1]]);
  } else {
    // 現有使用者：只更新需要更新的欄位
    const newCount = currentCount + 1;
    
    if (displayName && currentDisplayName !== displayName) {
      // 更新 displayName 和 count
      sheet.getRange(rowIndex, 2, 1, 2).setValues([[displayName, newCount]]);
    } else {
      // 只更新 count
      sheet.getRange(rowIndex, 3).setValue(newCount);
    }
  }
}

/**
 * Converts arbitrary text to a sheet-safe name.
 *
 * @param {string} rawName
 * @return {string}
 */
function sanitizeSheetName_(rawName) {
  let name = (rawName || '').replace(/[\[\]\*\/\\\?:]/g, '-').trim();
  if (!name) {
    name = 'Group';
  }
  if (name.length > 80) {
    name = name.substring(0, 80);
  }
  return name;
}

/**
 * Formats the sheet suffix (yy-MM) based on the yyyy-MM month key.
 *
 * @param {string} monthKey
 * @return {string}
 */
function formatMonthSuffix_(monthKey) {
  const parts = String(monthKey || '').split('-');
  if (parts.length >= 2) {
    const year = parts[0].slice(-2);
    const month = parts[1];
    return year + '-' + month;
  }
  return String(monthKey || '');
}

/**
 * Generates the sheet name for a group-month worksheet.
 *
 * @param {string} groupId
 * @param {string} groupName
 * @param {string} monthKey yyyy-MM
 * @return {string}
 */
function getGroupMonthSheetName_(groupId, groupName, monthKey) {
  const sanitizedGroupName = sanitizeSheetName_(groupName || groupId);
  const sheetSuffix = formatMonthSuffix_(monthKey);
  return sanitizedGroupName + '-' + sheetSuffix;
}

/**
 * Returns the sheet for a specific group-month if it already exists.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} groupId
 * @param {string} groupName
 * @param {string} monthKey yyyy-MM
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function findGroupMonthSheet_(spreadsheet, groupId, groupName, monthKey) {
  const sheetName = getGroupMonthSheetName_(groupId, groupName, monthKey);
  return spreadsheet.getSheetByName(sheetName);
}

/**
 * Builds the monthly report text for a specific group and month.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} groupId
 * @param {string} groupName
 * @param {{monthKey: string, monthLabel: string}} command
 * @return {string}
 */
function buildMonthlyReport_(spreadsheet, groupId, groupName, command) {
  const title = command.monthLabel + '發話量統計\n本發話量bot仍在測試中，僅供參考\n請以管管po的統計為準';
  const sheet = findGroupMonthSheet_(spreadsheet, groupId, groupName, command.monthKey);

  if (!sheet || sheet.getLastRow() < 2) {
    return title + '\n尚無資料';
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const rows = data
    .map(function(row) {
      return {
        name: row[1] || row[0] || '',
        count: Number(row[2]) || 0
      };
    })
    .filter(function(row) { return row.name && row.count > 0; });

  if (!rows.length) {
    return title + '\n尚無資料';
  }

  rows.sort(function(a, b) { return b.count - a.count; });
  const lines = rows.map(function(row) { return row.name + ' ' + row.count; });
  const responseText = title + '\n' + lines.join('\n');

  // LINE message size limit is 5000 characters.
  return responseText.length > 5000 ? responseText.substring(0, 5000) : responseText;
}

/**
 * Replies to a LINE message with plain text.
 *
 * @param {string} replyToken
 * @param {string} text
 */
function replyMessage_(replyToken, text) {
  if (!replyToken || !text) {
    return;
  }

  if (!CHANNEL_ACCESS_TOKEN) {
    Logger.log('Cannot reply: LINE_ACCESS_TOKEN is not configured.');
    return;
  }

  const payload = {
    replyToken: replyToken,
    messages: [
      {
        type: 'text',
        text: text.length > 5000 ? text.substring(0, 5000) : text
      }
    ]
  };

  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 300) {
    Logger.log('Failed to reply message: ' + response.getContentText());
  }
}

/**
 * Test function for doPost with mock LINE webhook data.
 * Uses actual LINE webhook structure based on real received data.
 */
function testDoPost() {
  Logger.log('=== Testing doPost ===');
  
  // Clear the summary sheet first for clean test
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let summarySheet = spreadsheet.getSheetByName(SUMMARY_SHEET_NAME);
  if (summarySheet) {
    summarySheet.clear();
    summarySheet.appendRow(['User ID', 'Display Name']);
  } else {
    summarySheet = getSummarySheet_();
  }
  
  // Mock event object matching actual LINE webhook structure
  const mockEvent = {
    parameter: {},
    postData: {
      contents: JSON.stringify({
        destination: "U3c7eadfa1e1093ded37b060bee7c4853",
        events: [
          {
            type: "message",
            message: {
              type: "text",
              id: "586506442824221068",
              text: "Test message 1",
            },
            webhookEventId: "01K9C37QWSYJ84QP35QS1H8BC5",
            deliveryContext: {
              isRedelivery: false,
            },
            timestamp: new Date("2025-11-06T08:06:29").getTime(),
            source: {
              type: "group",
              groupId: "C188bc0b118cb5b9893900e910dcd6d55",
              userId: "U96a9f442f7cb89bde1099eda991294c2",
            },
            replyToken: "27f0e1369ac74bd780a98191cedbc688",
            mode: "active",
          },
          {
            type: "message",
            message: {
              type: "text",
              id: "586506442824221069",
              text: "Test message 2",
            },
            webhookEventId: "01K9C37QWSYJ84QP35QS1H8BC6",
            deliveryContext: {
              isRedelivery: false,
            },
            timestamp: new Date("2025-10-15T10:30:00").getTime(),
            source: {
              type: "group",
              groupId: "C188bc0b118cb5b9893900e910dcd6d55",
              userId: "U96a9f442f7cb89bde1099eda991294c2",
            },
            replyToken: "27f0e1369ac74bd780a98191cedbc689",
            mode: "active",
          },
        ],
      }),
      length: 846,
      name: "postData",
      type: "application/json",
    },
    contextPath: "",
    queryString: "",
    contentLength: 846,
    parameters: {},
  };

  // Call doPost with mock data
  Logger.log('Calling doPost with mock webhook data...');
  const response = doPost(mockEvent);
  Logger.log('Response: ' + response.getContent());
  
  Logger.log('Test completed successfully!');
}

/**
 * Test function for rebuildSummaryFromLogs with mock raw log data.
 * Creates a temporary RawLogs sheet with fake data for testing.
 */
function testRebuildSummaryFromLogs() {
  Logger.log('=== Testing rebuildSummaryFromLogs ===');
  
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // Create or clear RawLogs sheet
  let logSheet = spreadsheet.getSheetByName('RawLogs');
  if (!logSheet) {
    logSheet = spreadsheet.insertSheet('RawLogs');
  } else {
    logSheet.clear();
  }
  
  // Add header and mock data
  logSheet.appendRow(['User ID', 'Display Name', 'Month', 'Count']);
  logSheet.appendRow(['test-user-001', 'Alice', '2025-10', 5]);
  logSheet.appendRow(['test-user-001', 'Alice', '2025-11', 3]);
  logSheet.appendRow(['test-user-002', 'Bob', '2025-10', 7]);
  logSheet.appendRow(['test-user-002', 'Bob', '2025-11', 2]);
  logSheet.appendRow(['test-user-003', 'Charlie', '2025-11', 10]);
  
  Logger.log('Created RawLogs sheet with test data');
  
  // Run the rebuild function
  rebuildSummaryFromLogs();
  
  Logger.log('Rebuild completed. Check the MonthlySummary sheet.');
  Logger.log('Expected results:');
  Logger.log('- Alice (test-user-001): 5 messages in 2025-10, 3 in 2025-11');
  Logger.log('- Bob (test-user-002): 7 messages in 2025-10, 2 in 2025-11');
  Logger.log('- Charlie (test-user-003): 10 messages in 2025-11');
}

/**
 * Run all tests. Executes both test functions in sequence.
 */
function runAllTests() {
  Logger.log('========================================');
  Logger.log('Running all tests...');
  Logger.log('========================================');
  
  testDoPost();
  Logger.log('');
  testRebuildSummaryFromLogs();
  
  Logger.log('========================================');
  Logger.log('All tests completed!');
  Logger.log('========================================');
}
