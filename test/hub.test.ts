import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  docFetch,
  docSearch,
  htmlToText,
  listRepoFiles,
  normalizeRepoType,
  paperSearch,
  repoDetails,
  repoSearch,
  tokenFromEnv,
  whoami,
} from "../src/hub.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

const WHOAMI_JSON = JSON.stringify({
  name: "testuser",
  fullname: "Test User",
  email: "test@example.com",
  type: "user",
  orgs: [{ name: "testorg" }],
});

const DETAILS_JSON = JSON.stringify({
  id: "meta-llama/Llama-3.1-8B",
  author: "meta-llama",
  downloads: 123456,
  likes: 789,
  lastModified: "2024-08-01T00:00:00.000Z",
  createdAt: "2024-07-18T00:00:00.000Z",
  private: false,
  gated: "auto",
  pipeline_tag: "text-generation",
  library_name: "transformers",
  tags: ["text-generation", "llama"],
  siblings: [{ rfilename: "config.json" }, { rfilename: "model.safetensors" }],
});

const SEARCH_JSON = JSON.stringify([
  { id: "a/one", author: "a", downloads: 100, likes: 5, lastModified: "2024-01-01T00:00:00.000Z" },
  { id: "b/two", author: "b", downloads: 50, likes: 2 },
]);

const TREE_JSON = JSON.stringify([
  { type: "file", path: "config.json", size: 123 },
  { type: "directory", path: "subdir" },
]);

const PAPERS_JSON = JSON.stringify([
  {
    paper: {
      id: "2401.00001",
      title: "A Paper About Retrieval",
      authors: [{ name: "Ada Lovelace" }, { name: "Alan Turing" }],
      summary: "We study retrieval.",
      publishedAt: "2024-01-02T00:00:00.000Z",
      upvotes: 42,
    },
  },
]);

const DOCS_SEARCH_JSON = JSON.stringify({
  results: [
    { title: "Fine-tuning", url: "https://huggingface.co/docs/transformers/training", content: "How to fine-tune a model." },
    { title: "Pipelines", url: "https://huggingface.co/docs/transformers/pipeline_tutorial", content: "Using pipelines." },
  ],
});

const DOCS_HTML =
  "<html><head><style>.x{}</style><script>var a=1;</script></head>" +
  "<body><h1>Transformers</h1><p>Hello &amp; welcome.</p><p>Second para.</p></body></html>";

interface Captured {
  url?: string;
  headers?: Record<string, string>;
}

function jsonResponse(body: string, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => "application/json" },
    text: async () => body,
  };
}

function fakeFetch(captured: Captured): FetchFn {
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    captured.url = url;
    captured.headers = init?.headers;
    if (url.includes("/whoami-v2")) return jsonResponse(WHOAMI_JSON);
    if (url.includes("/tree/")) return jsonResponse(TREE_JSON);
    if (url.includes("/papers/search")) return jsonResponse(PAPERS_JSON);
    if (url.includes("/docs/hub/search")) return jsonResponse(DOCS_SEARCH_JSON);
    if (url.startsWith("https://huggingface.co/docs/")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "text/html" },
        text: async () => DOCS_HTML,
      };
    }
    if (/\/api\/(models|datasets|spaces)\?/.test(url)) return jsonResponse(SEARCH_JSON);
    if (/\/api\/(models|datasets|spaces)\//.test(url)) return jsonResponse(DETAILS_JSON);
    return jsonResponse("not found", 404);
  };
}

const unauthorized: FetchFn = async () => jsonResponse("unauthorized", 401);

describe("tokenFromEnv", () => {
  it("prefers HF_TOKEN, honours the alias, and returns undefined when absent", () => {
    assert.equal(tokenFromEnv({ HF_TOKEN: " hf-key " }), "hf-key");
    assert.equal(tokenFromEnv({ HUGGING_FACE_HUB_TOKEN: "alias-key" }), "alias-key");
    assert.equal(tokenFromEnv({ HF_TOKEN: "a", HUGGING_FACE_HUB_TOKEN: "b" }), "a");
    assert.equal(tokenFromEnv({}), undefined);
    assert.equal(tokenFromEnv({ HF_TOKEN: "   " }), undefined);
  });
});

