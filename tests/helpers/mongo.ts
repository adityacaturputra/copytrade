import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  connectDB,
  disconnectDB,
  } from "../../shared/src/lib/database/index";

let mongoServer: MongoMemoryServer | null = null;

export async function startTestMongo(): Promise<string> {
  if (!mongoServer) {
    mongoServer = await MongoMemoryServer.create();
  }

  const uri = mongoServer.getUri("copytrade-test");
  process.env.MONGODB_URI = uri;
  await disconnectDB();
    await connectDB();
  return uri;
}

export async function clearTestMongo(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;

  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function stopTestMongo(): Promise<void> {
  await disconnectDB();
  
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}
