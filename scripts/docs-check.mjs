#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const envEx = readFileSync(path.join(root, ".env.example"), "utf8");
const catalog = readFileSync(path.join(root, "src/lib/docs-catalog.ts"), "utf8");
const requiredMd = [
  "docs/README.md",
  "docs/INSTALL.md",
  "docs/DEPLOY.md",
  "docs/MIGRATION.md",
  "docs/KNOWN_ISSUES.md",
  "docs/ROADMAP.md",
  "docs/DEBT.md",
  "docs/I18N.md",
  "docs/ANALYTICS.md",
  "docs/BILLING.md",
  "docs/PRODUCTION.md",
  "docs/AI.md",
  "docs/CLOUD.md",
  "docs/adr/0001-json-store.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
];

let bad = 0;
function fail(msg) {
  console.error(msg);
  bad += 1;
}

if (pkg.version !== "0.1.0") fail(`package version ${pkg.version} unexpected for this docs cut`);
for (const f of requiredMd) {
  if (!existsSync(path.join(root, f))) fail(`missing ${f}`);
}
if (!envEx.includes("NIXO_PEPPER") || !envEx.includes("NIXO_BACKUP_KEY")) fail(".env.example incomplete");
if (!catalog.includes("DOCS_VERSION") || !catalog.includes("/api/health")) fail("catalog missing core refs");
if (/BEGIN RSA PRIVATE KEY/.test(catalog)) fail("catalog looks like it contains a private key");

if (bad) process.exit(1);
console.log("docs-check: ok");
