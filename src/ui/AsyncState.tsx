import type { HTMLAttributes, ReactNode } from "react";
export function AsyncState({
  as: Element = "div",
  kind,
  label,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: "div" | "main" | "p";
  kind: "loading" | "empty" | "error";
  label?: string;
  children: ReactNode;
}) {
  return (
    <Element
      {...props}
      role={
        kind === "error" ? "alert" : kind === "loading" ? "status" : undefined
      }
      aria-label={label}
      aria-busy={kind === "loading" || undefined}
    >
      {children}
    </Element>
  );
}
