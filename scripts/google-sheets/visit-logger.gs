/**
 * Google Sheets visit logger for JENDO Poson AR
 *
 * Setup:
 * 1. New Google Sheet → name sheet tab "Visits"
 * 2. Row 1 headers (or run setupSheet once):
 *    Timestamp | Event | Page | Exp | Session | Email | Name | Referrer | Language | Screen | Platform | UserAgent | Full URL
 * 3. Extensions → Apps Script → paste this file
 * 4. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone
 * 5. Copy Web app URL into public/js/visit-config.js → webhookUrl
 */

const SHEET_NAME = 'Visits';

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  sheet.clear();
  sheet.appendRow([
    'Timestamp', 'Event', 'Page', 'Exp', 'Session', 'Email', 'Name',
    'Referrer', 'Language', 'Screen', 'Platform', 'UserAgent', 'Full URL',
  ]);
  sheet.setFrozenRows(1);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
      || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.event || 'page_view',
      data.page || '',
      data.exp || '',
      data.sessionId || '',
      data.email || '',
      data.name || '',
      data.referrer || '',
      data.language || '',
      data.screen || '',
      data.platform || '',
      data.userAgent || '',
      data.fullUrl || '',
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput('JENDO AR visit logger is running.')
    .setMimeType(ContentService.MimeType.TEXT);
}
