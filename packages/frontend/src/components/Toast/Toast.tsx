import * as React from 'react';
import { useAtom } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { toastsAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';

const TOAST_ICONS = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

export function ToastContainer() {
  const [toasts, setToasts] = useAtom(toastsAtom);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: pixelTheme.spacing.lg,
        right: pixelTheme.spacing.lg,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: pixelTheme.spacing.sm,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence mode="wait">
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: pixelTheme.spacing.sm,
              padding: `${pixelTheme.spacing.sm} ${pixelTheme.spacing.md}`,
              backgroundColor: pixelTheme.colors.surface,
              border: `1px solid ${pixelTheme.colors.border}`,
              fontFamily: pixelTheme.fontFamily.pixel,
              fontSize: pixelTheme.fontSize.xs,
              color: pixelTheme.colors.text,
              pointerEvents: 'auto',
              cursor: 'pointer',
              maxWidth: '320px',
            }}
            onClick={() => removeToast(toast.id)}
          >
            <span>{TOAST_ICONS[toast.type] || 'ℹ️'}</span>
            <span>{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}