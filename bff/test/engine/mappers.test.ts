// engine/mappers.ts — product↔engine workspace field translation (§5.2, REQ-032/033/034/
// 035/036/036b). Pure module (no config/db imports), so ordinary static imports are safe.
// These tests are derived from the spec's product↔engine field map, not from reading the
// mapper source beforehand.

import { describe, it, expect } from 'vitest';
import {
  documentPaths,
  parseInviteWorkspaceIds,
  toDocumentRef,
  toInvite,
  toOversightPage,
  toUser,
  toUserUpdate,
  toWorkspace,
  toWorkspaceSettings,
  toWorkspaceUpdate,
  validateWorkspacePatch,
} from '../../src/engine/mappers.js';
import { AppError } from '../../src/server/errors.js';
import type {
  EngineChatPage,
  EngineDocument,
  EngineInvite,
  EngineUser,
  EngineWorkspace,
} from '../../src/engine/engine-types.js';
import type { WorkspaceSettings } from '../../src/types/product-types.js';

// A fully-populated engine workspace fixture (REQ-032 grounding §3 shape).
function engineWorkspaceFixture(overrides: Partial<EngineWorkspace> = {}): EngineWorkspace {
  return {
    id: 42,
    name: 'Support KB',
    slug: 'support-kb',
    chatProvider: 'openai',
    chatModel: 'gpt-4',
    chatMode: 'chat',
    openAiTemp: 0.7,
    openAiHistory: 20,
    openAiPrompt: 'You are a helpful assistant.',
    similarityThreshold: 0.25,
    topN: 4,
    agentProvider: 'openai',
    agentModel: 'gpt-4o',
    queryRefusalResponse: 'I cannot answer that.',
    vectorSearchMode: 'default',
    pfpFilename: 'avatar.png',
    documents: [
      { id: 'doc-1', name: 'file1.txt', title: 'File One', docpath: 'custom-documents/file1.txt', pinned: true },
      { name: 'file2.txt' }, // no id/title/docpath — falls back to `name`
    ],
    ...overrides,
  };
}

describe('toWorkspace — REQ-032 list-shape mapping', () => {
  it('maps every product summary field to its engine source', () => {
    const engine = engineWorkspaceFixture();
    const ws = toWorkspace(engine, 'product-id-1');

    expect(ws.id).toBe('product-id-1');
    expect(ws.displayName).toBe(engine.name);
    expect(ws.llmProvider).toBe(engine.chatProvider);
    expect(ws.llmModel).toBe(engine.chatModel);
  });

  it('exposes ONLY the four product summary fields — no engine field names leak through', () => {
    const ws = toWorkspace(engineWorkspaceFixture(), 'pid');
    expect(Object.keys(ws).sort()).toEqual(['displayName', 'id', 'llmModel', 'llmProvider']);
  });

  it('passes through null llmProvider/llmModel (engine chatProvider/chatModel unset)', () => {
    const ws = toWorkspace(engineWorkspaceFixture({ chatProvider: null, chatModel: null }), 'pid');
    expect(ws.llmProvider).toBeNull();
    expect(ws.llmModel).toBeNull();
  });
});

describe('toWorkspaceSettings — REQ-032 full detail-shape mapping', () => {
  it('maps every editable product field to its engine source, per the REQ-032 table', () => {
    const engine = engineWorkspaceFixture();
    const settings = toWorkspaceSettings(engine, 'product-id-1');

    expect(settings).toMatchObject({
      id: 'product-id-1',
      displayName: engine.name,
      llmProvider: engine.chatProvider,
      llmModel: engine.chatModel,
      responseMode: engine.chatMode,
      temperature: engine.openAiTemp,
      historyWindow: engine.openAiHistory,
      systemPrompt: engine.openAiPrompt,
      retrievalThreshold: engine.similarityThreshold,
      retrievalTopN: engine.topN,
      agentLlmProvider: engine.agentProvider,
      agentLlmModel: engine.agentModel,
      noResultsMessage: engine.queryRefusalResponse,
      retrievalMode: engine.vectorSearchMode,
      avatar: engine.pfpFilename,
    });
  });

  it('exposes exactly the WorkspaceSettings product fields — engine `documents`/`slug`/`id` (numeric) never leak', () => {
    const settings = toWorkspaceSettings(engineWorkspaceFixture(), 'pid');
    expect(Object.keys(settings).sort()).toEqual(
      [
        'agentLlmModel',
        'agentLlmProvider',
        'avatar',
        'displayName',
        'historyWindow',
        'id',
        'llmModel',
        'llmProvider',
        'noResultsMessage',
        'responseMode',
        'retrievalMode',
        'retrievalThreshold',
        'retrievalTopN',
        'systemPrompt',
        'temperature',
      ].sort(),
    );
    expect((settings as unknown as { documents?: unknown }).documents).toBeUndefined();
  });
});

