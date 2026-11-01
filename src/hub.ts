/**
 * modelhub-port core: Hugging Face Hub lookups through the public
 * Hub API at https://huggingface.co/api.
 *
 * Keyless-first: the public Hub endpoints work without a token. When
 * HF_TOKEN is set (HUGGING_FACE_HUB_TOKEN is accepted as an alias) it
 * is sent as `Authorization: Bearer <token>`; when it is absent the
 * requests simply go out anonymously. A missing token is never an
 * error for the public tools. The single exception is hf_whoami,
 * which inherently describes the token's owner: with no token, or
 * with a token the API rejects (401), it returns an honest error
 * naming HF_TOKEN.
 *
 * Endpoints used:
 *   GET /api/whoami-v2
 *   GET /api/{models|datasets|spaces}/{id}
 *   GET /api/{models|datasets|spaces}?search=&author=&sort=&limit=&direction=
 *   GET /api/{models|datasets|spaces}/{id}/tree/{revision}[/{path}]
 *   GET /api/papers/search?q=&limit=
 *   GET https://huggingface.co/api/docs/hub/search?q=
 *   GET https://huggingface.co/docs/... (page fetch, HTML stripped)
 *
 * The docs-search endpoint is the one the hosted docs tooling is
 * documented to use; its exact live response shape is labelled a
 * first-check-at-live-smoke risk in the build report, and the parser
 * here tolerates the common envelope shapes without inventing data.
 *
 * All HTTP goes through an injected FetchFn so request building and
 * response handling are fully testable offline with fixtures.
 */
import type {
  DocFetchOptions,
  DocFetchResult,
  DocHit,
  DocSearchOptions,
  DocSearchResult,
  FetchFn,
  ListFilesOptions,
  ListFilesResult,
  PaperSearchOptions,
  PaperSearchResult,
  PaperSummary,
  RepoDetails,
  RepoDetailsOptions,
  RepoFile,
  RepoSearchOptions,
  RepoSearchResult,
  RepoSummary,
  RepoType,
  WhoamiResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const API_BASE = "https://huggingface.co/api";
export const DOCS_SEARCH_URL = "https://huggingface.co/api/docs/hub/search";

export const TOKEN_ENV = "HF_TOKEN";
export const TOKEN_ALIAS_ENV = "HUGGING_FACE_HUB_TOKEN";

/**
 * Read the optional Hub token. HF_TOKEN wins; the
 * HUGGING_FACE_HUB_TOKEN alias is honoured when HF_TOKEN is unset.
 * Returns undefined when neither is set or both are blank.
 */
export function tokenFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const name of [TOKEN_ENV, TOKEN_ALIAS_ENV]) {
    const raw = env[name];
    const v = typeof raw === "string" ? raw.trim() : "";
    if (v) return v;
  }
  return undefined;
}

function authHeaders(token?: string): Record<string, string> {
  const t = typeof token === "string" ? token.trim() : "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Normalise a repo_type argument to its API path segment. */
export function normalizeRepoType(input?: string): RepoType {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!raw) return "models";
  if (raw === "model" || raw === "models") return "models";
  if (raw === "dataset" || raw === "datasets") return "datasets";
  if (raw === "space" || raw === "spaces") return "spaces";
  throw new Error(
    `repo_type must be one of models, datasets, spaces (got "${input}")`,
  );
}

