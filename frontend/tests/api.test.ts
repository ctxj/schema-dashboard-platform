import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { schemasUrl, schemaUrl, ingestUrl, dashboardUrl, dashboardsUrl, postJson, isDuplicate } from "../src/api.ts";

// ---- url builders ----

test("endpoint urls match the api contract", () => {
  assert.equal(schemasUrl(), "/schema");
  assert.equal(schemaUrl("trade"), "/schema/trade");
  assert.equal(ingestUrl(), "/ingest");
  assert.equal(dashboardUrl("trade-dashboard"), "/dashboard/trade-dashboard");
  assert.equal(dashboardsUrl(), "/dashboard");
});

test("dashboardUrl url-encodes the dashboard name", () => {
  assert.equal(dashboardUrl("trade dash/1"), "/dashboard/trade%20dash%2F1");
});

test("schemaUrl url-encodes the schema name", () => {
  assert.equal(schemaUrl("a b"), "/schema/a%20b");
});

// ---- duplicate detection ----

test("isDuplicate detects replayed batches", () => {
  assert.equal(isDuplicate({ status: "duplicate", ingested: 0, original: {} }), true);
  assert.equal(isDuplicate({ status: "accepted", ingested: 1 }), false);
  assert.equal(isDuplicate(null), false);
});

// ---- postJson against a real local http server (no mocks) ----

async function withServer(handler: (req: any, res: any) => void, fn: (base: string, seen: { body: string; headers: any }) => Promise<void>) {
  const seen = { body: "", headers: {} as any };
  const server: Server = createServer((req, res) => {
    seen.headers = req.headers;
    req.on("data", (c: Buffer) => (seen.body += c));
    req.on("end", () => handler(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`, seen);
  } finally {
    server.close();
  }
}

test("postJson posts json and returns parsed body on success", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "trade", status: "created" }));
    },
    async (base, seen) => {
      const result = await postJson(`${base}/schema`, { name: "trade", fields: [] });
      assert.equal(result.ok, true);
      assert.equal(result.status, 201);
      assert.equal(result.body.name, "trade");
      assert.match(seen.headers["content-type"] ?? "", /application\/json/);
      assert.deepEqual(JSON.parse(seen.body), { name: "trade", fields: [] });
    },
  );
});

test("postJson returns ok:false with parsed error envelope on 400", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: [{ field: "name", "message": "required" }] }));
    },
    async (base) => {
      const result = await postJson(`${base}/schema`, {});
      assert.equal(result.ok, false);
      assert.equal(result.status, 400);
      assert.equal(result.body.errors[0].field, "name");
    },
  );
});

test("postJson surfaces server detail envelope on 404", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "unknown dashboard" }));
    },
    async (base) => {
      const result = await postJson(`${base}/dashboard/x`, {});
      assert.equal(result.ok, false);
      assert.equal(result.status, 404);
      assert.equal(result.body.detail, "unknown dashboard");
    },
  );
});
