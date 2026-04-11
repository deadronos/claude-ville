// packages/frontend/src/components/Modal/Modal.tsx

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useAtom } from 'jotai';
import { motion, AnimatePresence } from 'framer-motion';
import { modalOpenAtom, modalTitleAtom, modalContentAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';

export function Modal() {
  const [isOpen, setIsOpen] = useAtom(modalOpenAtom);
  const [title] = useAtom(modalTitleAtom);
  const [content] = useAtom(modalContentAtom);

  const close = React.useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  // Escape key handler
  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: pixelTheme.colors.surface,
              border: `1px solid ${pixelTheme.colors.border}`,
              minWidth: '400px',
              maxWidth: '600px',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: `${pixelTheme.spacing.sm} ${pixelTheme.spacing.md}`,
                borderBottom: `1px solid ${pixelTheme.colors.border}`,
              }}
            >
              <span style={{ fontFamily: pixelTheme.fontFamily.pixel, fontSize: pixelTheme.fontSize.xs, color: pixelTheme.colors.text }}>
                {title}
              </span>
              <button
                onClick={close}
                style={{
                  background: 'none',
                  border: 'none',
                  color: pixelTheme.colors.border,
                  cursor: 'pointer',
                  fontFamily: pixelTheme.fontFamily.pixel,
                  fontSize: pixelTheme.fontSize.xs,
                  padding: pixelTheme.spacing.xs,
                }}
              >
                ✕
              </button>
            </div>
            {/* Content */}
            <div
              style={{ padding: pixelTheme.spacing.md }}
              dangerouslySetInnerHTML={{ __html: content }}
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}