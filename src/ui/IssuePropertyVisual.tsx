function nativeColor(color?: string | null): string | undefined {
  const name = color?.toLowerCase();
  if (
    name &&
    [
      "gray",
      "blue",
      "green",
      "yellow",
      "orange",
      "red",
      "pink",
      "purple",
    ].includes(name)
  )
    return `var(--property-option-${name})`;
  const hex = color?.replace(/^#/, "");
  return hex && /^[\da-f]{6}$/i.test(hex) ? `#${hex}` : undefined;
}

export function IssueStateVisual({
  source,
  state,
  color,
}: {
  source: "github" | "linear";
  state: string;
  color?: string | null;
}) {
  const shape =
    source === "linear" &&
    ![
      "backlog",
      "unstarted",
      "started",
      "completed",
      "canceled",
      "duplicate",
    ].includes(state)
      ? "unknown"
      : state;
  return (
    <svg
      className="property-state-icon"
      data-source={source}
      data-state={shape}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={source === "linear" ? { color: nativeColor(color) } : undefined}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="5.5"
        strokeDasharray={shape === "backlog" ? "1.5 2" : undefined}
      />
      {shape === "started" && (
        <path
          d="M8 2.5a5.5 5.5 0 0 1 0 11Z"
          fill="currentColor"
          stroke="none"
        />
      )}
      {shape === "completed" && <path d="m5.2 8 1.9 1.9 3.7-3.8" />}
      {["not_planned", "canceled", "duplicate"].includes(shape) && (
        <path d="m4.2 11.8 7.6-7.6" />
      )}
      {["closed", "unknown"].includes(shape) && (
        <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      )}
    </svg>
  );
}

export function IssueAssigneeVisual({ name }: { name?: string | null }) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!words.length)
    return (
      <svg
        className="property-assignee-mark property-assignee-unassigned"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="5" r="2.5" />
        <path d="M3 13c.3-2.5 2-4 5-4s4.7 1.5 5 4" />
      </svg>
    );
  const initials =
    words.length > 1
      ? `${Array.from(words[0])[0]}${Array.from(words.at(-1)!)[0]}`
      : Array.from(words[0]).slice(0, 2).join("");
  return (
    <span className="property-assignee-mark" aria-hidden="true">
      {initials.toLocaleUpperCase()}
    </span>
  );
}

export function IssueLabelVisual({ color }: { color?: string | null }) {
  return (
    <span
      className="property-label-dot"
      style={{ backgroundColor: nativeColor(color) }}
      aria-hidden="true"
    />
  );
}

export function IssuePriorityVisual({ priority }: { priority: number }) {
  const level = 5 - priority;
  return (
    <svg
      className="property-priority-icon"
      data-priority={priority}
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden="true"
    >
      {priority >= 1 && priority <= 4 ? (
        [3, 5, 8, 11].map((height, index) => (
          <rect
            key={height}
            x={1 + index * 3}
            y={12 - height}
            width="2"
            height={height}
            rx="0.5"
            opacity={index < level ? 1 : 0.18}
          />
        ))
      ) : (
        <path d="M3 7h8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}