describe("normalizeRepoType", () => {
  it("maps singular and plural forms and rejects unknown kinds", () => {
    assert.equal(normalizeRepoType(undefined), "models");
    assert.equal(normalizeRepoType("model"), "models");
    assert.equal(normalizeRepoType("datasets"), "datasets");
    assert.equal(normalizeRepoType("Space"), "spaces");
    assert.throws(() => normalizeRepoType("widgets"), /models, datasets, spaces/);
  });
});

describe("whoami", () => {
  it("errors naming HF_TOKEN when no token is configured", async () => {
    await assert.rejects(() => whoami(fakeFetch({}), undefined), /HF_TOKEN/);
    await assert.rejects(() => whoami(fakeFetch({}), "  "), /HF_TOKEN/);
  });

  it("sends the token as Bearer and parses the account", async () => {
    const captured: Captured = {};
    const out = await whoami(fakeFetch(captured), "hf-key");
    assert.equal(out.name, "testuser");
    assert.equal(out.fullname, "Test User");
    assert.equal(captured.headers?.Authorization, "Bearer hf-key");
    assert.ok(captured.url?.endsWith("/api/whoami-v2"));
    assert.ok(out.text.includes("Organizations: testorg"));
  });

  it("names HF_TOKEN when the API rejects the token with 401", async () => {
    await assert.rejects(() => whoami(unauthorized, "bad-key"), /HF_TOKEN/);
  });
});

describe("repoDetails", () => {
  it("fetches model details anonymously with no Authorization header", async () => {
    const captured: Captured = {};
    const out = await repoDetails(fakeFetch(captured), undefined, {
      repo_id: "meta-llama/Llama-3.1-8B",
    });
    assert.equal(out.id, "meta-llama/Llama-3.1-8B");
    assert.equal(out.downloads, 123456);
    assert.deepEqual(out.files, ["config.json", "model.safetensors"]);
    assert.equal(captured.headers?.Authorization, undefined);
    assert.ok(captured.url?.includes("/api/models/meta-llama/Llama-3.1-8B"));
    assert.ok(out.text.includes("Pipeline: text-generation"));
  });

  it("routes datasets, passes revision as a query param, and sends a token when given", async () => {
    const captured: Captured = {};
    await repoDetails(fakeFetch(captured), "hf-key", {
      repo_id: "squad",
      repo_type: "datasets",
      revision: "refs/pr/1",
    });
    assert.ok(captured.url?.includes("/api/datasets/squad?"));
    assert.ok(captured.url?.includes("revision=refs%2Fpr%2F1"));
    assert.equal(captured.headers?.Authorization, "Bearer hf-key");
  });

  it("rejects an empty repo_id", async () => {
    await assert.rejects(
      () => repoDetails(fakeFetch({}), undefined, { repo_id: " " }),
      /non-empty/,
    );
  });
});

describe("repoSearch", () => {
  it("builds the list-endpoint query and parses summaries", async () => {
    const captured: Captured = {};
    const out = await repoSearch(fakeFetch(captured), undefined, {
      search: "llama",
      author: "meta-llama",
      sort: "downloads",
      direction: -1,
      limit: 5,
    });
    assert.equal(out.results.length, 2);
    assert.equal(out.results[0].id, "a/one");
    assert.ok(captured.url?.startsWith("https://huggingface.co/api/models?"));
    assert.ok(captured.url?.includes("search=llama"));
    assert.ok(captured.url?.includes("author=meta-llama"));
    assert.ok(captured.url?.includes("sort=downloads"));
    assert.ok(captured.url?.includes("direction=-1"));
    assert.ok(captured.url?.includes("limit=5"));
    assert.ok(out.text.includes("1. a/one"));
  });

  it("defaults the limit to 20 and clamps large limits to 100", async () => {
    const c1: Captured = {};
    await repoSearch(fakeFetch(c1), undefined, {});
    assert.ok(c1.url?.includes("limit=20"));
    const c2: Captured = {};
    await repoSearch(fakeFetch(c2), undefined, { limit: 5000, repo_type: "spaces" });
    assert.ok(c2.url?.includes("/api/spaces?"));
    assert.ok(c2.url?.includes("limit=100"));
  });
});

