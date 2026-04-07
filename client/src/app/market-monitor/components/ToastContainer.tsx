'use client';

import { useState, useCallback } from 'react';

interface Toast { id: number; type: 'short' | 'long'; title: string; message: string; }

let toastIdCounter = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: 'short' | 'long', title: string, message: string) => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 8000);
  }, []);

  const removeToast = useCallback((id: number) => { setToasts(prev => prev.filter(t => t.id !== id)); }, []);

  return { toasts, showToast, removeToast };
}

export default function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)}>
          <div className="toast-icon">{t.type === 'short' ? '🔴' : '🟢'}</div>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            <div className="toast-message">{t.message}</div>
          </div>
          <button className="toast-close" onClick={(e) => { e.stopPropagation(); removeToast(t.id); }}>✕</button>
          <div className="toast-progress" />
        </div>
      ))}
    </div>
  );
}
