#!/usr/bin/env node
/**
 * install-engine-skills.mjs
 *
 * Installs this library as a UE 5.9 in-engine Markdown skill root, so the skills appear in the
 * editor's own `ToolsetRegistry.AgentSkillToolset.ListSkills` / `GetSkills` (and so reach every
 * agent connected to the editor's MCP server, the in-editor Unreal Assistant included).
 *
 * UE 5.9 discovers `SKILL.md` files recursively under `<Project>/Skills/` (keys `/Skills/Project/...`),
 * under `<Plugin>/Skills/` of every enabled plugin (keys `/Skills/<Plugin>/...`) and under
 * `Engine/Extras/AgentTools/Skills/` (see the ue-ai-toolsets skill). Its frontmatter reader is line
 * based: it reads `name:` and `description:` from ONE line each and does not understand YAML block
 * scalars, so a wrapped or `description: >` value would reach the agent truncated or as ">". This
 * script copies every skill folder flat into the output folder and rewrites each frontmatter to two
 * single-line keys. The body, references/, scripts/ and assets/ are copied unchanged (the engine
 * rewrites relative links to absolute paths when it serves a skill).
 *
 * Usage:
 *   node scripts/install-engine-skills.mjs --out "<Project>/Skills/UnrealEngineSkills"
 *   node scripts/install-engine-skills.mjs --out <dir> --max-description 400   # shorter ListSkills
 *   node scripts/install-engine-skills.mjs --out <dir> --only ue-sequencer-python,ue-pie-python
 *   node scripts/install-engine-skills.mjs --check                              # validate only, write nothing
 *
 * Resulting keys: /Skills/Project/UnrealEngineSkills/<skill-id>.
 * Re-running replaces the output folder, but only if it carries this script's marker file.
 * Exit code 0 = ok, 1 = a skill failed validation or the output folder is not ours.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(repoRoot, 'skills');
const MARKER = '.unreal-engine-skills-install';

function parseArgs(argv) {
  const args = { out: null, maxDescription: 0, only: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--max-description') args.maxDescription = Number(argv[++i]) || 0;
    else if (a === '--only') args.only = new Set(argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--check') args.check = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Finds every skill folder (a folder holding SKILL.md) under skills/. */
async function findSkillDirs(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
    out.push(dir);
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) out.push(...(await findSkillDirs(path.join(dir, e.name))));
  }
  return out;
}

/**
 * Splits a SKILL.md into its YAML frontmatter fields (name, description) and body.
 * Handles plain one-line values, quoted values, wrapped plain values and block scalars (>, |).
 */
export function readRepoSkill(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { name: null, description: null, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { name: null, description: null, body: text };
  const lines = text.slice(4, end).split('\n');
  const body = text.slice(end + 4).replace(/^[^\n]*\n/, '');
  const topKey = /^([A-Za-z0-9_-]+):\s?(.*)$/;
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(topKey);
    if (!m) continue;
    const key = m[1];
    let value = (m[2] ?? '').trim();
    const block = /^[>|][+-]?$/.test(value);
    const parts = block ? [] : [value];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (topKey.test(lines[j]) && !/^\s/.test(lines[j])) break;
      const t = lines[j].trim();
      if (t.length) parts.push(t);
    }
    i = j - 1;
    value = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!block && value.length >= 2) {
      const q = value[0];
      if ((q === '"' || q === "'") && value.endsWith(q)) {
        value = value.slice(1, -1);
        value = q === "'" ? value.replace(/''/g, "'") : value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    fields[key] = value;
  }
  return { name: fields.name ?? null, description: fields.description ?? null, body };
}

/** A JS port of UE 5.9 MarkdownSkills::ParseSkillText, to check what the editor will read. */
export function parseLikeEngine(text) {
  const lines = text.split(/\r?\n/);
  let name = '';
  let description = '';
  let bodyStart = 0;
  if (lines.length > 0 && lines[0].trimEnd() === '---') {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      if (line === '---') {
        bodyStart = i + 1;
        break;
      }
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const field = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (field === 'name') name = value;
      else if (field === 'description') description = value;
    }
  }
  return { name, description, bodyStart };
}

