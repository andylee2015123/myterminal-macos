import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ConnectionStore } from './connection-store';
import { PtyManager } from './pty-manager';
import type {
  ConnectionDraft,
  ConnectionExportResult,
  ConnectionImportResult,
  CreateSessionRequest
} from '../shared/types';

app.setName('MyTerminal');
configureDevSessionStorage();

const store = new ConnectionStore();
const ptyManager = new PtyManager(store);

function configureDevSessionStorage(): void {
  if (!process.env.ELECTRON_RENDERER_URL) {
    return;
  }

  process.env.MYTERMINAL_CONNECTIONS_DIR ||= path.join(app.getPath('appData'), app.getName());

  const cliProfilePath = getCommandLineSwitchValue('user-data-dir');
  const profilePath = cliProfilePath || path.join(app.getPath('temp'), 'MyTerminal', `electron-dev-profile-${process.pid}`);
  const sessionDataPath = path.join(profilePath, 'Session Data');
  const cachePath = getCommandLineSwitchValue('disk-cache-dir') || path.join(profilePath, 'Cache');

  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(cachePath, { recursive: true });

  if (!cliProfilePath) {
    app.setPath('userData', profilePath);
    app.commandLine.appendSwitch('user-data-dir', profilePath);
  }

  app.setPath('sessionData', sessionDataPath);
  if (!getCommandLineSwitchValue('disk-cache-dir')) {
    app.commandLine.appendSwitch('disk-cache-dir', cachePath);
  }
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('log-level', '3');
}

function getCommandLineSwitchValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function appIconPath(): string {
  return path.join(__dirname, '../../assets/app-icon.png');
}

function configureDockIcon(): void {
  if (process.platform === 'darwin') {
    app.dock.setIcon(appIconPath());
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'MyTerminal',
    icon: appIconPath(),
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('connections:list', () => store.list());
  ipcMain.handle('connections:save', (_event, draft: ConnectionDraft) => store.save(draft));
  ipcMain.handle('connections:delete', (_event, id: string) => store.delete(id));
  ipcMain.handle('connections:export-file', () => exportConnectionsFile());
  ipcMain.handle('connections:import-file', () => importConnectionsFile());
  ipcMain.handle('connections:import-ssh-config', () => store.importSshConfig());

  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle('dialog:pick-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile']
    });

    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle('folder:open', (_event, folderPath: string) => openFolder(folderPath));

  ipcMain.handle('sessions:create', (_event, request: CreateSessionRequest) => ptyManager.create(request));
  ipcMain.handle('sessions:write', (_event, sessionId: string, data: string) => ptyManager.write(sessionId, data));
  ipcMain.handle('sessions:resize', (_event, sessionId: string, cols: number, rows: number) =>
    ptyManager.resize(sessionId, cols, rows)
  );
  ipcMain.handle('sessions:close', (_event, sessionId: string) => ptyManager.close(sessionId));
}

async function exportConnectionsFile(): Promise<ConnectionExportResult | undefined> {
  const result = await dialog.showSaveDialog({
    title: 'Export connections',
    defaultPath: `myterminal-connections-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON files', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) {
    return undefined;
  }

  const count = await store.exportToFile(result.filePath);
  return { filePath: result.filePath, count };
}

async function importConnectionsFile(): Promise<ConnectionImportResult | undefined> {
  const result = await dialog.showOpenDialog({
    title: 'Import connections',
    properties: ['openFile'],
    filters: [{ name: 'JSON files', extensions: ['json'] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }

  const filePath = result.filePaths[0];
  const summary = await store.importFromFile(filePath);
  return { filePath, ...summary };
}

async function openFolder(folderPath: string): Promise<void> {
  const resolvedPath = path.resolve(folderPath);
  let folder;
  try {
    folder = await stat(resolvedPath);
  } catch {
    throw new Error('Local folder does not exist.');
  }

  if (!folder.isDirectory()) {
    throw new Error('Local folder does not exist.');
  }

  const openError = await shell.openPath(resolvedPath);
  if (openError) {
    throw new Error('Failed to open folder in Finder.');
  }
}

app.whenReady().then(() => {
  configureDockIcon();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ptyManager.closeAll();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
