import { SETTINGS_HISTORY_LIMIT } from "../shared/state";

export function rememberSetting<T>(
  entries: Record<string, T>,
  key: string,
  value: T,
): Record<string, T> {
  return Object.fromEntries(
    [
      ...Object.entries(entries).filter(([existing]) => existing !== key),
      [key, value],
    ].slice(-SETTINGS_HISTORY_LIMIT),
  );
}
