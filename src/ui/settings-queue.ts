import type { ArcoHost } from "../shared/contracts";

const queues = new WeakMap<ArcoHost, Promise<void>>();

// A source switch can flush one hook while another saves the active source.
export function enqueueSettingsWrite(
  host: ArcoHost,
  write: () => Promise<void>,
) {
  const next = (queues.get(host) ?? Promise.resolve())
    .catch(() => undefined)
    .then(write);
  queues.set(host, next);
  return next;
}
