import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { parse } from "acorn";
import postcss from "postcss";
import { Buffer } from "node:buffer";
import { join } from "node:path";

const directory = process.argv[2] ?? "dist/plugin";
const html = await readFile(join(directory, "arco.html"), "utf8");
const server = await readFile(join(directory, "server.mjs"), "utf8");
assert.equal(
  await readFile(join(directory, "LICENSE"), "utf8"),
  await readFile("LICENSE", "utf8"),
  "project license missing or changed in plugin artifact",
);
[
  "fixture-issue-42",
  "fixture-linear-workspace",
  "arco-fixture/selection.png",
  "Preserve issue selection and scroll position",
].forEach((developmentLiteral) =>
  assert(
    !server.includes(developmentLiteral),
    "development fixture data in production server",
  ),
);
assert(!/<script\b[^>]*\bsrc\s*=/i.test(html), "external script");
assert(!/<link\b[^>]*rel=["']stylesheet/i.test(html), "external stylesheet");
[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].forEach(([, css]) => {
  const ast = postcss.parse(css);
  ast.walkAtRules("import", () => {
    throw new Error("CSS import");
  });
  ast.walkDecls((decl) => {
    assert(
      !/url\(\s*["']?(?:https?:|\/\/)/i.test(decl.value),
      "remote CSS URL",
    );
  });
});
const guardedDependencyProbes = [];
[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].forEach(([, js]) => {
  function walk(node) {
    if (!node || typeof node !== "object") return;
    assert(node.type !== "ImportExpression", "dynamic import");
    if (
      (node.type === "CallExpression" || node.type === "NewExpression") &&
      node.callee?.type === "Identifier" &&
      ["eval", "Function"].includes(node.callee.name)
    ) {
      const argument = node.arguments[0];
      const literal =
        argument?.type === "Literal"
          ? argument.value
          : argument?.type === "TemplateLiteral" &&
              argument.expressions.length === 0
            ? argument.quasis[0].value.cooked
            : undefined;
      // Shipped dependencies retain a global-object fallback and a JIT capability
      // probe. No user input reaches these; jitless mode and the browser CSP test
      // verify neither executes. Keep them visible in the report.
      assert(
        node.callee.name === "Function" &&
          node.arguments.length === 1 &&
          ["", "return this"].includes(literal),
        "unexpected runtime code evaluation",
      );
      guardedDependencyProbes.push(literal);
    }
    Object.entries(node).forEach(([key, value]) => {
      if (key === "type") return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      walk(value);
    });
  }
  walk(parse(js, { ecmaVersion: "latest", sourceType: "module" }));
});
const files = await readdir(directory, { recursive: true });
assert(
  !files.some((file) => /\.map$|\.env|fixture/.test(file)),
  "development/secret artifact",
);
assert(
  !files.some(
    (file) =>
      file.startsWith("node_modules/") &&
      !/^node_modules\/(?:@napi-rs(?:\/keyring[^/]*(?:\/.*)?)?)?$/.test(file),
  ),
  "unexpected unbundled runtime package",
);
assert(
  !html.includes("MOCK HOST · fixture only · Not the Codex app"),
  "test harness in production",
);
console.log(
  `PASS self-contained HTML (${Buffer.byteLength(html)} bytes), JS/CSS AST, no development fixture or sourcemap; ${guardedDependencyProbes.length} guarded dependency Function probes retained (CSP browser check required)`,
);
