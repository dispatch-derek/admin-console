// White-box unit tests for Table (+ Table.Row/Table.Cell) (REQ-F001-045). Complements Table.test.tsx
// (spec-level) by exercising: the `columns.length > 0` boundary (an explicit empty array must NOT
// render a header row, mirroring the omitted-columns case), the default/custom `minWidth`, and
// className/style pass-through on TableBase/Row/Cell.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table } from '../index';

describe('Table (white-box)', () => {
  it('omits the header row when `columns` is an explicit empty array (boundary distinct from undefined)', () => {
    render(
      <Table columns={[]}>
        <Table.Row>
          <Table.Cell>x</Table.Cell>
        </Table.Row>
      </Table>,
    );
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });

  it('defaults `minWidth` to 640 on the <table> when omitted', () => {
    const { container } = render(
      <Table>
        <Table.Row>
          <Table.Cell>x</Table.Cell>
        </Table.Row>
      </Table>,
    );
    const table = container.querySelector('table') as HTMLTableElement;
    expect(parseInt(table.style.minWidth, 10)).toBe(640);
  });

  it('applies a custom `minWidth`', () => {
    const customWidth = 900;
    const { container } = render(
      <Table minWidth={customWidth}>
        <Table.Row>
          <Table.Cell>x</Table.Cell>
        </Table.Row>
      </Table>,
    );
    const table = container.querySelector('table') as HTMLTableElement;
    expect(parseInt(table.style.minWidth, 10)).toBe(customWidth);
  });

  it('merges a caller-supplied className onto the <table>', () => {
    const { container } = render(
      <Table className="extra">
        <Table.Row>
          <Table.Cell>x</Table.Cell>
        </Table.Row>
      </Table>,
    );
    expect(container.querySelector('table')!.className).toEqual(expect.stringContaining('extra'));
  });

  it('Table.Row forwards className and style to the <tr>', () => {
    const { container } = render(
      <Table>
        <Table.Row className="row-extra" style={{ opacity: 0.5 }}>
          <Table.Cell>x</Table.Cell>
        </Table.Row>
      </Table>,
    );
    const tr = container.querySelector('tr.row-extra, tbody tr')!;
    expect(tr.className).toEqual(expect.stringContaining('row-extra'));
    expect(tr).toHaveStyle({ opacity: '0.5' });
  });

  it('Table.Cell forwards `style` on both header and non-header cells', () => {
    render(
      <Table>
        <Table.Row>
          <Table.Cell header style={{ opacity: 0.7 }}>
            head
          </Table.Cell>
          <Table.Cell style={{ opacity: 0.3 }}>data</Table.Cell>
        </Table.Row>
      </Table>,
    );
    expect(screen.getByText('head')).toHaveStyle({ opacity: '0.7' });
    expect(screen.getByText('data')).toHaveStyle({ opacity: '0.3' });
  });

  it('a header Table.Cell uses scope="row" (row-header semantics, not column-header)', () => {
    render(
      <Table>
        <Table.Row>
          <Table.Cell header>alice</Table.Cell>
        </Table.Row>
      </Table>,
    );
    expect(screen.getByText('alice')).toHaveAttribute('scope', 'row');
  });

  it('a `columns` header cell uses scope="col"', () => {
    render(
      <Table columns={['Name']}>
        <Table.Row>
          <Table.Cell>alice</Table.Cell>
        </Table.Row>
      </Table>,
    );
    expect(screen.getByText('Name')).toHaveAttribute('scope', 'col');
  });
});
