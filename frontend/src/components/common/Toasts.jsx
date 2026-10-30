export function Toasts({ items, dismiss }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`} role="status">
          <span>{toast.message}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => dismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
