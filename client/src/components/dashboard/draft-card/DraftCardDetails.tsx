import { ImageModal } from '../ImageModal';

export function DraftCardDetails({
  showDetails,
  imageUrls,
  originalContent,
  parsedSignalData,
  signalData,
  modalIndex,
  setModalIndex,
}: {
  showDetails: boolean;
  imageUrls: string[];
  originalContent: string;
  parsedSignalData: unknown;
  signalData: string;
  modalIndex: number | null;
  setModalIndex: (value: number | null) => void;
}) {
  return (
    <>
      {showDetails && (
        <div className="border-t border-slate-700 p-4 bg-slate-800/30">
          {imageUrls && imageUrls.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-slate-400 mb-2">📎 Attachments:</p>
              <div className="flex flex-wrap gap-2">
                {imageUrls.map((url, i) => (
                  <button key={i} onClick={() => setModalIndex(i)} className="group relative">
                    <img
                      src={url}
                      alt={`Attachment ${i + 1}`}
                      className="h-24 w-auto rounded-lg border border-slate-600 group-hover:border-primary-500 transition object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-lg transition flex items-center justify-center">
                      <span className="text-white text-lg opacity-0 group-hover:opacity-100 transition">🔍</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs text-slate-400 mb-1">💬 Original Message:</p>
            <p className="text-slate-300 text-sm whitespace-pre-wrap bg-slate-900/50 rounded p-3">
              {originalContent}
            </p>
          </div>

          <details className="mt-3">
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">
              📋 Raw AI Signal Data
            </summary>
            <pre className="text-xs text-slate-400 mt-2 bg-slate-900/50 rounded p-3 overflow-x-auto">
              {JSON.stringify(parsedSignalData || signalData, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {modalIndex !== null && imageUrls && imageUrls.length > 0 && (
        <ImageModal
          urls={imageUrls}
          initialIndex={modalIndex}
          onClose={() => setModalIndex(null)}
        />
      )}
    </>
  );
}
