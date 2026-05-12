import { app, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Connection, ConnectionDraft, SshConnection } from '../shared/types';

type StoredConnection =
  | Extract<Connection, { type: 'local' }>
  | (Omit<SshConnection, 'hasPassword'> & {
      encryptedPassword?: string;
    });

interface StoreFile {
  version: 1;
  connections: StoredConnection[];
}

const DEFAULT_COLORS = ['#0f766e', '#b45309', '#be123c', '#4f46e5', '#334155', '#7c2d12'];

export class ConnectionStore {
  private readonly filePath: string;
  private cache: StoredConnection[] | null = null;

  constructor() {
    this.filePath = path.join(process.env.MYTERMINAL_CONNECTIONS_DIR || app.getPath('userData'), 'connections.json');
  }

  async list(): Promise<Connection[]> {
    const connections = await this.read();
    return connections.map((connection) => this.toPublic(connection));
  }

  async save(draft: ConnectionDraft): Promise<Connection> {
    const connections = await this.read();
    const now = new Date().toISOString();
    const existing = draft.id ? connections.find((item) => item.id === draft.id) : undefined;
    const normalized = this.normalizeDraft(draft, existing, now);
    const next = existing
      ? connections.map((item) => (item.id === normalized.id ? normalized : item))
      : [normalized, ...connections];

    await this.write(next);
    return this.toPublic(normalized);
  }

  async delete(id: string): Promise<void> {
    const connections = await this.read();
    await this.write(connections.filter((connection) => connection.id !== id));
  }

  async touch(id: string): Promise<void> {
    const connections = await this.read();
    const now = new Date().toISOString();
    await this.write(
      connections.map((connection) =>
        connection.id === id ? { ...connection, lastOpenedAt: now, updatedAt: now } : connection
      )
    );
  }

  async find(id: string): Promise<Connection | undefined> {
    return (await this.list()).find((connection) => connection.id === id);
  }

  async getPassword(id: string): Promise<string | undefined> {
    const connections = await this.read();
    const connection = connections.find((item) => item.id === id);
    if (!connection || connection.type !== 'ssh' || !connection.encryptedPassword) {
      return undefined;
    }

    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(connection.encryptedPassword, 'base64'));
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  async importSshConfig(): Promise<Connection[]> {
    const configPath = path.join(app.getPath('home'), '.ssh', 'config');
    let content = '';

    try {
      content = await readFile(configPath, 'utf8');
    } catch {
      return [];
    }

    const parsed = parseSshConfig(content);
    if (parsed.length === 0) {
      return [];
    }

    const existing = await this.read();
    const existingKeys = new Set(
      existing
        .filter((item) => item.type === 'ssh')
        .map((item) => `${item.sshConfigHost || ''}|${item.host}|${item.username}|${item.port}`)
    );
    const now = new Date().toISOString();
    const additions: StoredConnection[] = [];

    for (const host of parsed) {
      const key = `${host.alias}|${host.hostName}|${host.user}|${host.port}`;
      if (existingKeys.has(key)) {
        continue;
      }

      additions.push({
        id: randomUUID(),
        type: 'ssh',
        name: host.alias,
        group: 'SSH config',
        color: pickColor(additions.length),
        tags: ['ssh-config'],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        host: host.hostName,
        port: host.port,
        username: host.user,
        authType: host.identityFile ? 'key' : 'agent',
        keyPath: host.identityFile,
        sshConfigHost: host.alias
      });
    }

    if (additions.length > 0) {
      await this.write([...additions, ...existing]);
    }

    return additions.map((connection) => this.toPublic(connection));
  }

  async importPuttySshSessions(): Promise<Connection[]> {
    const parsed = await readPuttySshSessions();
    if (parsed.length === 0) {
      return [];
    }

    const existing = await this.read();
    const next = [...existing];
    const existingPuttyByName = new Map<string, number>();
    const existingLegacyPuttyByEndpoint = new Map<string, number>();

    next.forEach((connection, index) => {
      if (connection.type !== 'ssh' || !isPuttyConnection(connection)) {
        return;
      }

      if (connection.puttySessionName) {
        existingPuttyByName.set(puttySessionKey(connection.puttySessionName), index);
      } else {
        existingLegacyPuttyByEndpoint.set(connectionEndpointKey(connection), index);
      }
    });

    const now = new Date().toISOString();
    const additions: StoredConnection[] = [];
    const updates: StoredConnection[] = [];

    for (const session of parsed) {
      const puttyKey = puttySessionKey(session.name);
      const legacyIndex = existingLegacyPuttyByEndpoint.get(puttyEndpointKey(session));
      const existingIndex = existingPuttyByName.get(puttyKey) ?? legacyIndex;

      if (existingIndex !== undefined) {
        const updated = updatePuttyConnection(next[existingIndex], session, now);
        next[existingIndex] = updated;
        updates.push(updated);
        continue;
      }

      additions.push(createPuttyConnection(session, now, additions.length));
    }

    if (additions.length > 0 || updates.length > 0) {
      await this.write([...additions, ...next]);
    }

    return [...additions, ...updates].map((connection) => this.toPublic(connection));
  }

