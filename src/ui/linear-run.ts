import type { LinearSavedReceipt } from "../shared/linear";

export type LinearRun = <T>(
  name: string,
  args: Record<string, unknown>,
) => Promise<T | LinearSavedReceipt | undefined>;

export function isSavedReceipt(value: unknown): value is LinearSavedReceipt {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "linear_saved_receipt"
  );
}
