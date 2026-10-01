// Keep templates readable and source text escaped by default.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
const root = import.meta.dirname;
const parse = (file, text, jsx = false) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.JS,
  );
const visit = (node, fn) => {
  fn(node);
  ts.forEachChild(node, (n) => visit(n, fn));
};
const reservedHelpers = new Set([
  "esc",
  "html",
  "icon",
  "money",
  "moneyWords",
  "moneyShort",
  "num",
  "fmtDate",
  "receipt",
  "query",
  "bar",
  "standing",
  "flagItem",
  "spotError",
  "leaders",
  "pager",
  "schedule",
  "pageHead",
  "methodCode",
  "bodyAnchor",
  "bodyHref",
  "bodyLink",
  "datasetLabel",
  "nativeAmount",
  "amountText",
  "federalStatement",
  "moneyLimit",
  "yearLink",
  "mobileSources",
  "rcpt",
  "sourceAction",
  "nameOrder",
  "countLine",
  "asked",
  "askClaude",
  "askChatGPT",
]);
const functions = new Map();
function functionNames(file) {
  if (functions.has(file)) return functions.get(file);
  const names = new Set();
  functions.set(file, names);
  const ast = parse(file, readFileSync(file, "utf8"));
  visit(ast, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) names.add(n.name.text);
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) ||
        ts.isFunctionExpression(n.initializer))
    )
      names.add(n.name.text);
  });
  return names;
}
const files = readdirSync(resolve(root, "src"), { recursive: true }).filter(
  (f) => f.endsWith(".astro"),
);
let sinks = 0;
for (const file of files) {
  const source = readFileSync(resolve(root, "src", file), "utf8");
  const front = source.match(/^---\n([\s\S]*?)^---/m) || ["", ""];
  const ast = parse(file, front[1]);
  visit(ast, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer?.getText(ast) === "Astro.props" &&
      ts.isObjectBindingPattern(n.name)
    )
      for (const e of n.name.elements)
        assert.ok(
          !reservedHelpers.has(
            e.propertyName?.getText(ast) || e.name.getText(ast),
          ),
          `${file}: helpers must be imported, not received as props`,
        );
  });
  const helpers = new Set();
  visit(ast, (n) => {
    if (ts.isImportDeclaration(n)) {
      const spec = n.moduleSpecifier.text;
      assert.ok(
        !/\/(pages|views)(\/|\.mjs)/.test(spec),
        `${file}: import plain helpers from lib, not rendering entry points`,
      );
      if (spec.endsWith(".mjs") && spec.startsWith(".")) {
        const names = functionNames(resolve(root, "src", dirname(file), spec));
        for (const e of n.importClause?.namedBindings?.elements || [])
          if (names.has(e.propertyName?.text || e.name.text))
            helpers.add(e.name.text);
      }
    }
    if (ts.isFunctionDeclaration(n) && n.name) helpers.add(n.name.text);
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isArrowFunction(n.initializer)
    )
      helpers.add(n.name.text);
  });
  const template = parse(
    file,
    `const template = <>${source.slice(front[0].length)}</>;`,
    true,
  );
  visit(template, (n) => {
    if (
      ts.isJsxAttribute(n) &&
      n.initializer &&
      ts.isJsxExpression(n.initializer)
    ) {
      const e = n.initializer.expression;
      if (n.name.getText(template) === "set:html") {
        sinks++;
        assert.ok(
          e &&
            ts.isCallExpression(e) &&
            ts.isIdentifier(e.expression) &&
            e.expression.text === "icon",
          `${file}: raw HTML is reserved for imported icons`,
        );
      }
      assert.ok(
        !(e && ts.isIdentifier(e) && helpers.has(e.text)),
        `${file}: import helpers in the receiving component instead of passing ${e?.getText(template)}`,
      );
      assert.ok(
        !(e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e))),
        `${file}: function props are not page data`,
      );
    }
  });
  for (const tree of [ast, template])
    visit(tree, (n) => {
      if (ts.isIdentifier(n))
        assert.ok(
          !["renderComponent", "renderAstro", "oneToOne"].includes(n.text),
          `${file}: nest Astro components directly`,
        );
      if (ts.isStringLiteralLike(n))
        assert.ok(
          !/<\/?[a-z][\w-]*(?:\s[^<>]*|\s*)>/i.test(n.text),
          `${file}: HTML belongs in markup, not strings`,
        );
    });
}
assert.ok(
  sinks <= 54,
  `${sinks} raw HTML sinks exceed the icon-only cap of 54`,
);
for (const file of [
  ...readdirSync(resolve(root, "src"), { recursive: true })
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => "src/" + f),
  "lib/html.mjs",
  "lib/views.mjs",
  "routes/feedback.js",
  "routes/receipt/index.js",
]) {
  const ast = parse(file, readFileSync(resolve(root, file), "utf8"));
  const helpers = functionNames(resolve(root, file));
  for (const n of ast.statements)
    if (
      ts.isImportDeclaration(n) &&
      n.moduleSpecifier.text.startsWith(".") &&
      n.moduleSpecifier.text.endsWith(".mjs")
    ) {
      const names = functionNames(
        resolve(root, dirname(file), n.moduleSpecifier.text),
      );
      for (const e of n.importClause?.namedBindings?.elements || [])
        if (names.has(e.propertyName?.text || e.name.text))
          helpers.add(e.name.text);
    }
  visit(ast, (n) => {
    if (ts.isStringLiteralLike(n))
      assert.ok(
        !/<\/?[a-z][\w-]*(?:\s[^<>]*|\s*)>/i.test(n.text),
        `${file}: HTML belongs in Astro components, not JavaScript data`,
      );
    if (ts.isIdentifier(n))
      assert.ok(
        !["renderComponent", "oneToOne"].includes(n.text),
        `${file}: removed string dispatch/dead helper`,
      );
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "renderAstro") {
      assert.ok(
        !ts.isStringLiteral(n.arguments[0]),
        `${file}: render a component reference, not a name`,
      );
      const props = n.arguments[1];
      if (props && ts.isObjectLiteralExpression(props))
        for (const p of props.properties) {
          const value = ts.isShorthandPropertyAssignment(p)
            ? p.name
            : ts.isPropertyAssignment(p)
              ? p.initializer
              : null;
          assert.ok(
            !(value && ts.isIdentifier(value) && helpers.has(value.text)),
            `${file}: pass data, not helper ${value?.getText(ast)}`,
          );
          assert.ok(
            !(
              value &&
              (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
            ),
            `${file}: function props are not page data`,
          );
        }
    }
  });
}
assert.ok(
  !files.includes("components/OneToOne.astro"),
  "Dead OneToOne component removed",
);
console.log(
  `PASS: ${files.length} Astro templates nest directly; ${sinks} icon-only raw HTML sinks; no HTML in page data`,
);