describe('toWorkspaceUpdate — REQ-033 partial-write translator', () => {
  it('a patch of exactly one field produces an engine body of exactly the mapped key', () => {
    const out = toWorkspaceUpdate({ temperature: 0.5 });
    expect(out).toEqual({ openAiTemp: 0.5 });
  });

  it('an empty patch produces an empty engine body', () => {
    expect(toWorkspaceUpdate({})).toEqual({});
  });

  it('a multi-field patch maps only the present fields, each to its correct engine key', () => {
    const out = toWorkspaceUpdate({ displayName: 'New Name', retrievalTopN: 5, systemPrompt: 'Be nice' });
    expect(out).toEqual({ name: 'New Name', topN: 5, openAiPrompt: 'Be nice' });
  });

  it('maps every REQ-032 product↔engine key pair correctly, one at a time', () => {
    const cases: Array<[keyof WorkspaceSettings, unknown, string]> = [
      ['displayName', 'X', 'name'],
      ['llmProvider', 'openai', 'chatProvider'],
      ['llmModel', 'gpt-4', 'chatModel'],
      ['responseMode', 'query', 'chatMode'],
      ['temperature', 1.1, 'openAiTemp'],
      ['historyWindow', 10, 'openAiHistory'],
      ['systemPrompt', 'hi', 'openAiPrompt'],
      ['retrievalThreshold', 0.5, 'similarityThreshold'],
      ['retrievalTopN', 3, 'topN'],
      ['agentLlmProvider', 'anthropic', 'agentProvider'],
      ['agentLlmModel', 'claude', 'agentModel'],
      ['noResultsMessage', 'no results', 'queryRefusalResponse'],
      ['retrievalMode', 'default', 'vectorSearchMode'],
      ['avatar', 'a.png', 'pfpFilename'],
    ];
    for (const [productKey, value, engineKey] of cases) {
      const out = toWorkspaceUpdate({ [productKey]: value } as Partial<WorkspaceSettings>);
      expect(out).toEqual({ [engineKey]: value });
    }
  });

  it('never maps `id` — it is not a member of the field table', () => {
    const out = toWorkspaceUpdate({ id: 'should-not-map' } as unknown as Partial<WorkspaceSettings>);
    expect(out).toEqual({});
  });
});

describe('toWorkspaceUpdate — REQ-036 null/inherit semantics (present-null vs absent)', () => {
  it('a PRESENT null is forwarded on the mapped engine key', () => {
    const out = toWorkspaceUpdate({ llmModel: null });
    expect(Object.prototype.hasOwnProperty.call(out, 'chatModel')).toBe(true);
    expect(out.chatModel).toBeNull();
    expect(out).toEqual({ chatModel: null });
  });

  it('an ABSENT key never appears in the engine body', () => {
    const out = toWorkspaceUpdate({ displayName: 'unrelated change' });
    expect(Object.prototype.hasOwnProperty.call(out, 'chatModel')).toBe(false);
  });

  it('applies present-null forwarding to every nullable product↔engine pair named in REQ-036', () => {
    const cases: Array<[keyof WorkspaceSettings, string]> = [
      ['llmProvider', 'chatProvider'],
      ['llmModel', 'chatModel'],
      ['agentLlmProvider', 'agentProvider'],
      ['agentLlmModel', 'agentModel'],
    ];
    for (const [productKey, engineKey] of cases) {
      const out = toWorkspaceUpdate({ [productKey]: null } as Partial<WorkspaceSettings>);
      expect(out).toEqual({ [engineKey]: null });
    }
  });
});

describe('documentPaths', () => {
  it('prefers docpath over name, and falls back to name when docpath is absent', () => {
    const paths = documentPaths(engineWorkspaceFixture());
    expect(paths).toEqual(['custom-documents/file1.txt', 'file2.txt']);
  });

  it('returns [] when the engine workspace has no documents field', () => {
    const engine = engineWorkspaceFixture();
    delete engine.documents;
    expect(documentPaths(engine)).toEqual([]);
  });

  it('returns [] for an empty documents array', () => {
    expect(documentPaths(engineWorkspaceFixture({ documents: [] }))).toEqual([]);
  });

  it('skips a document whose docpath AND name are both falsy', () => {
    const engine = engineWorkspaceFixture({
      documents: [{ name: '' } as unknown as EngineDocument, { name: 'ok.txt' }],
    });
    expect(documentPaths(engine)).toEqual(['ok.txt']);
  });
});

