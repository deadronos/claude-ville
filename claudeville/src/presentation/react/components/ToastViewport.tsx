import type { ToastItem } from '../state/ClaudeVilleController.js';

export function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (toastId: string) => void }) {
  return (
    <div id="toastContainer" className="toast-container">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast toast--${toast.tone}`} onClick={() => onDismiss(toast.id)}>
          {toast.message}
        </button>
      ))}
    </div>
  );
}
