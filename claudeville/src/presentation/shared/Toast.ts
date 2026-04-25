const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 3000;

interface ToastEntry {
    el: HTMLElement;
    timer: ReturnType<typeof setTimeout> | null;
}

export class Toast {
    container: HTMLElement | null;
    toasts: ToastEntry[];

    constructor() {
        this.container = document.getElementById('toastContainer');
        this.toasts = [];
    }

    show(message: string, type = 'info') {
        if (!this.container) return;

        // Remove oldest when exceeding max count
        while (this.toasts.length >= MAX_TOASTS) {
            this._remove(this.toasts[0]);
        }

        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.textContent = message;
        this.container.appendChild(el);

        const entry: ToastEntry = { el, timer: null };
        this.toasts.push(entry);

        entry.timer = setTimeout(() => {
            this._fadeOut(entry);
        }, AUTO_DISMISS_MS);
    }

    _fadeOut(entry: ToastEntry) {
        entry.el.classList.add('toast--fadeout');
        setTimeout(() => this._remove(entry), 300);
    }

    _remove(entry: ToastEntry) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.el.parentNode) {
            entry.el.parentNode.removeChild(entry.el);
        }
        const idx = this.toasts.indexOf(entry);
        if (idx !== -1) this.toasts.splice(idx, 1);
    }

    destroy() {
        for (const entry of this.toasts) {
            if (entry.timer) clearTimeout(entry.timer);
            if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        }
        this.toasts = [];
    }
}
