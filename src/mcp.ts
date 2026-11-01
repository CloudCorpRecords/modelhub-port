/**
 * modelhub-port MCP server. Tools: hf_whoami, hub_repo_details,
 * hub_repo_search, paper_search, hf_doc_search, hf_doc_fetch,
 * list_repo_files.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set.
 *
 * HF_TOKEN is optional and keyless-first: when set it is sent as a
 * Bearer token, when absent the public tools proceed anonymously.
 * Only hf_whoami errors without a token, naming HF_TOKEN.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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

const WhoamiArgs = z.object({});
const RepoDetailsArgs = z.object({
  repo_id: z.string(),
  repo_type: z.string().optional(),
  revision: z.string().optional(),
});
const RepoSearchArgs = z.object({
  search: z.string().optional(),
  repo_type: z.string().optional(),
  author: z.string().optional(),
  sort: z.string().optional(),
  limit: z.number().optional(),
  direction: z.number().optional(),
});
const PaperSearchArgs = z.object({
  query: z.string(),
  limit: z.number().optional(),
});
const DocSearchArgs = z.object({
  query: z.string(),
  limit: z.number().optional(),
});
const DocFetchArgs = z.object({
  url: z.string(),
});
const ListFilesArgs = z.object({
  repo_id: z.string(),
  repo_type: z.string().optional(),
  revision: z.string().optional(),
  path: z.string().optional(),
});

const TOOLS = [
  {
    name: "hf_whoami",
    description: "Return the Hugging Face account that the configured HF_TOKEN belongs to.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "hub_repo_details",
    description: "Get details for a Hugging Face model, dataset, or space repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_id: { type: "string", description: "The repository identifier (e.g. 'owner/name') to retrieve details for." },
        repo_type: { type: "string", description: "Optional repository type selecting the namespace: 'models', 'datasets', or 'spaces' (default 'models'; singular forms are also accepted)." },
        revision: { type: "string", description: "Optional revision (branch, tag, or commit) to query for this repository." },
      },
      required: ["repo_id"],
    },
  },
  {
    name: "hub_repo_search",
    description: "Search Hugging Face models, datasets, or spaces with optional filters.",
    inputSchema: {
      type: "object" as const,
      properties: {
        search: { type: "string", description: "Optional keyword search term matched against repository names and metadata." },
        repo_type: { type: "string", description: "Optional repository type to search: 'models', 'datasets', or 'spaces' (default 'models'; singular forms are also accepted)." },
        author: { type: "string", description: "Optional author or organization name to filter results to." },
        sort: { type: "string", description: "Optional field to sort results by, as accepted by the Hugging Face Hub API." },
        limit: { type: "number", description: "Optional maximum number of results to return (default 20, clamped to 1-100)." },
        direction: { type: "number", description: "Optional sort direction sent to the Hub API (floored to an integer, e.g. -1 for descending)." },
      },
    },
  },
  {
    name: "paper_search",
    description: "Search Hugging Face papers by keyword.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The keyword query to search Hugging Face papers by." },
        limit: { type: "number", description: "Optional maximum number of papers to return (default 10, clamped to 1-50)." },
      },
      required: ["query"],
    },
  },
  {
    name: "hf_doc_search",
    description: "Search the Hugging Face documentation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The keyword query to search the Hugging Face documentation by." },
        limit: { type: "number", description: "Optional maximum number of documentation results to return (default 10, clamped to 1-50)." },
      },
      required: ["query"],
    },
  },
  {
    name: "hf_doc_fetch",
    description: "Fetch a Hugging Face documentation page and return its text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL of the Hugging Face documentation page to fetch (must be a https://huggingface.co/docs/... page)." },
      },
      required: ["url"],
    },
  },
  {
    name: "list_repo_files",
    description: "List files in a Hugging Face model, dataset, or space repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_id: { type: "string", description: "The repository identifier (e.g. 'owner/name') whose files to list." },
        repo_type: { type: "string", description: "Optional repository type selecting the namespace: 'models', 'datasets', or 'spaces' (default 'models'; singular forms are also accepted)." },
        revision: { type: "string", description: "Optional revision (branch, tag, or commit) whose file tree to list (default 'main')." },
        path: { type: "string", description: "Optional subdirectory path within the repository to list files under." },
      },
      required: ["repo_id"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "modelhub-port", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const token = tokenFromEnv();
  try {
    if (name === "hf_whoami") {
      WhoamiArgs.parse(args ?? {});
      return textResult((await whoami(fetchFn, token)).text);
    }
    if (name === "hub_repo_details") {
      const parsed = RepoDetailsArgs.parse(args ?? {});
      return textResult((await repoDetails(fetchFn, token, parsed)).text);
    }
    if (name === "hub_repo_search") {
      const parsed = RepoSearchArgs.parse(args ?? {});
      return textResult((await repoSearch(fetchFn, token, parsed)).text);
    }
    if (name === "paper_search") {
      const parsed = PaperSearchArgs.parse(args ?? {});
      return textResult((await paperSearch(fetchFn, token, parsed)).text);
    }
    if (name === "hf_doc_search") {
      const parsed = DocSearchArgs.parse(args ?? {});
      return textResult((await docSearch(fetchFn, token, parsed)).text);
    }
    if (name === "hf_doc_fetch") {
      const parsed = DocFetchArgs.parse(args ?? {});
      return textResult((await docFetch(fetchFn, token, parsed)).text);
    }
    if (name === "list_repo_files") {
      const parsed = ListFilesArgs.parse(args ?? {});
      return textResult((await listRepoFiles(fetchFn, token, parsed)).text);
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
