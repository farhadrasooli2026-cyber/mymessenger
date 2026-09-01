#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", ".data", "coverage"]);
const FORBIDDEN = [
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
  /AKIA[0-9A-Z]{16}/,
  /nixo_reg=[A-Za-z0-9._-]{20,}/,
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|mjs|yml|yaml|md|json)$/.test(name) && name !== "package-lock.json") acc.push(p);
  }
  return acc;
}

let bad = 0;
for (const file of walk(ROOT)) {
  if (file.includes(`${path.sep}scripts${path.sep}secret-scan`)) continue;
  const text = readFileSync(file, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      console.error(`secret-scan: ${path.relative(ROOT, file)} matched ${re}`);
      bad += 1;
    }
  }
}
if (bad) process.exit(1);
console.log("secret-scan: ok");
