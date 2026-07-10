// App shell. Wraps the session context and gates the whole console behind authentication: an
// unauthenticated user always sees the login FSM; an authenticated user gets the AnythingLLM-style
// settings shell — a dark left sidebar grouped into sections (mirroring the native AnythingLLM
// admin settings sidebar: AI Providers, Admin, Agent Skills, Tools, Security) with a single main
// panel on the right (a simple in-app view switch — no router library needed).

import { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { WorkspaceList } from './features/workspaces/WorkspaceList';
import { UserList } from './features/users/UserList';
import { InviteList } from './features/users/InviteList';
import { MembershipPanel } from './features/users/MembershipPanel';
import { ChatOversight } from './features/users/ChatOversight';
import { MultiUserGate } from './features/users/MultiUserGate';
import { SettingsPage } from './features/settings/SettingsPage';
import { RawEnvEditor } from './features/raweditor/RawEnvEditor';
import { DiagnosticsPage } from './features/diagnostics/DiagnosticsPage';
import { BaselinePromptPage } from './features/baseline-prompt/BaselinePromptPage';
import { SidebarItem, PageHeader, Button } from './design-system';

type View =
  | 'llm'
  | 'vectorDb'
  | 'embedding'
  | 'tts'
  | 'stt'
  | 'workspaces'
  | 'users'
  | 'invites'
  | 'membership'
  | 'oversight'
  | 'baseline'
  | 'agentSkills'
  | 'raw'
  | 'diagnostics'
  | 'security';

interface NavItem {
  id: View;
  label: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    label: 'AI Providers',
    items: [
      { id: 'llm', label: 'LLM' },
      { id: 'vectorDb', label: 'Vector Database' },
      { id: 'embedding', label: 'Embedder' },
      { id: 'tts', label: 'Voice & Speech' },
      { id: 'stt', label: 'Transcription' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { id: 'users', label: 'Users' },
      { id: 'workspaces', label: 'Workspaces' },
      { id: 'oversight', label: 'Workspace Chats' },
      { id: 'invites', label: 'Invites' },
      { id: 'membership', label: 'Membership' },
    ],
  },
  {
    label: 'Customer-wide',
    items: [{ id: 'baseline', label: 'Baseline Prompt' }],
  },
  {
    label: 'Agent Skills',
    items: [{ id: 'agentSkills', label: 'Agent Skills' }],
  },
  {
    label: 'Tools',
    items: [
      { id: 'diagnostics', label: 'Diagnostics' },
      { id: 'raw', label: 'Raw Env Editor' },
    ],
  },
  {
    label: 'Security',
    items: [{ id: 'security', label: 'Security' }],
  },
];

const PAGE_META: Record<View, { title: string; description: string }> = {
  llm: { title: 'LLM Preference', description: 'Instance-wide language model provider, model, and credentials.' },
  vectorDb: { title: 'Vector Database', description: 'The vector store used to embed and retrieve document context.' },
  embedding: { title: 'Embedder Preference', description: 'The embedding engine and model used to vectorize documents.' },
  tts: { title: 'Voice & Speech (Text-to-Speech)', description: 'Provider used to synthesize spoken responses.' },
  stt: { title: 'Transcription (Speech-to-Text)', description: 'Provider used to transcribe uploaded audio and voice input.' },
  workspaces: { title: 'Workspaces', description: 'Create, configure, and delete workspaces.' },
  users: { title: 'Users', description: 'Manage user accounts, roles, and access.' },
  invites: { title: 'Invites', description: 'Invite new users, optionally scoped to specific workspaces.' },
  membership: { title: 'Workspace Membership', description: 'Control which users can access which workspaces.' },
  oversight: { title: 'Workspace Chats', description: 'Review chat history across all workspaces.' },
  baseline: {
    title: 'Customer-wide Baseline Prompt',
    description: 'Define one baseline system prompt and fan it out to every workspace.',
  },
  agentSkills: { title: 'Agent Skills', description: 'API keys and configuration for @agent tool-use skills.' },
  raw: { title: 'Raw Env Editor', description: 'Advanced: edit environment keys directly, bypassing curated controls.' },
  diagnostics: { title: 'Diagnostics', description: 'Vector counts and a masked environment dump for troubleshooting.' },
  security: { title: 'Security', description: 'Auth token, JWT secret, telemetry, and instance security flags.' },
};

const SETTINGS_VIEWS = new Set<View>(['llm', 'vectorDb', 'embedding', 'tts', 'stt', 'agentSkills', 'security']);

function Console() {
  const { staff, loading, login, logout } = useAuth();
  const [view, setView] = useState<View>('llm');

  if (loading) return <div className="ac-app-loading">Loading…</div>;
  if (!staff) return <LoginPage onAuthenticated={login} />;

  const meta = PAGE_META[view];

  return (
    <div className="ac-app">
      <aside className="ac-app-sidebar">
        <div className="ac-app-brand">AnythingLLM Admin Console</div>
        <nav className="ac-sidebar-nav">
          {NAV.map((section) => (
            <div key={section.label} className="ac-sidebar-section">
              <div className="ac-sidebar-section-label">{section.label}</div>
              {section.items.map((item) => (
                <SidebarItem
                  key={item.id}
                  className="ac-sidebar-item"
                  label={item.label}
                  active={view === item.id}
                  onClick={() => setView(item.id)}
                />
              ))}
            </div>
          ))}
        </nav>
        <div className="ac-sidebar-footer">
          <span className="ac-app-user">{staff.username}</span>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </aside>

      <main className="ac-app-main">
        <PageHeader className="ac-page-header" title={meta.title} description={meta.description} />

        <div className="ac-page-body">
          {SETTINGS_VIEWS.has(view) && <SettingsPage categoryIds={[view]} />}
          {view === 'workspaces' && <WorkspaceList />}
          {view === 'baseline' && <BaselinePromptPage />}
          {view === 'raw' && <RawEnvEditor />}
          {view === 'diagnostics' && <DiagnosticsPage />}
          {(view === 'users' || view === 'invites' || view === 'membership' || view === 'oversight') && (
            <MultiUserGate>
              {view === 'users' && <UserList />}
              {view === 'invites' && <InviteList />}
              {view === 'membership' && <MembershipPanel />}
              {view === 'oversight' && <ChatOversight />}
            </MultiUserGate>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Console />
    </AuthProvider>
  );
}
