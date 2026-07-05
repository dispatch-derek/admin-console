// App shell. Wraps the session context and gates the whole console behind authentication: an
// unauthenticated user always sees the login FSM; an authenticated user gets a top-level nav that
// switches between the feature areas (a simple in-app view switch — no router library needed).

import { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { WorkspaceList } from './features/workspaces/WorkspaceList';
import { UsersView } from './features/users/UsersView';
import { SettingsPage } from './features/settings/SettingsPage';
import { RawEnvEditor } from './features/raweditor/RawEnvEditor';
import { DiagnosticsPage } from './features/diagnostics/DiagnosticsPage';

type View = 'workspaces' | 'users' | 'settings' | 'raw' | 'diagnostics';

const NAV: { id: View; label: string }[] = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' },
  { id: 'raw', label: 'Raw Editor' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

function Console() {
  const { staff, loading, login, logout } = useAuth();
  const [view, setView] = useState<View>('workspaces');

  if (loading) return <div className="app-loading">Loading…</div>;
  if (!staff) return <LoginPage onAuthenticated={login} />;

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">AnythingLLM Admin Console</span>
        <nav className="top-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : undefined}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <span className="app-user">
          {staff.username}
          <button type="button" className="link-button" onClick={() => void logout()}>
            Sign out
          </button>
        </span>
      </header>

      <main className="app-main">
        {view === 'workspaces' && <WorkspaceList />}
        {view === 'users' && <UsersView />}
        {view === 'settings' && <SettingsPage />}
        {view === 'raw' && <RawEnvEditor />}
        {view === 'diagnostics' && <DiagnosticsPage />}
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
