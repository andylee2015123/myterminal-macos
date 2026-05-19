import { BrowserWindow } from 'electron';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as pty from 'node-pty';
import type { Connection, CreateSessionRequest, SessionInfo } from '../shared/types';
import { ConnectionStore } from './connection-store';

const SYSTEM_SSH = '/usr/bin/ssh';
const DEFAULT_MAC_PATHS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

interface SpawnCommand {
  file: string;
  args: string[];
  cwd?: string;
  password?: string;
}

interface RunningSession {
  process: pty.IPty;
  info: SessionInfo;
  pendingPassword?: string;
  sentPassword: boolean;
  recentOutput: string;
  sentAccessGrantedReturn: boolean;
  sentHostKeyConfirmation: boolean;
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
      sentPassword: false,
      recentOutput: '',
      sentAccessGrantedReturn: false,
      sentHostKeyConfirmation: false
    };

    this.sessions.set(id, session);

    child.onData((data) => {
      this.maybeSendPassword(session, data);
      this.maybeConfirmAccessGranted(session, data);
      this.maybeConfirmUnknownHostKey(session);
      this.broadcast('session:data', { sessionId: id, data });
    });

    child.onExit(({ exitCode }) => {
      const current = this.sessions.get(id);
      if (current) {
        current.info = { ...current.info, status: 'exited', exitCode };
      }
      this.broadcast('session:exit', { sessionId: id, exitCode });
    });

    await this.store.touch(connection.id);
    return this.sessions.get(id)?.info || info;
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

  private async commandForConnection(connection: Connection): Promise<SpawnCommand> {
    if (connection.type === 'local') {
      return commandForLocalConnection(connection);
    }

    const args: string[] = [];
    args.push('-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=no');

    if (connection.port && connection.port !== 22) {
      args.push('-p', String(connection.port));
    }

    if (connection.authType === 'key' && connection.keyPath) {
      const keyPath = normalizeIdentityFilePath(connection.keyPath);
      await assertReadableIdentityFile(keyPath);
      args.push('-i', keyPath, '-o', 'IdentitiesOnly=yes');
    }

    for (const extraArg of parseArgs(connection.extraArgs || '')) {
      args.push(extraArg);
    }

    const target = connection.sshConfigHost || sshTarget(connection);

    if (connection.remotePath) {
      args.push('-t', target, `cd ${quotePosix(connection.remotePath)} && exec ${remoteLoginShell()}`);
    } else {
      args.push(target);
    }

    return {
      file: SYSTEM_SSH,
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

  private maybeConfirmAccessGranted(session: RunningSession, data: string): void {
    session.recentOutput = `${session.recentOutput}${stripAnsi(data)}`.slice(-600);
    if (session.sentAccessGrantedReturn) {
      return;
    }

    if (/Access granted\.\s*Press Return to begin session\./i.test(session.recentOutput)) {
      session.process.write('\r');
      session.sentAccessGrantedReturn = true;
    }
  }

  private maybeConfirmUnknownHostKey(session: RunningSession): void {
    if (session.sentHostKeyConfirmation) {
      return;
    }

    if (/Are you sure you want to continue connecting \(yes\/no\/\[fingerprint\]\)\?\s*$/i.test(session.recentOutput)) {
      session.process.write('yes\r');
      session.sentHostKeyConfirmation = true;
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(channel, payload);
    }
  }
}

function commandForLocalConnection(connection: Extract<Connection, { type: 'local' }>): SpawnCommand {
  if (connection.shell === 'custom' && connection.shellPath) {
    return { file: connection.shellPath, args: [], cwd: connection.localPath };
  }

  if (connection.shell === 'bash') {
    return { file: '/bin/bash', args: ['-l'], cwd: connection.localPath };
  }

  if (connection.shell === 'sh') {
    return { file: '/bin/sh', args: [], cwd: connection.localPath };
  }

  return { file: '/bin/zsh', args: ['-l'], cwd: connection.localPath };
}

function subtitleForConnection(connection: Connection): string {
  if (connection.type === 'local') {
    return connection.localPath;
  }

  return sshEndpoint(connection);
}

function sshTarget(connection: Extract<Connection, { type: 'ssh' }>): string {
  return connection.username ? `${connection.username}@${connection.host}` : connection.host;
}

function sshEndpoint(connection: Extract<Connection, { type: 'ssh' }>): string {
  return `${sshTarget(connection)}:${connection.port}`;
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
  env.PATH = withDefaultMacPaths(env.PATH);
  return env;
}

function withDefaultMacPaths(value: string | undefined): string {
  const paths = (value || '').split(':').filter(Boolean);

  for (const path of DEFAULT_MAC_PATHS) {
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }

  return paths.join(':');
}

function normalizeIdentityFilePath(value: string): string {
  return expandHomePath(stripEnclosingQuotes(value.trim()));
}

async function assertReadableIdentityFile(keyPath: string): Promise<void> {
  try {
    await access(keyPath, constants.R_OK);
  } catch {
    throw new Error(`Private key is not readable: ${keyPath}`);
  }
}

function stripEnclosingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function expandHomePath(value: string): string {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return `${homedir()}${value.slice(1)}`;
  }

  return value;
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
