/* Windows desktop host. The renderer has no Node or filesystem privileges. */
'use strict';

const { app, BrowserWindow, dialog, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18768; // Keep the origin stable: presets live in origin-scoped localStorage.
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
let mainWindow = null;
let server = null;
let approvedDevices = [];
let discoveryVendorIds = [];
const selectedDevices = new Set(); // Explicitly selected interfaces, valid for this process only.

function isAllowedDevice(device) {
  return approvedDevices.some(entry => entry.vendorId === device.vendorId && entry.productId === device.productId);
}

function isSelectableDevice(device) {
  // Both metadata discovery and the original manufacturer's connection picker
  // require explicit user selection. DeviceController enforces the configured
  // manufacturer/registered policy and the output Report 75 interface.
  return isAllowedDevice(device) || discoveryVendorIds.includes(device.vendorId);
}

function trustedUrl(value) {
  try { return new URL(value).origin === ORIGIN; } catch { return false; }
}

function trustedContents(contents) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents);
}

async function readDeviceConfiguration() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'device-config.json'), 'utf8'));
  if (config.version !== 1 || !Array.isArray(config.devices)) throw new Error('장치 설정 파일의 형식이 올바르지 않습니다.');
  approvedDevices = config.devices.map(entry => {
    if (![entry.vendorId, entry.productId].every(value => Number.isInteger(value) && value >= 0 && value <= 65535)) {
      throw new Error('장치 설정에는 제조사가 확인한 정확한 VID/PID 정수가 필요합니다.');
    }
    return { vendorId: entry.vendorId, productId: entry.productId };
  });
  if (config.discoveryVendorIds !== undefined && !Array.isArray(config.discoveryVendorIds)) throw new Error('장치 검색 설정의 형식이 올바르지 않습니다.');
  discoveryVendorIds = [...new Set(config.discoveryVendorIds || [])];
  if (!discoveryVendorIds.every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error('장치 검색에는 유효한 제조사 ID가 필요합니다.');
}

async function startLocalServer() {
  const realRoot = await fs.realpath(ROOT);
  server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'");
    if (request.headers.host !== `127.0.0.1:${PORT}` || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(403).end('Forbidden'); return;
    }
    try {
      const requested = decodeURIComponent(new URL(request.url, ORIGIN).pathname);
      const asset = requested === '/' ? 'index.html' : requested.slice(1);
      // Only ship frontend assets. Never expose repository metadata, docs, or Node scripts.
      const rootAsset = ['index.html', 'style.css', 'app.js', 'device-config.json', 'favicon.svg'].includes(asset);
      const moduleAsset = /^(src|sdk|assets)\//.test(asset) && ['.js', '.mjs', '.css', '.svg', '.png', '.woff2', '.json'].includes(path.extname(asset));
      if ((!rootAsset && !moduleAsset) || asset.split(/[\\/]/).some(part => part === '..' || part.startsWith('.'))) {
        response.writeHead(404).end('Not found'); return;
      }
      const target = await fs.realpath(path.join(ROOT, asset));
      if (!target.startsWith(realRoot + path.sep)) { response.writeHead(403).end('Forbidden'); return; }
      const content = await fs.readFile(target);
      response.setHeader('Content-Type', MIME[path.extname(target)] || 'application/octet-stream');
      response.writeHead(200);
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

function configurePermissions() {
  const appSession = session.fromPartition('persist:azla-equalizer');
  appSession.setPermissionCheckHandler((contents, permission, origin, details) => (
    trustedContents(contents) && permission === 'hid' && details.isMainFrame && trustedUrl(origin)
  ));
  appSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(trustedContents(contents) && permission === 'hid' && details.isMainFrame && trustedUrl(details.requestingUrl));
  });
  appSession.setDevicePermissionHandler(details => (
    details.deviceType === 'hid' && trustedUrl(details.origin) && isSelectableDevice(details.device) && selectedDevices.has(details.device.deviceId)
  ));
  appSession.on('select-hid-device', async (event, details, callback) => {
    event.preventDefault();
    if (!mainWindow || details.frame !== mainWindow.webContents.mainFrame || !trustedUrl(details.frame.url)) {
      callback(''); return;
    }
    const devices = details.deviceList.filter(isSelectableDevice);
    if (!devices.length) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'AZLA Equalizer', message: '선택 가능한 기기를 찾지 못했습니다.',
        detail: '기기의 USB 연결을 확인한 후 다시 시도해 주세요. 미등록 제품은 설정에서 기기 정보를 확인할 수 있습니다.', buttons: ['확인']
      });
      callback(''); return;
    }
    try {
      const labels = devices.map((device, index) => `${index + 1}. ${String(device.name || 'AZLA USB DAC').replace(/&/g, '&&')}`);
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'AZLA 기기 선택', message: '사용할 기기를 선택하세요.',
        detail: '사용 중인 AZLA USB DAC를 선택해 주세요. EQ 적용을 누를 때만 현재 설정을 기록합니다.',
        buttons: [...labels, '취소'], cancelId: devices.length, defaultId: devices.length, noLink: true
      });
      if (result.response < devices.length) {
        const selected = devices[result.response];
        selectedDevices.add(selected.deviceId);
        callback(selected.deviceId);
      } else callback('');
    } catch { callback(''); }
  });
  appSession.on('hid-device-revoked', (_event, details) => {
    if (trustedUrl(details.origin)) selectedDevices.delete(details.device.deviceId);
  });
  return appSession;
}

function createWindow(appSession) {
  mainWindow = new BrowserWindow({
    width: 1512, height: 960, minWidth: 1100, minHeight: 720,
    title: 'AZLA Equalizer', backgroundColor: '#F0EEE9', show: false, autoHideMenuBar: true,
    webPreferences: { session: appSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false }
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!trustedUrl(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(ORIGIN);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    await readDeviceConfiguration();
    await startLocalServer();
    createWindow(configurePermissions());
  }).catch(error => {
    dialog.showErrorBox('AZLA Equalizer 실행 오류', error.code === 'EADDRINUSE'
      ? '앱이 사용하는 로컬 포트(18768)가 이미 사용 중입니다. 이전 앱을 종료한 뒤 다시 실행하세요.'
      : '앱 초기화에 실패했습니다. 장치 설정 파일과 설치 상태를 확인하세요.\n' + error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (server) server.close(); });
}
