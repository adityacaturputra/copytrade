require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const res = await db.collection('drafttrades').updateMany(
    { symbol: 'SUIUSDT' },
    { $set: { instrumentLotSize: 0.1, minOrderQty: 0.1, minOrderMarginUsdt: 5.0 } }
  );
  console.log("Updated", res.modifiedCount, "documents");
  process.exit(0);
}
main().catch(console.error);
