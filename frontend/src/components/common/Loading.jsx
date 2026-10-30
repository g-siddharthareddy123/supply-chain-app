export function Loading({ label = "Loading live data..." }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {label}
    </div>
  );
}
