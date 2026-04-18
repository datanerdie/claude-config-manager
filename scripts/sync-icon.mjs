// Mirrors site/public/favicon.svg — the canonical brand asset — into
// src-tauri/icons/icon.svg so `tauri icon` regenerates platform icons
// from the same source. Run via `npm run icons`.
import { copyFileSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repo, "site/public/favicon.svg");
const target = resolve(repo, "src-tauri/icons/icon.svg");

statSync(source); // throws if missing
copyFileSync(source, target);
const bytes = readFileSync(target).length;
console.log(`synced icon (${bytes} bytes): ${source} → ${target}`);
