export function DraftCardRrEditor({
  customRR,
  setCustomRR,
  autoTPs,
}: {
  customRR: number;
  setCustomRR: (value: number) => void;
  autoTPs: number[];
}) {
  return (
    <div className="rounded-lg p-3 mb-3 text-xs bg-blue-900/20 border border-blue-700/30">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
        <span className="font-semibold text-blue-300">📐 No TP — Set RR (Risk-Reward)</span>
        <div className="flex flex-wrap items-center gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rr) => (
            <button
              key={rr}
              onClick={() => setCustomRR(rr)}
              className={`w-7 h-7 rounded text-xs font-bold transition ${
                customRR === rr
                  ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {rr}
            </button>
          ))}
          <input
            type="number"
            step="0.1"
            min="0.5"
            value={customRR}
            onChange={(e) => setCustomRR(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
            className="h-7 w-20 rounded border border-slate-600 bg-slate-800 px-2 text-xs text-white focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {autoTPs.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          <span className="text-slate-400">Preview:</span>
          {autoTPs.map((tp, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-green-900/20 border border-green-700/30 text-success"
            >
              TP{idx + 1}: {tp.toFixed(2)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
