export type ToastTone = 'info' | 'success' | 'warning';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

const TOAST_TTL_MS = 3200;
const MAX_VISIBLE_TOASTS = 5;

export class ToastStore {
  private toasts: ToastItem[] = [];
  private timers = new Map<string, number>();

  constructor(private readonly onChange: () => void) {}

  snapshot(): ToastItem[] {
    return [...this.toasts];
  }

  push(message: string, tone: ToastTone) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.toasts = [...this.toasts, { id, tone, message }].slice(-MAX_VISIBLE_TOASTS);
    this.onChange();

    const timer = window.setTimeout(() => {
      this.dismiss(id);
    }, TOAST_TTL_MS);
    this.timers.set(id, timer);
  }

  dismiss(toastId: string) {
    const timer = this.timers.get(toastId);
    if (timer) {
      window.clearTimeout(timer);
      this.timers.delete(toastId);
    }

    this.toasts = this.toasts.filter((toast) => toast.id !== toastId);
    this.onChange();
  }

  dispose() {
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
  }
}
