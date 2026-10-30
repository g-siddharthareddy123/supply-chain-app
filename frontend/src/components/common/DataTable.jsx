export function DataTable({
  columns,
  rows,
  emptyText = "No records to display",
}) {
  if (!rows?.length) return <Empty title={emptyText} />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={
                row.id ?? row.order_id ?? row.receipt_id ?? row.line_id ?? index
              }
            >
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render
                    ? column.render(row)
                    : (row[column.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
