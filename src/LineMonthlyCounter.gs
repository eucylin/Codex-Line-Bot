const TIMEZONE = 'Asia/Taipei';
const SUMMARY_SHEET_NAME = 'MonthlySummary';

const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
const SPREADSHEET_ID = SCRIPT_PROPERTIES.getProperty('SPREADSHEET_ID');
const CHANNEL_ACCESS_TOKEN = SCRIPT_PROPERTIES.getProperty('LINE_ACCESS_TOKEN');
const CACHE = CacheService.getScriptCache();

/**
 * Entry point for LINE webhook calls. Handles message events and updates the
 * monthly summary sheet with message counts per user.
 *
 * @param {GoogleAppsScript.Events.DoPost} e Incoming webhook payload.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return createResponse_(400, 'Invalid request');
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (error) {
    Logger.log('Failed to parse payload: ' + error);
    return createResponse_(400, 'Bad request');
  }

  if (!payload.events || !payload.events.length) {
    return createResponse_(200, 'No events');
  }

  const sheet = getSummarySheet_();

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

    const timestamp = new Date(event.timestamp);
    const monthKey = Utilities.formatDate(timestamp, TIMEZONE, 'yyyy-MM');
    const displayName = getDisplayName_(groupId, userId);

    incrementMessageCount_(sheet, monthKey, userId, displayName);
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
    return cached;
  }

  if (!CHANNEL_ACCESS_TOKEN) {
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
    Logger.log('Failed to fetch display name: ' + response.getContentText());
    return userId;
  }

  const data = JSON.parse(response.getContentText());
  const name = data.displayName || userId;
  CACHE.put(cacheKey, name, 21600); // Cache for 6 hours
  return name;
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
    sheet.appendRow(['User ID', 'Display Name']);
  }
  return sheet;
}

/**
 * Increments the message count for a given user and month in the summary sheet.
 * Adds the month column or user row when necessary.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet The summary sheet.
 * @param {string} monthKey Month identifier in yyyy-MM format.
 * @param {string} userId LINE user ID.
 * @param {string} displayName User display name.
 */
function incrementMessageCount_(sheet, monthKey, userId, displayName) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  let monthColumnIndex = headers.indexOf(monthKey) + 1;
  if (monthColumnIndex === 0) {
    monthColumnIndex = lastColumn + 1;
    sheet.getRange(1, monthColumnIndex).setValue(monthKey);
  }

  const userIds = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  let rowIndex = -1;
  for (var i = 0; i < userIds.length; i++) {
    if (userIds[i][0] === userId) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex === -1) {
    rowIndex = sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1).setValue(userId);
    sheet.getRange(rowIndex, 2).setValue(displayName);
  } else if (displayName && sheet.getRange(rowIndex, 2).getValue() !== displayName) {
    sheet.getRange(rowIndex, 2).setValue(displayName);
  }

  const cell = sheet.getRange(rowIndex, monthColumnIndex);
  const currentValue = Number(cell.getValue()) || 0;
  cell.setValue(currentValue + 1);
}

/**
 * Utility to return a text response with custom HTTP status code.
 *
 * @param {number} status HTTP status code.
 * @param {string} message Response message.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function createResponse_(status, message) {
  return ContentService.createTextOutput(message).setMimeType(ContentService.MimeType.TEXT).setResponseCode(status);
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
      incrementMessageCount_(summarySheet, month, userId, info.name);
      const cell = summarySheet.getRange(findRow_(summarySheet, userId), findColumn_(summarySheet, month));
      cell.setValue(info.counts[month]);
    });
  });
}

function findRow_(sheet, userId) {
  const userIds = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < userIds.length; i++) {
    if (userIds[i][0] === userId) {
      return i + 2;
    }
  }
  return -1;
}

function findColumn_(sheet, monthKey) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === monthKey) {
      return i + 1;
    }
  }
  return -1;
}