describe('toDocumentRef — REQ-039 document reference shape', () => {
  it('uses the engine id when present, and title when present', () => {
    const ref = toDocumentRef({ id: 'doc-1', name: 'file1.txt', title: 'File One' });
    expect(ref).toEqual({ id: 'doc-1', title: 'File One' });
  });

  it('falls back to docpath for id when no id is present', () => {
    const ref = toDocumentRef({ name: 'file2.txt', docpath: 'sub/file2.txt' });
    expect(ref.id).toBe('sub/file2.txt');
  });

  it('falls back to name for both id and title when nothing else is present', () => {
    const ref = toDocumentRef({ name: 'file3.txt' });
    expect(ref).toEqual({ id: 'file3.txt', title: 'file3.txt' });
  });
});

describe('validateWorkspacePatch — REQ-034 responseMode constraint', () => {
  it('rejects "automatic" with a 400 AppError', () => {
    expect(() => validateWorkspacePatch({ responseMode: 'automatic' })).toThrow(AppError);
    try {
      validateWorkspacePatch({ responseMode: 'automatic' });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).status).toBe(400);
    }
  });

  it('accepts "chat" and "query"', () => {
    expect(() => validateWorkspacePatch({ responseMode: 'chat' })).not.toThrow();
    expect(() => validateWorkspacePatch({ responseMode: 'query' })).not.toThrow();
  });

  it('accepts a present null (inherit) without validating against the enum', () => {
    expect(() => validateWorkspacePatch({ responseMode: null as unknown as 'chat' })).not.toThrow();
  });
});

describe('validateWorkspacePatch — REQ-035 numeric bounds', () => {
  it('temperature: 2.5 is rejected (above the 2.0 cap)', () => {
    expect(() => validateWorkspacePatch({ temperature: 2.5 })).toThrow(AppError);
  });

  it('temperature: 2.0 is accepted (inclusive upper bound)', () => {
    expect(() => validateWorkspacePatch({ temperature: 2.0 })).not.toThrow();
  });

  it('temperature: 0.0 is accepted (inclusive lower bound)', () => {
    expect(() => validateWorkspacePatch({ temperature: 0.0 })).not.toThrow();
  });

  it('temperature: null is accepted (inherit)', () => {
    expect(() => validateWorkspacePatch({ temperature: null })).not.toThrow();
  });

  it('retrievalThreshold: 1.5 is rejected (above the 1.0 cap)', () => {
    expect(() => validateWorkspacePatch({ retrievalThreshold: 1.5 })).toThrow(AppError);
  });

  it('retrievalThreshold: 1.0 and 0.0 are both accepted (inclusive bounds)', () => {
    expect(() => validateWorkspacePatch({ retrievalThreshold: 1.0 })).not.toThrow();
    expect(() => validateWorkspacePatch({ retrievalThreshold: 0.0 })).not.toThrow();
  });

  it('retrievalThreshold: null is accepted (inherit)', () => {
    expect(() => validateWorkspacePatch({ retrievalThreshold: null })).not.toThrow();
  });

  it('retrievalTopN: 0 is rejected (must be >= 1)', () => {
    expect(() => validateWorkspacePatch({ retrievalTopN: 0 })).toThrow(AppError);
  });

  it('retrievalTopN: 1 is accepted', () => {
    expect(() => validateWorkspacePatch({ retrievalTopN: 1 })).not.toThrow();
  });

  it('historyWindow: -1 is rejected (must be >= 0)', () => {
    expect(() => validateWorkspacePatch({ historyWindow: -1 })).toThrow(AppError);
  });

  it('historyWindow: 0 is accepted (inclusive lower bound)', () => {
    expect(() => validateWorkspacePatch({ historyWindow: 0 })).not.toThrow();
  });
});

