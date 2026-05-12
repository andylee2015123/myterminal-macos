import { BrowserWindow } from 'electron';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { Connection, CreateSessionRequest, SessionInfo } from '../shared/types';
import { ConnectionStore } from './connection-store';

interface RunningSession {
  process: pty.IPty;
  info: SessionInfo;
  pendingPassword?: string;
  sentPassword: boolean;
}

export class PtyManager {
  private readonly sessions = new Map<string, RunningSession>();

  constructor(private readonly store: ConnectionStore) {}

  async create(request: CreateSessionRequest): Promise<SessionInfo> {
    const connection = await this.store.find(request.connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    const id = randomUUID();
    const command = await this.commandForConnection(connection);
    const info: SessionInfo = {
      id,
      connectionId: connection.id,
      type: connection.type,
      title: connection.name,
      subtitle: subtitleForConnection(connection),
      startedAt: new Date().toISOString(),
      status: 'running'
    };

    const child = pty.spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols: request.cols || 100,
      rows: request.rows || 32,
      cwd: command.cwd,
      env: buildEnv()
    });

    const session: RunningSession = {
      process: child,
      info,
      pendingPassword: command.password,
      sentPassword: false
    };

    child.onData((data) => {
      this.maybeSendPassword(session, data);
      this.broadcast('session:data', { sessionId: id, data });
    });

    child.onExit(({ exitCode }) => {
      const current = this.sessions.get(id);
      if (current) {
        current.info = { ...current.info, status: 'exited', exitCode };
      }
      this.broadcast('session:exit', { sessionId: id, exitCode });
    });

    this.sessions.set(id, session);
    await this.store.touch(connection.id);
    return info;
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.process.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) {
      this.sessions.get(sessionId)?.process.resize(cols, rows);
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      session.process.kill();
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  closeAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.close(sessionId);
    }
  }

  private async commandForConnection(connection: Connection): Promise<{
    file: string;
    args: string[];
    cwd?: string;
    password?: string;
  }> {
    if (connection.type === 'local') {
      if (connection.shell === 'pwsh') {
        return { file: 'pwsh.exe', args: ['-NoLogo'], cwd: connection.localPath };
      }

      if (connection.shell === 'cmd') {
        return { file: 'cmd.exe', args: [], cwd: connection.localPath };
      }

      if (connection.shell === 'custom' && connection.shellPath) {
        return { file: connection.shellPath, args: [], cwd: connection.localPath };
      }

      return { file: 'powershell.exe', args: ['-NoLogo'], cwd: connection.localPath };
    }

    const args: string[] = [];

    if (connection.port && connection.port !== 22) {
      args.push('-p', String(connection.port));
    }

    if (connection.authType === 'key' && connection.keyPath) {
      args.push('-i', connection.keyPath);
    }

    for (const extraArg of parseArgs(connection.extraArgs || '')) {
      args.push(extraArg);
    }

    const target = connection.sshConfigHost || `${connection.username}@${connection.host}`;

    if (connection.remotePath) {
      args.push('-t', target, `cd ${quotePosix(connection.remotePath)} && exec ${remoteLoginShell()}`);
    } else {
      args.push(target);
    }

    return {
      file: 'ssh.exe',
      args,
      password:
        connection.authType === 'password' && connection.hasPassword
          ? await this.store.getPassword(connection.id)
          : undefined
    };
  }

  private maybeSendPassword(session: RunningSession, data: string): void {
    if (!session.pendingPassword || session.sentPassword) {
      return;
    }

    if (/password(?: for .*?)?:\s*$/i.test(stripAnsi(data))) {
      session.process.write(`${session.pendingPassword}\r`);
      session.sentPassword = true;
      session.pendingPassword = undefined;
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(channel, payload);
    }
  }
}

function subtitleForConnection(connection: Connection): string {
  if (connection.type === 'local') {
    return connection.localPath;
  }

  return `${connection.username}@${connection.host}:${connection.port}`;
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function remoteLoginShell(): string {
  return '${SHELL:-sh} -l';
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}
