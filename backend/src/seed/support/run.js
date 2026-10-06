import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../../config/db.js";
import { assertEnv } from "../../config/env.js";
import { COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD, seedSupport } from "./index.js";

/** npm run seed:support — seeds only the Silent Support System demo data on an existing database. */
async function run() {
  assertEnv();
  await connectDB();
  const counts = await seedSupport();
  console.log("\nSilent Support seed complete:");
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(14)} ${value}`);
  console.log(`  support team  ${COUNSELLOR_EMAIL} / ${COUNSELLOR_PASSWORD}`);
  await disconnectDB();
}

run().catch(async (error) => {
  console.error("Silent Support seed failed:", error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
