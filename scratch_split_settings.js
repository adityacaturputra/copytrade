const fs = require('fs');

const file = 'client/src/app/settings/page.tsx';
let content = fs.readFileSync(file, 'utf-8');

const lines = content.split('\n');

const typesStart = lines.findIndex(l => l.includes('// ─── Types ───────────────────────────────────────────────────'));
const typesEnd = lines.findIndex(l => l.includes('// ─── Component ──────────────────────────────────────────────'));

if (typesStart !== -1 && typesEnd !== -1) {
  const extractedLines = lines.slice(typesStart + 1, typesEnd);
  
  // Create types.ts
  const typesContent = `import { DEFAULT_ACCOUNT_EXCHANGE_PROVIDER, DEFAULT_EXCHANGE_PROVIDER, getExchangeProviderConfig, getExchangeProviderOptions } from "@copytrade/shared/lib/exchange/provider-config";
import { createEmptyExchangeFormValues, ExchangeFormValues, AccountExchangeData } from "./exchange-form";
import { getStoredActionPassword } from "@/lib/action-auth";

` + extractedLines.join('\n').replace(/function/g, 'export function').replace(/interface/g, 'export interface').replace(/type/g, 'export type').replace(/const/g, 'export const');

  fs.writeFileSync('client/src/app/settings/types.ts', typesContent);
  
  // Replace in page.tsx
  const newLines = [
    ...lines.slice(0, typesStart),
    `import { AccountData, HealthStatus, AutoRaiseOverrideMode, ChannelEntry, AccountFormData, createEmptyAccountForm, RiskConfig, defaultRiskConfig, SignalConfigType, defaultSignalConfig, RECOMMENDED_SCHEDULES, EXCHANGE_PROVIDER_OPTIONS, getTradingPlatformConfig, parseOptionalPositiveNumber, parseOptionalNonNegativeNumber, formatOptionalNumber, toAutoRaiseOverrideMode, withActionPassword } from "./types";`,
    ...lines.slice(typesEnd)
  ];
  
  fs.writeFileSync(file, newLines.join('\n'));
}