// REQ-036 ruling: "other nullable fields" that support null=inherit EXCLUDES historyWindow and
// retrievalTopN. The shared WorkspaceSettings product type (REQ-025) declares both as
// non-nullable `number`, and they map to the non-nullable engine keys openAiHistory/topN, so a
// present `null` is invalid input (400) — not an inherit signal (unlike temperature /
// retrievalThreshold, which ARE `number | null` and accept null). See validateWorkspacePatch.
describe('validateWorkspacePatch — null is rejected for the non-nullable numeric fields (REQ-025/036)', () => {
  it('rejects a present null for historyWindow', () => {
    expect(() => validateWorkspacePatch({ historyWindow: null as unknown as number })).toThrow(AppError);
  });

  it('rejects a present null for retrievalTopN', () => {
    expect(() => validateWorkspacePatch({ retrievalTopN: null as unknown as number })).toThrow(AppError);
  });
});

describe('validateWorkspacePatch — REQ-036b retrievalMode free-text constraint', () => {
  it('rejects a whitespace-only value', () => {
    expect(() => validateWorkspacePatch({ retrievalMode: '   ' })).toThrow(AppError);
  });

  it('accepts "default"', () => {
    expect(() => validateWorkspacePatch({ retrievalMode: 'default' })).not.toThrow();
  });

  it('accepts null (inherit)', () => {
    expect(() => validateWorkspacePatch({ retrievalMode: null })).not.toThrow();
  });
});

describe('validateWorkspacePatch — present-key-only validation (REQ-033/036 defense in depth)', () => {
  it('an empty patch never trips any validator', () => {
    expect(() => validateWorkspacePatch({})).not.toThrow();
  });

  it('a patch touching only an unrelated field never validates an omitted field', () => {
    // displayName is not subject to any of the numeric/enum validators; omitted fields
    // (responseMode, temperature, retrievalThreshold, retrievalTopN, historyWindow,
    // retrievalMode) must never be checked just because they are absent.
    expect(() => validateWorkspacePatch({ displayName: 'Renamed' })).not.toThrow();
  });

  it('validates only the keys actually present in a mixed patch (one valid, one invalid)', () => {
    // retrievalTopN is invalid; temperature is absent and must not be checked.
    expect(() => validateWorkspacePatch({ retrievalTopN: 0, displayName: 'X' })).toThrow(AppError);
  });
});

// --- §6 Users / invites / oversight translation (REQ-041/043/045/051) ---

// A fully-populated engine user fixture (§6.2 grounding).
function engineUserFixture(overrides: Partial<EngineUser> = {}): EngineUser {
  return {
    id: 7,
    username: 'alice',
    role: 'default',
    suspended: 0,
    dailyMessageLimit: 50,
    ...overrides,
  };
}

describe('toUser — REQ-041 engine `suspended` 0/1 → product boolean; id → string', () => {
  it('maps suspended 0 → false', () => {
    expect(toUser(engineUserFixture({ suspended: 0 })).suspended).toBe(false);
  });

  it('maps suspended 1 → true', () => {
    expect(toUser(engineUserFixture({ suspended: 1 })).suspended).toBe(true);
  });

  it('maps the engine numeric id to a product string id', () => {
    const user = toUser(engineUserFixture({ id: 42 }));
    expect(user.id).toBe('42');
    expect(typeof user.id).toBe('string');
  });

  it('passes through username, role, and dailyMessageLimit unchanged', () => {
    const user = toUser(engineUserFixture({ username: 'bob', role: 'admin', dailyMessageLimit: null }));
    expect(user.username).toBe('bob');
    expect(user.role).toBe('admin');
    expect(user.dailyMessageLimit).toBeNull();
  });

  it('exposes ONLY the product User fields — no engine int flag leaks through', () => {
    const user = toUser(engineUserFixture());
    expect(Object.keys(user).sort()).toEqual(
      ['dailyMessageLimit', 'id', 'role', 'suspended', 'username'].sort(),
    );
    expect(typeof user.suspended).toBe('boolean');
  });
});

describe('toUserUpdate — REQ-043 present-key-only partial-write translator', () => {
  it('an empty patch produces an empty engine body', () => {
    expect(toUserUpdate({})).toEqual({});
  });

  it('suspended:true maps to engine {suspended:1}', () => {
    expect(toUserUpdate({ suspended: true })).toEqual({ suspended: 1 });
  });

  it('suspended:false maps to engine {suspended:0}', () => {
    expect(toUserUpdate({ suspended: false })).toEqual({ suspended: 0 });
  });

  it('role passes through unchanged', () => {
    expect(toUserUpdate({ role: 'manager' })).toEqual({ role: 'manager' });
  });

  it('dailyMessageLimit passes through unchanged, including a present null', () => {
    expect(toUserUpdate({ dailyMessageLimit: 100 })).toEqual({ dailyMessageLimit: 100 });
    expect(toUserUpdate({ dailyMessageLimit: null })).toEqual({ dailyMessageLimit: null });
  });

  it('only maps keys PRESENT in the patch — an absent key never appears in the engine body', () => {
    const out = toUserUpdate({ role: 'admin' });
    expect(Object.prototype.hasOwnProperty.call(out, 'suspended')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'dailyMessageLimit')).toBe(false);
  });

  it('a multi-field patch maps every present field to its engine key', () => {
    expect(toUserUpdate({ role: 'admin', suspended: true, dailyMessageLimit: 10 })).toEqual({
      role: 'admin',
      suspended: 1,
      dailyMessageLimit: 10,
    });
  });
});

