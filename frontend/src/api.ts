export interface ApiResult {
  ok: boolean;
  status: number;
  body: any;
}

export function schemasUrl(): string {
  return "/schema";
}

export function schemaUrl(name: string): string {
  return `/schema/${encodeURIComponent(name)}`;
}

export function ingestUrl(): string {
  return "/ingest";
}

export function dashboardUrl(name: string): string {
  return `/dashboard/${encodeURIComponent(name)}`;
}

export function dashboardsUrl(): string {
  return "/dashboard";
}

export function isDuplicate(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { status?: string }).status === "duplicate"
  );
}

export async function postJson(path: string, body: unknown): Promise<ApiResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: any = {};
  try {
    parsed = await res.json();
  } catch {
    // non-JSON body: keep empty object
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

export async function getJson(path: string): Promise<ApiResult> {
  const res = await fetch(path, { method: "GET" });
  let parsed: any = {};
  try {
    parsed = await res.json();
  } catch {
    // non-JSON body: keep empty object
  }
  return { ok: res.ok, status: res.status, body: parsed };
}
