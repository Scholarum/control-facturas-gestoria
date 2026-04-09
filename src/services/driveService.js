const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const { Readable } = require('stream');

const ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || '1bJjT-9q4jca4vkhmGNGKyHj7mmFlLjr9';

async function buildDriveClient() {
  let auth;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    // Credenciales como JSON string en variable de entorno (Render, etc.)
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const tmpPath = path.join(os.tmpdir(), 'gcp-credentials.json');
    fs.writeFileSync(tmpPath, Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64'));
    auth = new google.auth.GoogleAuth({
      keyFile: tmpPath,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else {
    auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(__dirname, '../../credentials..json'),
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  }

  return google.drive({ version: 'v3', auth });
}

// ─── Listar carpetas del directorio raíz ─────────────────────────────────────

async function listarCarpetasRaiz(drive) {
  const rootId = ROOT_FOLDER_ID;
  const items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q:         `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields:    'nextPageToken, files(id, name, createdTime)',
      pageSize:  1000,
      orderBy:   'name',
      pageToken,
    });
    items.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

// ─── Contar archivos dentro de una carpeta ───────────────────────────────────

async function contarArchivosCarpeta(drive, folderId) {
  const res = await drive.files.list({
    q:      `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: 'files(id)',
    pageSize: 1000,
  });
  return (res.data.files || []).length;
}

// ─── Crear carpeta de proveedor en el raíz de Drive ──────────────────────────

async function crearCarpeta(drive, nombreCarpeta) {
  const rootId = ROOT_FOLDER_ID;
  const res = await drive.files.create({
    requestBody: {
      name:     nombreCarpeta,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [rootId],
    },
    fields: 'id, name, createdTime',
  });
  return res.data;
}

// ─── Subir archivo a una carpeta de Drive ────────────────────────────────────

async function subirArchivo(drive, folderId, nombreArchivo, buffer, mimeType) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name:    nombreArchivo,
      parents: [folderId],
    },
    media: {
      mimeType: mimeType || 'application/pdf',
      body:     stream,
    },
    fields: 'id, name, createdTime',
  });
  return res.data;
}

// ─── Obtener nombre de carpeta por ID ────────────────────────────────────────

async function obtenerCarpeta(drive, folderId) {
  const res = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, parents',
  });
  return res.data;
}

module.exports = {
  buildDriveClient,
  listarCarpetasRaiz,
  contarArchivosCarpeta,
  crearCarpeta,
  subirArchivo,
  obtenerCarpeta,
  ROOT_FOLDER_ID,
};
