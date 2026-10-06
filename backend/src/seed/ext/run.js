import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../../config/db.js";
import { assertEnv } from "../../config/env.js";
import { seedExtensions } from "./index.js";

/** npm run seed:ext — seeds only the extension pack, on top of the base seed. */
async function run() {
  assertEnv();
  await connectDB();
  const counts = await seedExtensions();
  console.log("\nExtension seed complete:");
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(16)} ${value}`);
  await disconnectDB();
}

run().catch(async (error) => {
  console.error("Extension seed failed:", error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
