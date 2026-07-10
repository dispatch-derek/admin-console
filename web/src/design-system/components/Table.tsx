// Recreated DS component (REQ-F001-045). Contract: vendored data-display/Table.d.ts.
// `columns` drives the header row; Table.Row / Table.Cell compose body rows; Cell header→<th>.
import type { CSSProperties, ReactNode } from 'react';
import styles from './Table.module.css';

export interface TableProps {
  columns?: string[];
  children?: ReactNode;
  minWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export interface TableRowProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export interface TableCellProps {
  children?: ReactNode;
  header?: boolean;
  style?: CSSProperties;
}

function TableBase({ columns = [], children, minWidth = 640, className = '', style }: TableProps) {
  return (
    <div className={styles.scroll}>
      <table className={`${styles.table} ${className}`.trim()} style={{ minWidth, ...style }}>
        {columns.length > 0 && (
          <thead>
            <tr className={styles.headRow}>
              {columns.map((c) => (
                <th key={c} scope="col" className={styles.headCell}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ children, className = '', style }: TableRowProps) {
  return (
    <tr className={`${styles.row} ${className}`.trim()} style={style}>
      {children}
    </tr>
  );
}

function Cell({ children, header = false, style }: TableCellProps) {
  if (header) {
    return (
      <th scope="row" className={styles.cellHeader} style={style}>
        {children}
      </th>
    );
  }
  return (
    <td className={styles.cell} style={style}>
      {children}
    </td>
  );
}

export const Table = Object.assign(TableBase, { Row, Cell });
