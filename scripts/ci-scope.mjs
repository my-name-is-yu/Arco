import { appendFileSync } from "node:fs";

const { GITHUB_EVENT_NAME, GITHUB_OUTPUT } = process.env;
if (!GITHUB_EVENT_NAME || !GITHUB_OUTPUT)
  throw new Error(
    "CI scope selection requires the event name and output path.",
  );

let mode;
switch (GITHUB_EVENT_NAME) {
  case "push":
  case "pull_request":
    mode = "smoke";
    break;
  case "workflow_dispatch":
    mode = "full";
    break;
  default:
    throw new Error(`Unsupported CI event: ${GITHUB_EVENT_NAME}.`);
}

appendFileSync(GITHUB_OUTPUT, `mode=${mode}\n`);
console.log(JSON.stringify({ mode }));
