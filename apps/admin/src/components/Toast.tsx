import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  show: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

const KIND_STYLES: Record<ToastKind, { background: string; border: string }> = {
  success: { background: '#f0fdf4', border: '#16a34a' },
  error: { background: '#fef2f2', border: '#dc2626' },
  info: { background: '#eff6ff', border: '#2563eb' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
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
          zIndex: 1000,
          maxWidth: 360,
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              background: KIND_STYLES[toast.kind].background,
              borderLeft: `4px solid ${KIND_STYLES[toast.kind].border}`,
              padding: '10px 14px',
              borderRadius: 6,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              fontSize: 14,
              color: '#1f2937',
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
