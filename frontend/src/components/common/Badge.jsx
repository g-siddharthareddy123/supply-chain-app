export function Badge({ children, tone }) {
  const value = String(children ?? "UNKNOWN").toLowerCase();
  const color =
    tone ||
    ([
      "confirmed",
      "fulfilling",
      "received",
      "resolved",
      "active",
      "sent",
    ].includes(value)
      ? "green"
      : ["high", "open", "backorder", "canceled", "cancelled", "critical"].some(
            (part) => value.includes(part),
          )
        ? "red"
        : ["planned", "in_transit", "draft", "med", "warning"].includes(value)
          ? "amber"
          : "gray");
  return (
    <span className={`badge ${color}`}>
      {String(children ?? "Unknown").replaceAll("_", " ")}
    </span>
  );
}
