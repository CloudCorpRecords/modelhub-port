/**
 * modelhub-port types.
 *
 * The Hugging Face Hub surface is organised around repositories of
 * three kinds (models, datasets, spaces), daily papers, and the
 * documentation site. HTTP access is described by a minimal response
 * surface so tests can inject a fake fetch and never touch the network.
 */

export type RepoType = "models" | "datasets" | "spaces";

export interface WhoamiResult {
  name: string;
  fullname?: string;
  email?: string;
  type?: string;
  text: string;
}

export interface RepoDetailsOptions {
  repo_id: string;
  repo_type?: string;
  revision?: string;
}

export interface RepoDetails {
  id: string;
  repoType: RepoType;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  createdAt?: string;
  isPrivate?: boolean;
  gated?: string | boolean;
  pipelineTag?: string;
  libraryName?: string;
  tags: string[];
  files: string[];
  text: string;
}

export interface RepoSearchOptions {
  search?: string;
  repo_type?: string;
  author?: string;
  sort?: string;
  limit?: number;
  direction?: number;
}

export interface RepoSummary {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
}

export interface RepoSearchResult {
  repoType: RepoType;
  results: RepoSummary[];
  text: string;
}

export interface PaperSearchOptions {
  query: string;
  limit?: number;
}

export interface PaperSummary {
  id: string;
  title: string;
  authors: string[];
  summary?: string;
  publishedAt?: string;
  upvotes?: number;
}

export interface PaperSearchResult {
  query: string;
  papers: PaperSummary[];
  text: string;
}

export interface DocSearchOptions {
  query: string;
  limit?: number;
}

export interface DocHit {
  title: string;
  url?: string;
  snippet?: string;
}

export interface DocSearchResult {
  query: string;
  hits: DocHit[];
  text: string;
}

export interface DocFetchOptions {
  url: string;
}

export interface DocFetchResult {
  url: string;
  text: string;
}

export interface ListFilesOptions {
  repo_id: string;
  repo_type?: string;
  revision?: string;
  path?: string;
}

export interface RepoFile {
  type: string;
  path: string;
  size?: number;
}

export interface ListFilesResult {
  repoId: string;
  repoType: RepoType;
  revision: string;
  files: RepoFile[];
  text: string;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
