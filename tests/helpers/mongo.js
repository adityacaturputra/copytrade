"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTestMongo = startTestMongo;
exports.clearTestMongo = clearTestMongo;
exports.stopTestMongo = stopTestMongo;
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_memory_server_1 = require("mongodb-memory-server");
const database_1 = require("../../shared/src/lib/database");
let mongoServer = null;
async function startTestMongo() {
    if (!mongoServer) {
        mongoServer = await mongodb_memory_server_1.MongoMemoryServer.create();
    }
    const uri = mongoServer.getUri("copytrade-test");
    process.env.MONGODB_URI = uri;
    await (0, database_1.disconnectDB)();
    (0, database_1.resetDBConnectionState)();
    await (0, database_1.connectDB)();
    return uri;
}
async function clearTestMongo() {
    const db = mongoose_1.default.connection.db;
    if (!db)
        return;
    const collections = await db.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
async function stopTestMongo() {
    await (0, database_1.disconnectDB)();
    (0, database_1.resetDBConnectionState)();
    if (mongoServer) {
        await mongoServer.stop();
        mongoServer = null;
    }
}
//# sourceMappingURL=mongo.js.map