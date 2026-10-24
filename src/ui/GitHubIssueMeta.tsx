export function StateIcon({ state }: { state: "open" | "closed" }) {
  return (
    <span
      className={`state-icon ${state}`}
      aria-label={state === "open" ? "Open" : "Closed"}
    >
      {state === "open" ? "◉" : "✓"}
    </span>
  );
}

export function ShortDate({ date }: { date: string }) {
  return (
    <time dateTime={date} title={new Date(date).toLocaleString("en")}>
      {new Date(date).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
      })}
    </time>
  );
}
