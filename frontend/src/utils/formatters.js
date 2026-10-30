export const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export const dateInput = (value) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";

export const number = (value) =>
  value == null
    ? "—"
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const asArray = (value) => (Array.isArray(value) ? value : []);
