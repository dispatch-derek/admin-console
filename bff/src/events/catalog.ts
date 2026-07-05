// admin.* event names + payload types (§14, 03-data-models.md). The common envelope is
// shared with the bus + emitter; secret VALUES are redacted before publish (REQ-029c).

// Event name union (03-data-models.md §"Event name type").
export type AdminEventName =
  | 'admin.workspace.created'
  | 'admin.workspace.updated'
  | 'admin.workspace.deleted'
  | 'admin.workspace.documents_changed'
  // Knowledge pin/unpin events required by spec §14 / REQ-039.
  | 'admin.workspace.knowledge_pinned'
  | 'admin.workspace.knowledge_unpinned'
  | 'admin.workspace_user.assigned'
  | 'admin.workspace_user.unassigned'
  | 'admin.user.created'
  | 'admin.user.updated'
  | 'admin.user.suspended'
  | 'admin.user.reactivated'
  | 'admin.user.deleted'
  | 'admin.invite.created'
  | 'admin.invite.revoked'
  | 'admin.instance.setting_changed'
  | 'admin.instance.provider_changed'
  | 'admin.raw_env.written';

// Common envelope (REQ-029c). `verified` is a boolean for single-delta events, EXCEPT
// admin.instance.setting_changed whose `verified` is a per-control-id MAP (REQ-029f).
export interface AdminEventEnvelope<P = unknown> {
  event: AdminEventName;
  actor: string; // staff user id (REQ-029c)
  target: Record<string, string | number | string[]>; // opaque handles / product-control ids
  changes?: P; // secret values redacted (REQ-029c, REQ-062)
  verified: boolean | Record<string, boolean>; // map only for setting_changed (REQ-029f)
  timestamp: string; // ISO-8601
}

// admin.instance.setting_changed payload (REQ-029c/029f/101, MIN-3): `verified` is a
// per-control-id MAP, never a scalar; product-control ids per the shared type (REQ-062b);
// secret values redacted.
export interface SettingChangedPayload {
  categories: string[]; // §7.1–§7.8 categories touched
  controlIds: string[]; // touched product-control ids (REQ-062b)
  verified: Record<string, boolean>; // product-control id → verified (REQ-029f)
}

// admin.instance.provider_changed payload (REQ-063/029f): one per changed selector, own
// scalar `verified` (false when the 2xx re-read shows no actual change — R-2).
export interface ProviderChangedPayload {
  selector: string; // product selector id (REQ-063), e.g. 'llm.provider'
  newProvider: string;
  verified: boolean;
}
