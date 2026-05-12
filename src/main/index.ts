import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ConnectionStore } from './connection-store';
import { PtyManager } from './pty-manager';
import type { ConnectionDraft, CreateSessionRequest } from '../shared/types';

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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'MyTerminal',
    icon: path.join(__dirname, '../../assets/app-icon.ico'),
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
  ipcMain.handle('app:privilege-status', async () => ({
    isWindows: process.platform === 'win32',
    isAdmin: await isRunningAsAdmin()
  }));
  ipcMain.handle('app:relaunch-as-admin', () => relaunchAsAdmin());

  ipcMain.handle('connections:list', () => store.list());
  ipcMain.handle('connections:save', (_event, draft: ConnectionDraft) => store.save(draft));
  ipcMain.handle('connections:delete', (_event, id: string) => store.delete(id));
  ipcMain.handle('connections:import-ssh-config', () => store.importSshConfig());
  ipcMain.handle('connections:import-putty-ssh', () => store.importPuttySshSessions());

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

  ipcMain.handle('folder:open-in-explorer', (_event, folderPath: string) => openFolderInExplorer(folderPath));

  ipcMain.handle('sessions:create', (_event, request: CreateSessionRequest) => ptyManager.create(request));
  ipcMain.handle('sessions:write', (_event, sessionId: string, data: string) => ptyManager.write(sessionId, data));
  ipcMain.handle('sessions:resize', (_event, sessionId: string, cols: number, rows: number) =>
    ptyManager.resize(sessionId, cols, rows)
  );
  ipcMain.handle('sessions:close', (_event, sessionId: string) => ptyManager.close(sessionId));
}

async function openFolderInExplorer(folderPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Explorer is only available on Windows.');
  }

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

  await new Promise<void>((resolve, reject) => {
    execFile('explorer.exe', [resolvedPath], { windowsHide: false }, (error) => {
      if (error) {
        reject(new Error('Failed to open folder in Explorer.'));
        return;
      }

      resolve();
    });
  });
}

function isRunningAsAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    execFile('net.exe', ['session'], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

function relaunchAsAdmin(): Promise<void> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Administrator relaunch is only available on Windows.'));
  }

  const args = process.argv.slice(1);
  const argumentList = args.length
    ? ` -ArgumentList @(${args.map(quotePowerShell).join(',')})`
    : '';
  const command = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${quotePowerShell(
    process.execPath
  )}${argumentList} -Verb RunAs`;

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true },
      (error) => {
        if (error) {
          reject(new Error('Administrator relaunch was cancelled or failed.'));
          return;
        }

        resolve();
        setTimeout(() => app.quit(), 200);
      }
    );
  });
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

app.whenReady().then(() => {
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
