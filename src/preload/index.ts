import { contextBridge, ipcRenderer } from 'electron';
import type {
  Connection,
  ConnectionDraft,
  AppPrivilegeStatus,
  CreateSessionRequest,
  SessionDataEvent,
  SessionExitEvent,
  SessionInfo
} from '../shared/types';

const terminalApi = {
  getPrivilegeStatus: (): Promise<AppPrivilegeStatus> => ipcRenderer.invoke('app:privilege-status'),
  relaunchAsAdmin: (): Promise<void> => ipcRenderer.invoke('app:relaunch-as-admin'),
  listConnections: (): Promise<Connection[]> => ipcRenderer.invoke('connections:list'),
  saveConnection: (draft: ConnectionDraft): Promise<Connection> => ipcRenderer.invoke('connections:save', draft),
  deleteConnection: (id: string): Promise<void> => ipcRenderer.invoke('connections:delete', id),
  importSshConfig: (): Promise<Connection[]> => ipcRenderer.invoke('connections:import-ssh-config'),
  pickFolder: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:pick-folder'),
  pickFile: (): Promise<string | undefined> => ipcRenderer.invoke('dialog:pick-file'),
  createSession: (request: CreateSessionRequest): Promise<SessionInfo> =>
    ipcRenderer.invoke('sessions:create', request),
  writeSession: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke('sessions:write', sessionId, data),
  resizeSession: (sessionId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('sessions:resize', sessionId, cols, rows),
  closeSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:close', sessionId),
  onSessionData: (callback: (event: SessionDataEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionDataEvent): void => callback(payload);
    ipcRenderer.on('session:data', listener);
    return () => ipcRenderer.removeListener('session:data', listener);
  },
  onSessionExit: (callback: (event: SessionExitEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionExitEvent): void => callback(payload);
    ipcRenderer.on('session:exit', listener);
    return () => ipcRenderer.removeListener('session:exit', listener);
  }
};

contextBridge.exposeInMainWorld('terminalApi', terminalApi);

export type TerminalApi = typeof terminalApi;
