import type { DraftAction, DraftTrade, RiskConfig } from '../types';

export interface DraftCardProps {
  draft: DraftTrade;
  acting: boolean;
  onDraftAction: (
    id: string,
    action: DraftAction,
    extraBody?: Record<string, unknown>,
  ) => void;
  riskConfig: RiskConfig | null;
  accountBalance: number;
  refreshKey: number;
}

export interface ResolvedStyle {
  icon: string;
  borderColor: string;
  bgColor: string;
}
