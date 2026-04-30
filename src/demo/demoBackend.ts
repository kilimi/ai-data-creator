/**
 * Demo Backend
 * ------------
 * A client-side mock that intercepts window.fetch() and serves canned
 * responses for the FastAPI endpoints used by the frontend. This lets the
 * app run inside the Lovable preview without a real backend or database.
 *
 * Activated automatically when:
 *   - VITE_DEMO_MODE === 'true', OR
 *   - localStorage.getItem('demoMode') === 'true', OR
 *   - the configured API base URL is unreachable (auto-fallback).
 *
 * Toggle manually from the browser console:
 *   localStorage.setItem('demoMode', 'true'); location.reload();
 *   localStorage.removeItem('demoMode');     location.reload();
 */

import { getApiBaseUrl } from "@/config/api";

type JsonHandler = (
  url: URL,
  init: RequestInit,
  match: RegExpMatchArray
) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: JsonHandler;
}

// ---------- in-memory store ----------
const now = () => new Date().toISOString();

const store = {
  nextProjectId: 3,
  nextDatasetId: 4,
  projects: [
    {
      id: 1,
      name: "Demo Project",
      description: "Sample project shown in demo mode (no backend running).",
      created_at: now(),
      updated_at: now(),
      is_project: true,
      tags: ["demo", "sample"],
      datasets: [] as any[],
      dataset_groups: [] as any[],
    },
    {
      id: 2,
      name: "Wildlife Detection",
      description: "Another example project to showcase the UI.",
      created_at: now(),
      updated_at: now(),
      is_project: true,
      tags: ["wildlife"],
      datasets: [] as any[],
      dataset_groups: [] as any[],
    },
  ] as any[],
  datasets: [
    {
      id: 1,
      name: "Sample Images",
      description: "A small demo dataset.",
      tags: ["demo"],
      created_at: now(),
      updated_at: now(),
      image_count: 0,
      annotation_count: 0,
      annotation_file_count: 0,
      annotation_files: [],
      project_id: 1,
    },
    {
      id: 2,
      name: "Training Set",
      description: "Demo training set.",
      tags: [],
      created_at: now(),
      updated_at: now(),
      image_count: 0,
      annotation_count: 0,
      annotation_file_count: 0,
      annotation_files: [],
      project_id: 1,
    },
    {
      id: 3,
      name: "Birds",
      description: "Demo wildlife dataset.",
      tags: [],
      created_at: now(),
      updated_at: now(),
      image_count: 0,
      annotation_count: 0,
      annotation_file_count: 0,
      annotation_files: [],
      project_id: 2,
    },
  ] as any[],
};

// link datasets into projects
for (const p of store.projects) {
  p.datasets = store.datasets.filter((d) => d.project_id === p.id);
}

