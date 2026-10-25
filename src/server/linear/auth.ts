import { LinearServiceError } from "./errors";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AsyncEntry } from "@napi-rs/keyring";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { stateDirectory } from "../state";

export const LINEAR_REDIRECT_URI =
  "http://127.0.0.1:53187/oauth/linear/callback";
export const credentialSchema = z
  .object({
    clientId: z.string().min(1),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().finite(),
    scopes: z.array(z.string()),
  })
  .strict();
export type LinearCredential = z.infer<typeof credentialSchema>;
export interface CredentialStore {
  read(connectionId: string): Promise<LinearCredential | null>;
  write(connectionId: string, value: LinearCredential): Promise<void>;
  remove(connectionId: string): Promise<void>;
}
export function createCredentialStore(): CredentialStore {
  const entry = (id: string) =>
    new AsyncEntry("Arco Linear OAuth", id, {
      linux: { store: "secret-service" },
    });
  return {
    async read(id) {
      try {
        const value = await entry(id).getPassword();
        return value === null
          ? null
          : credentialSchema.parse(JSON.parse(value));
      } catch {
        throw new LinearServiceError(
          "Your saved Linear sign-in could not be read. Unlock your device's credential store and try again.",
          "storage",
        );
      }
    },
    async write(id, value) {
      try {
        await entry(id).setPassword(
          JSON.stringify(credentialSchema.parse(value)),
        );
      } catch {
        throw new LinearServiceError(
          "Your Linear sign-in could not be saved. Unlock your device's credential store and authorize again.",
          "storage",
        );
      }
    },
    async remove(id) {
      try {
        await entry(id).deleteCredential();
      } catch {
        throw new LinearServiceError(
          "Your saved Linear sign-in could not be removed. Unlock your device's credential store and try again.",
          "storage",
        );
      }
    },
  };
}
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.union([z.string(), z.array(z.string())]),
});
function tokenCredential(
  clientId: string,
  value: unknown,
  now: number,
): LinearCredential {
  const parsed = tokenResponseSchema.parse(value);
  const scopes =
    typeof parsed.scope === "string"
      ? parsed.scope.split(/[ ,]+/).filter(Boolean)
      : parsed.scope;
  if (!scopes.includes("read") || !scopes.includes("write"))
    throw new LinearServiceError(
      "Linear read and write authorization is required.",
      "auth",
    );
  return {
    clientId,
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: now + parsed.expires_in * 1000,
    scopes,
  };
}
export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  };
}
export function validState(actual: string | null, expected: string) {
  const provided = Buffer.from(actual ?? "");
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}
export function createLinearAuth(
  options: {
    store?: CredentialStore;
    directory?: string;
    fetch?: typeof fetch;
    now?: () => number;
  } = {},
) {
  const store = options.store ?? createCredentialStore();
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const directory = join(
    options.directory ?? stateDirectory(),
    "linear-authorization",
  );
  const pending = new Map<string, { server: Server; close: () => void }>();
  const statuses = new Map<
    string,
    { state: "pending" | "connected" | "failed"; message: string }
  >();
  async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, createHash("sha256").update(id).digest("hex"));
    const release = await lockfile.lock(file, {
      realpath: false,
      stale: 30_000,
      retries: { retries: 30, minTimeout: 25, maxTimeout: 100 },
    });
    try {
      return await action();
    } finally {
      await release();
    }
  }
  async function exchange(form: URLSearchParams, clientId: string) {
    let response;
    try {
      response = await request("https://api.linear.app/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new LinearServiceError(
        "Could not connect to Linear. Check your connection and try again.",
        error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
          ? "timeout"
          : "unavailable",
      );
    }
    if (!response.ok)
      throw new LinearServiceError(
        response.status === 400 || response.status === 401
          ? "Linear authorization is no longer valid. Reconnect to Linear."
          : response.status === 429
            ? "Linear authorization is temporarily limited. Wait and reconnect."
            : response.status === 403
              ? "Linear authorization was denied. Check your Linear permissions."
              : "Could not connect to Linear. Check your connection and try again.",
        response.status === 400 || response.status === 401
          ? "auth"
          : response.status === 429
            ? "rate-limited"
            : response.status === 403
              ? "forbidden"
              : "unavailable",
      );
    try {
      return tokenCredential(clientId, await response.json(), now());
    } catch {
      throw new LinearServiceError(
        "Linear authorization could not be completed. Reconnect to Linear.",
        "auth",
      );
    }
  }
  async function accessToken(connectionId: string, forceRefresh = false) {
    return locked(connectionId, async () => {
      const current = await store.read(connectionId);
      if (!current) throw new LinearServiceError("Connect to Linear.", "auth");
      if (!forceRefresh && current.expiresAt > now() + 60_000)
        return current.accessToken;
      const updated = await exchange(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: current.clientId,
          refresh_token: current.refreshToken,
        }),
        current.clientId,
      );
      await store.write(connectionId, updated);
      return updated.accessToken;
    });
  }
  return {
    accessToken,
    async refresh(connectionId: string) {
      await accessToken(connectionId, true);
    },
    async hasConnection(connectionId: string) {
      return Boolean(await store.read(connectionId));
    },
    status(connectionId: string) {
      return {
        ...(statuses.get(connectionId) ?? {
          state: "idle" as const,
          message: "",
        }),
      };
    },
    async begin(
      connectionId: string,
      clientId: string,
      redirectUri = LINEAR_REDIRECT_URI,
    ) {
      z.string().min(1).max(200).parse(connectionId);
      z.string().min(1).max(200).parse(clientId);
      const callback = new URL(redirectUri);
      if (
        callback.protocol !== "http:" ||
        callback.hostname !== "127.0.0.1" ||
        callback.pathname !== "/oauth/linear/callback" ||
        !callback.port ||
        callback.search ||
        callback.hash
      )
        throw new LinearServiceError(
          "Use the registered 127.0.0.1 loopback callback.",
        );
      if (pending.has(connectionId))
        throw new LinearServiceError(
          "Linear authorization is already in progress.",
        );
      const pkce = createPkce();
      const status = {
        state: "pending" as "pending" | "connected" | "failed",
        message: "",
      };
      statuses.set(connectionId, status);
      let processing = false;
      let active = true;
      const server = createServer((req, res) => {
        void (async () => {
          const received = new URL(req.url ?? "/", callback.origin);
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Referrer-Policy", "no-referrer");
          if (req.method !== "GET" || received.pathname !== callback.pathname) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          if (
            req.headers.host !== callback.host ||
            !validState(received.searchParams.get("state"), pkce.state)
          ) {
            res.writeHead(400);
            res.end("Invalid authorization state");
            return;
          }
          const code = received.searchParams.get("code");
          if (processing) {
            res.writeHead(409);
            res.end("Authorization already processing");
            return;
          }
          processing = true;
          try {
            if (!code || received.searchParams.has("error"))
              throw new LinearServiceError(
                "Linear authorization was cancelled.",
                "auth",
              );
            await locked(connectionId, async () => {
              if (!active)
                throw new LinearServiceError(
                  "Linear authorization was cancelled.",
                  "auth",
                );
              const credential = await exchange(
                new URLSearchParams({
                  grant_type: "authorization_code",
                  client_id: clientId,
                  redirect_uri: redirectUri,
                  code,
                  code_verifier: pkce.verifier,
                }),
                clientId,
              );
              if (!active)
                throw new LinearServiceError(
                  "Linear authorization was cancelled.",
                  "auth",
                );
              await store.write(connectionId, credential);
            });
            status.state = "connected";
            res.end(
              "Arco is connected to Linear. You can close this tab and return to Arco.",
            );
          } catch (error) {
            status.state = "failed";
            status.message =
              error instanceof LinearServiceError
                ? error.message
                : "Linear authorization failed.";
            res.writeHead(400);
            res.end(status.message);
          } finally {
            transaction.close();
          }
        })().catch(() => {
          res.writeHead(500);
          res.end("Authorization failed");
          transaction.close();
        });
      });
      const timer = setTimeout(() => {
        status.state = "failed";
        status.message = "Linear authorization timed out. Reconnect to Linear.";
        transaction.close();
      }, 5 * 60_000);
      timer.unref();
      const transaction = {
        server,
        close() {
          active = false;
          clearTimeout(timer);
          server.removeAllListeners("request");
          server.close();
          if (pending.get(connectionId) === transaction)
            pending.delete(connectionId);
        },
      };
      pending.set(connectionId, transaction);
      await new Promise<void>((resolve, reject) => {
        server.once("error", () => {
          transaction.close();
          reject(
            new LinearServiceError(
              "The Linear callback port could not be opened. Complete any other connection attempt and try again.",
              "unavailable",
            ),
          );
        });
        server.listen(Number(callback.port), "127.0.0.1", resolve);
      });
      const authorize = new URL("https://linear.app/oauth/authorize");
      authorize.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "read,write",
        actor: "user",
        state: pkce.state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        prompt: "consent",
      }).toString();
      return {
        connectionId,
        authorizationUrl: authorize.href,
        redirectUri,
        expiresIn: 300,
      };
    },
    async disconnect(connectionId: string, revoke = false) {
      pending.get(connectionId)?.close();
      pending.delete(connectionId);
      statuses.delete(connectionId);
      return locked(connectionId, async () => {
        const current = await store.read(connectionId);
        if (revoke && current) {
          const response = await request(
            "https://api.linear.app/oauth/revoke",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token: current.refreshToken,
                token_type_hint: "refresh_token",
              }),
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (response.status !== 200)
            throw new LinearServiceError(
              "Linear authorization could not be revoked. Your saved sign-in was kept. Check your connection in Linear before trying again.",
              "uncertain",
            );
        }
        await store.remove(connectionId);
        return {
          disconnected: true,
          providerRevoked: revoke && Boolean(current),
        };
      });
    },
    close() {
      for (const transaction of pending.values()) transaction.close();
    },
  };
}
export type LinearAuth = ReturnType<typeof createLinearAuth>;
