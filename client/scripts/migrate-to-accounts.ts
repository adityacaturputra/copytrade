// Migration: DiscordSource → Account
// Run with: npx tsx scripts/migrate-to-accounts.ts
//
// What this does:
// 1. Creates Account documents from existing DiscordSource documents
// 2. Sets exchange credentials (OKX by default) on each account
// 3. Updates existing Position documents with the accountId they belong to

import mongoose from "mongoose";
import { loadClientEnv } from "./load-env";

// Load .env
loadClientEnv();

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/copytrade";

// Default OKX exchange credentials (from .env before cleanup)
const DEFAULT_EXCHANGE = {
  provider: "okx",
  apiKey: process.env.OKX_API_KEY || "f394bb7f-b6ab-4bf6-896a-e8d47e947fe0",
  secretKey: process.env.OKX_SECRET_KEY || "06D8C94CB43E71848BE341376B4D27D4",
  passphrase: process.env.OKX_PASSPHRASE || "*Dityablast1412",
  isDemo: process.env.OKX_SIMULATED !== "false", // default true
};

// Minimal schemas for migration
const DiscordSourceSchema = new mongoose.Schema(
  {
    name: String,
    method: { type: String, default: "bot" },
    token: String,
    refreshToken: String,
    channelIds: [String],
    channelNames: { type: Map, of: String },
    disabledChannelIds: [String],
    autoRefresh: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    lastFetchedAt: Date,
    lastError: String,
    tokenExpiresAt: Date,
  },
  { timestamps: true },
);

const AccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sourceType: { type: String, default: "discord" },
    sourceData: mongoose.Schema.Types.Mixed,
    channelIds: [String],
    channelNames: { type: Map, of: String },
    disabledChannelIds: [String],
    tradingPlatform: { type: String, default: "okx" },
    exchangeData: mongoose.Schema.Types.Mixed,
    isActive: { type: Boolean, default: true },
    lastFetchedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

const PositionSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
    status: String,
    symbol: String,
    side: String,
  },
  { strict: false, timestamps: true },
);

const DiscordSource = mongoose.model("DiscordSource", DiscordSourceSchema);
const Account = mongoose.model("Account", AccountSchema);
const Position = mongoose.model("Position", PositionSchema);

async function migrate() {
  console.log("🚀 Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected");

  // ─── Step 1: Migrate DiscordSource → Account ────────────────────────
  const sources = await DiscordSource.find().lean();
  console.log(`📡 Found ${sources.length} Discord sources to migrate`);

  let migratedCount = 0;

  for (const source of sources) {
    // Check if already migrated
    const existing = await Account.findOne({
      name: source.name,
      sourceType: "discord",
      "sourceData.token": source.token,
    });

    if (existing) {
      console.log(
        `⏭️  Already migrated: ${source.name} → Account ${existing._id}`,
      );

      // Update exchange data if missing
      if (!existing.exchangeData?.apiKey) {
        existing.exchangeData = {
          apiKey: DEFAULT_EXCHANGE.apiKey,
          secretKey: DEFAULT_EXCHANGE.secretKey,
          passphrase: DEFAULT_EXCHANGE.passphrase,
          simulated: DEFAULT_EXCHANGE.isDemo,
        };
        existing.tradingPlatform = DEFAULT_EXCHANGE.provider;
        await existing.save();
        console.log(`   ↳ Updated exchange credentials for ${source.name}`);
      }
      continue;
    }

    const account = await Account.create({
      name: source.name,
      sourceType: "discord",
      sourceData: {
        method: source.method,
        token: source.token,
        refreshToken: source.refreshToken,
        autoRefresh: source.autoRefresh,
        tokenExpiresAt: source.tokenExpiresAt,
      },
      channelIds: source.channelIds,
      channelNames: source.channelNames
        ? source.channelNames instanceof Map
          ? Object.fromEntries(source.channelNames)
          : source.channelNames
        : {},
      disabledChannelIds: source.disabledChannelIds || [],
      tradingPlatform: DEFAULT_EXCHANGE.provider,
      exchangeData: {
        apiKey: DEFAULT_EXCHANGE.apiKey,
        secretKey: DEFAULT_EXCHANGE.secretKey,
        passphrase: DEFAULT_EXCHANGE.passphrase,
        simulated: DEFAULT_EXCHANGE.isDemo,
      },
      isActive: source.isActive,
      lastFetchedAt: source.lastFetchedAt,
      lastError: source.lastError,
    });

    console.log(
      `✅ Migrated: ${source.name} → Account ${account._id} (${source.channelIds?.length || 0} channels, exchange: ${DEFAULT_EXCHANGE.provider})`,
    );
    migratedCount++;
  }

  // ─── Step 2: Update existing positions with accountId ───────────────
  const accounts = await Account.find().lean();

  if (accounts.length > 0) {
    // Positions without accountId — assign to the first active account
    const defaultAccount = accounts.find((a) => a.isActive) || accounts[0];

    const positionsWithoutAccount = await Position.find({
      accountId: { $exists: false },
    });

    if (positionsWithoutAccount.length > 0) {
      const updateResult = await Position.updateMany(
        { accountId: { $exists: false } },
        { $set: { accountId: defaultAccount._id } },
      );

      console.log(
        `\n🔗 Updated ${updateResult.modifiedCount} positions → Account ${defaultAccount.name} (${defaultAccount._id})`,
      );
    } else {
      console.log("\n✅ All positions already have accountId");
    }
  } else {
    console.log(
      "\n⚠️  No accounts found — skipping position accountId assignment",
    );
  }

  // ─── Summary ────────────────────────────────────────────────────────
  const totalAccounts = await Account.countDocuments();
  const totalPositions = await Position.countDocuments({
    accountId: { $exists: true },
  });

  console.log("\n🎉 Migration complete!");
  console.log(`   Accounts: ${totalAccounts}`);
  console.log(`   Positions with accountId: ${totalPositions}`);
  console.log(
    "💡 Old DiscordSource data is preserved. You can delete it after verifying.",
  );

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
