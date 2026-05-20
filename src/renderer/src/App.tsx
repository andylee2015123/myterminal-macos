import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardPaste,
  Copy,
  Download,
  Edit3,
  Folder,
  FolderOpen,
  HardDrive,
  Import,
  KeyRound,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Server,
  Star,
  StarOff,
  TerminalSquare,
  Trash2,
  Upload,
  Wifi
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type {
  Connection,
  ConnectionDraft,
  LocalConnection,
  SessionExitEvent,
  SessionInfo,
  ShellKind,
  SshAuthType,
  SshConnection
} from '../../shared/types';

const COLORS = ['#0f766e', '#b45309', '#be123c', '#4f46e5', '#334155', '#7c2d12'];
const COLLAPSED_GROUPS_STORAGE_KEY = 'collapsedConnectionGroups';

const EMPTY_LOCAL_DRAFT: Omit<LocalConnection, 'id' | 'createdAt' | 'updatedAt'> = {
  type: 'local',
  name: '',
  group: '',
  color: COLORS[0],
  tags: [],
  favorite: false,
  localPath: '',
  shell: 'zsh'
};

const EMPTY_SSH_DRAFT: Omit<SshConnection, 'id' | 'createdAt' | 'updatedAt' | 'hasPassword'> & {
  password?: string;
  clearPassword?: boolean;
} = {
  type: 'ssh',
  name: '',
  group: '',
  color: COLORS[3],
  tags: [],
  favorite: false,
  host: '',
  port: 22,
  username: '',
  authType: 'agent',
  keyPath: '',
  remotePath: '',
  sshConfigHost: '',
  extraArgs: ''
};

type EditorMode = 'local-new' | 'ssh-new' | 'edit';
type DraftState = ConnectionDraft & { hasPassword?: boolean };
type TerminalActions = {
  copy: () => void;
  paste: () => void;
};

