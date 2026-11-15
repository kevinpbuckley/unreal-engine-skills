#!/usr/bin/env node
/**
 * check-hosted-catalog.mjs
 *
 * Compares the skill catalog served by the hosted MCP server with the skills in this repo and
 * fails on any difference. Run it after every deploy of the hosted server (and before announcing
 * new skills): the server bundles a snapshot of this repo at deploy time, so a skill pushed here is
 * not served until the server is rebundled and redeployed.
 *
 * Usage:
 *   node scripts/check-hosted-catalog.mjs
 *   node scripts/check-hosted-catalog.mjs --url https://www.unrealengineskills.com/api/mcp
 *   node scripts/check-hosted-catalog.mjs --load      # also load every skill by id (slower)
 *
 * Exit code 0 = the served catalog equals the repo; 1 = a mismatch or a request failed.
 */

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, '..', 'skills');
const DEFAULT_URL = 'https://www.unrealengineskills.com/api/mcp';
const TOOL = 'unreal-engine-skills-manager';

const argv = process.argv.slice(2);
const url = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : process.env.UE_SKILLS_MCP_URL || DEFAULT_URL;
const loadEach = argv.includes('--load');

let nextId = 1;
async function callTool(args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: TOOL, arguments: args } })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${JSON.stringify(args)}`);
  const json = await res.json();
  if (json.error) throw new Error(`JSON-RPC error for ${JSON.stringify(args)}: ${JSON.stringify(json.error)}`);
  const text = json.result?.content?.find((c) => c.type === 'text')?.text ?? '';
  return { text, isError: Boolean(json.result?.isError) };
}

async function repoCatalog() {
  const out = new Map(); // id -> category
  for (const cat of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const s of await readdir(path.join(skillsRoot, cat.name), { withFileTypes: true })) {
      if (s.isDirectory()) out.set(s.name, cat.name);
    }
  }
  return out;
}

async function servedCatalog() {
  const out = new Map();
  const top = JSON.parse((await callTool({ action: 'categories' })).text);
  for (const { category } of top.categories) {
    const detail = JSON.parse((await callTool({ action: 'categories', category })).text);
    for (const s of detail.skills) out.set(s.id, category);
  }
  return out;
}

async function main() {
  const [repo, served] = await Promise.all([repoCatalog(), servedCatalog()]);
  const missing = [...repo.keys()].filter((id) => !served.has(id)).sort();
  const extra = [...served.keys()].filter((id) => !repo.has(id)).sort();
  const moved = [...repo.keys()].filter((id) => served.has(id) && served.get(id) !== repo.get(id)).sort();

  const loadFailures = [];
  if (loadEach) {
    for (const id of [...repo.keys()].filter((k) => served.has(k)).sort()) {
      const r = await callTool({ action: 'load', skill: id });
      if (r.isError || /not found/i.test(r.text.slice(0, 200))) loadFailures.push(id);
    }
  }

  console.log(`[check-hosted-catalog] ${url}`);
  console.log(`[check-hosted-catalog] repo: ${repo.size} skills, served: ${served.size} skills`);
  if (!missing.length && !extra.length && !moved.length && !loadFailures.length) {
    console.log('[check-hosted-catalog] OK - the served catalog matches the repo.');
    return;
  }
  if (missing.length) console.log(`  In the repo, not served (redeploy needed): ${missing.join(', ')}`);
  if (extra.length) console.log(`  Served, not in the repo (renamed or removed here): ${extra.join(', ')}`);
  if (moved.length) console.log(`  In a different category: ${moved.map((id) => `${id} (${served.get(id)} -> ${repo.get(id)})`).join(', ')}`);
  if (loadFailures.length) console.log(`  Listed but failed to load: ${loadFailures.join(', ')}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[check-hosted-catalog] Failed:', err.message ?? err);
  process.exit(1);
});