function requireNonEmpty(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function requestText(
  fetchFn: FetchFn,
  url: string,
  token: string | undefined,
  what: string,
  accept = "application/json",
): Promise<string> {
  let response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: accept, ...authHeaders(token) },
      redirect: "follow",
    });
  } catch (err) {
    throw new Error(
      `${what} request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const body = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        `${what} failed: HTTP 401 Unauthorized — the supplied HF_TOKEN was rejected or a token is required for this resource; check HF_TOKEN and retry`,
      );
    }
    const detail = body.trim().slice(0, 200);
    throw new Error(
      `${what} failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  return body;
}

async function requestJson(
  fetchFn: FetchFn,
  url: string,
  token: string | undefined,
  what: string,
): Promise<unknown> {
  const body = await requestText(fetchFn, url, token, what);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${what} returned a response that was not valid JSON`);
  }
}

/** Encode a repo id for a URL path without escaping its slash. */
function encodeRepoId(repoId: string): string {
  return repoId.split("/").map(encodeURIComponent).join("/");
}

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

// ---------------------------------------------------------------------
// hf_whoami
// ---------------------------------------------------------------------

export async function whoami(
  fetchFn: FetchFn,
  token?: string,
): Promise<WhoamiResult> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) {
    throw new Error(
      "HF_TOKEN environment variable is required for hf_whoami: set HF_TOKEN to a Hugging Face access token and retry (the other tools work without a token)",
    );
  }
  const data = await requestJson(fetchFn, `${API_BASE}/whoami-v2`, t, "Hugging Face whoami");
  if (!isRecord(data)) throw new Error("Hugging Face whoami returned an unexpected response shape");
  const name = str(data.name) ?? "";
  if (!name) throw new Error("Hugging Face whoami returned no user name");
  const result: WhoamiResult = { name, text: "" };
  if (str(data.fullname)) result.fullname = str(data.fullname);
  if (str(data.email)) result.email = str(data.email);
  if (str(data.type)) result.type = str(data.type);
  const lines = [`Name: ${name}`];
  if (result.fullname) lines.push(`Full name: ${result.fullname}`);
  if (result.email) lines.push(`Email: ${result.email}`);
  if (result.type) lines.push(`Type: ${result.type}`);
  const orgs = Array.isArray(data.orgs)
    ? data.orgs.filter(isRecord).map((o) => str(o.name)).filter(Boolean)
    : [];
  if (orgs.length > 0) lines.push(`Organizations: ${orgs.join(", ")}`);
  result.text = lines.join("\n");
  return result;
}

// ---------------------------------------------------------------------
// hub_repo_details
// ---------------------------------------------------------------------

export async function repoDetails(
  fetchFn: FetchFn,
  token: string | undefined,
  options: RepoDetailsOptions,
): Promise<RepoDetails> {
  const repoId = requireNonEmpty(options.repo_id, "repo_id");
  const repoType = normalizeRepoType(options.repo_type);
  const params = new URLSearchParams();
  if (options.revision && options.revision.trim()) {
    params.set("revision", options.revision.trim());
  }
  const qs = params.toString();
  const url = `${API_BASE}/${repoType}/${encodeRepoId(repoId)}${qs ? `?${qs}` : ""}`;
  const data = await requestJson(fetchFn, url, token, "Hugging Face repo details");
  if (!isRecord(data)) throw new Error("Hugging Face repo details returned an unexpected response shape");
  const siblings = Array.isArray(data.siblings) ? data.siblings : [];
  const files = siblings
    .filter(isRecord)
    .map((s) => str(s.rfilename))
    .filter((v): v is string => Boolean(v));
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((v): v is string => typeof v === "string")
    : [];
  const out: RepoDetails = {
    id: str(data.id) ?? repoId,
    repoType,
    tags,
    files,
    text: "",
  };
  if (str(data.author)) out.author = str(data.author);
  if (num(data.downloads) !== undefined) out.downloads = num(data.downloads);
  if (num(data.likes) !== undefined) out.likes = num(data.likes);
  if (str(data.lastModified)) out.lastModified = str(data.lastModified);
  if (str(data.createdAt)) out.createdAt = str(data.createdAt);
  if (typeof data.private === "boolean") out.isPrivate = data.private;
  if (typeof data.gated === "string" || typeof data.gated === "boolean") out.gated = data.gated;
  if (str(data.pipeline_tag)) out.pipelineTag = str(data.pipeline_tag);
  if (str(data.library_name)) out.libraryName = str(data.library_name);
  const lines = [`${out.id} (${repoType})`];
  if (out.author) lines.push(`Author: ${out.author}`);
  if (out.downloads !== undefined) lines.push(`Downloads: ${out.downloads}`);
  if (out.likes !== undefined) lines.push(`Likes: ${out.likes}`);
  if (out.lastModified) lines.push(`Last modified: ${out.lastModified}`);
  if (out.createdAt) lines.push(`Created: ${out.createdAt}`);
  if (out.isPrivate !== undefined) lines.push(`Private: ${out.isPrivate}`);
  if (out.gated !== undefined) lines.push(`Gated: ${out.gated}`);
  if (out.pipelineTag) lines.push(`Pipeline: ${out.pipelineTag}`);
  if (out.libraryName) lines.push(`Library: ${out.libraryName}`);
  if (tags.length > 0) lines.push(`Tags: ${tags.join(", ")}`);
  if (files.length > 0) lines.push(`Files (${files.length}): ${files.join(", ")}`);
  out.text = lines.join("\n");
  return out;
}

// ---------------------------------------------------------------------
// hub_repo_search
// ---------------------------------------------------------------------

function toSummary(raw: unknown): RepoSummary | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const out: RepoSummary = { id };
  if (str(raw.author)) out.author = str(raw.author);
  if (num(raw.downloads) !== undefined) out.downloads = num(raw.downloads);
  if (num(raw.likes) !== undefined) out.likes = num(raw.likes);
  if (str(raw.lastModified)) out.lastModified = str(raw.lastModified);
  return out;
}

export function formatSummaries(repoType: RepoType, results: RepoSummary[]): string {
  if (results.length === 0) return `No ${repoType} found.`;
  return results
    .map((r, i) => {
      const bits: string[] = [];
      if (r.downloads !== undefined) bits.push(`downloads ${r.downloads}`);
      if (r.likes !== undefined) bits.push(`likes ${r.likes}`);
      if (r.lastModified) bits.push(`updated ${r.lastModified}`);
      return `${i + 1}. ${r.id}${bits.length ? ` (${bits.join(", ")})` : ""}`;
    })
    .join("\n");
}

export async function repoSearch(
  fetchFn: FetchFn,
  token: string | undefined,
  options: RepoSearchOptions,
): Promise<RepoSearchResult> {
  const repoType = normalizeRepoType(options.repo_type);
  const params = new URLSearchParams();
  if (options.search && options.search.trim()) params.set("search", options.search.trim());
  if (options.author && options.author.trim()) params.set("author", options.author.trim());
  if (options.sort && options.sort.trim()) params.set("sort", options.sort.trim());
  if (options.direction !== undefined && Number.isFinite(options.direction)) {
    params.set("direction", String(Math.floor(options.direction)));
  }
  params.set("limit", String(clampLimit(options.limit, 20, 100)));
  const url = `${API_BASE}/${repoType}?${params.toString()}`;
  const data = await requestJson(fetchFn, url, token, "Hugging Face repo search");
  const list = Array.isArray(data) ? data : [];
  const results = list.map(toSummary).filter((v): v is RepoSummary => v !== null);
  return { repoType, results, text: formatSummaries(repoType, results) };
}

// ---------------------------------------------------------------------
// list_repo_files
// ---------------------------------------------------------------------

export async function listRepoFiles(
  fetchFn: FetchFn,
  token: string | undefined,
  options: ListFilesOptions,
): Promise<ListFilesResult> {
  const repoId = requireNonEmpty(options.repo_id, "repo_id");
  const repoType = normalizeRepoType(options.repo_type);
  const revision =
    options.revision && options.revision.trim() ? options.revision.trim() : "main";
  const sub = options.path && options.path.trim() ? `/${encodePath(options.path.trim())}` : "";
  const url = `${API_BASE}/${repoType}/${encodeRepoId(repoId)}/tree/${encodeURIComponent(revision)}${sub}`;
  const data = await requestJson(fetchFn, url, token, "Hugging Face repo tree");
  const list = Array.isArray(data) ? data : [];
  const files: RepoFile[] = list.filter(isRecord).map((e) => {
    const f: RepoFile = {
      type: str(e.type) ?? "file",
      path: str(e.path) ?? "",
    };
    if (num(e.size) !== undefined) f.size = num(e.size);
    return f;
  }).filter((f) => f.path);
  const text =
    files.length === 0
      ? `No files found in ${repoId} at ${revision}.`
      : files
          .map((f) => `${f.type}\t${f.path}${f.size !== undefined ? `\t${f.size}` : ""}`)
          .join("\n");
  return { repoId, repoType, revision, files, text };
}

// ---------------------------------------------------------------------
// paper_search
// ---------------------------------------------------------------------

function toPaper(raw: unknown): PaperSummary | null {
  if (!isRecord(raw)) return null;
  const paper = isRecord(raw.paper) ? raw.paper : raw;
  const id = str(paper.id) ?? str(raw.id) ?? "";
  const title = str(paper.title) ?? str(raw.title) ?? "";
  if (!title && !id) return null;
  const authorsRaw = Array.isArray(paper.authors) ? paper.authors : [];
  const authors = authorsRaw
    .map((a) => (typeof a === "string" ? a : isRecord(a) ? str(a.name) : undefined))
    .filter((v): v is string => Boolean(v));
  const out: PaperSummary = { id, title: title || id, authors };
  const summary = str(paper.summary) ?? str(paper.abstract);
  if (summary) out.summary = summary;
  const published = str(paper.publishedAt) ?? str(raw.publishedAt) ?? str(paper.published_at);
  if (published) out.publishedAt = published;
  const upvotes = num(paper.upvotes) ?? num(raw.upvotes);
  if (upvotes !== undefined) out.upvotes = upvotes;
  return out;
}

export async function paperSearch(
  fetchFn: FetchFn,
  token: string | undefined,
  options: PaperSearchOptions,
): Promise<PaperSearchResult> {
  const query = requireNonEmpty(options.query, "query");
  const limit = clampLimit(options.limit, 10, 50);
  const url = `${API_BASE}/papers/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const data = await requestJson(fetchFn, url, token, "Hugging Face paper search");
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.results)
      ? data.results
      : [];
  const papers = list.map(toPaper).filter((v): v is PaperSummary => v !== null);
  const text =
    papers.length === 0
      ? `No papers found for "${query}".`
      : papers
          .map((p, i) => {
            const lines = [`${i + 1}. ${p.title}${p.id ? ` (${p.id})` : ""}`];
            if (p.authors.length > 0) lines.push(`   Authors: ${p.authors.join(", ")}`);
            if (p.publishedAt) lines.push(`   Published: ${p.publishedAt}`);
            if (p.upvotes !== undefined) lines.push(`   Upvotes: ${p.upvotes}`);
            if (p.summary) lines.push(`   ${p.summary}`);
            return lines.join("\n");
          })
          .join("\n\n");
  return { query, papers, text };
}

