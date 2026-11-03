import type { SupabaseClient } from "@supabase/supabase-js";
import { validateAiFilePayload, type AiFilePayload } from "@/lib/ai-file-validation";
import { authenticateRequest } from "@/lib/supabase-server";

export const maxDuration = 90;

type AiTask = "extract_boq" | "extract_mb" | "assistant" | "boq_question";
const MAX_REQUEST_BYTES = 15 * 1024 * 1024;

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"] },
    documentDate: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemNumber: { type: ["string", "null"] },
          description: { type: "string" },
          unit: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          rate: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
          specification: { type: ["string", "null"] },
          sourceRef: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
        required: ["itemNumber", "description", "unit", "quantity", "rate", "amount", "specification", "sourceRef", "confidence"],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["title", "documentDate", "items", "notes"],
};

const answerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    sourceRefs: { type: "array", items: { type: "string" } },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "sourceRefs", "caveats"],
};

const measurementSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"] },
    documentDate: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemNumber: { type: ["string", "null"] },
          description: { type: "string" },
          unit: { type: ["string", "null"] },
          length: { type: ["number", "null"] },
          width: { type: ["number", "null"] },
          heightDepth: { type: ["number", "null"] },
          unitsCount: { type: ["number", "null"] },
          quantity: { type: ["number", "null"] },
          boqItemNumber: { type: ["string", "null"] },
          sourceRef: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
        required: ["itemNumber", "description", "unit", "length", "width", "heightDepth", "unitsCount", "quantity", "boqItemNumber", "sourceRef", "confidence"],
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["title", "documentDate", "items", "notes"],
};

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error("EMPTY_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_BODY");
  return parsed as Record<string, unknown>;
}

function inputFile(file: AiFilePayload) {
  const fileData = "data:" + file.mimeType + ";base64," + file.base64;
  if (file.mimeType.startsWith("image/")) {
    return { type: "input_image", image_url: fileData, detail: "high" };
  }
  return {
    type: "input_file",
    filename: file.name,
    file_data: "data:" + file.mimeType + ";base64," + file.base64,
    detail: "high",
  };
}

function outputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
    }
  }
  return typeof payload.output_text === "string" ? payload.output_text : "";
}

async function callOpenAI(input: unknown[], schemaName: string, schema: object) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-6-astra",
      store: false,
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
    signal: AbortSignal.timeout(75_000),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error("AI_PROVIDER_ERROR:" + response.status);
  }
  if (payload.status === "incomplete") throw new Error("The AI response was incomplete. Try a smaller document or a more focused question.");
  const text = outputText(payload);
  if (!text) throw new Error("The AI provider returned no structured result. Try again.");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("The AI provider returned malformed structured data. Try again.");
  }
}

