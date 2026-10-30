import { RefreshCw } from "lucide-react";

import { Button } from "./Button";

export function RefreshAction({ onClick, loading }) {
  return (
    <Button
      variant="secondary"
      icon={RefreshCw}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
