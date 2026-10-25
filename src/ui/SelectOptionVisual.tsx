import type { ReactNode } from "react";
import { IssueLabelVisual } from "./IssuePropertyVisual";

export function SelectOptionVisual({
  leading,
  color,
}: {
  leading?: ReactNode;
  color?: string;
}) {
  const visual = leading ?? (color ? <IssueLabelVisual color={color} /> : null);
  return visual != null ? (
    <span className="source-select-leading" aria-hidden="true">
      {visual}
    </span>
  ) : null;
}
