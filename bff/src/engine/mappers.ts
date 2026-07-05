// Product↔engine field translation lives here (REQ-021a). Holds the shared redaction
// helpers used by the emitter + audit sink, plus the workspace field-translation table
// (REQ-032) with partial-write + null-inherit semantics (REQ-033/036).
//
// TODO(slice-5): the curated-settings product-control-id → engine env-key map (REQ-062a),
//   secret overwrite-without-reveal handling (REQ-061), and RawEnvEntry state derivation.

import { AppError } from '../server/errors.js';
import { isSecretKey } from './env-keys.js';
import type {
  EngineChatPage,
  EngineDocument,
  EngineInvite,
  EngineUser,
  EngineUserUpdate,
  EngineWorkspace,
  EngineWorkspaceUpdate,
} from './engine-types.js';
import type {
  DocumentRef,
  Invite,
  OversightChatPage,
  User,
  Workspace,
  WorkspaceDocument,
  WorkspaceSettings,
} from '../types/product-types.js';

// The placeholder written in place of a secret VALUE (REQ-062/094). Key names are kept.
export const REDACTED = '[redacted]';

// Redact secret VALUES in a flat record keyed by engine env keys (e.g. an update-env
// patch, or a raw {key,value} set). Secret keys keep their name; their value → REDACTED.
export function redactEnvValues(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSecretKey(key) ? REDACTED : value;
  }
  return out;
}

// Redact secret VALUES anywhere in an arbitrary detail/changes structure by key name,
// recursing through plain objects and arrays (REQ-062/094). Used by audit + emitter so a
// secret value can never reach a log line, audit row, or event payload.
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redactSecrets(v);
    }
    return out;
  }
  return value;
}

// --- Workspace field translation (REQ-032) ---

// The product WorkspaceSettings key → engine EngineWorkspaceUpdate key table. This is the
// single source of truth for the partial-write translator (REQ-033/036). `id` is never a
// member, so it can never be written to the engine.
const WORKSPACE_FIELD_MAP: Record<
  keyof Omit<WorkspaceSettings, 'id' | 'documents'>,
  keyof EngineWorkspaceUpdate
> = {
  displayName: 'name',
  llmProvider: 'chatProvider',
  llmModel: 'chatModel',
  responseMode: 'chatMode',
  temperature: 'openAiTemp',
  historyWindow: 'openAiHistory',
  systemPrompt: 'openAiPrompt',
  retrievalThreshold: 'similarityThreshold',
  retrievalTopN: 'topN',
  agentLlmProvider: 'agentProvider',
  agentLlmModel: 'agentModel',
  noResultsMessage: 'queryRefusalResponse',
  retrievalMode: 'vectorSearchMode',
  avatar: 'pfpFilename',
};

// List shape (REQ-032): the four summary fields only.
export function toWorkspace(engine: EngineWorkspace, productId: string): Workspace {
  return {
    id: productId,
    displayName: engine.name,
    llmProvider: engine.chatProvider,
    llmModel: engine.chatModel,
  };
}

// Full detail shape (REQ-032): summary fields plus every editable setting.
export function toWorkspaceSettings(
  engine: EngineWorkspace,
  productId: string,
): WorkspaceSettings {
  return {
    ...toWorkspace(engine, productId),
    responseMode: engine.chatMode,
    temperature: engine.openAiTemp,
    historyWindow: engine.openAiHistory,
    systemPrompt: engine.openAiPrompt,
    retrievalThreshold: engine.similarityThreshold,
    retrievalTopN: engine.topN as number,
    agentLlmProvider: engine.agentProvider,
    agentLlmModel: engine.agentModel,
    noResultsMessage: engine.queryRefusalResponse,
    retrievalMode: engine.vectorSearchMode,
    avatar: engine.pfpFilename,
    documents: toWorkspaceDocuments(engine),
  };
}

// Map the workspace's attached engine documents to the product shape with pin state (REQ-039).
// Uses docpath ?? name as the stable id (matching documentPaths / the knowledge verify predicates).
export function toWorkspaceDocuments(engine: EngineWorkspace): WorkspaceDocument[] {
  const docs = engine.documents ?? [];
  const out: WorkspaceDocument[] = [];
  for (const doc of docs) {
    const path = doc.docpath ?? doc.name;
    if (!path) continue;
    out.push({ id: path, title: doc.title ?? doc.name, pinned: doc.pinned === true });
  }
  return out;
}

// Partial-write translator (REQ-033/036): iterate ONLY over product keys PRESENT in the
// patch (by own-property presence, not truthiness) so a present `null` is forwarded as
// null (inherit) and an ABSENT key never appears in the engine body. `id` is never mapped.
export function toWorkspaceUpdate(
  patch: Partial<WorkspaceSettings>,
): Partial<EngineWorkspaceUpdate> {
  const out: Partial<EngineWorkspaceUpdate> = {};
  for (const productKey of Object.keys(WORKSPACE_FIELD_MAP) as Array<
    keyof Omit<WorkspaceSettings, 'id' | 'documents'>
  >) {
    if (!Object.prototype.hasOwnProperty.call(patch, productKey)) continue;
    const engineKey = WORKSPACE_FIELD_MAP[productKey];
    // The field map guarantees a value-compatible target; the union widening across the
    // per-key value types is safe because both sides mirror the REQ-032 table.
    (out as Record<string, unknown>)[engineKey] = patch[productKey];
  }
  return out;
}

