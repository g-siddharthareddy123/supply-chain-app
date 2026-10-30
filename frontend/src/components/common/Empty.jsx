import { Boxes } from "lucide-react";

export function Empty({
  title = "No records found",
  detail = "Data will appear here when available.",
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Boxes size={20} />
      </div>
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}
