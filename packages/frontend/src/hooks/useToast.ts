import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { toastsAtom, type Toast } from '../store';

export function useToast() {
  const setToasts = useSetAtom(toastsAtom);

  const addToast = useCallback(
    (message: string, type: Toast['type'] = 'info') => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      setToasts(prev => {
        const next = [...prev, { id, message, type }];
        return next.slice(-5); // max 5 toasts
      });
      // Auto-dismiss after 3s
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    },
    [setToasts]
  );

  return {
    toast: addToast,
    success: (msg: string) => addToast(msg, 'success'),
    warning: (msg: string) => addToast(msg, 'warning'),
    error: (msg: string) => addToast(msg, 'error'),
  };
}
