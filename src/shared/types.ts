export type ConnectionType = 'local' | 'ssh';
export type ShellKind = 'zsh' | 'bash' | 'sh' | 'custom';
export type SshAuthType = 'agent' | 'key' | 'password';

export interface BaseConnection {
  id: string;
  type: ConnectionType;
  name: string;
  group: string;
  color: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export interface LocalConnection extends BaseConnection {
  type: 'local';
  localPath: string;
  shell: ShellKind;
  shellPath?: string;
}

export interface SshConnection extends BaseConnection {
  type: 'ssh';
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  keyPath?: string;
  remotePath?: string;
  sshConfigHost?: string;
  extraArgs?: string;
  hasPassword?: boolean;
}

export type Connection = LocalConnection | SshConnection;

export type ConnectionDraft =
  | (Omit<LocalConnection, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
    })
  | (Omit<SshConnection, 'id' | 'createdAt' | 'updatedAt' | 'hasPassword'> & {
      id?: string;
      password?: string;
      clearPassword?: boolean;
    });

export interface SessionInfo {
  id: string;
  connectionId: string;
  type: ConnectionType;
  title: string;
  subtitle: string;
  startedAt: string;
  status: 'running' | 'exited';
  exitCode?: number;
}

export interface CreateSessionRequest {
  connectionId: string;
  cols?: number;
  rows?: number;
}

export interface SessionDataEvent {
  sessionId: string;
  data: string;
}

export interface SessionExitEvent {
  sessionId: string;
  exitCode: number;
}

export interface ConnectionExportResult {
  filePath: string;
  count: number;
}

export interface ConnectionImportSummary {
  total: number;
  added: number;
  updated: number;
  skipped: number;
}

export interface ConnectionImportResult extends ConnectionImportSummary {
  filePath: string;
}
