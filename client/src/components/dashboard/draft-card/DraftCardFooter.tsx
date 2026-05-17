import { ProcessLogsAccordion } from '../ProcessLogsAccordion';

export function DraftCardFooter({
  author,
  sourceTimestamp,
  messageUrl,
  showDetails,
  setShowDetails,
  processId,
  refreshKey,
}: {
  author: string;
  sourceTimestamp?: string;
  messageUrl?: string;
  showDetails: boolean;
  setShowDetails: (value: boolean) => void;
  processId?: string;
  refreshKey: number;
}) {
  return (
    <>
      <div className="mt-4 pt-3 border-t border-slate-700/50">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500 mb-2">
          <span>👤 @{author}</span>
          {sourceTimestamp ? (
            <span className="text-blue-400">💬 {new Date(sourceTimestamp).toLocaleString()}</span>
          ) : null}
          {messageUrl && (
            <a
              href={messageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-400 hover:text-primary-300 underline"
            >
              🔗 Discord
            </a>
          )}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-slate-400 hover:text-white transition"
          >
            {showDetails ? '▼ Hide' : '▶ Show'} original
          </button>
        </div>
      </div>

      <ProcessLogsAccordion processId={processId} refreshKey={refreshKey} />
    </>
  );
}
