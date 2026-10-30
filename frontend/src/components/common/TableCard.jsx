import { Card } from "./Card";

export function TableCard({ children, className = "" }) {
  return <Card className={`table-card ${className}`}>{children}</Card>;
}
