const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;
let serverModule;
let serverPort;

function seedUserData() {
  const sourceDir = path.resolve(__dirname, '../data');
  const targetDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(targetDir, { recursive: true });

  for (const fileName of ['users.json', 'activities.json']) {
    const source = path.join(sourceDir, fileName);
    const target = path.join(targetDir, fileName);
    if (!fs.existsSync(target) && fs.existsSync(source)) {
      fs.copyFileSync(source, target);
    }
  }

  process.env.CAMPUS_ACTIVITY_DATA_DIR = targetDir;
}

async function createWindow() {
  seedUserData();
  if (!serverModule) serverModule = require('../src/app');
  if (!serverPort) serverPort = await serverModule.startServer(0);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    title: '校园活动管理系统',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

function reportStartupError(error) {
  const message = error && (error.stack || error.message) ? (error.stack || error.message) : String(error);
  console.error(message);
  try {
    const logFile = path.join(app.getPath('userData'), 'startup-error.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (logError) { console.error('无法写入启动日志：' + logError.message); }
  dialog.showErrorBox('校园活动管理系统启动失败', `${message}\n\n详细信息已记录到 startup-error.log`);
  app.quit();
}

app.whenReady().then(createWindow).catch(reportStartupError);

app.on('window-all-closed', async () => {
  if (serverModule) await serverModule.stopServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
