import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { parse } from "acorn";
import postcss from "postcss";
import { Buffer } from "node:buffer";

const html = await readFile("dist/plugin/arco.html", "utf8");
const server = await readFile("dist/plugin/server.mjs", "utf8");
for (const developmentLiteral of [
  "fixture-issue-42",
  "fixture-linear-workspace",
  "arco-fixture/selection.png",
  "Preserve issue selection and scroll position",
])
  assert(
    !server.includes(developmentLiteral),
    "development fixture data in production server",
  );
assert(!/<script\b[^>]*\bsrc\s*=/i.test(html), "external script");
assert(!/<link\b[^>]*rel=["']stylesheet/i.test(html), "external stylesheet");
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
for (const [, css] of styles) {
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
}
const guardedDependencyProbes = [];
for (const [, js] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
  const ast = parse(js, { ecmaVersion: "latest", sourceType: "module" });
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
    for (const [key, value] of Object.entries(node))
      if (key !== "type") {
        if (Array.isArray(value)) value.forEach(walk);
        else walk(value);
      }
  }
  walk(ast);
}
const files = await readdir("dist/plugin", { recursive: true });
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
assert(!html.includes("ローカルfixture host"), "test harness in production");
console.log(
  `PASS self-contained HTML (${Buffer.byteLength(html)} bytes), JS/CSS AST, no development fixture or sourcemap; ${guardedDependencyProbes.length} guarded dependency Function probes retained (CSP browser check required)`,
);
