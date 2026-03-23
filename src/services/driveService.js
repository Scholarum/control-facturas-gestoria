const { google } = require('googleapis');
const path       = require('path');

const CREDENTIALS_FILE = path.resolve(__dirname, '../../credentials..json');

async function buildDriveClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_FILE,
    scopes:  ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

module.exports = { buildDriveClient };