// ---------------------------------------------------------------------
// hf_doc_search / hf_doc_fetch
// ---------------------------------------------------------------------

function toHit(raw: unknown): DocHit | null {
  if (!isRecord(raw)) return null;
  const title =
    str(raw.title) ?? str(raw.name) ?? str(raw.heading) ?? str(raw.url) ?? "";
  if (!title) return null;
  const hit: DocHit = { title };
  const url = str(raw.url) ?? str(raw.link) ?? str(raw.path);
  if (url) hit.url = url;
  const snippet = str(raw.content) ?? str(raw.text) ?? str(raw.snippet) ?? str(raw.excerpt);
  if (snippet) hit.snippet = snippet.slice(0, 500);
  return hit;
}

export async function docSearch(
  fetchFn: FetchFn,
  token: string | undefined,
  options: DocSearchOptions,
): Promise<DocSearchResult> {
  const query = requireNonEmpty(options.query, "query");
  const limit = clampLimit(options.limit, 10, 50);
  const url = `${DOCS_SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const data = await requestJson(fetchFn, url, token, "Hugging Face docs search");
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.results)
      ? data.results
      : isRecord(data) && Array.isArray(data.hits)
        ? data.hits
        : isRecord(data) && Array.isArray(data.documents)
          ? data.documents
          : [];
  const hits = list
    .map(toHit)
    .filter((v): v is DocHit => v !== null)
    .slice(0, limit);
  const text =
    hits.length === 0
      ? `No documentation results for "${query}".`
      : hits
          .map((h, i) => {
            const lines = [`${i + 1}. ${h.title}`];
            if (h.url) lines.push(`   ${h.url}`);
            if (h.snippet) lines.push(`   ${h.snippet}`);
            return lines.join("\n");
          })
          .join("\n\n");
  return { query, hits, text };
}

/** Strip HTML to readable plain text. Exported for direct testing. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join("\n")
    .trim();
}

export async function docFetch(
  fetchFn: FetchFn,
  token: string | undefined,
  options: DocFetchOptions,
): Promise<DocFetchResult> {
  const rawUrl = requireNonEmpty(options.url, "url");
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`url is not a valid URL: ${rawUrl}`);
  }
  if (parsed.hostname !== "huggingface.co" || !parsed.pathname.startsWith("/docs")) {
    throw new Error(
      "url must be a Hugging Face documentation page (https://huggingface.co/docs/...)",
    );
  }
  const body = await requestText(fetchFn, parsed.toString(), token, "Hugging Face docs fetch", "text/html, text/plain");
  const isHtml = /<\s*(html|body|div|p|h1)[\s>]/i.test(body);
  return { url: parsed.toString(), text: isHtml ? htmlToText(body) : body.trim() };
}
