const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');

async function buildDriveClient() {
  let keyFile;

  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    // Producción (Render): decodificar desde variable de entorno
    const tmpPath = path.join(os.tmpdir(), 'gcp-credentials.json');
    fs.writeFileSync(tmpPath, Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64'));
    keyFile = tmpPath;
  } else {
    // Desarrollo local: usar el fichero directamente
    keyFile = path.resolve(__dirname, '../../credentials..json');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

module.exports = { buildDriveClient };
