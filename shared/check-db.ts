import mongoose from "mongoose";

async function run() {
  await mongoose.connect("mongodb://127.0.0.1:27017/copytrade_dev");
  const db = mongoose.connection;
  const col = db.collection("proxysettings");
  const data = await col.findOne({});
  console.log("DB DATA:", JSON.stringify(data, null, 2));
  process.exit(0);
}
run();
