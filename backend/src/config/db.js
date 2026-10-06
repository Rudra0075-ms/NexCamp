import mongoose from "mongoose";
import { env } from "./env.js";

mongoose.set("strictQuery", true);

export async function connectDB() {
  const primaryUri = env.mongoUri || "mongodb://127.0.0.1:27018/campus-intelligence";

  try {
    const conn = await mongoose.connect(primaryUri, {
      serverSelectionTimeoutMS: 25000
    });
    const host = conn.connection.host || "mongodb";
    console.log(`MongoDB connected: ${host}`);
    return conn.connection;
  } catch (err) {
    console.error(`[MongoDB] Primary connection failed: ${err.message}`);

    // If remote Atlas connection had auth failure or connection failure, attempt local fallback
    if (primaryUri !== "mongodb://127.0.0.1:27018/campus-intelligence") {
      console.log("[MongoDB] Attempting fallback to local instance at mongodb://127.0.0.1:27018/campus-intelligence...");
      try {
        const fallback = await mongoose.connect("mongodb://127.0.0.1:27018/campus-intelligence", {
          serverSelectionTimeoutMS: 4000
        });
        console.log("MongoDB connected: 127.0.0.1 (local fallback)");
        return fallback.connection;
      } catch (fallbackErr) {
        console.error(`[MongoDB] Local fallback also failed: ${fallbackErr.message}`);
      }
    }
    throw err;
  }
}

export async function disconnectDB() {
  await mongoose.connection.close();
}

