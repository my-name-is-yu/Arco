import type { ComponentProps } from "react";

export function DisclosureSummary({
  children,
  ...props
}: ComponentProps<"summary">) {
  return (
    <summary {...props}>
      <span className="disclosure-label">{children}</span>
    </summary>
  );
}
