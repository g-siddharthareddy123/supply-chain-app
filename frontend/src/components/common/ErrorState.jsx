import { AlertTriangle, RefreshCw } from "lucide-react";

export function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state">
      <AlertTriangle size={18} />
      <div>
        <b>Could not load data</b>
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button variant="secondary" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
