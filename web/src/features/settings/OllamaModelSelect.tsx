// Model picker backed by live Ollama discovery (REQ-036a/075/076). On mount it calls
// GET /api/models/ollama. When `available` is true it renders a dropdown of the pulled models
// (keeping any current value that is not in the list as a selectable option). When `available` is
// false — Ollama unreachable/timeout — it falls back to a validated free-text input and surfaces a
// NON-BLOCKING warning that the live model list could not be loaded (REQ-076). Discovery never
// throws; a failed request is treated the same as `available:false`.

import { useEffect, useState } from 'react';
import * as api from '../../api/client';
import { validateModelFreeText } from '../../components/validation';
import { Input, Select } from '../../design-system';

interface OllamaModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
}

// F-001 REQ-F001-016/021: rendered on DS form primitives — the discovered-model dropdown is the DS
// `Select`, and both the loading placeholder and the Ollama-unreachable free-text fallback are the DS
// `Input` (which carries the label→control association and the validation `error`). The non-blocking
// "model list unavailable" notice stays a token-styled status line.
export function OllamaModelSelect({ value, onChange, id, label }: OllamaModelSelectProps) {
  const [models, setModels] = useState<string[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .getOllamaModels()
      .then((result) => {
        if (!active) return;
        setAvailable(result.available);
        setModels(result.models.map((m) => m.name));
      })
      .catch(() => {
        // Defensive: treat any transport failure as unavailable → free-text fallback.
        if (!active) return;
        setAvailable(false);
        setModels([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return <Input id={id} label={label} type="text" value={value} disabled placeholder="Loading models…" />;
  }

  if (!available) {
    const err = value.trim() === '' ? null : validateModelFreeText(value);
    return (
      <div className="ac-ollama-fallback">
        <Input
          id={id}
          label={label}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          error={err}
        />
        <p className="ac-warning" role="status">
          Live Ollama model list unavailable — enter the model name manually.
        </p>
      </div>
    );
  }

  const options = models ?? [];
  const hasCurrent = value === '' || options.includes(value);
  return (
    <Select id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">(inherit / none)</option>
      {!hasCurrent && <option value={value}>{value} (current)</option>}
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </Select>
  );
}
