import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Connection,
  ConnectionDraft,
  ConnectionImportSummary,
  ShellKind,
  SshAuthType,
  SshConnection
} from '../shared/types';

type StoredConnection =
  | Extract<Connection, { type: 'local' }>
  | (Omit<SshConnection, 'hasPassword'> & {
      encryptedPassword?: string;
    });

interface StoreFile {
  version: 1;
  connections: StoredConnection[];
}

type ExportedConnection = Extract<Connection, { type: 'local' }> | Omit<SshConnection, 'hasPassword'>;

interface ExportFile {
  app: 'MyTerminal';
  version: 1;
  exportedAt: string;
  connections: ExportedConnection[];
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

  async exportToFile(filePath: string): Promise<number> {
    const connections = await this.read();
    const payload: ExportFile = {
      app: 'MyTerminal',
      version: 1,
      exportedAt: new Date().toISOString(),
      connections: connections.map(toExportConnection)
    };

    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return payload.connections.length;
  }

  async importFromFile(filePath: string): Promise<ConnectionImportSummary> {
    const raw = await readFile(filePath, 'utf8');
    const entries = parseImportFile(raw);
    const existing = await this.read();
    const next = [...existing];
    const now = new Date().toISOString();
    const summary: ConnectionImportSummary = {
      total: entries.length,
      added: 0,
      updated: 0,
      skipped: 0
    };

    entries.forEach((entry, index) => {
      const imported = normalizeImportedConnection(entry, now, index);
      if (!imported) {
        summary.skipped += 1;
        return;
      }

      const identityKey = connectionIdentityKey(imported);
      const existingIndex = next.findIndex(
        (connection) => connection.id === imported.id || connectionIdentityKey(connection) === identityKey
      );

      if (existingIndex >= 0) {
        next[existingIndex] = mergeImportedConnection(next[existingIndex], imported, now);
        summary.updated += 1;
        return;
      }

      next.unshift(imported);
      summary.added += 1;
    });

    if (summary.added > 0 || summary.updated > 0) {
      await this.write(next);
    }

    return summary;
  }

  private async read(): Promise<StoredConnection[]> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoreFile;
      this.cache = Array.isArray(parsed.connections)
        ? parsed.connections.map((connection) => normalizeStoredConnection(connection))
        : [];
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
      const shell = normalizeShellKind(draft.shell) || defaultShellKind();

      return {
        ...base,
        type: 'local',
        localPath: draft.localPath.trim(),
        shell,
        shellPath: shell === 'custom' ? draft.shellPath?.trim() || undefined : undefined
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

function normalizeStoredConnection(connection: StoredConnection): StoredConnection {
  if (connection.type !== 'local') {
    return connection;
  }

  const shell = normalizeShellKind(connection.shell) || defaultShellKind();
  return {
    ...connection,
    shell,
    shellPath: shell === 'custom' ? connection.shellPath : undefined
  };
}

function defaultShellKind(): ShellKind {
  return 'zsh';
}

function pickColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function toExportConnection(connection: StoredConnection): ExportedConnection {
  if (connection.type === 'ssh') {
    const { encryptedPassword: _encryptedPassword, ...safeConnection } = connection;
    return safeConnection;
  }

  return { ...connection };
}

function parseImportFile(raw: string): unknown[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Import file is not valid JSON.');
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (isRecord(parsed) && Array.isArray(parsed.connections)) {
    return parsed.connections;
  }

  throw new Error('Import file must contain a connections array.');
}

function normalizeImportedConnection(value: unknown, now: string, colorIndex: number): StoredConnection | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = textField(value, 'type');
  const name = textField(value, 'name');
  if (!name || (type !== 'local' && type !== 'ssh')) {
    return undefined;
  }

  const base = {
    id: textField(value, 'id') || randomUUID(),
    name,
    group: textField(value, 'group'),
    color: colorField(textField(value, 'color'), colorIndex),
    tags: normalizeTags(arrayField(value, 'tags')),
    favorite: value.favorite === true,
    createdAt: dateField(value.createdAt) || now,
    updatedAt: now,
    lastOpenedAt: dateField(value.lastOpenedAt)
  };

  if (type === 'local') {
    const shell = shellField(value.shell) || defaultShellKind();
    const localPath = textField(value, 'localPath');
    const shellPath = optionalTextField(value, 'shellPath');

    if (!localPath || (shell === 'custom' && !shellPath)) {
      return undefined;
    }

    return {
      ...base,
      type: 'local',
      localPath,
      shell,
      shellPath: shell === 'custom' ? shellPath : undefined
    };
  }

  const host = textField(value, 'host');
  const sshConfigHost = optionalTextField(value, 'sshConfigHost');
  const port = portField(value.port);
  const authType = authTypeField(value.authType) || 'agent';
  const keyPath = optionalTextField(value, 'keyPath');

  if ((!host && !sshConfigHost) || !port || (authType === 'key' && !keyPath)) {
    return undefined;
  }

  return {
    ...base,
    type: 'ssh',
    host,
    port,
    username: textField(value, 'username'),
    authType,
    keyPath,
    remotePath: optionalTextField(value, 'remotePath'),
    sshConfigHost,
    extraArgs: optionalTextField(value, 'extraArgs')
  };
}

function mergeImportedConnection(
  existing: StoredConnection,
  imported: StoredConnection,
  now: string
): StoredConnection {
  const shared = {
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now,
    lastOpenedAt: existing.lastOpenedAt || imported.lastOpenedAt
  };

  if (imported.type === 'ssh') {
    return {
      ...imported,
      ...shared,
      encryptedPassword: existing.type === 'ssh' ? existing.encryptedPassword : undefined
    };
  }

  return {
    ...imported,
    ...shared
  };
}

function connectionIdentityKey(connection: StoredConnection): string {
  if (connection.type === 'local') {
    return [
      'local',
      connection.localPath.toLowerCase(),
      connection.shell,
      (connection.shellPath || '').toLowerCase()
    ].join('|');
  }

  return [
    'ssh',
    (connection.sshConfigHost || '').toLowerCase(),
    connection.host.toLowerCase(),
    connection.username.toLowerCase(),
    connection.port
  ].join('|');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function optionalTextField(record: Record<string, unknown>, key: string): string | undefined {
  return textField(record, key) || undefined;
}

function arrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function dateField(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function colorField(value: string, fallbackIndex: number): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : pickColor(fallbackIndex);
}

function portField(value: unknown): number | undefined {
  const port = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  const normalized = Math.trunc(port);
  return normalized >= 1 && normalized <= 65535 ? normalized : undefined;
}

function shellField(value: unknown): ShellKind | undefined {
  return normalizeShellKind(value);
}

function normalizeShellKind(value: unknown): ShellKind | undefined {
  if (value === 'zsh' || value === 'bash' || value === 'sh' || value === 'custom') {
    return value;
  }

  return undefined;
}

function authTypeField(value: unknown): SshAuthType | undefined {
  if (value === 'agent' || value === 'key' || value === 'password') {
    return value;
  }

  return undefined;
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
