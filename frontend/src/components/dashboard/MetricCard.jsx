import { Card } from "../common/Card";

export function Metric({ label, value, caption, icon: Icon, tone }) {
  return (
    <Card className="metric-card">
      <div className={`metric-icon ${tone || ""}`}>
        <Icon size={18} />
      </div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value ?? "—"}</div>
      <div className="metric-caption">{caption}</div>
    </Card>
  );
}
