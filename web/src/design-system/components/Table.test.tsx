// SPEC F-001 REQ-F001-045 (§5) — recreate Table (+ Table.Row/Table.Cell) matching
// web/vendor/design-system/project/components/data-display/Table.d.ts. Behavior carried faithfully
// from the vendored prototype (docs/design/F-001/01-component-contracts.md §1): `columns` drives the
// header row; `Table.Cell header` renders a `<th>`, otherwise a `<td>`.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/Table.tsx`
// exist (REQ-F001-045/015). Maps to the `.entity-table`/`.entity-list` migration pattern (REQ-F001-016).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table } from '../index';

describe('Table (REQ-F001-045, contract: data-display/Table.d.ts)', () => {
  it('renders a header row from `columns`', () => {
    render(
      <Table columns={['Username', 'Role']}>
        <Table.Row>
          <Table.Cell>alice</Table.Cell>
          <Table.Cell>admin</Table.Cell>
        </Table.Row>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: 'Username' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
  });

  it('omits the header row when `columns` is not provided', () => {
    render(
      <Table>
        <Table.Row>
          <Table.Cell>alice</Table.Cell>
        </Table.Row>
      </Table>,
    );
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });

  it('Table.Cell renders a <th> when `header` is true, a <td> otherwise', () => {
    render(
      <Table>
        <Table.Row>
          <Table.Cell header>alice</Table.Cell>
          <Table.Cell>admin</Table.Cell>
        </Table.Row>
      </Table>,
    );
    const th = screen.getByText('alice');
    expect(th.tagName).toBe('TH');
    const td = screen.getByText('admin');
    expect(td.tagName).toBe('TD');
  });

  it('renders rows via Table.Row inside a <tbody>', () => {
    const { container } = render(
      <Table columns={['A']}>
        <Table.Row>
          <Table.Cell>1</Table.Cell>
        </Table.Row>
        <Table.Row>
          <Table.Cell>2</Table.Cell>
        </Table.Row>
      </Table>,
    );
    const tbody = container.querySelector('tbody');
    expect(tbody).not.toBeNull();
    expect(tbody?.querySelectorAll('tr').length).toBe(2);
  });
});