  private async read(): Promise<StoredConnection[]> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoreFile;
      this.cache = Array.isArray(parsed.connections) ? parsed.connections : [];
    } catch {
      this.cache = [];
    }

    return this.cache;
  }

  private async write(connections: StoredConnection[]): Promise<void> {
    this.cache = connections;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: StoreFile = { version: 1, connections };
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private normalizeDraft(
    draft: ConnectionDraft,
    existing: StoredConnection | undefined,
    now: string
  ): StoredConnection {
    const base = {
      id: draft.id || randomUUID(),
      name: draft.name.trim(),
      group: draft.group.trim(),
      color: draft.color || pickColor(0),
      tags: normalizeTags(draft.tags),
      favorite: Boolean(draft.favorite),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastOpenedAt: existing?.lastOpenedAt
    };

    if (draft.type === 'local') {
      return {
        ...base,
        type: 'local',
        localPath: draft.localPath.trim(),
        shell: draft.shell,
        shellPath: draft.shell === 'custom' ? draft.shellPath?.trim() || undefined : undefined
      };
    }

    const previousPassword =
      existing && existing.type === 'ssh' && 'encryptedPassword' in existing
        ? existing.encryptedPassword
        : undefined;
    const encryptedPassword =
      draft.clearPassword || !draft.password
        ? draft.clearPassword
          ? undefined
          : previousPassword
        : encryptPassword(draft.password);

    return {
      ...base,
      type: 'ssh',
      host: draft.host.trim(),
      port: Number(draft.port) || 22,
      username: draft.username.trim(),
      authType: draft.authType,
      keyPath: draft.keyPath?.trim() || undefined,
      remotePath: draft.remotePath?.trim() || undefined,
      sshConfigHost: draft.sshConfigHost?.trim() || undefined,
      puttySessionName: draft.puttySessionName?.trim() || undefined,
      extraArgs: draft.extraArgs?.trim() || undefined,
      encryptedPassword
    };
  }

  private toPublic(connection: StoredConnection): Connection {
    if (connection.type === 'ssh') {
      const { encryptedPassword: _encryptedPassword, ...safeConnection } = connection;
      return {
        ...safeConnection,
        hasPassword: Boolean(connection.encryptedPassword)
      };
    }

    return connection;
  }
}

function encryptPassword(password: string): string | undefined {
  if (!password || !safeStorage.isEncryptionAvailable()) {
    return undefined;
  }

  return safeStorage.encryptString(password).toString('base64');
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8)
    )
  );
}

function pickColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

interface ParsedSshHost {
  alias: string;
  hostName: string;
  user: string;
  port: number;
  identityFile?: string;
}

function parseSshConfig(content: string): ParsedSshHost[] {
  const hosts: ParsedSshHost[] = [];
  let current: Partial<ParsedSshHost> | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const [keyword = '', ...rest] = line.split(/\s+/);
    const value = rest.join(' ');
    const key = keyword.toLowerCase();

    if (key === 'host') {
      if (current?.alias && current.hostName && current.user) {
        hosts.push({
          alias: current.alias,
          hostName: current.hostName,
          user: current.user,
          port: current.port || 22,
          identityFile: current.identityFile
        });
      }

      const alias = value.split(/\s+/).find((item) => item && !item.includes('*') && !item.includes('?'));
      current = alias ? { alias, hostName: alias, port: 22 } : undefined;
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === 'hostname') {
      current.hostName = value;
    } else if (key === 'user') {
      current.user = value;
    } else if (key === 'port') {
      current.port = Number(value) || 22;
    } else if (key === 'identityfile') {
      current.identityFile = value.replace(/^~/, app.getPath('home'));
    }
  }

  if (current?.alias && current.hostName && current.user) {
    hosts.push({
      alias: current.alias,
      hostName: current.hostName,
      user: current.user,
      port: current.port || 22,
      identityFile: current.identityFile
    });
  }

  return hosts;
}

interface PuttyRegistrySession {
  Name?: unknown;
  HostName?: unknown;
  Protocol?: unknown;
  PortNumber?: unknown;
  UserName?: unknown;
  PublicKeyFile?: unknown;
}

interface ParsedPuttySession {
  name: string;
  hostName: string;
  user: string;
  port: number;
  identityFile?: string;
}