async function enforceAiRateLimit(client: SupabaseClient): Promise<Response | null> {
  const { data, error } = await client.rpc("consume_ai_request_limit", {
    p_max_requests: 6,
    p_window_seconds: 60,
  });
  if (error) {
    return Response.json({ error: "AI request controls are not ready. Apply the latest LeaderCon database migration." }, { status: 503 });
  }
  if (data !== true) {
    return Response.json({ error: "AI request limit reached. Wait one minute and try again." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  return null;
}

function makeUserMessage(content: unknown[]) {
  return { role: "user", content };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return Response.json({ error: "This request is too large. AI review supports files up to 10 MB." }, { status: 413 });

  const auth = await authenticateRequest(request);
  if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (cause) {
    if (cause instanceof Error && cause.message === "REQUEST_TOO_LARGE") {
      return Response.json({ error: "This request is too large. AI review supports files up to 10 MB." }, { status: 413 });
    }
    return Response.json({ error: "The request body must be valid JSON and under 15 MB." }, { status: 400 });
  }

  const task = body.task as AiTask;
  const organizationId = safeText(body.organizationId, 64);
  if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) {
    return Response.json({ error: "A valid workspace is required." }, { status: 400 });
  }
  const { data: membership, error: membershipError } = await auth.client
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError || !membership) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "AI is not configured. Add OPENAI_API_KEY to the server environment." }, { status: 503 });

  try {
    if (task === "extract_boq" || task === "extract_mb") {
      const file = validateAiFilePayload(body.file);
      if (!file) return Response.json({ error: "Choose a supported PDF, image, spreadsheet, Word, CSV, or text file under 10 MB." }, { status: 400 });
      const rateLimitResponse = await enforceAiRateLimit(auth.client);
      if (rateLimitResponse) return rateLimitResponse;
      const prompt = task === "extract_boq"
        ? "Read this construction BOQ or schedule of rates. Extract every visible line item faithfully. Preserve the original item numbering and source page, sheet, or row. Use null when a value is absent or uncertain. Do not infer missing quantities, rates, amounts, or specifications. Keep explicit document facts separate from assumptions in notes."
        : "Read this construction Measurement Book. Extract each measured item faithfully. Preserve item numbers, dimensions, calculated quantities, units, and source page/row. Use null for absent or uncertain values. Do not certify the work or infer missing dimensions. Put warnings and uncertain readings in notes.";
      const result = await callOpenAI(
        [makeUserMessage([{ type: "input_text", text: prompt }, inputFile(file)])],
        task === "extract_boq" ? "boq_extraction" : "measurement_book_extraction",
        task === "extract_boq" ? extractionSchema : measurementSchema,
      );
      return Response.json({ result });
    }

    if (task === "boq_question") {
      const boqId = safeText(body.boqId, 64);
      const question = safeText(body.question, 1500);
      if (!boqId || !question) return Response.json({ error: "Choose an approved BOQ and enter a question." }, { status: 400 });
      const { data: boq, error: boqError } = await auth.client
        .from("boqs")
        .select("id, name, version_number, status, total_amount, project_id")
        .eq("id", boqId)
        .eq("organization_id", organizationId)
        .eq("status", "approved")
        .maybeSingle();
      if (boqError) return Response.json({ error: "Could not read the approved BOQ: " + boqError.message }, { status: 400 });
      if (!boq) return Response.json({ error: "The selected BOQ is not approved or is outside this workspace." }, { status: 404 });
      const { data: items, error: itemError } = await auth.client
        .from("boq_items")
        .select("item_number, description, unit, quantity, rate, amount, specification, source_ref")
        .eq("organization_id", organizationId)
        .eq("boq_id", boqId)
        .order("item_number", { ascending: true })
        .limit(1500);
      if (itemError) return Response.json({ error: "Could not read BOQ items: " + itemError.message }, { status: 400 });
      const rateLimitResponse = await enforceAiRateLimit(auth.client);
      if (rateLimitResponse) return rateLimitResponse;
      const context = JSON.stringify({ boq, items: items ?? [] });
      const result = await callOpenAI([
        { role: "developer", content: "Answer only from the supplied approved BOQ data. Do not invent contractual requirements or missing facts. Separate explicit facts from interpretation. Refer to exact item numbers and source page, sheet, or row. If the BOQ does not answer the question, say so. All totals must be calculated from the supplied item values; never estimate official financial figures." },
        makeUserMessage([{ type: "input_text", text: "Approved BOQ data: " + context + "\n\nQuestion: " + question }]),
      ], "boq_answer", answerSchema);
      const allowedRefs = new Set((items ?? []).flatMap((item) => [item.item_number, item.source_ref].filter((value): value is string => Boolean(value))));
      result.sourceRefs = Array.isArray(result.sourceRefs)
        ? result.sourceRefs.filter((ref): ref is string => typeof ref === "string" && allowedRefs.has(ref))
        : [];
      return Response.json({ result, boqName: boq.name });
    }

    if (task === "assistant") {
      const question = safeText(body.question, 1500);
      if (!question) return Response.json({ error: "Enter a question for the accounts assistant." }, { status: 400 });
      const [vendorResult, balanceResult, transactionResult, projectResult] = await Promise.all([
        auth.client.from("vendors").select("id, name, opening_balance, category").eq("organization_id", organizationId).eq("is_archived", false).limit(500),
        auth.client.rpc("get_vendor_balances", { p_organization_id: organizationId }),
        auth.client.from("vendor_transactions").select("id, vendor_id, transaction_type, transaction_date, reference_number, description, amount, due_date, status").eq("organization_id", organizationId).in("status", ["posted", "draft"]).order("transaction_date", { ascending: false }).limit(1000),
        auth.client.from("projects").select("id, name, project_code, status, budget, contract_value").eq("organization_id", organizationId).limit(300),
      ]);
      if (vendorResult.error || balanceResult.error || transactionResult.error || projectResult.error) {
        return Response.json({ error: "The assistant could not access the accounting data. Confirm the database migration and your workspace policies." }, { status: 400 });
      }
      const rateLimitResponse = await enforceAiRateLimit(auth.client);
      if (rateLimitResponse) return rateLimitResponse;
      const vendors = vendorResult.data ?? [];
      const transactions = transactionResult.data ?? [];
      const context = {
        scope: "Current authenticated user's organization only",
        vendors: vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, category: vendor.category })),
        posted_vendor_balances_inr: balanceResult.data ?? [],
        recent_transactions: transactions.slice(0, 250),
        transaction_sample_note: "At most 250 of the latest 1000 accessible transactions are provided for context. The balances above are calculated by the database from the complete posted ledger.",
        projects: projectResult.data ?? [],
      };
      const result = await callOpenAI([
        { role: "developer", content: "You are LeaderCon's accounts assistant. Use only the supplied authorized workspace data. Do not invent or estimate financial numbers. Any balances already supplied are deterministic calculations from posted ledger data. Draft transactions do not affect official balances. State the scope and relevant dates, explain when data is incomplete, and cite transaction references or project/vendor names in sourceRefs. Never propose posting a financial change without explicit human approval." },
        makeUserMessage([{ type: "input_text", text: "Workspace data: " + JSON.stringify(context) + "\n\nQuestion: " + question }]),
      ], "accounts_answer", answerSchema);
      return Response.json({ result, basis: "Authorized workspace records; balances calculated from posted ledger entries." });
    }

    return Response.json({ error: "Unsupported AI task." }, { status: 400 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "AI request failed.";
    if (message === "AI_NOT_CONFIGURED") return Response.json({ error: "AI is not configured. Add OPENAI_API_KEY to the server environment." }, { status: 503 });
    if (message.startsWith("AI_PROVIDER_ERROR:")) {
      const providerStatus = Number(message.slice("AI_PROVIDER_ERROR:".length));
      if (providerStatus === 401 || providerStatus === 403) {
        return Response.json({ error: "The AI provider rejected its server credentials. Check OPENAI_API_KEY in the server environment." }, { status: 502 });
      }
      if (providerStatus === 429) return Response.json({ error: "The AI provider is temporarily rate limited. Wait and try again." }, { status: 429 });
      return Response.json({ error: "The AI provider could not process this request. Try again later." }, { status: 502 });
    }
    if (message.includes("timed out") || message.includes("Timeout")) return Response.json({ error: "The AI request timed out. Try a smaller document or shorter question." }, { status: 504 });
    console.error("LeaderCon AI request failed.");
    return Response.json({ error: "The AI provider could not complete this request. Try again or check the server configuration." }, { status: 502 });
  }
}
