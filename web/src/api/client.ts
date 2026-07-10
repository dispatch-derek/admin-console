// Typed product API client. ALL paths are relative — Vite proxies /api/* to the BFF, which
// injects the upstream key (the key never reaches this module). On a non-OK response we throw an
// ApiError carrying the BFF { message } for verbatim display (REQ-097a). A 204 resolves to void.
// A 401 anywhere fires the registered unauthorized handler so AuthContext can clear session state
// and route to login (REQ-012/014).

import { ApiError, apiErrorFrom } from './errors';
import type {
  BaselineApplyRequest,
  BaselineApplyResult,
  BaselinePreview,
  BaselinePrompt,
  BaselineStatusView,
  DocumentRef,
  EnrollResult,
  Invite,
  LoginStage,
  OllamaModelsResult,
  OperatorMode,
  OversightChatPage,
  RawEnvEntry,
  SessionResult,
  SettingsPatch,
  SettingsView,
  SettingsWriteResult,
  StageOrSession,
  Staff,
  User,
  Workspace,
  WorkspaceSettings,
} from './types';

// --- 401 dispatch -----------------------------------------------------------------------------

let onUnauthorized: (() => void) | null = null;

// AuthContext registers the handler that clears session state on any 401 (REQ-014).
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

// --- core request helper ----------------------------------------------------------------------

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(path, init);

  if (res.status === 401) {
    // Fire the global handler, then still throw so the caller's flow unwinds.
    if (onUnauthorized) onUnauthorized();
  }

  if (!res.ok) {
    throw await apiErrorFrom(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// --- Auth (§3.2) ------------------------------------------------------------------------------

export function login(username: string, password: string): Promise<LoginStage> {
  return request('/api/auth/login', { method: 'POST', body: { username, password } });
}

export function setPassword(challengeId: string, newPassword: string): Promise<LoginStage> {
  return request('/api/auth/set-password', {
    method: 'POST',
    body: { challengeId, newPassword },
  });
}

export function enroll(challengeId: string, code: string): Promise<EnrollResult> {
  return request('/api/auth/enroll', { method: 'POST', body: { challengeId, code } });
}

export function mfa(challengeId: string, code: string): Promise<SessionResult> {
  return request('/api/auth/mfa', { method: 'POST', body: { challengeId, code } });
}

export function recovery(
  username: string,
  password: string,
  recoveryCode: string,
): Promise<StageOrSession> {
  return request('/api/auth/recovery', {
    method: 'POST',
    body: { username, password, recoveryCode },
  });
}

export function logout(): Promise<void> {
  return request('/api/auth/logout', { method: 'POST' });
}

export function me(): Promise<SessionResult> {
  return request('/api/auth/me');
}

// --- Staff lifecycle --------------------------------------------------------------------------

export function listStaff(): Promise<Staff[]> {
  return request('/api/staff');
}

export function createStaff(username: string): Promise<Staff> {
  return request('/api/staff', { method: 'POST', body: { username } });
}

export function patchStaff(id: string, patch: { disabled: boolean }): Promise<Staff> {
  return request(`/api/staff/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export function deleteStaff(id: string): Promise<void> {
  return request(`/api/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function resetStaffPassword(id: string): Promise<{ tempToken: string }> {
  return request(`/api/staff/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
}

export function resetStaffMfa(id: string): Promise<void> {
  return request(`/api/staff/${encodeURIComponent(id)}/reset-mfa`, { method: 'POST' });
}

// --- Workspaces (§5) --------------------------------------------------------------------------

export function listWorkspaces(): Promise<Workspace[]> {
  return request('/api/workspaces');
}

export function getWorkspace(id: string): Promise<WorkspaceSettings> {
  return request(`/api/workspaces/${encodeURIComponent(id)}`);
}

export function createWorkspace(displayName: string): Promise<Workspace> {
  return request('/api/workspaces', { method: 'POST', body: { displayName } });
}

export function updateWorkspaceSettings(
  id: string,
  patch: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/settings`, {
    method: 'PATCH',
    body: patch,
  });
}

export function deleteWorkspace(id: string): Promise<void> {
  return request(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function changeKnowledge(
  id: string,
  body: { adds?: string[]; deletes?: string[] },
): Promise<WorkspaceSettings> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/knowledge`, {
    method: 'PUT',
    body,
  });
}

export function pinKnowledge(
  id: string,
  body: { docPath: string; pinned: boolean },
): Promise<void> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/knowledge/pin`, {
    method: 'POST',
    body,
  });
}

export function listDocuments(): Promise<DocumentRef[]> {
  return request('/api/documents');
}

// --- Users / invites / membership / oversight (§6) --------------------------------------------

export function getMultiUserStatus(): Promise<{ enabled: boolean }> {
  return request('/api/multi-user-status');
}

export function listUsers(): Promise<User[]> {
  return request('/api/users');
}

export function createUser(body: {
  username: string;
  password: string;
  role: string;
}): Promise<User> {
  return request('/api/users', { method: 'POST', body });
}

export function updateUser(
  id: string,
  patch: { role?: string; suspended?: boolean; dailyMessageLimit?: number | null },
): Promise<User> {
  return request(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export function deleteUser(id: string): Promise<void> {
  return request(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function listInvites(): Promise<Invite[]> {
  return request('/api/invites');
}

export function createInvite(workspaceIds: string[]): Promise<Invite> {
  return request('/api/invites', { method: 'POST', body: { workspaceIds } });
}

export function deleteInvite(id: string): Promise<void> {
  return request(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function listMembers(id: string): Promise<User[]> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/members`);
}

export function updateMembers(
  id: string,
  body: { userIds: string[]; reset: boolean },
): Promise<User[]> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/members`, {
    method: 'POST',
    body,
  });
}

export function getOversightChats(params: {
  workspace?: string;
  limit?: number;
  offset?: number;
}): Promise<OversightChatPage> {
  return request(`/api/oversight/chats${query(params)}`);
}

// --- Settings / raw / diagnostics / discovery (§7) --------------------------------------------

export function getSettings(): Promise<SettingsView> {
  return request('/api/settings');
}

export function patchSettings(patch: SettingsPatch): Promise<SettingsWriteResult> {
  return request('/api/settings', { method: 'PATCH', body: patch });
}

export function getRawEnv(): Promise<RawEnvEntry[]> {
  return request('/api/settings/raw');
}

export function putRawEnv(
  writes: { key: string; value: string }[],
): Promise<{ verified: boolean; keys: string[] }> {
  return request('/api/settings/raw', { method: 'PUT', body: { writes } });
}

export function getVectorCount(): Promise<{ vectorCount: number }> {
  return request('/api/diagnostics/vectors');
}

export function getEnvDump(): Promise<Record<string, unknown>> {
  return request('/api/diagnostics/env');
}

export function getOllamaModels(): Promise<OllamaModelsResult> {
  return request('/api/models/ollama');
}

// --- Customer-wide baseline system prompt (F-002, §7.2) ---------------------------------------

export function getBaselinePrompt(): Promise<BaselinePrompt> {
  return request('/api/baseline-prompt');
}

export function putBaselinePrompt(text: string): Promise<BaselinePrompt> {
  return request('/api/baseline-prompt', { method: 'PUT', body: { text } });
}

export function clearBaselinePrompt(): Promise<BaselinePrompt> {
  return request('/api/baseline-prompt', { method: 'DELETE' });
}

export function getBaselineStatus(): Promise<BaselineStatusView> {
  return request('/api/baseline-prompt/status');
}

export function getBaselinePreview(mode: OperatorMode): Promise<BaselinePreview> {
  return request(`/api/baseline-prompt/preview${query({ mode })}`);
}

export function applyBaselinePrompt(body: BaselineApplyRequest): Promise<BaselineApplyResult> {
  return request('/api/baseline-prompt/apply', { method: 'POST', body });
}

export { ApiError };
