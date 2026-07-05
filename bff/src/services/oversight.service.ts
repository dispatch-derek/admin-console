// Oversight service (§6.6, REQ-051). Read-only chat-history view for oversight — no
// verify-after-write, no event, no audit. Resolves an optional opaque workspace handle to
// its engine numeric id (reusing the workspace resolver) and passes an EngineChatQuery to
// the adapter, re-shaping the result to a product OversightChatPage.

import { engineAdapter as adapter } from '../engine/adapter.js';
import { toOversightPage } from '../engine/mappers.js';
import { resolveWorkspaceNumericId } from './user.service.js';
import type { EngineChatQuery } from '../engine/engine-types.js';
import type { OversightChatPage } from '../types/product-types.js';

// GET /api/oversight/chats (REQ-051).
export async function getChats(query: {
  workspace?: string;
  limit?: number;
  offset?: number;
}): Promise<OversightChatPage> {
  const q: EngineChatQuery = {};
  if (query.offset !== undefined) q.offset = query.offset;
  if (query.limit !== undefined) q.limit = query.limit;
  if (query.workspace !== undefined) {
    const { numericId } = await resolveWorkspaceNumericId(query.workspace);
    q.workspaceId = numericId;
  }
  const result = await adapter.workspaceChats(q);
  return toOversightPage(result);
}
