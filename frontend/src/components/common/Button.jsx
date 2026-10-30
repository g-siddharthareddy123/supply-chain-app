export function Button({
  children,
  variant = "primary",
  icon: Icon,
  type = "button",
  ...props
}) {
  return (
    <button type={type} className={`button ${variant}`} {...props}>
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}
