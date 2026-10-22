#!/usr/bin/env node
/* global console, process, URL */
/**
 * Compiles the role files in packages/core/roles/*.md, the soul files in
 * packages/core/soul/*.md and packages/core/constitution.md into
 * packages/core/src/roles/library.generated.ts.
 *
 * Core is bundled into Electron, so it cannot read Markdown or parse YAML at runtime. The
 * roles, souls and constitution are compiled into a committed TypeScript file instead, and a
 * test fails when that file is stale. Each role is validated against the protocol's Role
 * schema on the way; each soul must have exactly its one part (Character), and the
 * constitution exactly its two (Values, Never).
 *
 * Usage: pnpm --filter @tagalong/core gen:roles
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The subpath, not the package root: roles.js imports only zod, so plain Node can load it.
import { Role } from '@tagalong/protocol/roles';
import { parse } from 'yaml';

export const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url));
export const SOULS_DIR = fileURLToPath(new URL('../soul/', import.meta.url));
export const CONSTITUTION_FILE = fileURLToPath(new URL('../constitution.md', import.meta.url));
export const LIBRARY_FILE = fileURLToPath(
  new URL('../src/roles/library.generated.ts', import.meta.url),
);

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** One role file's header and body as a Role-shaped object, not yet validated. */
export function parseRoleFile(source) {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source; // byte-order mark
  const match = FRONT_MATTER.exec(text.replace(/\r\n/g, '\n'));
  if (!match) throw new Error('A role file starts with a YAML front-matter header.');
  const header = parse(match[1]) ?? {};
  return {
    id: header.id,
    name: header.name,
    version: header.version,
    summary: header.summary,
    goodAt: header.good_at,
    notFor: header.not_for,
    tools: header.tools,
    model: { tier: header.model?.tier, needsVision: header.model?.needs_vision },
    instructions: match[2].trim(),
  };
}

/** Every role file in the folder, validated, in file-name order. */
export function loadRoles(dir = ROLES_DIR) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const result = Role.safeParse(parseRoleFile(readFileSync(join(dir, file), 'utf8')));
      if (!result.success) {
        throw new Error(`${file} is not a valid role: ${result.error.message}`);
      }
      return result.data;
    });
}

/** A soul's parts, by heading, in this order and no others. */
const SOUL_HEADINGS = ['Character'];
/** The constitution's parts, by heading, in this order and no others. */
const CONSTITUTION_HEADINGS = ['Values', 'Never'];

/**
 * One soul file's (or the constitution's) text, checked: exactly these headings in order,
 * each with something under it, and nothing before the first. Returned with LF line endings,
 * trimmed.
 */
export function parseSoulFile(source, headings = SOUL_HEADINGS) {
  const text = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source)
    .replace(/\r\n/g, '\n')
    .trim();
  const parts = text.split(/^## /m);
  if (parts[0].trim() !== '') throw new Error('The file starts with its first ## heading.');
  const sections = parts.slice(1).map((part) => {
    const newline = part.indexOf('\n');
    return newline === -1
      ? { heading: part.trim(), body: '' }
      : { heading: part.slice(0, newline).trim(), body: part.slice(newline + 1).trim() };
  });
  const found = sections.map((section) => section.heading);
  for (const heading of headings) {
    if (!found.includes(heading)) throw new Error(`The file needs a "## ${heading}" part.`);
  }
  const extra = found.filter((heading) => !headings.includes(heading));
  if (extra.length > 0 || found.length !== headings.length) {
    throw new Error(`The file has only ${headings.join(', ')}; found ${extra.join(', ')}.`);
  }
  if (found.some((heading, index) => heading !== headings[index])) {
    throw new Error(`The file's parts go in this order: ${headings.join(', ')}.`);
  }
  const empty = sections.find((section) => section.body === '');
  if (empty !== undefined) throw new Error(`The "## ${empty.heading}" part is empty.`);
  return text;
}

/** Every soul file in the folder, checked, keyed by file name. */
export function loadSouls(dir = SOULS_DIR) {
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .sort()
      .map((file) => {
        try {
          return [file.slice(0, -3), parseSoulFile(readFileSync(join(dir, file), 'utf8'))];
        } catch (error) {
          throw new Error(`${file} is not a valid soul: ${error.message}`, { cause: error });
        }
      }),
  );
}

/** The constitution's text, checked: exactly Values then Never. */
export function loadConstitution(file = CONSTITUTION_FILE) {
  try {
    return parseSoulFile(readFileSync(file, 'utf8'), CONSTITUTION_HEADINGS);
  } catch (error) {
    throw new Error(`constitution.md is not valid: ${error.message}`, { cause: error });
  }
}

/** The source of library.generated.ts for these roles, souls and constitution. */
export function renderLibrary(roles, souls, constitution) {
  return [
    '// Generated by packages/core/scripts/gen-roles.mjs from packages/core/roles/*.md,',
    '// packages/core/soul/*.md and packages/core/constitution.md. Do not edit by hand.',
    '// Regenerate with: pnpm --filter @tagalong/core gen:roles',
    "import type { Role } from '@tagalong/protocol';",
    '',
    `export const ROLE_LIBRARY: readonly Role[] = ${JSON.stringify(roles, null, 2)};`,
    '',
    `export const SOUL_LIBRARY: Readonly<Record<string, string>> = ${JSON.stringify(souls, null, 2)};`,
    '',
    `export const CONSTITUTION: string = ${JSON.stringify(constitution)};`,
    '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const roles = loadRoles();
  const souls = loadSouls();
  writeFileSync(LIBRARY_FILE, renderLibrary(roles, souls, loadConstitution()));
  console.log(
    `Wrote ${roles.length} roles, ${Object.keys(souls).length} souls and the constitution to ${LIBRARY_FILE}`,
  );
}
