import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../../config/db.js";
import { assertEnv } from "../../config/env.js";
import { seedExceptionOnly } from "./index.js";
import { flushEvents } from "../../services/xo/eventService.js";

/** npm run seed:xo — seeds only the Exception-Only Campus additions, on top of the base + extension seed. */
async function run() {
  assertEnv();
  await connectDB();
  const counts = await seedExceptionOnly();
  await flushEvents();
  console.log("\nException-only seed complete:");
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(18)} ${value}`);
  await disconnectDB();
}

run().catch(async (error) => {
  console.error("Exception-only seed failed:", error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
