import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypeScriptModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const financials = await loadTypeScriptModule("../src/lib/financials.ts");
const aiFiles = await loadTypeScriptModule("../src/lib/ai-file-validation.ts");
const labour = await loadTypeScriptModule("../src/lib/labour.ts");

test("posted vendor ledger entries use the expected signs", () => {
  assert.equal(financials.signedTransactionAmount({ transaction_type: "invoice", amount: 100, status: "posted" }), 100);
  assert.equal(financials.signedTransactionAmount({ transaction_type: "payment", amount: 40, status: "posted" }), -40);
  assert.equal(financials.signedTransactionAmount({ transaction_type: "advance", amount: -12, status: "posted" }), -12);
  assert.equal(financials.signedTransactionAmount({ transaction_type: "credit_note", amount: 8, status: "posted" }), -8);
  assert.equal(financials.signedTransactionAmount({ transaction_type: "adjustment", amount: -3, status: "posted" }), -3);
});

test("draft, void, unknown, and invalid amounts do not change a ledger balance", () => {
  assert.equal(financials.signedTransactionAmount({ transaction_type: "invoice", amount: 100, status: "draft" }), 0);
  assert.equal(financials.signedTransactionAmount({ transaction_type: "payment", amount: 100, status: "void" }), 0);
  assert.equal(financials.signedTransactionAmount({ transaction_type: "other", amount: 100, status: "posted" }), 0);
  assert.equal(financials.signedTransactionAmount({ transaction_type: "invoice", amount: "not-a-number", status: "posted" }), 0);
});

test("vendor balance adds opening balance and signed posted movements", () => {
  const balance = financials.calculateVendorBalance("100", [
    { transaction_type: "invoice", amount: 80, status: "posted" },
    { transaction_type: "payment", amount: 25, status: "posted" },
    { transaction_type: "credit_note", amount: 10, status: "posted" },
    { transaction_type: "adjustment", amount: -2, status: "posted" },
    { transaction_type: "invoice", amount: 50, status: "draft" },
  ]);
  assert.equal(balance, 143);
  assert.equal(financials.calculateVendorBalance("invalid", []), 0);
});

test("labour outstanding and payment status use linked payment amounts", () => {
  assert.equal(labour.calculateLabourOutstanding("1250.00", "250.00"), 1000);
  assert.equal(labour.deriveLabourPaymentStatus(1250, 250), "partial");
  assert.equal(labour.calculateLabourOutstanding(1250, 1250), 0);
  assert.equal(labour.deriveLabourPaymentStatus(1250, 1250), "paid");
  assert.equal(labour.calculateLabourOutstanding(1250, 1500), 0);
});

test("measurement comparisons require an explicit matching unit", () => {
  assert.equal(financials.areUnitsComparable("m³", " M³ "), true);
  assert.equal(financials.areUnitsComparable("sqm", "sq m"), false);
  assert.equal(financials.areUnitsComparable("m", null), false);
});

test("AI file validation accepts a signed PDF and rejects invalid input", () => {
  const pdf = Buffer.from("%PDF-1.7\nLeaderCon BOQ").toString("base64");
  const valid = aiFiles.validateAiFilePayload({
    name: "C:\\uploads\\boq.pdf",
    mimeType: "application/pdf",
    base64: pdf,
  });
  assert.equal(valid?.name, "boq.pdf");
  assert.equal(valid?.mimeType, "application/pdf");

  assert.equal(aiFiles.validateAiFilePayload({ name: "boq.pdf", mimeType: "text/plain", base64: pdf }), null);
  assert.equal(aiFiles.validateAiFilePayload({ name: "scan.png", mimeType: "image/png", base64: pdf }), null);
  assert.equal(aiFiles.validateAiFilePayload({ name: "boq.pdf", mimeType: "application/pdf", base64: "%%%=" }), null);
  assert.equal(aiFiles.validateAiFilePayload({ name: "boq.exe", mimeType: "application/pdf", base64: pdf }), null);
});

test("AI file validation rejects files above its size limit before decoding", () => {
  const tooLarge = "A".repeat(Math.ceil(aiFiles.MAX_AI_FILE_BYTES / 3) * 4 + 4);
  assert.equal(aiFiles.validateAiFilePayload({ name: "boq.pdf", mimeType: "application/pdf", base64: tooLarge }), null);
});

test("CSV values are quoted and formula-like user text is neutralized", () => {
  assert.equal(financials.csvCell('Vendor "A"'), '"Vendor ""A"""');
  assert.equal(financials.csvCell("=HYPERLINK(\"https://example.test\")").startsWith('"\'=HYPERLINK'), true);
  assert.equal(financials.csvCell(" -cmd"), '"\' -cmd"');
  assert.equal(financials.csvCell(-12), '"-12"');
});