export function App(): JSX.Element {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'local' | 'ssh'>('all');
  const [editorMode, setEditorMode] = useState<EditorMode>('local-new');
  const [draft, setDraft] = useState<DraftState>({ ...EMPTY_LOCAL_DRAFT });
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [connectionPanelVisible, setConnectionPanelVisible] = useState(
    () => window.localStorage.getItem('connectionPanelVisible') !== 'false'
  );
  const [editorPanelVisible, setEditorPanelVisible] = useState(
    () => window.localStorage.getItem('editorPanelVisible') !== 'false'
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(readCollapsedConnectionGroups())
  );
  const terminalActionsRef = useRef(new Map<string, TerminalActions>());

  const loadConnections = useCallback(async () => {
    setConnections(await window.terminalApi.listConnections());
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    window.localStorage.setItem('connectionPanelVisible', String(connectionPanelVisible));
  }, [connectionPanelVisible]);

  useEffect(() => {
    window.localStorage.setItem('editorPanelVisible', String(editorPanelVisible));
  }, [editorPanelVisible]);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(Array.from(collapsedGroups)));
  }, [collapsedGroups]);

  useEffect(() => {
    const offExit = window.terminalApi.onSessionExit((event: SessionExitEvent) => {
      setSessions((current) => {
        return current.map((session) =>
          session.id === event.sessionId ? { ...session, status: 'exited', exitCode: event.exitCode } : session
        );
      });
    });

    return offExit;
  }, []);

  const filteredConnections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return connections
      .filter((connection) => typeFilter === 'all' || connection.type === typeFilter)
      .filter((connection) => {
        if (!normalizedQuery) {
          return true;
        }

        const haystack = [
          connection.name,
          connection.group,
          connection.type === 'local'
            ? connection.localPath
            : `${formatSshEndpoint(connection)} ${connection.sshConfigHost || ''}`,
          connection.tags.join(' ')
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite) {
          return a.favorite ? -1 : 1;
        }

        const aRecent = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
        const bRecent = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
        if (aRecent !== bRecent) {
          return bRecent - aRecent;
        }

        return a.name.localeCompare(b.name);
      });
  }, [connections, query, typeFilter]);

  const groupedConnections = useMemo(() => {
    const map = new Map<string, Connection[]>();

    for (const connection of filteredConnections) {
      const group = connection.group || (connection.type === 'local' ? 'Local folders' : 'SSH hosts');
      map.set(group, [...(map.get(group) || []), connection]);
    }

    return Array.from(map.entries());
  }, [filteredConnections]);
  const hasActiveSearch = query.trim().length > 0;

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === activeSession?.connectionId),
    [connections, activeSession?.connectionId]
  );
  const activeLocalConnection =
    activeConnection && activeConnection.type === 'local' ? activeConnection : undefined;

  const startNewLocal = (): void => {
    setEditorMode('local-new');
    setSelectedConnectionId(undefined);
    setDraft({ ...EMPTY_LOCAL_DRAFT });
  };

  const startNewSsh = (): void => {
    setEditorMode('ssh-new');
    setSelectedConnectionId(undefined);
    setDraft({ ...EMPTY_SSH_DRAFT });
  };

  const editConnection = (connection: Connection): void => {
    setEditorMode('edit');
    setSelectedConnectionId(connection.id);
    setDraft({ ...connection, tags: [...connection.tags] } as ConnectionDraft);
  };

  const duplicateConnection = (connection: Connection): void => {
    const copy = { ...connection, id: undefined, name: `${connection.name} copy`, favorite: false } as ConnectionDraft;
    if (copy.type === 'ssh') {
      copy.password = undefined;
    }
    setEditorMode('edit');
    setSelectedConnectionId(undefined);
    setDraft(copy);
  };

  const saveDraft = async (openAfterSave = false): Promise<void> => {
    const error = validateDraft(draft);
    if (error) {
      setMessage(error);
      return;
    }

    setSaving(true);
    setMessage(undefined);

    try {
      const saved = await window.terminalApi.saveConnection(draft);
      await loadConnections();
      setSelectedConnectionId(saved.id);
      setEditorMode('edit');
      setDraft({ ...saved, tags: [...saved.tags] } as ConnectionDraft);
      if (openAfterSave) {
        await openConnection(saved.id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteConnection = async (connection: Connection): Promise<void> => {
    if (!window.confirm(`Delete "${connection.name}"?`)) {
      return;
    }

    await window.terminalApi.deleteConnection(connection.id);
    if (selectedConnectionId === connection.id) {
      startNewLocal();
    }
    await loadConnections();
  };

  const openConnection = async (connectionId: string): Promise<void> => {
    try {
      const session = await window.terminalApi.createSession({ connectionId, cols: 100, rows: 32 });
      setSessions((current) => [...current, session]);
      setActiveSessionId(session.id);
      await loadConnections();
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection failed.');
    }
  };

  const closeSession = async (sessionId: string): Promise<void> => {
    await window.terminalApi.closeSession(sessionId);
    setSessions((current) => {
      const next = current.filter((session) => session.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[next.length - 1]?.id);
      }
      return next;
    });
  };

  const importSshConfig = async (): Promise<void> => {
    const imported = await window.terminalApi.importSshConfig();
    await loadConnections();
    setMessage(imported.length ? `Imported ${imported.length} SSH connection(s).` : 'No new SSH config hosts found.');
  };

  const exportConnections = async (): Promise<void> => {
    try {
      const result = await window.terminalApi.exportConnections();
      if (!result) {
        return;
      }

      setMessage(`Exported ${result.count} connection(s). Passwords are not included.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection export failed.');
    }
  };

  const importConnectionsFile = async (): Promise<void> => {
    try {
      const result = await window.terminalApi.importConnections();
      if (!result) {
        return;
      }

      await loadConnections();
      const skipped = result.skipped ? `, ${result.skipped} skipped` : '';
      setMessage(`Import complete: ${result.added} added, ${result.updated} updated${skipped}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection import failed.');
    }
  };

  const updateDraft = (key: string, value: unknown): void => {
    setDraft((current) => ({ ...current, [key]: value }) as DraftState);
  };

  const toggleConnectionGroup = (group: string): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const toggleFavorite = async (connection: Connection): Promise<void> => {
    await window.terminalApi.saveConnection({
      ...connection,
      favorite: !connection.favorite,
      tags: [...connection.tags]
    } as ConnectionDraft);
    await loadConnections();
  };

  const registerTerminalActions = useCallback((sessionId: string, actions: TerminalActions): void => {
    terminalActionsRef.current.set(sessionId, actions);
  }, []);

  const unregisterTerminalActions = useCallback((sessionId: string): void => {
    terminalActionsRef.current.delete(sessionId);
  }, []);

  const copyActiveTerminal = (): void => {
    if (!activeSessionId) {
      return;
    }

    terminalActionsRef.current.get(activeSessionId)?.copy();
  };

  const pasteActiveTerminal = (): void => {
    if (!activeSessionId) {
      return;
    }

    terminalActionsRef.current.get(activeSessionId)?.paste();
  };

  const openActiveFolderInFinder = async (): Promise<void> => {
    if (!activeLocalConnection) {
      return;
    }

    try {
      await window.terminalApi.openFolder(activeLocalConnection.localPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to open folder in Finder.');
    }
  };

  return (
    <div className={`app-shell ${connectionPanelVisible ? '' : 'connections-collapsed'}`}>
      <aside className={`connection-panel ${connectionPanelVisible ? '' : 'collapsed'}`}>
        {connectionPanelVisible ? (
        <>
        <div className="brand-row">
          <div className="brand-copy">
            <div className="brand-mark">
              <TerminalSquare size={21} />
            </div>
            <div>
              <div className="brand-title">MyTerminal</div>
              <div className="brand-subtitle">{connections.length} connections</div>
            </div>
          </div>
          <button
            className="panel-toggle-button"
            onClick={() => setConnectionPanelVisible(false)}
            title="Collapse MyTerminal"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div className="search-row">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, host, path, tag"
          />
        </div>

        <div className="filter-row">
          <button className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>
            All
          </button>
          <button className={typeFilter === 'local' ? 'active' : ''} onClick={() => setTypeFilter('local')}>
            <HardDrive size={14} /> Local
          </button>
          <button className={typeFilter === 'ssh' ? 'active' : ''} onClick={() => setTypeFilter('ssh')}>
            <Server size={14} /> SSH
          </button>
        </div>

        <div className="action-grid">
          <button className="primary-action" onClick={startNewLocal}>
            <FolderOpen size={16} /> Local
          </button>
          <button className="primary-action" onClick={startNewSsh}>
            <Wifi size={16} /> SSH
          </button>
          <button className="ghost-action" onClick={exportConnections}>
            <Download size={16} /> Export
          </button>
          <button className="ghost-action" onClick={importConnectionsFile}>
            <Upload size={16} /> Import
          </button>
          <button className="ghost-action wide" onClick={importSshConfig}>
            <Import size={16} /> Import SSH config
          </button>
        </div>

        <div className="connection-list">
          {groupedConnections.map(([group, items]) => {
            const collapsed = !hasActiveSearch && collapsedGroups.has(group);
            return (
              <section className={`connection-group ${collapsed ? 'collapsed' : ''}`} key={group}>
                <button
                  className="group-title"
                  onClick={() => toggleConnectionGroup(group)}
                  aria-expanded={!collapsed}
                  title={collapsed ? `Expand ${group}` : `Collapse ${group}`}
                >
                  <span className="group-title-copy">
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span>{group}</span>
                  </span>
                  <span className="group-count">{items.length}</span>
                </button>
                {!collapsed &&
                  items.map((connection) => (
                    <ConnectionRow
                      key={connection.id}
                      connection={connection}
                      selected={selectedConnectionId === connection.id}
                      onOpen={() => openConnection(connection.id)}
                      onEdit={() => editConnection(connection)}
                      onDelete={() => deleteConnection(connection)}
                      onDuplicate={() => duplicateConnection(connection)}
                      onToggleFavorite={() => toggleFavorite(connection)}
                    />
                  ))}
              </section>
            );
          })}
          {filteredConnections.length === 0 && (
            <div className="empty-panel">
              <Monitor size={22} />
              <span>No connections</span>
            </div>
          )}
        </div>
        </>
        ) : (
          <button
            className="collapsed-rail"
            onClick={() => setConnectionPanelVisible(true)}
            title="Expand MyTerminal"
          >
            <TerminalSquare size={18} />
            <span>MyTerminal</span>
            <PanelLeftOpen size={16} />
          </button>
        )}
      </aside>

      <main className={`workspace ${editorPanelVisible ? '' : 'editor-collapsed'}`}>
        <section className={`editor-panel ${editorPanelVisible ? '' : 'collapsed'}`}>
        {editorPanelVisible ? (
          <ConnectionEditor
            draft={draft}
            mode={editorMode}
            saving={saving}
            message={message}
            onCollapse={() => setEditorPanelVisible(false)}
            onDraftChange={updateDraft}
            onPickFolder={async () => {
              const folder = await window.terminalApi.pickFolder();
              if (folder && draft.type === 'local') {
                updateDraft('localPath', folder);
                if (!draft.name) {
                  updateDraft('name', folder.split(/[\\/]/).filter(Boolean).pop() || folder);
                }
              }
            }}
            onPickKey={async () => {
              const file = await window.terminalApi.pickFile();
              if (file && draft.type === 'ssh') {
                updateDraft('keyPath', file);
              }
            }}
            onSave={() => saveDraft(false)}
            onSaveAndOpen={() => saveDraft(true)}
          />
        ) : (
          <button
            className="collapsed-rail"
            onClick={() => setEditorPanelVisible(true)}
            title="Expand connection details"
          >
            {draft.type === 'local' ? <HardDrive size={18} /> : <Server size={18} />}
            <span>{draft.type === 'local' ? 'Local folder' : 'Remote SSH'}</span>
            <PanelLeftOpen size={16} />
          </button>
        )}
        </section>

        <section className="terminal-panel">
          <div className="tabs-row">
            {sessions.length === 0 ? (
              <div className="tabs-empty">No active sessions</div>
            ) : (
              sessions.map((session) => (
                <button
                  className={`session-tab ${activeSessionId === session.id ? 'active' : ''}`}
                  key={session.id}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  {session.type === 'local' ? <Folder size={14} /> : <Server size={14} />}
                  <span>{session.title}</span>
                  {session.status === 'exited' && <span className="exit-dot" />}
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeSession(session.id);
                    }}
                  >
                    x
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="terminal-header">
            <div>
              <div className="terminal-title">{activeSession?.title || 'Terminal'}</div>
              <div className="terminal-subtitle">{activeSession?.subtitle || 'Open a connection to start.'}</div>
            </div>
            <div className="terminal-tools">
              {activeLocalConnection && (
                <button
                  className="tool-button"
                  onClick={openActiveFolderInFinder}
                  title="Open folder in Finder"
                >
                  <FolderOpen size={15} />
                </button>
              )}
              <button
                className="tool-button"
                onClick={copyActiveTerminal}
                disabled={!activeSessionId}
                title="Copy selected text"
              >
                <Copy size={15} />
              </button>
              <button
                className="tool-button"
                onClick={pasteActiveTerminal}
                disabled={!activeSessionId}
                title="Paste"
              >
                <ClipboardPaste size={15} />
              </button>
              <div className={`status-pill ${activeSession?.status || 'idle'}`}>
                {activeSession?.status || 'idle'}
              </div>
            </div>
          </div>

          <div className="terminal-stack">
            {sessions.length === 0 && (
              <div className="terminal-empty">
                <TerminalSquare size={34} />
                <span>Choose a saved connection or create a new one.</span>
              </div>
            )}
            {sessions.map((session) => (
              <TerminalPane
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onActionsReady={registerTerminalActions}
                onActionsDispose={unregisterTerminalActions}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ConnectionRow({
  connection,
  selected,
  onOpen,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleFavorite
}: {
  connection: Connection;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleFavorite: () => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const detail =
    connection.type === 'local'
      ? connection.localPath
      : formatSshEndpoint(connection);

  return (
    <div className={`connection-row ${selected ? 'selected' : ''}`}>
      <button className="favorite-button" onClick={onToggleFavorite} title="Favorite">
        {connection.favorite ? <Star size={15} fill="currentColor" /> : <StarOff size={15} />}
      </button>
      <button
        className="connection-main"
        onClick={onEdit}
        onDoubleClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        <span className="connection-color" style={{ backgroundColor: connection.color }} />
        <span className="connection-copy">
          <strong>{connection.name || 'Untitled'}</strong>
          <small>{detail}</small>
        </span>
      </button>
      <div className="connection-actions">
        <button title="Connect" onClick={onOpen}>
          <TerminalSquare size={15} />
        </button>
        <button title="Edit" onClick={onEdit}>
          <Edit3 size={15} />
        </button>
        <button title="More" onClick={() => setMenuOpen((value) => !value)}>
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div className="row-menu">
            <button onClick={onDuplicate}>
              <Copy size={14} /> Duplicate
            </button>
            <button onClick={onDelete}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionEditor({
  draft,
  mode,
  saving,
  message,
  onDraftChange,
  onPickFolder,
  onPickKey,
  onCollapse,
  onSave,
  onSaveAndOpen
}: {
  draft: DraftState;
  mode: EditorMode;
  saving: boolean;
  message?: string;
  onCollapse: () => void;
  onDraftChange: (key: string, value: unknown) => void;
  onPickFolder: () => void;
  onPickKey: () => void;
  onSave: () => void;
  onSaveAndOpen: () => void;
}): JSX.Element {
  return (
    <div className="editor-content">
      <div className="section-heading">
        <div>
          <div className="eyebrow">{mode === 'edit' ? 'Connection' : 'New connection'}</div>
          <h1>{draft.type === 'local' ? 'Local folder' : 'Remote SSH'}</h1>
        </div>
        <div className="heading-actions">
          <div className="type-chip">{draft.type}</div>
          <button className="panel-toggle-button" onClick={onCollapse} title="Collapse connection details">
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

      <div className="form-grid">
        <label>
          <span>Name</span>
          <input value={draft.name} onChange={(event) => onDraftChange('name', event.target.value)} />
        </label>

        <label>
          <span>Group</span>
          <input value={draft.group} onChange={(event) => onDraftChange('group', event.target.value)} />
        </label>

        <label className="wide">
          <span>Tags</span>
          <input
            value={draft.tags.join(', ')}
            onChange={(event) =>
              onDraftChange(
                'tags',
                event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              )
            }
          />
        </label>

        <div className="color-field">
          <span>Color</span>
          <div className="swatches">
            {COLORS.map((color) => (
              <button
                className={draft.color === color ? 'selected' : ''}
                key={color}
                style={{ backgroundColor: color }}
                onClick={() => onDraftChange('color', color)}
                title={color}
              >
                {draft.color === color && <Check size={13} />}
              </button>
            ))}
          </div>
        </div>

        <label className="check-line">
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(event) => onDraftChange('favorite', event.target.checked)}
          />
          <span>Favorite</span>
        </label>
      </div>

      {draft.type === 'local' ? (
        <LocalFields draft={draft} onDraftChange={onDraftChange} onPickFolder={onPickFolder} />
      ) : (
        <SshFields draft={draft} onDraftChange={onDraftChange} onPickKey={onPickKey} />
      )}

      {message && <div className="message-line">{message}</div>}

      <div className="editor-actions">
        <button className="secondary-button" onClick={onSave} disabled={saving}>
          Save
        </button>
        <button className="main-button" onClick={onSaveAndOpen} disabled={saving}>
          <Plus size={16} /> Save and open
        </button>
      </div>
    </div>
  );
}

function LocalFields({
  draft,
  onDraftChange,
  onPickFolder
}: {
  draft: Extract<DraftState, { type: 'local' }>;
  onDraftChange: (key: string, value: unknown) => void;
  onPickFolder: () => void;
}): JSX.Element {
  return (
    <div className="detail-block">
      <div className="block-title">
        <HardDrive size={17} /> Local
      </div>
      <label className="path-field">
        <span>Folder</span>
        <div>
          <input
            value={draft.localPath}
            onChange={(event) => onDraftChange('localPath', event.target.value)}
          />
          <button onClick={onPickFolder} title="Browse">
            <FolderOpen size={16} />
          </button>
        </div>
      </label>
      <label>
        <span>Shell</span>
        <select
          value={draft.shell}
          onChange={(event) => onDraftChange('shell', event.target.value as ShellKind)}
        >
          <option value="zsh">zsh</option>
          <option value="bash">bash</option>
          <option value="sh">sh</option>
          <option value="custom">Custom shell</option>
        </select>
      </label>
      {draft.shell === 'custom' && (
        <label>
          <span>Shell path</span>
          <input
            value={draft.shellPath || ''}
            onChange={(event) => onDraftChange('shellPath', event.target.value)}
          />
        </label>
      )}
    </div>
  );
}

function SshFields({
  draft,
  onDraftChange,
  onPickKey
}: {
  draft: Extract<DraftState, { type: 'ssh' }>;
  onDraftChange: (key: string, value: unknown) => void;
  onPickKey: () => void;
}): JSX.Element {
  return (
    <div className="detail-block">
      <div className="block-title">
        <Server size={17} /> SSH
      </div>
      <div className="inline-grid">
        <label>
          <span>Host</span>
          <input value={draft.host} onChange={(event) => onDraftChange('host', event.target.value)} />
        </label>
        <label>
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(event) => onDraftChange('port', Number(event.target.value))}
          />
        </label>
      </div>
      <label>
        <span>User</span>
        <input value={draft.username} onChange={(event) => onDraftChange('username', event.target.value)} />
      </label>
      <label>
        <span>SSH config alias</span>
        <input
          value={draft.sshConfigHost || ''}
          onChange={(event) => onDraftChange('sshConfigHost', event.target.value)}
        />
      </label>
      <div className="auth-row">
        {(['agent', 'key', 'password'] as SshAuthType[]).map((authType) => (
          <button
            className={draft.authType === authType ? 'active' : ''}
            key={authType}
            onClick={() => onDraftChange('authType', authType)}
          >
            {authType === 'agent' && <Braces size={15} />}
            {authType === 'key' && <KeyRound size={15} />}
            {authType === 'password' && <ChevronsUpDown size={15} />}
            {authType}
          </button>
        ))}
      </div>

      {draft.authType === 'key' && (
        <label className="path-field">
          <span>Private key</span>
          <div>
            <input
              value={draft.keyPath || ''}
              onChange={(event) => onDraftChange('keyPath', event.target.value)}
            />
            <button onClick={onPickKey} title="Browse">
              <FolderOpen size={16} />
            </button>
          </div>
        </label>
      )}

      {draft.authType === 'password' && (
        <>
          <label>
            <span>Password</span>
            <input
              type="password"
              placeholder={draft.hasPassword ? 'Saved password' : ''}
              value={draft.password || ''}
              onChange={(event) => onDraftChange('password', event.target.value)}
            />
          </label>
          {draft.hasPassword && (
            <label className="check-line">
              <input
                type="checkbox"
                checked={Boolean(draft.clearPassword)}
                onChange={(event) => onDraftChange('clearPassword', event.target.checked)}
              />
              <span>Clear saved password</span>
            </label>
          )}
        </>
      )}

      <label>
        <span>Remote folder</span>
        <input
          value={draft.remotePath || ''}
          onChange={(event) => onDraftChange('remotePath', event.target.value)}
        />
      </label>
      <label>
        <span>Extra ssh args</span>
        <input
          value={draft.extraArgs || ''}
          onChange={(event) => onDraftChange('extraArgs', event.target.value)}
        />
      </label>
    </div>
  );
}

function TerminalPane({
  session,
  active,
  onActionsReady,
  onActionsDispose
}: {
  session: SessionInfo;
  active: boolean;
  onActionsReady: (sessionId: string, actions: TerminalActions) => void;
  onActionsDispose: (sessionId: string) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  const actionsRef = useRef<TerminalActions | null>(null);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | undefined>();

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 8000,
      convertEol: true,
      theme: {
        background: '#101113',
        foreground: '#f4f4f5',
        cursor: '#f4f4f5',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#38bdf8',
        magenta: '#d946ef',
        cyan: '#14b8a6',
        white: '#f4f4f5',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#7dd3fc',
        brightMagenta: '#f0abfc',
        brightCyan: '#5eead4',
        brightWhite: '#ffffff'
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(containerRef.current as HTMLDivElement);
    terminal.focus();

    const copySelection = (): void => {
      const selection = terminal.getSelection();
      if (selection) {
        window.terminalApi.writeClipboardText(selection);
      }
    };

    const pasteClipboard = (): void => {
      const text = window.terminalApi.readClipboardText();
      if (text) {
        window.terminalApi.writeSession(session.id, text);
      }
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true;
      }

      if (event.metaKey && event.code === 'KeyC') {
        copySelection();
        return false;
      }

      if (event.metaKey && event.code === 'KeyV') {
        pasteClipboard();
        return false;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        copySelection();
        return false;
      }

      if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
        pasteClipboard();
        return false;
      }

      if (event.ctrlKey && !event.shiftKey && event.code === 'KeyC') {
        if (terminal.getSelection()) {
          copySelection();
          return false;
        }

        return true;
      }

      if (event.ctrlKey && !event.shiftKey && event.code === 'KeyV') {
        pasteClipboard();
        return false;
      }

      if (event.ctrlKey && event.code === 'Insert') {
        copySelection();
        return false;
      }

      if (event.shiftKey && event.code === 'Insert') {
        pasteClipboard();
        return false;
      }

      return true;
    });

    const actions = {
      copy: copySelection,
      paste: pasteClipboard
    };

    actionsRef.current = actions;
    onActionsReady(session.id, actions);

    terminal.onData((data) => {
      window.terminalApi.writeSession(session.id, data);
    });
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      if (!activeRef.current) {
        return;
      }
      try {
        fitAddon.fit();
        window.terminalApi.resizeSession(session.id, terminal.cols, terminal.rows);
      } catch {
        // xterm can throw while the pane is transitioning from hidden to visible.
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    const offData = window.terminalApi.onSessionData((event) => {
      if (event.sessionId === session.id) {
        terminal.write(event.data);
      }
    });

    window.setTimeout(() => {
      try {
        fitAddon.fit();
        window.terminalApi.resizeSession(session.id, terminal.cols, terminal.rows);
      } catch {
        // Initial fit is best effort until layout settles.
      }
    }, 60);

    return () => {
      actionsRef.current = null;
      onActionsDispose(session.id);
      offData();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [onActionsDispose, onActionsReady, session.id]);

  useEffect(() => {
    if (!active || !terminalRef.current || !fitRef.current) {
      return;
    }

    window.setTimeout(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
      if (terminalRef.current) {
        window.terminalApi.resizeSession(session.id, terminalRef.current.cols, terminalRef.current.rows);
      }
    }, 40);
  }, [active, session.id]);

  useEffect(() => {
    if (!active) {
      setContextMenu(undefined);
    }
  }, [active]);

  const showContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    terminalRef.current?.focus();

    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      left: clamp(event.clientX - rect.left, 8, rect.width - 150),
      top: clamp(event.clientY - rect.top, 8, rect.height - 84)
    });
  };

  const hideContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (!(event.target as HTMLElement).closest('.terminal-context-menu')) {
      setContextMenu(undefined);
    }
  };

  return (
    <div
      className={`terminal-pane ${active ? 'active' : ''}`}
      onContextMenu={showContextMenu}
      onMouseDown={hideContextMenu}
    >
      <div className="terminal-mount" ref={containerRef} />
      {contextMenu && (
        <div
          className="terminal-context-menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              actionsRef.current?.copy();
              setContextMenu(undefined);
            }}
          >
            <Copy size={14} /> Copy
          </button>
          <button
            onClick={() => {
              actionsRef.current?.paste();
              setContextMenu(undefined);
            }}
          >
            <ClipboardPaste size={14} /> Paste
          </button>
        </div>
      )}
    </div>
  );
}

function validateDraft(draft: DraftState): string | undefined {
  if (!draft.name.trim()) {
    return 'Name is required.';
  }

  if (draft.type === 'local') {
    if (!draft.localPath.trim()) {
      return 'Folder is required.';
    }

    if (draft.shell === 'custom' && !draft.shellPath?.trim()) {
      return 'Custom shell path is required.';
    }
  }

  if (draft.type === 'ssh') {
    if (!draft.host.trim() && !draft.sshConfigHost?.trim()) {
      return 'Host is required.';
    }

    if (draft.port < 1 || draft.port > 65535) {
      return 'Port must be between 1 and 65535.';
    }

    if (draft.authType === 'key' && !draft.keyPath?.trim()) {
      return 'Private key is required.';
    }
  }

  return undefined;
}

function readCollapsedConnectionGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function formatSshEndpoint(connection: Pick<SshConnection, 'host' | 'port' | 'username'>): string {
  const target = connection.username ? `${connection.username}@${connection.host}` : connection.host;
  return `${target}:${connection.port}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
