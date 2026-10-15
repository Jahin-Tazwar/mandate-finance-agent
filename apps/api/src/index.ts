import { createApp } from "./app";
import { config } from "./config";
import { initStore } from "./store";

// Load the seed data first: if a CSV row is invalid, stop with a clear list of problems
// instead of starting a server that serves broken data.
try {
  const state = initStore();

  // e.g. "Loaded 3 personas and 757 transactions from .../data/seed"
  const txCount = [...state.transactions.values()].reduce((n, list) => n + list.length, 0);
  console.log(`Loaded ${state.personas.size} personas and ${txCount} transactions from ${config.seedDir}`);
} catch (err) {
  // Reject: bad seed data. Print every problem and stop (exit code 1 = failed)
  console.error((err as Error).message);
  process.exit(1);
}

// Loud reminders for development-only switches, so they're never left on by accident
if (config.authDisabled) console.warn("WARNING: AUTH_DISABLED=true: requests without a session are let through.");
if (config.llm.allowProviderTraining) {
  console.warn("WARNING: LLM_ALLOW_PROVIDER_TRAINING=true: AI providers may keep prompts. Development only.");
}

// Data is loaded: start answering requests
createApp().listen(config.port, () => {
  console.log(`Mandate API listening on http://localhost:${config.port}`);
});
