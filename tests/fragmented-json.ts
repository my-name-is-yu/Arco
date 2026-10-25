import { request, type Server } from "node:http";
import { text } from "node:stream/consumers";

export function postFragmentedJson(server: Server, value: unknown) {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("The fixture server is not listening on TCP.");
  const body = Buffer.from(JSON.stringify(value));
  const split = body.indexOf(Buffer.from("🧭")) + 1;
  if (split === 0)
    throw new Error("The fixture request needs a compass character.");

  return new Promise<unknown>((resolve, reject) => {
    const outgoing = request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: "/graphql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
      },
      (response) => {
        text(response).then(JSON.parse).then(resolve, reject);
      },
    );
    // Make the reader receive the incomplete UTF-8 prefix before sending its suffix.
    server.once("request", (incoming) => {
      let received = 0;
      incoming.on("data", function observed(chunk: Buffer) {
        received += chunk.length;
        if (received < split) return;
        incoming.off("data", observed);
        outgoing.end(body.subarray(split));
      });
    });
    outgoing.on("error", reject);
    outgoing.write(body.subarray(0, split));
  });
}
