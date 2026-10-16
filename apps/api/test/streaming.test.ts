import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proposeAction } from "../src/actions";
import { setModelForTests } from "../src/agent/llm";
import { createApp } from "../src/app";
import { createSessionToken } from "../src/auth";
import { config } from "../src/config";
import { initStore } from "../src/store";
import { signedIn } from "./helpers";

const app = createApp();

beforeEach(() => {
  initStore();
});
afterEach(() => {
  setModelForTests(null);
  vi.unstubAllGlobals();
  config.llm.apiKey = null;
  config.llm.model = null;
});

/** Sends a chat message and returns the [event, data] pairs of the SSE stream. */
async function chatEvents(message: string) {
  const res = await signedIn(app, "maya").post("/api/personas/maya/chat").send({ message }).expect(200);
  return res.text
    .trim()
    .split("\n\n")
    .map((block) => {
      const [e, d] = block.split("\n");
      return [e!.slice(7), JSON.parse(d!.slice(6))] as [string, any];
    });
}

describe("word-by-word chat", () => {
  it("each piece the model writes is sent on at once", async () => {
    setModelForTests(async (_m, _t, onText) => {
      for (const piece of ["Your ", "safe-to-spend ", "is $34.45."]) onText?.(piece);
      return { content: "Your safe-to-spend is $34.45.", toolCalls: [], model: "fake" };
    });
    const events = await chatEvents("How much can I spend?");
    expect(events.filter(([e]) => e === "text").map(([, d]) => d.delta)).toEqual(["Your ", "safe-to-spend ", "is $34.45."]);
  });

  it("text from a tool round and the final answer are separate paragraphs", async () => {
    let round = 0;
    setModelForTests(async (_m, _t, onText) => {
      if (round++ === 0) {
        onText?.("Let me check.");
        return { content: "Let me check.", toolCalls: [{ id: "c1", type: "function", function: { name: "get_overview", arguments: "{}" } }], model: "fake" };
      }
      onText?.("You're fine.");
      return { content: "You're fine.", toolCalls: [], model: "fake" };
    });
    const text = (await chatEvents("Am I ok?")).filter(([e]) => e === "text").map(([, d]) => d.delta).join("");
    expect(text).toBe("Let me check.\n\nYou're fine.");
  });
});

describe("OpenRouter stream reader (fake network)", () => {
  /** A fake OpenRouter response that arrives in awkward chunks (lines split in half). */
  function fakeStream(chunks: string[]) {
    const body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    return vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  }

  it("rebuilds text and a tool call from pieces, ignoring keep-alive comments", async () => {
    config.llm.apiKey = "test";
    config.llm.model = "fake/model";
    const line = (o: object) => `data: ${JSON.stringify(o)}\n\n`;
    // One piece of a tool call, e.g. piece({ id: "call_9", function: { name: "get_bills" } })
    const piece = (p: object) => ({ choices: [{ delta: { tool_calls: [{ index: 0, ...p }] } }] });
    const all =
      ": OPENROUTER PROCESSING\n\n" +
      line({ model: "fake/model", choices: [{ delta: { content: "Checking " } }] }) +
      line({ choices: [{ delta: { content: "bills." } }] }) +
      line(piece({ id: "call_9", function: { name: "get_bills", arguments: "" } })) +
      line(piece({ function: { arguments: '{"a"' } })) +
      line(piece({ function: { arguments: ":1}" } })) +
      "data: [DONE]\n\n";
    // Split mid-line on purpose, the way real network chunks arrive
    const fetchMock = fakeStream([all.slice(0, 37), all.slice(37, 150), all.slice(150)]);
    vi.stubGlobal("fetch", fetchMock);

    const { callModel } = await import("../src/agent/llm");
    const pieces: string[] = [];
    const reply = await callModel([{ role: "user", content: "hi" }], [], (d) => pieces.push(d));
    expect(pieces).toEqual(["Checking ", "bills."]);
    expect(reply).toEqual({
      content: "Checking bills.",
      toolCalls: [{ id: "call_9", type: "function", function: { name: "get_bills", arguments: '{"a":1}' } }],
      model: "fake/model",
    });
    // The request asked for a stream, and for providers that don't keep data
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent).toMatchObject({ stream: true, provider: { data_collection: "deny" } });
  });
});

describe("live timeline (GET /personas/:id/timeline)", () => {
  it("pushes an action event when one is created, and only to its owner", async () => {
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const controller = new AbortController();
    try {
      const res = await fetch(`http://localhost:${port}/api/personas/daniel/timeline`, {
        headers: { Cookie: `mandate_session=${createSessionToken("daniel")}` },
        signal: controller.signal,
      });
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Read until `needle` appears in the stream
      let received = "";
      const readUntil = async (needle: string) => {
        while (!received.includes(needle)) received += decoder.decode((await reader.read()).value);
      };

      await readUntil("event: ready");
      proposeAction("maya", { source: "agent", type: "payment", fromAccount: "checking", payee: "Mobi Telecom", amountCents: 3_500 }); // Maya's: not sent
      proposeAction("daniel", { source: "agent", type: "payment", fromAccount: "checking", payee: "CityPower", amountCents: 13_280 });
      await readUntil("Pay CityPower");

      expect(received).not.toMatch(/Mobi Telecom/);
      expect(received).toMatch(/event: action\ndata: \{"id":"act_2".*"status":"pending_approval"/);
    } finally {
      controller.abort();
      server.close();
    }
  });

  it("needs your own session", async () => {
    await signedIn(app, "maya").get("/api/personas/daniel/timeline").expect(403);
  });
});
