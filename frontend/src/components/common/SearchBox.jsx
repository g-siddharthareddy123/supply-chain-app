import { Search } from "lucide-react";

export function SearchBox({ value, onChange, placeholder = "Search..." }) {
  return (
    <div className="search-box">
      <Search size={16} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}
