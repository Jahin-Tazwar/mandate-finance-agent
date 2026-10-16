import { config } from "../config";

/**
 * Talks to the AI model through OpenRouter (one API, many models).
 * The rest of the agent only sees `callModel()`, so tests can swap in a fake model
 * with `setModelForTests()` and never call the internet.
 */

/** A tool call the model asks for, e.g. { name: "get_bills", arguments: "{}" }. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One message in the conversation (OpenAI-style format, which OpenRouter uses). */
export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** A tool the model may call: name, what it's for, and its arguments as JSON Schema. */
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** The model's answer: either text, or tools it wants to call first. */
export interface ModelReply {
  content: string | null;
  toolCalls: ToolCall[];
  model: string;
}

/**
 * Asks the model once. `onText` (optional) receives the answer piece by piece as it's
 * written, so the chat can show it word by word; the full reply is still returned at the end.
 */
export type ModelClient = (messages: ModelMessage[], tools: ToolDefinition[], onText?: (delta: string) => void) => Promise<ModelReply>;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** A tool call being put together from streamed pieces. */
interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/**
 * One streamed request to one model. Throws on any failure (the caller may try the fallback).
 * The answer arrives as many small "data:" lines; text pieces go to `onText` straight away,
 * tool calls arrive in pieces too (name first, then the arguments a few characters at a time).
 */
async function askOpenRouter(model: string, messages: ModelMessage[], tools: ToolDefinition[], onText?: (delta: string) => void): Promise<ModelReply> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Mandate",
    },
    body: JSON.stringify({
      model,
      messages,
      // No tools (e.g. the rules helper): leave the fields out, some providers reject an empty list
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      temperature: 0.2, // low = steadier answers about money
      // Room for "reasoning" models to think AND answer (800 wasn't enough after tool results)
      max_tokens: 2000,
      reasoning: { effort: "low" }, // keep the thinking short; ignored by models that don't think
      stream: true,
      // Only use providers that promise not to store or train on our prompts
      // (unless the development switch allows it, for free models)
      provider: { data_collection: config.llm.allowProviderTraining ? "allow" : "deny" },
    }),
    signal: AbortSignal.timeout(45_000), // never hang the chat forever
  });

  // Reject: the model or OpenRouter failed (bad key, model down, rate limit...)
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`OpenRouter ${response.status} for ${model}: ${detail}`);
  }

  let content = "";
  let usedModel = model;
  let finishReason: string | null = null;
  const calls: PartialCall[] = [];

  // Read the stream line by line. A chunk can end mid-line, so keep the unfinished part.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";

    for (const line of lines) {
      // Skip: blank lines and ": OPENROUTER PROCESSING" keep-alive comments
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      const chunk = JSON.parse(data) as {
        model?: string;
        error?: { message?: string };
        choices?: {
          finish_reason?: string | null;
          delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
        }[];
      };

      // Reject: the provider failed half-way through
      if (chunk.error) throw new Error(`OpenRouter stream error for ${model}: ${chunk.error.message ?? "unknown"}`);
      if (chunk.model) usedModel = chunk.model;

      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        onText?.(delta.content);
      }
      // e.g. piece 1: { index: 0, id: "call_1", function: { name: "get_bills", arguments: "" } }
      //      piece 2: { index: 0, function: { arguments: "{}" } }
      for (const piece of delta?.tool_calls ?? []) {
        const i = piece.index ?? 0;
        const call = (calls[i] ??= { id: "", name: "", args: "" });
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.name ||= piece.function.name;
        call.args += piece.function?.arguments ?? "";
      }
    }
  }

  if (process.env.DEBUG_LLM) console.log(`[llm] ${usedModel} finish=${finishReason} content=${content.length} chars tools=${calls.length}`);

  // Reject: it used up all its tokens thinking and never answered (lets the fallback model try)
  if (finishReason === "length" && !content && calls.length === 0) throw new Error(`${model} ran out of tokens before answering`);

  const toolCalls: ToolCall[] = calls
    .filter((c) => c && c.name)
    .map((c, i) => ({ id: c.id || `call_${i}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
  return { content: content || null, toolCalls, model: usedModel };
}

/** The real client: the main model, then the fallback model if the main one fails. */
const openRouterClient: ModelClient = async (messages, tools, onText) => {
  const models = [config.llm.model, config.llm.fallbackModel].filter((m): m is string => Boolean(m));
  let lastError: unknown = new Error("No model configured (LLM_MODEL)");
  let sentText = false;
  const forward = onText && ((delta: string) => {
    sentText = true;
    onText(delta);
  });

  for (const model of models) {
    try {
      return await askOpenRouter(model, messages, tools, forward);
    } catch (err) {
      console.error((err as Error).message); // server log only; the user gets a friendly message
      lastError = err;
      // Stop: part of an answer was already shown; a second model would start a different one
      if (sentText) break;
    }
  }
  throw lastError;
};

let client: ModelClient | null = null;

/** Tests: replace the model with a scripted fake. Pass null to go back to OpenRouter. */
export function setModelForTests(fake: ModelClient | null) {
  client = fake;
}

/** True if chat can work: a fake is set, or OpenRouter has a key and a model. */
export const modelReady = () => client !== null || Boolean(config.llm.apiKey && config.llm.model);

export const callModel: ModelClient = (messages, tools, onText) => (client ?? openRouterClient)(messages, tools, onText);
