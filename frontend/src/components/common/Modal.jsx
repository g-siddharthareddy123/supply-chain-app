import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-header">
          <h3 id="modal-title">{title}</h3>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
