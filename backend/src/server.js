import { connectDB } from "./config/db.js";
import { assertEnv, env } from "./config/env.js";
import { createApp } from "./app.js";
import { startGatePassMonitor, stopGatePassMonitor } from "./services/gatePassService.js";
// EXTENSION HOOK (see HOOKS.md): notice digest / escalation / reminder timer.
import { startExtensionMonitor, stopExtensionMonitor } from "./services/ext/extMonitor.js";

async function start() {
  assertEnv();

  await connectDB();
  console.log("MongoDB connected");

  // CAMPUS RESOURCE SHARING: seed demo resources if collection empty
  try {
    const { seedResources } = await import("./seed/resourceSeed.js");
    await seedResources();
  } catch (seedErr) {
    console.warn("Campus resources auto-seed skipped:", seedErr.message);
  }

  const app = createApp();

  // Server-side clock for gate passes: raises the five-minute return warning
  // and the overdue alarm whether or not anybody has a browser tab open.
  startGatePassMonitor();
  startExtensionMonitor(); // EXTENSION HOOK

  const server = app.listen(env.port, () => {
    console.log(`NeX Camp API listening on http://localhost:${env.port}`);
    console.log(`CORS allows: ${env.clientUrls.join(", ")}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received — shutting down`);
    stopGatePassMonitor();
    stopExtensionMonitor(); // EXTENSION HOOK
    server.close(async () => {
      const { disconnectDB } = await import("./config/db.js");
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error) => {
  console.error("Failed to start:", error.message);
  process.exit(1);
});
