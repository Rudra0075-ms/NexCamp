import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../../config/db.js";
import { assertEnv } from "../../config/env.js";
import { flushEvents } from "../../services/xo/eventService.js";
import { seedProof } from "./index.js";

/** npm run seed:proof — seeds only the Round 3 demo data, on top of the base + extension + exception-only seed. */
async function run() {
  assertEnv();
  await connectDB();
  const counts = await seedProof();
  await flushEvents();
  console.log("\nRound 3 seed complete:");
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(30)} ${value}`);
  await disconnectDB();
}

run().catch(async (error) => {
  console.error("Round 3 seed failed:", error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
