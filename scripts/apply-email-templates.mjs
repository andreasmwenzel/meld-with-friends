#!/usr/bin/env node
// Applies supabase/emails/*.html to the Supabase project's Auth config via the Management API.
// Usage: source ~/.config/meld/env && node scripts/apply-email-templates.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error("Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in the environment.");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "emails");

const emails = [
  { key: "magic_link", file: "magic-link.html", subject: "Your seat at the table" },
  { key: "confirmation", file: "confirmation.html", subject: "Confirm your email for Meld" },
  { key: "email_change", file: "email-change.html", subject: "Confirm this email for your Meld account" },
  { key: "recovery", file: "recovery.html", subject: "Reset your Meld password" },
];

const body = {};
for (const { key, file, subject } of emails) {
  body[`mailer_subjects_${key}`] = subject;
  body[`mailer_templates_${key}_content`] = await readFile(path.join(dir, file), "utf8");
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error(`Supabase API responded ${res.status}: ${await res.text()}`);
  process.exit(1);
}

console.log(`Updated auth config for project ${ref}. Fields set:`);
for (const field of Object.keys(body)) console.log(`  ${field}`);
