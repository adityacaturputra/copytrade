import sys

with open("client/src/app/page.tsx", "r") as f:
    content = f.read()

# 1. InlineLogDetails
old_render_log = """function renderStructuredLogDetails(details?: string) {
  if (!details) return null;

  try {
    const parsed = JSON.parse(details);
    return (
      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950/70 p-3 text-[11px] text-slate-300">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  } catch {
    return (
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
        {details}
      </p>
    );
  }
}"""
new_inline_log = """function InlineLogDetails({ text }: { text?: string | null }) {
  if (!text) return null;

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");

  let startIndex = -1;
  let endIndex = -1;

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    startIndex = firstBrace;
    endIndex = lastBrace;
  } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    startIndex = firstBracket;
    endIndex = lastBracket;
  }

  if (startIndex !== -1 && endIndex !== -1) {
    const possibleJson = text.slice(startIndex, endIndex + 1);
    try {
      const obj = JSON.parse(possibleJson);
      const formatted = JSON.stringify(obj, null, 2);
      const prefix = text.slice(0, startIndex);
      const suffix = text.slice(endIndex + 1);

      return (
        <span className="break-words">
          {prefix}
          <span className="relative group cursor-help inline-flex items-center mx-1 z-10 align-middle">
            <span className="bg-emerald-950/40 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded border border-emerald-900/50 hover:bg-emerald-900/50 transition-colors whitespace-nowrap">
              ...{'{ }'} JSON
            </span>
            <span className="absolute z-[100] hidden group-hover:block bg-[#0D1117] text-slate-300 text-[10px] p-3 rounded-lg border border-slate-600 shadow-2xl min-w-[250px] max-w-[85vw] md:max-w-[600px] bottom-full left-0 sm:left-1/2 sm:-translate-x-1/2 mb-2 pointer-events-none whitespace-pre-wrap leading-relaxed max-h-[40vh] overflow-y-auto text-left">
              {formatted}
            </span>
          </span>
          {suffix}
        </span>
      );
    } catch {
      // not valid json
    }
  }

  return <span className="break-words">{text}</span>;
}"""
content = content.replace(old_render_log, new_inline_log)

# 2. Process Logs
old_logs = """                <div key={log._id || log.id} className="hover:bg-slate-800/30 px-1 -mx-1 rounded transition-colors grid grid-cols-[140px_10px_60px_10px_140px_10px_180px_20px_1fr] gap-1 items-start">
                  <span className="text-slate-500 truncate">{dateStr}</span>
                  <span className="text-slate-700 text-center">|</span>
                  <span className={`${getTerminalColor(levelText)} font-bold truncate`}>{levelText || "INFO"}</span>
                  <span className="text-slate-700 text-center">|</span>
                  <span className="text-fuchsia-400 truncate" title={log.type}>{log.type}</span>
                  <span className="text-slate-700 text-center">|</span>
                  <span className="text-slate-300 truncate" title={log.action}>{log.action}</span>
                  <span className="text-slate-700 text-center">---</span>
                  <span className="text-slate-400 break-words">
                    {log.details}
                    {log.error && <span className="text-red-400 ml-1">Error: {log.error}</span>}
                    {log.symbol && <span className="text-primary-400 ml-1">[{log.symbol}]</span>}
                  </span>
                </div>"""
new_logs = """                <div key={log._id || log.id} className="hover:bg-slate-800/30 p-2 sm:px-1 sm:py-0 -mx-1 rounded transition-colors flex flex-col gap-1 sm:grid sm:grid-cols-[140px_10px_60px_10px_140px_10px_180px_20px_1fr] sm:items-start border-b border-slate-800/50 sm:border-none">
                  {/* Mobile Header */}
                  <div className="flex items-center gap-2 sm:hidden text-xs">
                    <span className="text-slate-500">{dateStr}</span>
                    <span className="text-slate-700">|</span>
                    <span className={`${getTerminalColor(levelText)} font-bold`}>{levelText || "INFO"}</span>
                  </div>
                  <div className="flex items-center gap-2 sm:hidden text-[11px]">
                    <span className="text-fuchsia-400 truncate">{log.type}</span>
                    <span className="text-slate-700">|</span>
                    <span className="text-slate-300 truncate">{log.action}</span>
                  </div>

                  {/* Desktop Columns */}
                  <span className="hidden sm:inline text-slate-500 truncate">{dateStr}</span>
                  <span className="hidden sm:inline text-slate-700 text-center">|</span>
                  <span className={`hidden sm:inline ${getTerminalColor(levelText)} font-bold truncate`}>{levelText || "INFO"}</span>
                  <span className="hidden sm:inline text-slate-700 text-center">|</span>
                  <span className="hidden sm:inline text-fuchsia-400 truncate" title={log.type}>{log.type}</span>
                  <span className="hidden sm:inline text-slate-700 text-center">|</span>
                  <span className="hidden sm:inline text-slate-300 truncate" title={log.action}>{log.action}</span>
                  <span className="hidden sm:inline text-slate-700 text-center">---</span>
                  
                  {/* Detail Body */}
                  <span className="text-slate-400 mt-1 sm:mt-0 leading-relaxed break-words">
                    <InlineLogDetails text={log.details} />
                    {log.error && <span className="text-red-400 ml-1 block sm:inline mt-1 sm:mt-0">Error: {log.error}</span>}
                    {log.symbol && <span className="text-primary-400 ml-1 block sm:inline mt-1 sm:mt-0">[{log.symbol}]</span>}
                  </span>
                </div>"""
