// Workspace settings editor (§5.2). Every editable field is rendered with partial-write semantics
// (REQ-033/036): only operator-changed fields are sent, a cleared nullable field is sent as JSON
// null (inherit), and untouched fields are omitted. Numeric fields are validated client-side to
// their pinned inclusive bounds before submit (REQ-035). `responseMode` offers only chat/query and
// shows an out-of-range incoming value read-only (REQ-034). Model fields use the live Ollama picker
// when the effective provider is Ollama, else validated free-text (REQ-036a/064a). `retrievalMode`
// is validated free-text (REQ-036b). Avatar is a filename reference only — no binary upload (REQ-036c).

import { useEffect, useMemo, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import {
  validateModelFreeText,
  validateNumeric,
  validateRetrievalMode,
  WORKSPACE_NUMERIC_RULES,
} from '../../components/validation';
import { OllamaModelSelect } from '../settings/OllamaModelSelect';
import { KnowledgePanel } from './KnowledgePanel';
import type { WorkspaceSettings as WS } from '../../api/types';

interface WorkspaceSettingsProps {
  workspaceId: string;
  onDeleted: () => void;
}

const RESPONSE_MODES = ['chat', 'query'] as const;

// Convert a form string to the value sent on the wire: empty → null (inherit), else the string.
function textOrNull(raw: string): string | null {
  return raw.trim() === '' ? null : raw;
}

export function WorkspaceSettings({ workspaceId }: WorkspaceSettingsProps) {
  const [original, setOriginal] = useState<WS | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [responseModeChoice, setResponseModeChoice] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    api
      .getWorkspace(workspaceId)
      .then((ws) => {
        if (!active) return;
        setOriginal(ws);
        setForm({
          displayName: ws.displayName,
          temperature: ws.temperature === null ? '' : String(ws.temperature),
          historyWindow: String(ws.historyWindow),
          systemPrompt: ws.systemPrompt ?? '',
          retrievalThreshold: ws.retrievalThreshold === null ? '' : String(ws.retrievalThreshold),
          retrievalTopN: String(ws.retrievalTopN),
          llmProvider: ws.llmProvider ?? '',
          llmModel: ws.llmModel ?? '',
          agentLlmProvider: ws.agentLlmProvider ?? '',
          agentLlmModel: ws.agentLlmModel ?? '',
          noResultsMessage: ws.noResultsMessage ?? '',
          retrievalMode: ws.retrievalMode ?? '',
          avatar: ws.avatar ?? '',
        });
        // In-range mode preselects itself; an out-of-range value stays "keep current" (REQ-034).
        setResponseModeChoice(
          RESPONSE_MODES.includes(ws.responseMode as (typeof RESPONSE_MODES)[number])
            ? ws.responseMode
            : '',
        );
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Failed to load workspace');
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const outOfRangeMode =
    original !== null &&
    !RESPONSE_MODES.includes(original.responseMode as (typeof RESPONSE_MODES)[number]);

  // Field-level validation errors that block submit (REQ-035/064a/036b).
  const errors = useMemo<Record<string, string>>(() => {
    const e: Record<string, string> = {};
    if (form.displayName !== undefined && form.displayName.trim() === '') {
      e.displayName = 'A display name is required';
    }
    // Numeric: nullable fields skip validation when cleared (empty = inherit).
    for (const [field, rule] of Object.entries(WORKSPACE_NUMERIC_RULES)) {
      const raw = form[field] ?? '';
      const nullable = field === 'temperature' || field === 'retrievalThreshold';
      if (nullable && raw.trim() === '') continue;
      const msg = validateNumeric(raw, rule);
      if (msg) e[field] = msg;
    }
    // Model free-text: validate only non-Ollama, non-empty values (REQ-064a).
    if ((form.llmProvider ?? '') !== 'ollama' && (form.llmModel ?? '').trim() !== '') {
      const msg = validateModelFreeText(form.llmModel);
      if (msg) e.llmModel = msg;
    }
    if ((form.agentLlmProvider ?? '') !== 'ollama' && (form.agentLlmModel ?? '').trim() !== '') {
      const msg = validateModelFreeText(form.agentLlmModel);
      if (msg) e.agentLlmModel = msg;
    }
    // retrievalMode free-text: reject whitespace-only when non-empty (REQ-036b).
    if ((form.retrievalMode ?? '').trim() !== '') {
      const msg = validateRetrievalMode(form.retrievalMode);
      if (msg) e.retrievalMode = msg;
    }
    return e;
  }, [form]);

  const hasErrors = Object.keys(errors).length > 0;

  // Build the partial patch: only fields whose value differs from what was loaded (REQ-033/091).
  function buildPatch(): Partial<WS> {
    if (!original) return {};
    const patch: Partial<WS> = {};

    if (form.displayName !== original.displayName) patch.displayName = form.displayName;

    const numNullable = (
      field: 'temperature' | 'retrievalThreshold',
    ): void => {
      const raw = form[field].trim();
      const next = raw === '' ? null : Number(raw);
      if (next !== original[field]) patch[field] = next;
    };
    numNullable('temperature');
    numNullable('retrievalThreshold');

    const numRequired = (field: 'historyWindow' | 'retrievalTopN'): void => {
      const next = Number(form[field]);
      if (next !== original[field]) patch[field] = next;
    };
    numRequired('historyWindow');
    numRequired('retrievalTopN');

    const nullableText = (
      field: 'systemPrompt' | 'noResultsMessage' | 'llmProvider' | 'llmModel' | 'agentLlmProvider' | 'agentLlmModel' | 'retrievalMode' | 'avatar',
    ): void => {
      const next = textOrNull(form[field]);
      if (next !== original[field]) patch[field] = next;
    };
    nullableText('systemPrompt');
    nullableText('noResultsMessage');
    nullableText('llmProvider');
    nullableText('llmModel');
    nullableText('agentLlmProvider');
    nullableText('agentLlmModel');
    nullableText('retrievalMode');
    nullableText('avatar');

    // responseMode: only write when the operator explicitly picked chat/query (REQ-034).
    if (responseModeChoice !== '' && responseModeChoice !== original.responseMode) {
      patch.responseMode = responseModeChoice;
    }

    return patch;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (hasErrors) return;
    const patch = buildPatch();
    setSaveError(null);
    setSaved(false);
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateWorkspaceSettings(workspaceId, patch);
      setOriginal(updated);
      setSaved(true);
    } catch (err) {
      // On a failed write the field keeps its prior value; state that it was not saved (REQ-098).
      setSaveError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!original) return <p>Loading…</p>;

  const modelField = (
    field: 'llmModel' | 'agentLlmModel',
    providerField: 'llmProvider' | 'agentLlmProvider',
  ) => {
    const effectiveProvider = form[providerField] ?? '';
    if (effectiveProvider === 'ollama') {
      return (
        <OllamaModelSelect id={field} value={form[field] ?? ''} onChange={(v) => set(field, v)} />
      );
    }
    return (
      <input
        id={field}
        type="text"
        value={form[field] ?? ''}
        onChange={(e) => set(field, e.target.value)}
        aria-invalid={errors[field] ? true : undefined}
      />
    );
  };

  return (
    <div className="workspace-settings">
      <h2>{original.displayName}</h2>
      <form onSubmit={save}>
        <label className="field">
          <span>Display name</span>
          <input
            id="displayName"
            type="text"
            value={form.displayName ?? ''}
            onChange={(e) => set('displayName', e.target.value)}
            aria-invalid={errors.displayName ? true : undefined}
          />
          {errors.displayName && <span className="field-error">{errors.displayName}</span>}
        </label>

        <label className="field">
          <span>Response mode</span>
          {outOfRangeMode && (
            <span className="readonly-note">
              Current value <code>{original.responseMode}</code> is read-only; pick chat or query to
              change it.
            </span>
          )}
          <select
            id="responseMode"
            value={responseModeChoice}
            onChange={(e) => setResponseModeChoice(e.target.value)}
          >
            {outOfRangeMode && <option value="">— keep current —</option>}
            {RESPONSE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Temperature (0–2, blank = inherit)</span>
          <input
            id="temperature"
            type="text"
            value={form.temperature ?? ''}
            onChange={(e) => set('temperature', e.target.value)}
            aria-invalid={errors.temperature ? true : undefined}
          />
          {errors.temperature && <span className="field-error">{errors.temperature}</span>}
        </label>

        <label className="field">
          <span>History window (integer ≥ 0)</span>
          <input
            id="historyWindow"
            type="text"
            value={form.historyWindow ?? ''}
            onChange={(e) => set('historyWindow', e.target.value)}
            aria-invalid={errors.historyWindow ? true : undefined}
          />
          {errors.historyWindow && <span className="field-error">{errors.historyWindow}</span>}
        </label>

        <label className="field">
          <span>Retrieval threshold (0–1, blank = inherit)</span>
          <input
            id="retrievalThreshold"
            type="text"
            value={form.retrievalThreshold ?? ''}
            onChange={(e) => set('retrievalThreshold', e.target.value)}
            aria-invalid={errors.retrievalThreshold ? true : undefined}
          />
          {errors.retrievalThreshold && (
            <span className="field-error">{errors.retrievalThreshold}</span>
          )}
        </label>

        <label className="field">
          <span>Retrieval top N (integer ≥ 1)</span>
          <input
            id="retrievalTopN"
            type="text"
            value={form.retrievalTopN ?? ''}
            onChange={(e) => set('retrievalTopN', e.target.value)}
            aria-invalid={errors.retrievalTopN ? true : undefined}
          />
          {errors.retrievalTopN && <span className="field-error">{errors.retrievalTopN}</span>}
        </label>

        <label className="field">
          <span>Retrieval mode (blank = inherit)</span>
          <input
            id="retrievalMode"
            type="text"
            value={form.retrievalMode ?? ''}
            onChange={(e) => set('retrievalMode', e.target.value)}
            aria-invalid={errors.retrievalMode ? true : undefined}
          />
          {errors.retrievalMode && <span className="field-error">{errors.retrievalMode}</span>}
        </label>

        <label className="field">
          <span>LLM provider (blank = inherit)</span>
          <input
            id="llmProvider"
            type="text"
            value={form.llmProvider ?? ''}
            onChange={(e) => set('llmProvider', e.target.value)}
          />
        </label>

        <label className="field">
          <span>LLM model (blank = inherit)</span>
          {modelField('llmModel', 'llmProvider')}
          {errors.llmModel && <span className="field-error">{errors.llmModel}</span>}
        </label>

        <label className="field">
          <span>Agent LLM provider (blank = inherit)</span>
          <input
            id="agentLlmProvider"
            type="text"
            value={form.agentLlmProvider ?? ''}
            onChange={(e) => set('agentLlmProvider', e.target.value)}
          />
        </label>

        <label className="field">
          <span>Agent LLM model (blank = inherit)</span>
          {modelField('agentLlmModel', 'agentLlmProvider')}
          {errors.agentLlmModel && <span className="field-error">{errors.agentLlmModel}</span>}
        </label>

        <label className="field">
          <span>System prompt (blank = inherit)</span>
          <textarea
            id="systemPrompt"
            value={form.systemPrompt ?? ''}
            onChange={(e) => set('systemPrompt', e.target.value)}
          />
        </label>

        <label className="field">
          <span>No-results message (blank = inherit)</span>
          <input
            id="noResultsMessage"
            type="text"
            value={form.noResultsMessage ?? ''}
            onChange={(e) => set('noResultsMessage', e.target.value)}
          />
        </label>

        <label className="field">
          <span>Avatar filename (blank = inherit)</span>
          <input
            id="avatar"
            type="text"
            value={form.avatar ?? ''}
            onChange={(e) => set('avatar', e.target.value)}
          />
          <span className="readonly-note">Binary avatar upload is not available in v1.</span>
        </label>

        <ErrorBanner message={saveError} />
        {saved && !saveError && <p className="success">Saved.</p>}
        <button type="submit" disabled={busy || hasErrors}>
          Save changes
        </button>
      </form>

      <KnowledgePanel workspaceId={workspaceId} />
    </div>
  );
}
