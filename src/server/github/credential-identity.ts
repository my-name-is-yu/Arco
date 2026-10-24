import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { GitHubError } from "./transport";

const execute = promisify(execFile);

/** Private cache identity for the credential selected by gh; never return its token. */
export async function credentialIdentity(
  readToken: () => Promise<string> = async () => {
    const result = await execute(
      "gh",
      ["auth", "token", "--hostname", "github.com", "--no-refresh"],
      {
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
        },
        timeout: 10_000,
        maxBuffer: 16_384,
        windowsHide: true,
      },
    );
    return result.stdout;
  },
): Promise<string> {
  try {
    const token = (await readToken()).trim();
    if (!token) throw new Error("Missing credential");
    return createHash("sha256").update(`github.com\0${token}`).digest("hex");
  } catch {
    throw new GitHubError(
      "Unable to verify GitHub authentication. Check gh auth login and refresh.",
      "auth",
    );
  }
}
