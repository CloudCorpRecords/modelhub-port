#!/usr/bin/env node
/**
 * modelhub-port CLI.
 *
 *   modelhub-port whoami
 *   modelhub-port details <repo_id> [--type models|datasets|spaces] [--revision rev]
 *   modelhub-port search [text] [--type ...] [--author a] [--sort s] [--limit n] [--direction -1|1]
 *   modelhub-port papers <query> [--limit n]
 *   modelhub-port doc-search <query> [--limit n]
 *   modelhub-port doc-fetch <url>
 *   modelhub-port files <repo_id> [--type ...] [--revision rev] [--path p]
 *   modelhub-port mcp
 *
 * HF_TOKEN is optional (keyless-first): when set it is sent as a
 * Bearer token, when absent requests proceed anonymously. Only
 * `whoami` requires it. HUGGING_FACE_HUB_TOKEN is an accepted alias.
 *
 * Exit codes: 0 success, 1 lookup error, 2 usage error.
 */
import {
  docFetch,
  docSearch,
  listRepoFiles,
  paperSearch,
  repoDetails,
  repoSearch,
  tokenFromEnv,
  VERSION,
  whoami,
} from "./hub.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  modelhub-port whoami
  modelhub-port details <repo_id> [--type models|datasets|spaces] [--revision rev]
  modelhub-port search [text] [--type t] [--author a] [--sort s] [--limit n] [--direction n]
  modelhub-port papers <query> [--limit n]
  modelhub-port doc-search <query> [--limit n]
  modelhub-port doc-fetch <url>
  modelhub-port files <repo_id> [--type t] [--revision rev] [--path p]
  modelhub-port mcp
  modelhub-port --version`);
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function withoutFlags(args: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.includes(args[i])) i++;
    else out.push(args[i]);
  }
  return out;
}

function numFlag(args: string[], name: string): number | undefined {
  const raw = flagValue(args, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const token = tokenFromEnv();
  try {
    if (cmd === "whoami") {
      console.log((await whoami(fetchFn, token)).text);
    } else if (cmd === "details") {
      const [repoId] = withoutFlags(rest, ["--type", "--revision"]);
      if (!repoId) usage();
      const out = await repoDetails(fetchFn, token, {
        repo_id: repoId,
        repo_type: flagValue(rest, "--type"),
        revision: flagValue(rest, "--revision"),
      });
      console.log(out.text);
    } else if (cmd === "search") {
      const positional = withoutFlags(rest, ["--type", "--author", "--sort", "--limit", "--direction"]);
      const out = await repoSearch(fetchFn, token, {
        search: positional.join(" ").trim() || undefined,
        repo_type: flagValue(rest, "--type"),
        author: flagValue(rest, "--author"),
        sort: flagValue(rest, "--sort"),
        limit: numFlag(rest, "--limit"),
        direction: numFlag(rest, "--direction"),
      });
      console.log(out.text);
    } else if (cmd === "papers") {
      const positional = withoutFlags(rest, ["--limit"]);
      const query = positional.join(" ").trim();
      if (!query) usage();
      const out = await paperSearch(fetchFn, token, { query, limit: numFlag(rest, "--limit") });
      console.log(out.text);
    } else if (cmd === "doc-search") {
      const positional = withoutFlags(rest, ["--limit"]);
      const query = positional.join(" ").trim();
      if (!query) usage();
      const out = await docSearch(fetchFn, token, { query, limit: numFlag(rest, "--limit") });
      console.log(out.text);
    } else if (cmd === "doc-fetch") {
      const [url] = rest;
      if (!url) usage();
      const out = await docFetch(fetchFn, token, { url });
      console.log(out.text);
    } else if (cmd === "files") {
      const [repoId] = withoutFlags(rest, ["--type", "--revision", "--path"]);
      if (!repoId) usage();
      const out = await listRepoFiles(fetchFn, token, {
        repo_id: repoId,
        repo_type: flagValue(rest, "--type"),
        revision: flagValue(rest, "--revision"),
        path: flagValue(rest, "--path"),
      });
      console.log(out.text);
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
