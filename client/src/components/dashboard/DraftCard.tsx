import React, { useState } from 'react';
import { buildAutoTpPreview, getResolvedStyle, getTpMinimums, parseDraftSignal } from './draft-card/helpers';
import { PendingDraftActions, ResolvedDraftActions } from './draft-card/DraftCardActions';
import { DraftCardDetails } from './draft-card/DraftCardDetails';
import { DraftCardFooter } from './draft-card/DraftCardFooter';
import { DraftCardHeader } from './draft-card/DraftCardHeader';
import { DraftCardMetrics } from './draft-card/DraftCardMetrics';
import { DraftCardRrEditor } from './draft-card/DraftCardRrEditor';
import { DraftCardTpMargin } from './draft-card/DraftCardTpMargin';
import { DraftCardTpTargets } from './draft-card/DraftCardTpTargets';
import type { DraftCardProps } from './draft-card/types';

export function DraftCard({
  draft,
  acting,
  onDraftAction,
  riskConfig,
  accountBalance,
  refreshKey,
}: DraftCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [customRR, setCustomRR] = useState<number>(3);
  const isPending = draft.status === 'pending';
  const isResolved = !isPending;
  const [isExpanded, setIsExpanded] = useState(isPending);

  const hasNoTP = !draft.takeProfitTargets || draft.takeProfitTargets.length === 0;
  const canCalcTPFromRR = hasNoTP && !!draft.entryPrice && draft.entryPrice > 0 && !!draft.stopLoss;
  const autoTPs = buildAutoTpPreview(draft, customRR);
  const { orderType, parsedSignalData } = parseDraftSignal(draft.signalData);
  const resolvedStyle = getResolvedStyle(draft.status);
  const {
    tpCount,
    tpMinQty,
    tpMinMarginUsdt,
    minOrderQty,
    minOrderMarginUsdt,
    riskLeverage,
  } = getTpMinimums(
    draft,
    riskConfig,
    accountBalance,
  );

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        isPending
          ? 'border-amber-700/50 bg-amber-950/20'
          : `${resolvedStyle.borderColor} ${resolvedStyle.bgColor}`
      }`}
    >
      <DraftCardHeader
        draft={draft}
        isPending={isPending}
        isResolved={isResolved}
        isExpanded={isExpanded}
        resolvedStyle={resolvedStyle}
        orderType={orderType}
        onToggle={() => setIsExpanded((prev) => !prev)}
      />

      {isExpanded && (
        <div className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
            <div className="flex-1 min-w-0">
              <DraftCardMetrics draft={draft} />
              <DraftCardTpTargets
                takeProfitTargets={draft.takeProfitTargets}
                tpCloseMode={riskConfig?.tpCloseMode}
              />

              {canCalcTPFromRR && isPending && (
                <DraftCardRrEditor
                  customRR={customRR}
                  setCustomRR={setCustomRR}
                  autoTPs={autoTPs}
                />
              )}

              <DraftCardTpMargin
                tpCount={tpCount}
                tpMinQty={tpMinQty}
                tpMinMarginUsdt={tpMinMarginUsdt}
                minOrderQty={minOrderQty}
                minOrderMarginUsdt={minOrderMarginUsdt}
                riskLeverage={riskLeverage}
              />

              {draft.reasoning && (
                <p className="text-slate-300 text-sm bg-slate-800/50 rounded p-2 mb-3">
                  💡 {draft.reasoning}
                </p>
              )}
            </div>

            {isPending ? (
              <PendingDraftActions
                draft={draft}
                acting={acting}
                customRR={customRR}
                canCalcTPFromRR={canCalcTPFromRR}
                onDraftAction={onDraftAction}
              />
            ) : (
              <ResolvedDraftActions
                draft={draft}
                acting={acting}
                onDraftAction={onDraftAction}
              />
            )}
          </div>

          <DraftCardFooter
            author={draft.author}
            sourceTimestamp={draft.sourceTimestamp}
            messageUrl={draft.messageUrl}
            showDetails={showDetails}
            setShowDetails={setShowDetails}
            processId={draft.processId}
            refreshKey={refreshKey}
          />
        </div>
      )}

      {isExpanded && (
        <DraftCardDetails
          showDetails={showDetails}
          imageUrls={draft.imageUrls}
          originalContent={draft.originalContent}
          parsedSignalData={parsedSignalData}
          signalData={draft.signalData}
          modalIndex={modalIndex}
          setModalIndex={setModalIndex}
        />
      )}
    </div>
  );
}