content = content.replace(old_logs, new_logs)

# 3. Invocation
old_invoke = """          {activeTab === "positions" && (
            <PositionsTab
              channelIdFilter={selectedChannelId}
              accountIdFilter={selectedAccountId}
              refreshKey={refreshKey}
            />
          )}"""
new_invoke = """          {activeTab === "positions" && (
            <PositionsTab
              channelIdFilter={selectedChannelId}
              accountIdFilter={selectedAccountId}
              refreshKey={refreshKey}
              livePositions={data?.openPositions || []}
            />
          )}"""
content = content.replace(old_invoke, new_invoke)

# 4. PositionsTab definition
old_def = """function PositionsTab({
  channelIdFilter,
  accountIdFilter,
  refreshKey,
}: {
  channelIdFilter: string;
  accountIdFilter: string;
  refreshKey: number;
}) {"""
new_def = """function PositionsTab({
  channelIdFilter,
  accountIdFilter,
  refreshKey,
  livePositions = [],
}: {
  channelIdFilter: string;
  accountIdFilter: string;
  refreshKey: number;
  livePositions?: Position[];
}) {"""
content = content.replace(old_def, new_def)

# 5. The Map block inside PositionsTab
old_table_block = """      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Entry</th>
                {positionFilter === "open" && <th>Current</th>}
                <th>Qty</th>
                <th>Leverage</th>
                <th>PnL</th>
                {positionFilter === "closed" && <th>Close Reason</th>}
                {positionFilter === "pending" && <th>Status</th>}
                <th>Opened</th>
                {positionFilter === "closed" && <th>Closed</th>}
                <th className="text-right">Logs</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <Fragment key={pos._id || pos.id}>
                  <tr
                    className={positionFilter === "pending" ? "opacity-80 border-b border-slate-700/50" : "border-b border-slate-700/50"}
                  >
                    <td className="font-medium">{pos.symbol}</td>
                    <td>
                      <span
                        className={`badge ${pos.side === "LONG" ? "badge-success" : "badge-danger"}`}
                      >
                        {pos.side}
                      </span>
                    </td>
                    <td>{pos.entryPrice?.toFixed(4)}</td>
                    {positionFilter === "open" && (
                      <td>{pos.currentPrice?.toFixed(4) || "-"}</td>
                    )}
                    <td>{pos.quantity}</td>
                    <td>{pos.leverage}x</td>
                    <td
                      className={`font-mono ${(pos.pnl || 0) >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {(pos.pnl || 0) >= 0 ? "+" : ""}
                      {pos.pnl?.toFixed(2) || "0.00"}
                    </td>
                    {positionFilter === "closed" && (
                      <td className="text-xs text-slate-400 relative group cursor-help">
                        <span className="max-w-[120px] truncate block">
                          {pos.closeReason || "-"}
                        </span>
                        {pos.closeReason && (
                          <div className="absolute z-[100] hidden group-hover:block bg-slate-800 text-slate-200 text-[10px] p-2 rounded-lg border border-slate-600 shadow-2xl min-w-[200px] bottom-full left-0 mb-1 pointer-events-none whitespace-normal leading-relaxed">
                            {pos.closeReason}
                          </div>
                        )}
                      </td>
                    )}
                    {positionFilter === "pending" && (
                      <td>
                        <span className="inline-flex items-center gap-1.5 badge badge-warning">
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                          Pending
                        </span>
                      </td>
                    )}
                    <td className="text-xs text-slate-400">
                      {new Date(pos.openedAt).toLocaleString()}
                    </td>
                    {positionFilter === "closed" && (
                      <td className="text-xs text-slate-400">
                        {pos.closedAt
                          ? new Date(pos.closedAt).toLocaleString()
                          : "-"}
                      </td>
                    )}
                    <td className="text-right">
                      <button
                        onClick={() =>
                          setExpandedPosId(
                            expandedPosId === (pos._id || String(pos.id))
                              ? null
                              : pos._id || String(pos.id),
                          )
                        }
                        className={`text-[10px] px-2 py-1 rounded transition-colors ${
                          expandedPosId === (pos._id || String(pos.id))
                            ? "bg-slate-700 text-white"
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                        }`}
                      >
                        {expandedPosId === (pos._id || String(pos.id))
                          ? "▼ Hide"
                          : "▶ Logs"}
                      </button>
                    </td>
                  </tr>
                  {expandedPosId === (pos._id || String(pos.id)) && (
                    <tr>
                      <td colSpan={100} className="p-0 border-none bg-slate-900/10">
                        <div className="px-4 py-2">
                          <ProcessLogsAccordion
                            processId={pos.processId}
                            refreshKey={refreshKey}
                            hideHeader={true}
                            defaultOpen={true}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )"""

