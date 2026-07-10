// Shared id-generation for Input/Select/Textarea (REQ-F001-045). Factored out because all three
// fields need an identical useId-generated-id fallback plus hint/error id derivation
// (REQ-F001-021/-030); this is implementation-internal, not part of any component's public prop
// contract. Split from FieldFrame.tsx (a component) so each file exports a single kind of thing
// (react-refresh/only-export-components).
import { useId } from 'react';

export function useFieldIds(id: string | undefined, hint?: string, error?: string | null) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return { fieldId, hintId, errorId };
}
