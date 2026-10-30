import { Button } from "../common/Button";

export function SubmitRow({ busy, onCancel, label = "Save changes" }) {
  return (
    <div className="form-actions">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : label}
      </Button>
    </div>
  );
}
