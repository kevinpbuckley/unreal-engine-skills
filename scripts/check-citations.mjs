#!/usr/bin/env node
/**
 * check-citations.mjs
 *
 * Verifies that every engine-source path cited in the skills
 * (Engine/Source/... and Engine/Plugins/...) exists on disk in a real engine
 * install. This keeps the repo's core quality claim — "ground claims in real
 * 5.7 source paths" — honest, and doubles as the upgrade tool when re-targeting
 * a new engine version: anything that moved fails immediately.
 *
 * Usage:
 *   node scripts/check-citations.mjs            # check all skills
 *   node scripts/check-citations.mjs core/gameplay-tags   # check one skill dir
 *
 * Engine root resolution:
 *   1. UE_ENGINE_ROOT env var (the directory that CONTAINS Engine/), if set.
 *   2. E:\Program Files\Epic Games\UE_5.7 (this machine's primary install).
 *
 * Exit code 0 = all cited paths exist; 1 = at least one missing (or engine
 * root not found).
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(repoRoot, 'skills');

const DEFAULT_ENGINE_ROOT = 'E:\\Program Files\\Epic Games\\UE_5.7';
const engineRoot = process.env.UE_ENGINE_ROOT?.trim() || DEFAULT_ENGINE_ROOT;

// Matches Engine/Source/... and Engine/Plugins/... citations ending in a
// source-ish extension. Trailing punctuation from prose is stripped afterwards.
const CITATION_RE =
  /Engine[\\/](?:Source|Plugins)[\\/][A-Za-z0-9_.\-\\/]+?\.(?:h|hpp|cpp|inl|cs|ini|usf|ush)\b/g;

// A cited base DIRECTORY, e.g. "Engine source (UE 5.7, `Engine/Source/Runtime/GameplayTags/`):".
// Subsequent backticked relative paths in list items resolve against the most
// recent base until the next base appears.
const BASE_DIR_RE = /Engine[\\/](?:Source|Plugins)[\\/][A-Za-z0-9_.\-\\/]+[\\/](?=`|\)|\s|$)/;

// A backticked relative source path at the start of a list item, e.g.
// "- `Classes/GameplayTagContainer.h` — ...".
const REL_ITEM_RE = /^\s*[-*]\s+`([A-Za-z0-9_][A-Za-z0-9_.\-/]*\.(?:h|hpp|cpp|inl|cs|usf|ush))`/;

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function findMarkdownFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await findMarkdownFiles(full)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  if (!(await isDir(path.join(engineRoot, 'Engine')))) {
    console.error(`[check-citations] Engine root not found: ${engineRoot}`);
    console.error('[check-citations] Set UE_ENGINE_ROOT to the directory that contains Engine\\.');
    process.exit(1);
  }

  const scanRoot = process.argv[2]
    ? path.join(skillsRoot, process.argv[2])
    : skillsRoot;

  if (!(await isDir(scanRoot))) {
    console.error(`[check-citations] Not a directory: ${scanRoot}`);
    process.exit(1);
  }

  const mdFiles = await findMarkdownFiles(scanRoot);

  let citedTotal = 0;
  let missingTotal = 0;
  const fileCache = new Map(); // normalized engine-relative path -> boolean
  const failures = [];

  for (const mdFile of mdFiles) {
    const text = await readFile(mdFile, 'utf8');
    const matches = text.match(CITATION_RE) || [];

    // Resolve "base directory + relative bullet" citations line by line.
    let base = null;
    for (const line of text.split('\n')) {
      const baseMatch = line.match(BASE_DIR_RE);
      if (baseMatch) {
        base = baseMatch[0].replace(/[\\]/g, '/');
        continue;
      }
      if (!base) continue;
      const relMatch = line.match(REL_ITEM_RE);
      if (relMatch) {
        const rel = relMatch[1];
        // Bullets citing a full Engine/... path are already captured above.
        if (rel.startsWith('Engine/')) continue;
        // Some skills repeat the base's last folder in the bullet
        // (base `.../Public/Delegates/` + bullet `Delegates/Delegate.h`) —
        // collapse the duplicated segment.
        const lastSegment = base.split('/').filter(Boolean).pop();
        const resolved =
          lastSegment && rel.startsWith(lastSegment + '/')
            ? base + rel.slice(lastSegment.length + 1)
            : base + rel;
        matches.push(resolved);
      } else if (/^\S/.test(line) && !/^\s*[-*]/.test(line)) {
        // A new flush-left paragraph ends the citation block; indented
        // continuation lines of a wrapped bullet do not.
        base = null;
      }
    }

    if (matches.length === 0) continue;

    const unique = Array.from(new Set(matches.map((m) => m.replace(/[\\]/g, '/'))));
    const missingHere = [];

    for (const cited of unique) {
      citedTotal++;
      let exists = fileCache.get(cited);
      if (exists === undefined) {
        exists = await isFile(path.join(engineRoot, ...cited.split('/')));
        fileCache.set(cited, exists);
      }
      if (!exists) {
        missingHere.push(cited);
        missingTotal++;
      }
    }

    if (missingHere.length > 0) {
      failures.push({ file: path.relative(repoRoot, mdFile), missing: missingHere });
    }
  }

  console.log(`[check-citations] Engine root: ${engineRoot}`);
  console.log(`[check-citations] Markdown files scanned: ${mdFiles.length}`);
  console.log(`[check-citations] Unique citations checked: ${citedTotal}`);

  if (failures.length === 0) {
    console.log('[check-citations] OK — every cited engine path exists on disk.');
    return;
  }

  console.log(`[check-citations] MISSING: ${missingTotal} citation(s) in ${failures.length} file(s):\n`);
  for (const f of failures) {
    console.log(`  ${f.file}`);
    for (const m of f.missing) {
      console.log(`    - ${m}`);
    }
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('[check-citations] Failed:', err);
  process.exit(1);
});