new_table_block = """      ) : (
        <>
          {/* Mobile Card View */}
          <div className="sm:hidden flex flex-col gap-3 pb-4">
            {positions.map((pos) => {
              let displayPnl = pos.pnl || 0;
              let displayCurrentPrice = pos.currentPrice || pos.entryPrice;
              
              if (pos.status === "open" && livePositions.length > 0) {
                const livePos = livePositions.find(
                  (lp) => (lp._id || lp.id) === (pos._id || pos.id),
                );
                if (livePos) {
                  displayPnl = livePos.pnl || 0;
                  displayCurrentPrice = livePos.currentPrice || livePos.entryPrice;
                }
              }

              const pnlPercent =
                displayCurrentPrice && pos.entryPrice && pos.entryPrice > 0
                  ? ((displayCurrentPrice - pos.entryPrice) / pos.entryPrice) *
                    100 *
                    pos.leverage *
                    (pos.side === "LONG" ? 1 : -1)
                  : 0;

              const isExpanded = expandedPosId === (pos._id || String(pos.id));

              return (
                <div
                  key={`mobile-${pos._id || pos.id}`}
                  className="bg-slate-800/40 rounded-lg border border-slate-700/50 p-3"
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-200">{pos.symbol}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          pos.side === "LONG"
                            ? "bg-emerald-950 text-emerald-400"
                            : "bg-red-950 text-red-400"
                        }`}
                      >
                        {pos.side}
                      </span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${getStatusColor(pos.status)}`}>
                      {pos.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase">Entry</span>
                      <span className="text-xs font-mono text-slate-300">
                        {pos.entryPrice?.toFixed(4) || "-"}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase">Qty</span>
                      <span className="text-xs font-mono text-slate-300">{pos.quantity}</span>
                    </div>
                    <div className="bg-slate-900/50 rounded p-1.5 flex flex-col">
                      <span className="text-[9px] text-slate-500 uppercase">PNL</span>
                      <div className={`text-xs font-mono font-bold ${
                        displayPnl > 0 ? "text-emerald-400" : displayPnl < 0 ? "text-red-400" : "text-slate-400"
                      }`}>
                        {displayPnl > 0 ? "+" : ""}
                        {displayPnl.toFixed(2)}
                        <span className="text-[9px] ml-1 opacity-80 font-normal">
                          ({displayPnl > 0 ? "+" : ""}{pnlPercent.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 mb-3 text-[10px] text-slate-500">
                    <div className="flex justify-between">
                      <span>Opened</span>
                      <span>{new Date(pos.openedAt).toLocaleString()}</span>
                    </div>
                    {pos.closedAt && (
                      <div className="flex justify-between">
                        <span>Closed</span>
                        <span>{new Date(pos.closedAt).toLocaleString()}</span>
                      </div>
                    )}
                    {pos.closeReason && (
                      <div className="bg-slate-900/50 p-1.5 rounded mt-1 border border-slate-700/50 relative group">
                        <span className="text-[9px] text-slate-500 uppercase block mb-0.5">Close Reason</span>
                        <span className="text-slate-400 block truncate">{pos.closeReason}</span>
                        <div className="absolute z-[100] hidden active:block sm:group-hover:block bg-slate-800 text-slate-200 text-[10px] p-2 rounded-lg border border-slate-600 shadow-2xl min-w-[200px] bottom-full left-0 mb-1 whitespace-normal leading-relaxed">
                          {pos.closeReason}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() =>
                      setExpandedPosId(isExpanded ? null : (pos._id || String(pos.id)))
                    }
                    className={`w-full text-xs py-1.5 rounded transition-colors flex items-center justify-center gap-1 ${
                      isExpanded
                        ? "bg-slate-700 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {isExpanded ? "▲ Hide Logs" : "▶ View Logs"}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 bg-slate-900/80 rounded-lg p-2 border border-slate-700/50 w-full overflow-hidden">
                      <ProcessLogsAccordion
                        processId={pos.processId}
                        refreshKey={refreshKey}
                        hideHeader={true}
                        defaultOpen={true}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Entry</th>
                  {positionFilter === "open" && <th>Current</th>}
                  <th>Qty</th>
                  <th>Leverage</th>
                  <th>PnL</th>
                  {positionFilter === "closed" && <th>Close Reason</th>}
                  {positionFilter === "pending" && <th>Status</th>}
                  <th>Opened</th>
                  {positionFilter === "closed" && <th>Closed</th>}
                  <th className="text-right">Logs</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  let displayPnl = pos.pnl || 0;
                  let displayCurrentPrice = pos.currentPrice || pos.entryPrice;
                  
                  if (pos.status === "open" && livePositions.length > 0) {
                    const livePos = livePositions.find(
                      (lp) => (lp._id || lp.id) === (pos._id || pos.id),
                    );
                    if (livePos) {
                      displayPnl = livePos.pnl || 0;
                      displayCurrentPrice = livePos.currentPrice || livePos.entryPrice;
                    }
                  }

                  const pnlPercent =
                    displayCurrentPrice && pos.entryPrice && pos.entryPrice > 0
                      ? ((displayCurrentPrice - pos.entryPrice) / pos.entryPrice) *
                        100 *
                        pos.leverage *
                        (pos.side === "LONG" ? 1 : -1)
                      : 0;

                  return (
                    <Fragment key={`desktop-${pos._id || pos.id}`}>
                      <tr
                        className={positionFilter === "pending" ? "opacity-80 border-b border-slate-700/50" : "border-b border-slate-700/50"}
                      >
                        <td className="font-medium">{pos.symbol}</td>
                        <td>
                          <span
                            className={`badge ${pos.side === "LONG" ? "badge-success" : "badge-danger"}`}
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td>{pos.entryPrice?.toFixed(4)}</td>
                        {positionFilter === "open" && (
                          <td>{displayCurrentPrice?.toFixed(4) || "-"}</td>
                        )}
                        <td>{pos.quantity}</td>
                        <td>{pos.leverage}x</td>
                        <td
                          className={`font-mono flex items-center gap-1.5 ${displayPnl >= 0 ? "text-success" : "text-danger"}`}
                        >
                          <span>
                            {displayPnl >= 0 ? "+" : ""}
                            {displayPnl.toFixed(2)}
                          </span>
                          {positionFilter === "open" && (
                            <span className="text-[10px] opacity-80">
                              ({displayPnl >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%)
                            </span>
                          )}
                        </td>
                        {positionFilter === "closed" && (
                          <td className="text-xs text-slate-400 relative group cursor-help">
                            <span className="max-w-[120px] truncate block">
                              {pos.closeReason || "-"}
                            </span>
                            {pos.closeReason && (
                              <div className="absolute z-[100] hidden group-hover:block bg-slate-800 text-slate-200 text-[10px] p-2 rounded-lg border border-slate-600 shadow-2xl min-w-[200px] bottom-full left-0 mb-1 pointer-events-none whitespace-normal leading-relaxed">
                                {pos.closeReason}
                              </div>
                            )}
                          </td>
                        )}
                        {positionFilter === "pending" && (
                          <td>
                            <span className="inline-flex items-center gap-1.5 badge badge-warning">
                              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                              Pending
                            </span>
                          </td>
                        )}
                        <td className="text-xs text-slate-400">
                          {new Date(pos.openedAt).toLocaleString()}
                        </td>
                        {positionFilter === "closed" && (
                          <td className="text-xs text-slate-400">
                            {pos.closedAt
                              ? new Date(pos.closedAt).toLocaleString()
                              : "-"}
                          </td>
                        )}
                        <td className="text-right">
                          <button
                            onClick={() =>
                              setExpandedPosId(
                                expandedPosId === (pos._id || String(pos.id))
                                  ? null
                                  : pos._id || String(pos.id),
                              )
                            }
                            className={`text-[10px] px-2 py-1 rounded transition-colors ${
                              expandedPosId === (pos._id || String(pos.id))
                                ? "bg-slate-700 text-white"
                                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                            }`}
                          >
                            {expandedPosId === (pos._id || String(pos.id))
                              ? "▼ Hide"
                              : "▶ Logs"}
                          </button>
                        </td>
                      </tr>
                      {expandedPosId === (pos._id || String(pos.id)) && (
                        <tr>
                          <td colSpan={100} className="p-0 border-none bg-slate-900/10">
                            <div className="px-4 py-2">
                              <ProcessLogsAccordion
                                processId={pos.processId}
                                refreshKey={refreshKey}
                                hideHeader={true}
                                defaultOpen={true}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )"""
content = content.replace(old_table_block, new_table_block)

with open("client/src/app/page.tsx", "w") as f:
    f.write(content)
print("Patch applied")
