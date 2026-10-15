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

export type ModelClient = (messages: ModelMessage[], tools: ToolDefinition[]) => Promise<ModelReply>;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** One request to one model. Throws on any failure (the caller tries the fallback). */
async function askOpenRouter(model: string, messages: ModelMessage[], tools: ToolDefinition[]): Promise<ModelReply> {
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
      tools,
      tool_choice: "auto",
      temperature: 0.2, // low = steadier answers about money
      max_tokens: 800,
      // Only use providers that promise not to store or train on our prompts
      provider: { data_collection: "deny" },
    }),
    signal: AbortSignal.timeout(45_000), // never hang the chat forever
  });

  // Reject: the model or OpenRouter failed (bad key, model down, rate limit...)
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`OpenRouter ${response.status} for ${model}: ${detail}`);
  }

  const body = (await response.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  };
  const message = body.choices?.[0]?.message;

  // Reject: an answer with no message in it
  if (!message) throw new Error(`OpenRouter returned no message for ${model}`);
  return { content: message.content ?? null, toolCalls: message.tool_calls ?? [], model: body.model ?? model };
}

/** The real client: the main model, then the fallback model if the main one fails. */
const openRouterClient: ModelClient = async (messages, tools) => {
  const models = [config.llm.model, config.llm.fallbackModel].filter((m): m is string => Boolean(m));
  let lastError: unknown = new Error("No model configured (LLM_MODEL)");
  for (const model of models) {
    try {
      return await askOpenRouter(model, messages, tools);
    } catch (err) {
      console.error((err as Error).message); // server log only; the user gets a friendly message
      lastError = err;
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

export const callModel: ModelClient = (messages, tools) => (client ?? openRouterClient)(messages, tools);