// Extract the path/name of each attached document (helper for documents + pin verify
// predicates). Uses docpath ?? name, filtering falsy.
export function documentPaths(engine: EngineWorkspace): string[] {
  const docs = engine.documents ?? [];
  const paths: string[] = [];
  for (const doc of docs) {
    const p = doc.docpath ?? doc.name;
    if (p) paths.push(p);
  }
  return paths;
}

// Product document reference shape (REQ-039).
export function toDocumentRef(doc: EngineDocument): DocumentRef {
  return {
    id: String(doc.id ?? doc.docpath ?? doc.name),
    title: doc.title ?? doc.name,
  };
}

// --- User / invite / oversight translation (§6) ---

// Product User shape (REQ-041): engine `suspended` 0/1 → product boolean so no engine int
// flag leaks across the boundary.
export function toUser(engine: EngineUser): User {
  return {
    id: String(engine.id),
    username: engine.username,
    role: engine.role as User['role'],
    suspended: engine.suspended === 1,
    dailyMessageLimit: engine.dailyMessageLimit,
  };
}

// Partial-write translator for a user edit (REQ-043): iterate ONLY over product keys PRESENT
// in the patch (by own-property presence, like toWorkspaceUpdate), mapping product boolean
// `suspended` → engine 1/0. An absent key never appears in the engine body.
export function toUserUpdate(
  patch: Partial<Pick<User, 'role' | 'suspended' | 'dailyMessageLimit'>>,
): Partial<EngineUserUpdate> {
  const out: Partial<EngineUserUpdate> = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'role')) {
    out.role = patch.role as string;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'suspended')) {
    out.suspended = patch.suspended ? 1 : 0;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'dailyMessageLimit')) {
    out.dailyMessageLimit = patch.dailyMessageLimit ?? null;
  }
  return out;
}

// Product Invite shape (REQ-045). The caller resolves engine numeric workspace ids →
// product handles and passes them in, so the mapper stays pure (no repo import).
export function toInvite(engine: EngineInvite, workspaceHandles: string[]): Invite {
  return {
    id: String(engine.id),
    code: engine.code,
    status: engine.status,
    claimedBy: engine.claimedBy,
    workspaceIds: workspaceHandles,
  };
}

// Parse the engine invite `workspaceIds` csv (e.g. "1,3") into a number[] so the service
// can reverse-map each engine numeric id to a product workspace handle (REQ-045/046).
export function parseInviteWorkspaceIds(engine: EngineInvite): number[] {
  if (!engine.workspaceIds) return [];
  const out: number[] = [];
  for (const part of engine.workspaceIds.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const n = Number(trimmed);
    if (Number.isNaN(n)) continue;
    out.push(n);
  }
  return out;
}

// Read-only oversight page shape (REQ-051): pass through opaque chat records.
export function toOversightPage(engine: EngineChatPage): OversightChatPage {
  return {
    chats: engine.chats ?? [],
    hasMore: engine.hasPages === true,
  };
}

// Defense-in-depth validation of a settings patch (REQ-034/035/036b). Applied to PRESENT
// keys only; a present `null` means inherit and is accepted. Throws AppError(400).
export function validateWorkspacePatch(patch: Partial<WorkspaceSettings>): void {
  const has = (k: keyof WorkspaceSettings): boolean =>
    Object.prototype.hasOwnProperty.call(patch, k);

  if (has('responseMode') && patch.responseMode !== null) {
    if (patch.responseMode !== 'chat' && patch.responseMode !== 'query') {
      throw new AppError(400, "responseMode must be 'chat' or 'query'");
    }
  }
  if (has('temperature') && patch.temperature !== null) {
    const v = patch.temperature;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 2) {
      throw new AppError(400, 'temperature must be a number between 0.0 and 2.0');
    }
  }
  // historyWindow is non-nullable in the product type (REQ-025) and maps to the non-nullable
  // engine `openAiHistory`, so unlike temperature/retrievalThreshold a present `null` is NOT a
  // valid inherit value here — reject it rather than forward null to a number-typed engine key.
  if (has('historyWindow')) {
    const v = patch.historyWindow;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new AppError(400, 'historyWindow must be an integer >= 0');
    }
  }
  if (has('retrievalThreshold') && patch.retrievalThreshold !== null) {
    const v = patch.retrievalThreshold;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
      throw new AppError(400, 'retrievalThreshold must be a number between 0.0 and 1.0');
    }
  }
  // retrievalTopN is non-nullable in the product type (REQ-025) and maps to the non-nullable
  // engine `topN`, so a present `null` is invalid input, not an inherit signal (see above).
  if (has('retrievalTopN')) {
    const v = patch.retrievalTopN;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new AppError(400, 'retrievalTopN must be an integer >= 1');
    }
  }
  if (has('retrievalMode') && patch.retrievalMode !== null) {
    const v = patch.retrievalMode;
    if (typeof v !== 'string' || v.trim().length === 0) {
      throw new AppError(400, 'retrievalMode must be a non-empty string');
    }
  }
}