function createPuttyConnection(session: ParsedPuttySession, now: string, colorIndex: number): StoredConnection {
  return {
    id: randomUUID(),
    type: 'ssh',
    name: session.name,
    group: 'PuTTY',
    color: pickColor(colorIndex),
    tags: puttyTags(session.identityFile),
    favorite: false,
    createdAt: now,
    updatedAt: now,
    host: session.hostName,
    port: session.port,
    username: session.user,
    authType: session.identityFile ? 'key' : 'agent',
    keyPath: session.identityFile,
    puttySessionName: session.name
  };
}

function updatePuttyConnection(
  connection: StoredConnection,
  session: ParsedPuttySession,
  now: string
): StoredConnection {
  if (connection.type !== 'ssh') {
    return connection;
  }

  return {
    ...connection,
    group: connection.group || 'PuTTY',
    tags: mergeTags(connection.tags, puttyTags(session.identityFile)),
    updatedAt: now,
    host: session.hostName,
    port: session.port,
    username: session.user,
    authType: session.identityFile ? 'key' : 'agent',
    keyPath: session.identityFile,
    puttySessionName: session.name
  };
}

function isPuttyConnection(connection: StoredConnection): boolean {
  return (
    connection.type === 'ssh' &&
    (Boolean(connection.puttySessionName) || connection.group === 'PuTTY' || connection.tags.includes('putty'))
  );
}

function puttyTags(identityFile: string | undefined): string[] {
  return identityFile?.toLowerCase().endsWith('.ppk') ? ['putty', 'ppk'] : ['putty'];
}

function mergeTags(current: string[], next: string[]): string[] {
  return normalizeTags([...current, ...next]);
}

function puttySessionKey(name: string): string {
  return name.trim().toLowerCase();
}

function puttyEndpointKey(session: ParsedPuttySession): string {
  return `${session.hostName}|${session.user}|${session.port}`.toLowerCase();
}

function connectionEndpointKey(connection: Extract<StoredConnection, { type: 'ssh' }>): string {
  return `${connection.host}|${connection.username}|${connection.port}`.toLowerCase();
}

async function readPuttySshSessions(): Promise<ParsedPuttySession[]> {
  if (process.platform !== 'win32') {
    return [];
  }

  const script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    "$root = 'Registry::HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions'",
    "if (-not (Test-Path -LiteralPath $root)) { '[]'; exit 0 }",
    '$sessions = @(Get-ChildItem -LiteralPath $root | ForEach-Object {',
    '  $props = Get-ItemProperty -LiteralPath $_.PSPath',
    '  [PSCustomObject]@{',
    '    Name = $_.PSChildName',
    '    HostName = $props.HostName',
    '    Protocol = $props.Protocol',
    '    PortNumber = $props.PortNumber',
    '    UserName = $props.UserName',
    '    PublicKeyFile = $props.PublicKeyFile',
    '  }',
    '})',
    'ConvertTo-Json -Compress -InputObject $sessions'
  ].join('\n');

  const raw = await execPowerShell(script);
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return [];
  }

  const sessions = Array.isArray(parsed) ? parsed : [parsed];
  return sessions
    .map((session) => normalizePuttySession(session as PuttyRegistrySession))
    .filter((session): session is ParsedPuttySession => Boolean(session));
}

function execPowerShell(command: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}

function normalizePuttySession(session: PuttyRegistrySession): ParsedPuttySession | undefined {
  const name = decodePuttySessionName(toText(session.Name));
  if (!name || name.toLowerCase() === 'default settings') {
    return undefined;
  }

  const protocol = toText(session.Protocol).toLowerCase();
  if (protocol && protocol !== 'ssh') {
    return undefined;
  }

  let hostName = toText(session.HostName);
  if (!hostName) {
    return undefined;
  }

  let user = toText(session.UserName);
  if (!user && hostName.includes('@')) {
    const splitIndex = hostName.lastIndexOf('@');
    user = hostName.slice(0, splitIndex).trim();
    hostName = hostName.slice(splitIndex + 1).trim();
  }

  const hostAndPort = splitHostAndPort(hostName);
  hostName = hostAndPort.hostName;

  if (!hostName) {
    return undefined;
  }

  const identityFile = toText(session.PublicKeyFile);

  return {
    name,
    hostName,
    user,
    port: normalizePort(session.PortNumber, hostAndPort.port),
    identityFile: identityFile || undefined
  };
}

function decodePuttySessionName(value: string): string {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
  }
}

function splitHostAndPort(value: string): { hostName: string; port?: number } {
  const hostName = value.trim();
  const match = /^([^:]+):(\d+)$/.exec(hostName);
  if (!match) {
    return { hostName };
  }

  return {
    hostName: match[1].trim(),
    port: Number(match[2]) || undefined
  };
}

function normalizePort(value: unknown, fallback?: number): number {
  if (typeof value === 'number' && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
    if (parsed > 0) {
      return parsed;
    }
  }

  return fallback || 22;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
