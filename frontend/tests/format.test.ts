import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formatValue } from "../src/format.ts";

test("escapeHtml escapes all html metacharacters", () => {
  assert.equal(
    escapeHtml(`<script>alert("x") & 'y'</script>`),
    `&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;`,
  );
});

test("escapeHtml passes plain text through unchanged", () => {
  assert.equal(escapeHtml("tradeId T001"), "tradeId T001");
});

test("formatValue renders numbers as plain numbers", () => {
  assert.equal(formatValue(25000), "25000");
  assert.equal(formatValue(25000.5), "25000.5");
});

test("formatValue renders zero as 0 not a placeholder", () => {
  assert.equal(formatValue(0), "0");
});

test("formatValue renders null and undefined as placeholder", () => {
  assert.equal(formatValue(null), "—");
  assert.equal(formatValue(undefined), "—");
});

test("formatValue renders booleans as true and false", () => {
  assert.equal(formatValue(true), "true");
  assert.equal(formatValue(false), "false");
});

test("formatValue passes strings through unchanged", () => {
  assert.equal(formatValue("OPEN"), "OPEN");
  assert.equal(formatValue("2026-10-31T09:00:00Z"), "2026-10-31T09:00:00Z");
});
