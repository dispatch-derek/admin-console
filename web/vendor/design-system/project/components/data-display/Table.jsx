import React from "react";

/**
 * Admin data table. Uppercase, bold, secondary-colored headers over
 * hairline-separated rows (h-40, text-xs). Pass `columns` (array of header
 * labels) and `children` <Table.Row>/<tr> rows, or compose manually.
 */
export function Table({ columns = [], children, minWidth = 640, className = "", style = {} }) {
  return (
    <div style={{ overflowX: "auto", width: "100%" }}>
      <table
        className={className}
        style={{
          width: "100%",
          minWidth,
          textAlign: "left",
          borderCollapse: "collapse",
          fontFamily: "var(--font-sans)",
          fontSize: "12px",
          ...style,
        }}
      >
        {columns.length > 0 && (
          <thead>
            <tr style={{ borderBottom: "1px solid var(--theme-sidebar-border)" }}>
              {columns.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  style={{
                    padding: "12px 24px",
                    fontSize: "12px",
                    fontWeight: 700,
                    lineHeight: "18px",
                    textTransform: "uppercase",
                    letterSpacing: "0.02em",
                    color: "var(--theme-text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
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

/** A body row. Cells are <Table.Cell> or plain <td>. */
Table.Row = function Row({ children, className = "", style = {} }) {
  return (
    <tr
      className={className}
      style={{
        height: 40,
        color: "rgba(255,255,255,0.8)",
        fontWeight: 500,
        borderBottom: "1px solid var(--theme-sidebar-border)",
        ...style,
      }}
    >
      {children}
    </tr>
  );
};

Table.Cell = function Cell({ children, header = false, style = {} }) {
  const Tag = header ? "th" : "td";
  return (
    <Tag
      scope={header ? "row" : undefined}
      style={{ padding: "0 24px", whiteSpace: header ? "nowrap" : "normal", fontWeight: header ? 500 : "inherit", ...style }}
    >
      {children}
    </Tag>
  );
};