function shorten(description, max) {
  if (!max || description.length <= max) return description;
  const cut = description.slice(0, max);
  const sentence = cut.lastIndexOf('. ');
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s-]+$/, '') + ' ...';
}

/** Relative Markdown link targets in a body that do not exist next to the skill. */
async function missingLinks(body, skillDir) {
  const missing = [];
  const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(#|\/|[a-z]+:)/i.test(target) || /^[A-Za-z]:/.test(target)) continue;
    const file = target.split('#')[0];
    if (file && !(await exists(path.join(skillDir, file)))) missing.push(file);
  }
  return missing;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.out && !args.check)) {
    console.log('Usage: node scripts/install-engine-skills.mjs --out <Project>/Skills/UnrealEngineSkills [--max-description N] [--only a,b] | --check');
    process.exit(args.help ? 0 : 1);
  }

  const skillDirs = (await findSkillDirs(skillsRoot)).sort();
  const problems = [];
  const prepared = [];
  const seen = new Map();

  for (const dir of skillDirs) {
    const id = path.basename(dir);
    if (args.only && !args.only.has(id)) continue;
    const raw = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    const skill = readRepoSkill(raw);
    const rel = path.relative(repoRoot, dir);
    if (skill.name !== id) problems.push(`${rel}: frontmatter name "${skill.name}" != folder "${id}"`);
    if (!skill.description) problems.push(`${rel}: no description`);
    if (seen.has(id)) problems.push(`${rel}: duplicate skill id (also ${seen.get(id)})`);
    seen.set(id, rel);
    const description = shorten((skill.description || '').replace(/\s+/g, ' ').trim(), args.maxDescription);
    const out = `---\nname: ${id}\ndescription: ${description}\n---\n\n${skill.body.replace(/^\n+/, '')}`;
    const engine = parseLikeEngine(out);
    if (engine.name !== id || engine.description !== description || !engine.description || /^[>|]/.test(engine.description)) {
      problems.push(`${rel}: the engine would read name="${engine.name}" description="${engine.description.slice(0, 40)}..."`);
    }
    for (const file of await missingLinks(skill.body, dir)) problems.push(`${rel}: relative link to missing file ${file}`);
    prepared.push({ id, dir, out });
  }

  if (args.only) {
    for (const id of args.only) if (!seen.has(id)) problems.push(`--only: no skill named ${id}`);
  }

  if (problems.length) {
    console.error(`[install-engine-skills] ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  if (args.check) {
    console.log(`[install-engine-skills] OK - ${prepared.length} skills would install with one-line name/description the UE 5.9 loader reads correctly.`);
    return;
  }

  const outDir = path.resolve(process.cwd(), args.out);
  if (await exists(outDir)) {
    if (!(await exists(path.join(outDir, MARKER)))) {
      const entries = await readdir(outDir);
      if (entries.length) {
        console.error(`[install-engine-skills] ${outDir} exists, is not empty and was not made by this script. Refusing to overwrite.`);
        process.exit(1);
      }
    }
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  for (const s of prepared) {
    const dest = path.join(outDir, s.id);
    await cp(s.dir, dest, { recursive: true });
    await writeFile(path.join(dest, 'SKILL.md'), s.out, 'utf8');
  }
  await writeFile(
    path.join(outDir, MARKER),
    `Installed by unreal-engine-skills/scripts/install-engine-skills.mjs on ${new Date().toISOString()}.\n` +
      'Re-run the script to update; it replaces this whole folder.\n',
    'utf8'
  );
  const prefix = outDir.replace(/\\/g, '/').match(/\/Skills\/(.+)$/);
  console.log(`[install-engine-skills] Installed ${prepared.length} skills into ${outDir}`);
  if (prefix) console.log(`[install-engine-skills] Keys (project root): /Skills/Project/${prefix[1]}/<skill-id>`);
}

main().catch((err) => {
  console.error('[install-engine-skills] Failed:', err);
  process.exit(1);
});
