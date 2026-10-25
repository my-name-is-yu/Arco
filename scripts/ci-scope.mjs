import { appendFileSync } from "node:fs";

if (!process.env.GITHUB_EVENT_NAME || !process.env.GITHUB_OUTPUT)
  throw new Error(
    "CI scope selection requires the event name and output path.",
  );

const mode =
  process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
    ? "full"
    : ["push", "pull_request"].includes(process.env.GITHUB_EVENT_NAME)
      ? "smoke"
      : undefined;
if (!mode)
  throw new Error(`Unsupported CI event: ${process.env.GITHUB_EVENT_NAME}.`);

appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
console.log(JSON.stringify({ mode }));