// A fully-populated engine invite fixture (§6.3 grounding).
function engineInviteFixture(overrides: Partial<EngineInvite> = {}): EngineInvite {
  return {
    id: 3,
    code: 'ABC123',
    status: 'pending',
    claimedBy: null,
    workspaceIds: null,
    ...overrides,
  };
}

describe('parseInviteWorkspaceIds — REQ-045 engine `workspaceIds` csv parser', () => {
  it('parses "1,3" into [1, 3]', () => {
    expect(parseInviteWorkspaceIds(engineInviteFixture({ workspaceIds: '1,3' }))).toEqual([1, 3]);
  });

  it('returns [] for an empty string', () => {
    expect(parseInviteWorkspaceIds(engineInviteFixture({ workspaceIds: '' }))).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(parseInviteWorkspaceIds(engineInviteFixture({ workspaceIds: null }))).toEqual([]);
  });

  it('filters out non-numeric (NaN) segments', () => {
    expect(parseInviteWorkspaceIds(engineInviteFixture({ workspaceIds: '1,foo,3' }))).toEqual([1, 3]);
  });

  it('trims whitespace around each segment', () => {
    expect(parseInviteWorkspaceIds(engineInviteFixture({ workspaceIds: ' 1 , 3 ' }))).toEqual([1, 3]);
  });

  it('skips empty segments produced by a trailing/double comma', () => {
    expect(parseInviteWorkspaceIds(engineInviteFixture({ workspaceIds: '1,,3,' }))).toEqual([1, 3]);
  });
});

describe('toInvite — REQ-045 product invite shape', () => {
  it('shapes id (as string), code, status, and claimedBy from the engine invite', () => {
    const invite = toInvite(
      engineInviteFixture({ id: 9, code: 'XYZ', status: 'claimed', claimedBy: '5' }),
      [],
    );
    expect(invite).toMatchObject({ id: '9', code: 'XYZ', status: 'claimed', claimedBy: '5' });
  });

  it('uses the passed-in product workspace handles verbatim, ignoring the engine numeric csv', () => {
    const invite = toInvite(engineInviteFixture({ workspaceIds: '1,2' }), ['handle-a', 'handle-b']);
    expect(invite.workspaceIds).toEqual(['handle-a', 'handle-b']);
  });

  it('an unscoped invite (no product handles resolved) has an empty workspaceIds array', () => {
    const invite = toInvite(engineInviteFixture({ workspaceIds: null }), []);
    expect(invite.workspaceIds).toEqual([]);
  });

  it('defaults status to "pending" (engine default, passthrough)', () => {
    const invite = toInvite(engineInviteFixture({ status: 'pending' }), []);
    expect(invite.status).toBe('pending');
  });
});

describe('toOversightPage — REQ-051 read-only oversight page shape', () => {
  it('maps hasPages:true → hasMore:true', () => {
    const page = toOversightPage({ chats: [{ a: 1 }], hasPages: true } as EngineChatPage);
    expect(page.hasMore).toBe(true);
  });

  it('maps hasPages:false → hasMore:false', () => {
    const page = toOversightPage({ chats: [], hasPages: false } as EngineChatPage);
    expect(page.hasMore).toBe(false);
  });

  it('a missing hasPages defaults hasMore to false', () => {
    const page = toOversightPage({ chats: [] } as EngineChatPage);
    expect(page.hasMore).toBe(false);
  });

  it('passes chats through unchanged', () => {
    const chats = [{ id: 1 }, { id: 2 }];
    const page = toOversightPage({ chats, hasPages: true } as EngineChatPage);
    expect(page.chats).toBe(chats);
  });

  it('defaults chats to [] when missing from the engine page', () => {
    const page = toOversightPage({ hasPages: false } as unknown as EngineChatPage);
    expect(page.chats).toEqual([]);
  });
});
