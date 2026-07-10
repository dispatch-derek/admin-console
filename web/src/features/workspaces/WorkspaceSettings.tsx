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
import { Button, Input, Select, Textarea } from '../../design-system';
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
    label: string,
  ) => {
    const effectiveProvider = form[providerField] ?? '';
    if (effectiveProvider === 'ollama') {
      return (
        <OllamaModelSelect
          id={field}
          label={label}
          value={form[field] ?? ''}
          onChange={(v) => set(field, v)}
        />
      );
    }
    return (
      <Input
        id={field}
        label={label}
        type="text"
        value={form[field] ?? ''}
        onChange={(e) => set(field, e.target.value)}
        error={errors[field]}
      />
    );
  };

  return (
    <div className="ac-workspace-settings">
      <h2>{original.displayName}</h2>
      <form onSubmit={save}>
        <Input
          id="displayName"
          label="Display name"
          type="text"
          value={form.displayName ?? ''}
          onChange={(e) => set('displayName', e.target.value)}
          error={errors.displayName}
        />

        {outOfRangeMode && (
          <p className="ac-readonly-note">
            Current value <code>{original.responseMode}</code> is read-only; pick chat or query to
            change it.
          </p>
        )}
        <Select
          id="responseMode"
          label="Response mode"
          value={responseModeChoice}
          onChange={(e) => setResponseModeChoice(e.target.value)}
        >
          {outOfRangeMode && <option value="">— keep current —</option>}
          {RESPONSE_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>

        <Input
          id="temperature"
          label="Temperature (0–2, blank = inherit)"
          type="text"
          value={form.temperature ?? ''}
          onChange={(e) => set('temperature', e.target.value)}
          error={errors.temperature}
        />

        <Input
          id="historyWindow"
          label="History window (integer ≥ 0)"
          type="text"
          value={form.historyWindow ?? ''}
          onChange={(e) => set('historyWindow', e.target.value)}
          error={errors.historyWindow}
        />

        <Input
          id="retrievalThreshold"
          label="Retrieval threshold (0–1, blank = inherit)"
          type="text"
          value={form.retrievalThreshold ?? ''}
          onChange={(e) => set('retrievalThreshold', e.target.value)}
          error={errors.retrievalThreshold}
        />

        <Input
          id="retrievalTopN"
          label="Retrieval top N (integer ≥ 1)"
          type="text"
          value={form.retrievalTopN ?? ''}
          onChange={(e) => set('retrievalTopN', e.target.value)}
          error={errors.retrievalTopN}
        />

        <Input
          id="retrievalMode"
          label="Retrieval mode (blank = inherit)"
          type="text"
          value={form.retrievalMode ?? ''}
          onChange={(e) => set('retrievalMode', e.target.value)}
          error={errors.retrievalMode}
        />

        <Input
          id="llmProvider"
          label="LLM provider (blank = inherit)"
          type="text"
          value={form.llmProvider ?? ''}
          onChange={(e) => set('llmProvider', e.target.value)}
        />

        {modelField('llmModel', 'llmProvider', 'LLM model (blank = inherit)')}

        <Input
          id="agentLlmProvider"
          label="Agent LLM provider (blank = inherit)"
          type="text"
          value={form.agentLlmProvider ?? ''}
          onChange={(e) => set('agentLlmProvider', e.target.value)}
        />

        {modelField('agentLlmModel', 'agentLlmProvider', 'Agent LLM model (blank = inherit)')}

        <Textarea
          id="systemPrompt"
          label="System prompt (blank = inherit)"
          value={form.systemPrompt ?? ''}
          onChange={(e) => set('systemPrompt', e.target.value)}
        />

        <Input
          id="noResultsMessage"
          label="No-results message (blank = inherit)"
          type="text"
          value={form.noResultsMessage ?? ''}
          onChange={(e) => set('noResultsMessage', e.target.value)}
        />

        <Input
          id="avatar"
          label="Avatar filename (blank = inherit)"
          type="text"
          value={form.avatar ?? ''}
          onChange={(e) => set('avatar', e.target.value)}
          hint="Binary avatar upload is not available in v1."
        />

        <ErrorBanner message={saveError} />
        {saved && !saveError && <p className="ac-success">Saved.</p>}
        <Button variant="cta" type="submit" disabled={busy || hasErrors}>
          Save changes
        </Button>
      </form>

      <KnowledgePanel
        workspaceId={workspaceId}
        attached={original.documents}
        onChanged={(documents) => setOriginal((ws) => (ws ? { ...ws, documents } : ws))}
      />
    </div>
  );
}
