export function PageHeader({ title, description, actions }) {
  return (
    <div className="content-heading">
      <div>
        <p className="section-kicker">OPERATIONS OVERVIEW</p>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
