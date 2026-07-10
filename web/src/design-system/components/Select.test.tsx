// SPEC F-001 REQ-F001-045 (§5) — recreate Select matching
// web/vendor/design-system/project/components/forms/Select.d.ts: `options` accepts either a plain
// string or a `{value,label}` SelectOption.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// Select.tsx` exist (REQ-F001-045/015). Serves the provider-selector / OllamaModelSelect migration
// pattern (REQ-F001-016).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../index';

describe('Select (REQ-F001-045, contract: forms/Select.d.ts)', () => {
  it('renders an associated label', () => {
    render(<Select label="Provider" id="provider" options={['openai', 'anthropic']} />);
    expect(screen.getByLabelText('Provider')).toBeInTheDocument();
  });

  it('renders string options as both value and label', () => {
    render(<Select label="Provider" options={['openai', 'anthropic']} />);
    expect(screen.getByRole('option', { name: 'openai' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'anthropic' })).toBeInTheDocument();
  });

  it('renders {value,label} SelectOption entries using the label text', () => {
    render(
      <Select
        label="Model"
        options={[
          { value: 'gpt-4o', label: 'GPT-4o' },
          { value: 'claude', label: 'Claude' },
        ]}
      />,
    );
    expect(screen.getByRole('option', { name: 'GPT-4o' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude' })).toBeInTheDocument();
  });

  it('reflects a controlled `value` and fires onChange', async () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Provider"
        value="openai"
        onChange={onChange}
        options={['openai', 'anthropic']}
      />,
    );
    const select = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect(select.value).toBe('openai');
    await userEvent.selectOptions(select, 'anthropic');
    expect(onChange).toHaveBeenCalled();
  });

  it('supports `disabled`', () => {
    render(<Select label="Locked" disabled options={['a']} />);
    expect(screen.getByLabelText('Locked')).toBeDisabled();
  });
});