// ---------- routes ----------
const routes: Route[] = [
  // Health
  {
    method: "GET",
    pattern: /^\/health-check\/?$/,
    handler: () => ({ status: "ok", demo: true }),
  },

  // Tasks (popover polls these)
  {
    method: "GET",
    pattern: /^\/tasks\/active/,
    handler: () => [],
  },
  {
    method: "GET",
    pattern: /^\/tasks\/?($|\?)/,
    handler: () => [],
  },

  // System / GPU
  {
    method: "GET",
    pattern: /^\/system\/gpu/,
    handler: () => ({ available: false, devices: [], demo: true }),
  },

  // Projects list
  {
    method: "GET",
    pattern: /^\/projects\/?($|\?)/,
    handler: () => ({ data: store.projects }),
  },
  // Project by id
  {
    method: "GET",
    pattern: /^\/projects\/(\d+)\/?($|\?)/,
    handler: (_u, _i, m) => {
      const id = Number(m[1]);
      const p = store.projects.find((x) => x.id === id);
      return p ? { data: p } : { data: null };
    },
  },
  // Create project
  {
    method: "POST",
    pattern: /^\/projects\/?$/,
    handler: async (_u, init) => {
      const body = await readBody(init);
      const project = {
        id: store.nextProjectId++,
        name: body.name || "New Project",
        description: body.description || "",
        created_at: now(),
        updated_at: now(),
        is_project: true,
        tags: parseTags(body.tags),
        datasets: [],
        dataset_groups: [],
      };
      store.projects.push(project);
      return { data: project };
    },
  },

  // Datasets list
  {
    method: "GET",
    pattern: /^\/datasets\/?($|\?)/,
    handler: () => store.datasets,
  },
  // Dataset by id
  {
    method: "GET",
    pattern: /^\/datasets\/(\d+)\/?($|\?)/,
    handler: (_u, _i, m) => {
      const id = Number(m[1]);
      return store.datasets.find((d) => d.id === id) || null;
    },
  },
  // Dataset images / collections / annotations (empty in demo)
  {
    method: "GET",
    pattern: /^\/datasets\/\d+\/images/,
    handler: () => ({ images: [] }),
  },
  {
    method: "GET",
    pattern: /^\/datasets\/\d+\/image-collections/,
    handler: () => [],
  },
  {
    method: "GET",
    pattern: /^\/datasets\/\d+\/annotations/,
    handler: () => [],
  },
  {
    method: "GET",
    pattern: /^\/datasets\/\d+\/calibrations/,
    handler: () => [],
  },

  // Create dataset
  {
    method: "POST",
    pattern: /^\/datasets\/?$/,
    handler: async (_u, init) => {
      const body = await readBody(init);
      const ds = {
        id: store.nextDatasetId++,
        name: body.name || "New Dataset",
        description: body.description || "",
        tags: parseTags(body.tags),
        created_at: now(),
        updated_at: now(),
        image_count: 0,
        annotation_count: 0,
        annotation_file_count: 0,
        annotation_files: [],
        project_id: Number(body.project_id) || 1,
      };
      store.datasets.push(ds);
      const proj = store.projects.find((p) => p.id === ds.project_id);
      if (proj) proj.datasets.push(ds);
      return ds;
    },
  },
];

// ---------- helpers ----------
function parseTags(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  }
}

async function readBody(init: RequestInit): Promise<Record<string, any>> {
  const body = init.body;
  if (!body) return {};
  if (body instanceof FormData) {
    const obj: Record<string, any> = {};
    body.forEach((v, k) => (obj[k] = v));
    return obj;
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- installer ----------
let installed = false;

export function installDemoBackend(): void {
  if (installed) return;
  installed = true;

  const baseUrl = getApiBaseUrl().replace(/\/$/, "");
  const originalFetch = window.fetch.bind(window);

  // eslint-disable-next-line no-console
  console.info(
    `%c[demo backend] active — intercepting requests to ${baseUrl}`,
    "color:#7c3aed;font-weight:bold;"
  );

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    if (!rawUrl.startsWith(baseUrl)) {
      return originalFetch(input as any, init);
    }

    const url = new URL(rawUrl);
    const path = url.pathname + url.search;
    const method = (init.method || "GET").toUpperCase();

    for (const route of routes) {
      if (route.method !== method) continue;
      const m = path.match(route.pattern);
      if (m) {
        try {
          const data = await route.handler(url, init, m);
          return jsonResponse(data);
        } catch (err) {
          return jsonResponse(
            { error: err instanceof Error ? err.message : String(err) },
            500
          );
        }
      }
    }

    // Unmatched: return empty success so the UI doesn't error out
    console.warn(`[demo backend] unhandled ${method} ${path} — returning empty response`);
    return jsonResponse(method === "GET" ? [] : { ok: true, demo: true });
  };
}

export function shouldEnableDemoMode(): boolean {
  try {
    if (import.meta.env.VITE_DEMO_MODE === "true") return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("demoMode") === "true") {
      return true;
    }
  } catch {
    /* ignore */
  }
  // Default ON when running inside the Lovable preview hostname.
  if (typeof window !== "undefined" && /lovable\.app$/i.test(window.location.hostname)) {
    return true;
  }
  return false;
}