describe("listRepoFiles", () => {
  it("lists the tree at main by default and formats sizes", async () => {
    const captured: Captured = {};
    const out = await listRepoFiles(fakeFetch(captured), undefined, { repo_id: "a/one" });
    assert.equal(out.revision, "main");
    assert.equal(out.files.length, 2);
    assert.ok(captured.url?.includes("/api/models/a/one/tree/main"));
    assert.ok(out.text.includes("file\tconfig.json\t123"));
    assert.ok(out.text.includes("directory\tsubdir"));
  });

  it("honours revision and sub-path", async () => {
    const captured: Captured = {};
    await listRepoFiles(fakeFetch(captured), undefined, {
      repo_id: "a/one",
      revision: "v2",
      path: "subdir",
    });
    assert.ok(captured.url?.endsWith("/tree/v2/subdir"));
  });
});

describe("paperSearch", () => {
  it("queries the papers endpoint and unwraps nested paper records", async () => {
    const captured: Captured = {};
    const out = await paperSearch(fakeFetch(captured), undefined, { query: "retrieval" });
    assert.equal(out.papers.length, 1);
    assert.equal(out.papers[0].title, "A Paper About Retrieval");
    assert.deepEqual(out.papers[0].authors, ["Ada Lovelace", "Alan Turing"]);
    assert.ok(captured.url?.includes("/api/papers/search?q=retrieval"));
    assert.ok(captured.url?.includes("limit=10"));
  });

  it("rejects an empty query", async () => {
    await assert.rejects(
      () => paperSearch(fakeFetch({}), undefined, { query: "" }),
      /non-empty/,
    );
  });
});

describe("docSearch", () => {
  it("queries the docs search endpoint and parses hits", async () => {
    const captured: Captured = {};
    const out = await docSearch(fakeFetch(captured), undefined, { query: "fine-tuning" });
    assert.equal(out.hits.length, 2);
    assert.equal(out.hits[0].title, "Fine-tuning");
    assert.ok(captured.url?.includes("/api/docs/hub/search?q=fine-tuning"));
    assert.ok(out.text.includes("How to fine-tune a model."));
  });

  it("caps hits at the requested limit", async () => {
    const out = await docSearch(fakeFetch({}), undefined, { query: "x", limit: 1 });
    assert.equal(out.hits.length, 1);
  });
});

describe("htmlToText and docFetch", () => {
  it("strips scripts, styles and tags and decodes entities", () => {
    const text = htmlToText(DOCS_HTML);
    assert.ok(text.includes("Transformers"));
    assert.ok(text.includes("Hello & welcome."));
    assert.ok(!text.includes("var a=1"));
    assert.ok(!text.includes("<p>"));
  });

  it("fetches a docs page and returns stripped text", async () => {
    const out = await docFetch(fakeFetch({}), undefined, {
      url: "https://huggingface.co/docs/transformers/index",
    });
    assert.ok(out.text.includes("Second para."));
  });

  it("rejects non-docs and off-site URLs without fetching", async () => {
    await assert.rejects(
      () => docFetch(fakeFetch({}), undefined, { url: "https://example.com/docs/x" }),
      /documentation page/,
    );
    await assert.rejects(
      () => docFetch(fakeFetch({}), undefined, { url: "https://huggingface.co/models/a/b" }),
      /documentation page/,
    );
    await assert.rejects(
      () => docFetch(fakeFetch({}), undefined, { url: "not a url" }),
      /not a valid URL/,
    );
  });
});

describe("error propagation", () => {
  it("surfaces HTTP failures with their status", async () => {
    const failing: FetchFn = async () => jsonResponse("boom", 500);
    await assert.rejects(
      () => repoSearch(failing, undefined, {}),
      /HTTP 500/,
    );
  });
});
