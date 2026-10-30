"use strict";
// T1.9E: user-facing text must come from the locale files (src/i18n/locales) or the catalog
// (src/i18n/catalog.ts). This check reads every app screen and library file and stops on:
//   JSX_TEXT        words written directly between JSX tags
//   STRING_PROP     words in title/placeholder/label/... props or options objects
//   JSX_STRING      words in a {"..."} expression inside JSX
//   ALERT_TEXT      words written directly in Alert.alert / setError / setMessage
//   RAW_ERROR       error.message passed to Alert.alert (use userErrorMessage)
//   LANG_TERNARY    language === "en" ? "..." : "..." (add a locale key instead)
//   NORWEGIAN_TEXT  æ/ø/å in a string outside the locale files
//   UNIT_TEXT       km/kr/mi/NOK glued to a number in code (use the market formatters)
//   LOCALE_TAG      "nb-NO"/"en-GB" outside src/i18n (use the formatters)
// Needs the TypeScript package (npm install locally; the CI checks job installs it).
//   node .\scripts\check-t1-9e-hardcoded-text.js

const fs = require("fs");
const path = require("path");

let ts;
try {
  ts = require(require.resolve("typescript", { paths: [path.resolve(__dirname, "..")] }));
} catch {
  console.error("FAIL: typescript is not installed. Run npm install first (CI installs it in the checks job).");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const EXCLUDE = [
  /^src\/i18n\/locales\//,
  /^src\/i18n\/catalog\.ts$/,
  // Product setup notes for developers; never shown in the app.
  /^src\/lib\/revenueCatConfig\.ts$/,
];
// Names and symbols that are the same in every language.
const ALLOWED = new Set(["Lost or Found", "Lost Plus", "Google", "Apple", "VS", "OK", "GPS", "ID"]);
const TEXT_PROPS = new Set([
  "title", "headerTitle", "tabBarLabel", "placeholder", "label", "accessibilityLabel",
  "accessibilityHint", "subtitle", "message", "description", "text", "body", "emptyText", "buttonText",
]);

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const hasWords = (s) => /[A-Za-zÆØÅæøå]{2,}/.test(s);
// "Hello there", "Treff", "Ingen saker" — but not codes ("FOUND", "home-outline", "padding").
const looksLikeText = (s) => {
  const v = s.trim();
  if (!hasWords(v) || ALLOWED.has(v)) return false;
  if (/[æøåÆØÅ]/.test(v)) return true;
  if (/^[A-Z0-9_]+$/.test(v) || /^[a-z0-9_.:/#?=&@-]+$/i.test(v) && !/\s/.test(v) && !/^[A-Z][a-z]{2,}$/.test(v)) return false;
  if (/^(rgba?|#)/i.test(v)) return false;
  return /\s/.test(v) || /^[A-Z][a-z]{2,}/.test(v);
};

const findings = [];
for (const file of [...files(path.join(root, "app")), ...files(path.join(root, "src"))]) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (EXCLUDE.some((re) => re.test(rel))) continue;
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (node, rule, text) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push(`${rule} ${rel}:${line + 1} ${JSON.stringify(String(text).replace(/\s+/g, " ").trim().slice(0, 70))}`);
  };
  const calleeOf = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) || ts.isNewExpression(p)) return p.expression.getText(sf);
      if (ts.isBlock(p) || ts.isSourceFile(p)) return "";
    }
    return "";
  };
  const isLogOrInternal = (callee) =>
    /^(console\.|log$|warn$|debug$|reportHandledError|captureServerException|Sentry\.|codedError|require|import|t$|tr$|translate$)/.test(callee) ||
    /^(new )?Error$/.test(callee) || /(\.|^)t$/.test(callee);
  const textOf = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      if (looksLikeText(node.text)) add(node, "JSX_TEXT", node.text);
      else if (/(^|\s)(km|km²|kr|NOK|mi|ft)(\s|$)/.test(node.text)) add(node, "UNIT_TEXT", node.text);
    }

    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf);
      if (TEXT_PROPS.has(name) && looksLikeText(node.initializer.text)) add(node, "STRING_PROP", node.initializer.text);
    }

    const text = textOf(node);
    if (text != null && !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent)) {
      const callee = calleeOf(node);
      let p = node.parent;
      while (p && (ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
      if (/[æøåÆØÅ]/.test(text) && !isLogOrInternal(callee)) add(node, "NORWEGIAN_TEXT", text);
      else if (p && ts.isJsxExpression(p) && looksLikeText(text)) add(node, "JSX_STRING", text);
      else if (p && ts.isPropertyAssignment(p) && TEXT_PROPS.has(p.name.getText(sf)) && looksLikeText(text) && !isLogOrInternal(callee)) add(node, "STRING_PROP", text);
      else if (/^(Alert\.alert|set(Error|Message|Notice|Info|Status)|showToast)$/.test(callee) && looksLikeText(text)) add(node, "ALERT_TEXT", text);
      if (/^(nb-NO|en-GB|en-US)$/.test(text) && !rel.startsWith("src/i18n/")) add(node, "LOCALE_TAG", text);
    }

    if (ts.isTemplateExpression(node)) {
      const raw = node.getText(sf);
      if (/\}\s*(km|kr|mi|NOK|ft)\b/.test(raw)) add(node, "UNIT_TEXT", raw);
      const internal = isLogOrInternal(calleeOf(node));
      if (/[æøåÆØÅ]/.test(raw) && !internal) add(node, "NORWEGIAN_TEXT", raw);
      else if (!internal) {
        // Words around ${...}: "Last: ${who}", "${n} items left".
        const parts = [node.head.text, ...node.templateSpans.map((x) => x.literal.text)];
        if (parts.some((x) => /[A-Za-zæøå]{2,}\s+[A-Za-zæøå]{2,}|[A-Za-z]{3,}: +$/.test(x))) add(node, "TEMPLATE_TEXT", raw);
      }
    }

    if (ts.isConditionalExpression(node)) {
      const cond = node.condition.getText(sf).replace(/\s+/g, "");
      const branchText = (n) => textOf(n) ?? (ts.isTemplateExpression(n) ? n.getText(sf) : null);
      const branch = branchText(node.whenTrue) ?? branchText(node.whenFalse);
      if (/(language|lang|l)===?["']en["']/.test(cond) && branch != null && hasWords(branch)) add(node, "LANG_TERNARY", node.getText(sf));
    }

    if (ts.isCallExpression(node) && node.expression.getText(sf) === "Alert.alert") {
      for (const arg of node.arguments.slice(1, 2)) {
        if (/\.message\b/.test(arg.getText(sf))) add(arg, "RAW_ERROR", arg.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (findings.length) {
  console.error(`FAIL: ${findings.length} hardcoded user-facing texts. Move them to the locale files or the catalog:`);
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}
console.log("OK: T1.9E no hardcoded user-facing text in app/ and src/.");
