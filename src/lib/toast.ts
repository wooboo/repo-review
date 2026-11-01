/** Minimal toast store: `toast(text)` from anywhere, rendered once by `<Toaster />` in the shell. */
export type ToastAction = { label: string; onClick: () => void };
export type Toast = { id: number; text: string; action?: ToastAction };

const DURATION_MS = 6000;
let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string, options: { action?: ToastAction; duration?: number } = {}): number {
  const id = next++;
  toasts = [...toasts.slice(-2), { id, text, action: options.action }];
  emit();
  if (typeof window !== "undefined") window.setTimeout(() => dismissToast(id), options.duration ?? DURATION_MS);
  return id;
}

export const subscribeToasts = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const currentToasts = () => toasts;
const none: Toast[] = [];
export const serverToasts = () => none;
