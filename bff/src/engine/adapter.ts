// The single typed gateway to AnythingLLM `/api/v1` (REQ-013, REQ-026). ONLY module that
// references engine paths + field names. Attaches the Bearer key (REQ-013), URL-encodes
// opaque handles (REQ-022), and throws EngineError { status, body } on non-OK (REQ-023).
// It does NOT verify, emit, or audit — that is the service layer's job (01-bff §chain).

import { config } from '../config.js';
import { EngineError } from '../server/errors.js';
import type {
  EngineChatPage,
  EngineChatQuery,
  EngineDocument,
  EngineInvite,
  EngineNewUser,
  EngineNewWorkspace,
  EngineSystem,
  EngineUser,
  EngineUserUpdate,
  EngineWorkspace,
  EngineWorkspaceUpdate,
  OllamaModel,
} from './engine-types.js';

// Bearer key attached server-side (REQ-013) — never leaves the BFF (boundary rule 4).
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.anythingLLMApiKey}` };
}

const enc = encodeURIComponent;

export interface EngineAdapter {
  // Workspaces (§5)
  listWorkspaces(): Promise<EngineWorkspace[]>;
  getWorkspace(slug: string): Promise<EngineWorkspace | null>;
  createWorkspace(body: EngineNewWorkspace): Promise<EngineWorkspace>;
  updateWorkspace(slug: string, body: Partial<EngineWorkspaceUpdate>): Promise<void>;
  deleteWorkspace(slug: string): Promise<void>;
  updateEmbeddings(slug: string, adds: string[], deletes: string[]): Promise<void>;
  updatePin(slug: string, docPath: string, pinned: boolean): Promise<void>;
  listDocuments(): Promise<EngineDocument[]>;

  // Users / invites / membership (§6) — require multi-user ON
  isMultiUserMode(): Promise<boolean>;
  listUsers(): Promise<EngineUser[]>;
  createUser(body: EngineNewUser): Promise<EngineUser>;
  updateUser(id: number, body: Partial<EngineUserUpdate>): Promise<void>;
  deleteUser(id: number): Promise<void>;
  listInvites(): Promise<EngineInvite[]>;
  createInvite(workspaceIds?: number[]): Promise<EngineInvite>;
  deleteInvite(id: number): Promise<void>;
  listWorkspaceMembers(workspaceId: number): Promise<EngineUser[]>;
  manageWorkspaceUsers(slug: string, userIds: number[], reset: boolean): Promise<void>;
  workspaceChats(query: EngineChatQuery): Promise<EngineChatPage>;

  // System settings (§7)
  getSystem(): Promise<EngineSystem>;
  updateEnv(patch: Record<string, string | number | boolean | null>): Promise<void>;
  envDump(): Promise<Record<string, string>>;
  vectorCount(): Promise<number>;

  // Ollama discovery (via basePath, not /api/v1)
  ollamaTags(basePath: string): Promise<OllamaModel[]>;
}

class HttpEngineAdapter implements EngineAdapter {
  private readonly base = `${config.anythingLLMBaseUrl}/api/v1`;

  // Core request runner: attaches auth, parses JSON, and normalizes every non-OK or
  // network failure into a typed EngineError for server/errors.ts to map (REQ-023).
  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const headers: Record<string, string> = { ...authHeaders(), Accept: 'application/json' };
    const opts: RequestInit = { method: init?.method ?? 'GET', headers };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(init.body);
    }

    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, opts);
    } catch (cause) {
      // Network/DNS/timeout — status 0 maps to the retryable "unavailable" message.
      throw new EngineError(0, { error: String(cause) });
    }

    if (!res.ok) {
      throw new EngineError(res.status, await this.safeBody(res));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? (JSON.parse(text) as T) : (undefined as T));
  }

  // Best-effort body parse for error mapping; never throws.
  private async safeBody(res: Response): Promise<unknown> {
    try {
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch {
      return null;
    }
  }

  async listWorkspaces(): Promise<EngineWorkspace[]> {
    const data = await this.request<{ workspaces?: EngineWorkspace[] }>('/workspaces');
    return data?.workspaces ?? [];
  }

  async getWorkspace(slug: string): Promise<EngineWorkspace | null> {
    try {
      const data = await this.request<{ workspace?: EngineWorkspace | EngineWorkspace[] }>(
        `/workspace/${enc(slug)}`,
      );
      const w = Array.isArray(data?.workspace) ? data.workspace[0] : data?.workspace;
      return w ?? null;
    } catch (err) {
      if (err instanceof EngineError && err.status === 404) return null;
      throw err;
    }
  }

  async createWorkspace(body: EngineNewWorkspace): Promise<EngineWorkspace> {
    const data = await this.request<{ workspace: EngineWorkspace }>('/workspace/new', {
      method: 'POST',
      body,
    });
    return data.workspace;
  }

  async updateWorkspace(slug: string, body: Partial<EngineWorkspaceUpdate>): Promise<void> {
    await this.request<unknown>(`/workspace/${enc(slug)}/update`, { method: 'POST', body });
  }

  async deleteWorkspace(slug: string): Promise<void> {
    await this.request<unknown>(`/workspace/${enc(slug)}`, { method: 'DELETE' });
  }

  async updateEmbeddings(slug: string, adds: string[], deletes: string[]): Promise<void> {
    await this.request<unknown>(`/workspace/${enc(slug)}/update-embeddings`, {
      method: 'POST',
      body: { adds, deletes },
    });
  }

  async updatePin(slug: string, docPath: string, pinned: boolean): Promise<void> {
    await this.request<unknown>(`/workspace/${enc(slug)}/update-pin`, {
      method: 'POST',
      body: { docPath, pinStatus: pinned },
    });
  }

  async listDocuments(): Promise<EngineDocument[]> {
    const data = await this.request<{ localFiles?: unknown; documents?: EngineDocument[] }>(
      '/documents',
    );
    return data?.documents ?? [];
  }

  async isMultiUserMode(): Promise<boolean> {
    const data = await this.request<{ isMultiUser?: boolean }>('/admin/is-multi-user-mode');
    return data?.isMultiUser ?? false;
  }

  async listUsers(): Promise<EngineUser[]> {
    const data = await this.request<{ users?: EngineUser[] }>('/admin/users');
    return data?.users ?? [];
  }

  async createUser(body: EngineNewUser): Promise<EngineUser> {
    const data = await this.request<{ user: EngineUser }>('/admin/users/new', {
      method: 'POST',
      body,
    });
    return data.user;
  }

  async updateUser(id: number, body: Partial<EngineUserUpdate>): Promise<void> {
    await this.request<unknown>(`/admin/users/${enc(String(id))}`, { method: 'POST', body });
  }

  async deleteUser(id: number): Promise<void> {
    await this.request<unknown>(`/admin/users/${enc(String(id))}`, { method: 'DELETE' });
  }

  async listInvites(): Promise<EngineInvite[]> {
    const data = await this.request<{ invites?: EngineInvite[] }>('/admin/invites');
    return data?.invites ?? [];
  }

  async createInvite(workspaceIds?: number[]): Promise<EngineInvite> {
    const data = await this.request<{ invite: EngineInvite }>('/admin/invite/new', {
      method: 'POST',
      body: { workspaceIds: workspaceIds ?? [] },
    });
    return data.invite;
  }

  async deleteInvite(id: number): Promise<void> {
    await this.request<unknown>(`/admin/invite/${enc(String(id))}`, { method: 'DELETE' });
  }

  async listWorkspaceMembers(workspaceId: number): Promise<EngineUser[]> {
    const data = await this.request<{ users?: EngineUser[] }>(
      `/admin/workspaces/${enc(String(workspaceId))}/users`,
    );
    return data?.users ?? [];
  }

  async manageWorkspaceUsers(slug: string, userIds: number[], reset: boolean): Promise<void> {
    await this.request<unknown>(`/admin/workspaces/${enc(slug)}/manage-users`, {
      method: 'POST',
      body: { userIds, reset },
    });
  }

  async workspaceChats(query: EngineChatQuery): Promise<EngineChatPage> {
    const data = await this.request<EngineChatPage>('/admin/workspace-chats', {
      method: 'POST',
      body: query,
    });
    return data ?? { chats: [] };
  }

  async getSystem(): Promise<EngineSystem> {
    const data = await this.request<{ settings?: Record<string, string | number | boolean | null> }>(
      '/system',
    );
    return { settings: data?.settings ?? {} };
  }

  async updateEnv(patch: Record<string, string | number | boolean | null>): Promise<void> {
    await this.request<unknown>('/system/update-env', { method: 'POST', body: patch });
  }

  async envDump(): Promise<Record<string, string>> {
    const data = await this.request<Record<string, string>>('/system/env-dump');
    return data ?? {};
  }

  async vectorCount(): Promise<number> {
    const data = await this.request<{ vectorCount?: number }>('/system/vector-count');
    return data?.vectorCount ?? 0;
  }

  // Ollama discovery calls the model host directly (REQ-075), NOT /api/v1, and without the
  // engine Bearer key. The browser never calls this; the BFF proxies it server-side.
  async ollamaTags(basePath: string): Promise<OllamaModel[]> {
    const base = basePath.replace(/\/$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/api/tags`, { headers: { Accept: 'application/json' } });
    } catch (cause) {
      throw new EngineError(0, { error: String(cause) });
    }
    if (!res.ok) throw new EngineError(res.status, await this.safeBody(res));
    const data = (await res.json()) as { models?: OllamaModel[] };
    return data?.models ?? [];
  }
}

// Singleton — the app holds one adapter (REQ-026).
export const engineAdapter: EngineAdapter = new HttpEngineAdapter();
