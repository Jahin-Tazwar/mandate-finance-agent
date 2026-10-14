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

// Data is loaded: start answering requests
createApp().listen(config.port, () => {
  console.log(`Mandate API listening on http://localhost:${config.port}`);
});
