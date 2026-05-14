const fs = require('fs');
const content = fs.readFileSync('client/src/app/page.tsx', 'utf-8').split('\n');

// We want to replace lines 11 to 357 (0-indexed 10 to 356)
// Line 10 is: import { calculateRisk } ...
// Line 356 is: } // end DashboardData

const newContent = [
  ...content.slice(0, 10),
  `import {
  Stats, Position, Message, Log, LOG_LEVEL_FILTERS, getLogLevelBadgeClass, formatUsd,
  estimatePositionMargin, calculatePositionPnlUsd, resolvePositionPnlUsd, resolvePositionPnlPercent,
  formatCompactDateTime, getCompactDateTimeParts, formatMarginMode, getPositionSourceLabel,
  getPositionKey, formatPositionTakeProfitTargets, DraftTrade, DraftAction, AccountInfo,
  RiskConfig, CronStep, CronRunStatus, SignalConfig, AccountExchangeInfo, DashboardData
} from "@/components/dashboard/types";`,
  ...content.slice(357)
];

fs.writeFileSync('client/src/app/page.tsx', newContent.join('\n'));
