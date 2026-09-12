'use client';

import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

interface ToastContextValue {
  show: (message: string, tone?: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 100,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.tone === 'success' ? '#166534' : '#dc2626',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: '0.9rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              maxWidth: 320,
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
