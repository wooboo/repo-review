import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export type Palette = "neutral" | "accent";
export const THEMES: readonly Theme[] = ["light", "dark", "system"];
export const PALETTES: readonly Palette[] = ["neutral", "accent"];

/** Runs inline in <head> before paint; keep in sync with applyTheme / applyPalette. */
export const themeScript = `try{var c=document.cookie,t=(c.match(/(?:^|; )theme=(light|dark|system)(?:;|$)/)||[])[1]||'system',p=(c.match(/(?:^|; )palette=(neutral|accent)(?:;|$)/)||[])[1]||'neutral',d=document.documentElement;d.classList.toggle('dark',t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));d.dataset.palette=p}catch(e){}`;

export function parseThemeCookie(cookie: string): Theme {
  const value = /(?:^|; )theme=(light|dark|system)(?:;|$)/.exec(cookie)?.[1];
  return value === "light" || value === "dark" ? value : "system";
}
export function parsePaletteCookie(cookie: string): Palette {
  return /(?:^|; )palette=accent(?:;|$)/.test(cookie) ? "accent" : "neutral";
}

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
};

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media().matches));
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onSystem = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  media().addEventListener("change", onSystem);
  return () => {
    listeners.delete(listener);
    media().removeEventListener("change", onSystem);
  };
}
const getTheme = () => parseThemeCookie(document.cookie);
const getPalette = () => parsePaletteCookie(document.cookie);

export function setTheme(theme: Theme) {
  setCookie("theme", theme);
  applyTheme(theme);
  listeners.forEach((l) => l());
}
export function setPalette(palette: Palette) {
  setCookie("palette", palette);
  document.documentElement.dataset.palette = palette;
  listeners.forEach((l) => l());
}
export const useTheme = () => useSyncExternalStore(subscribe, getTheme, () => "system" as Theme);
export const usePalette = () => useSyncExternalStore(subscribe, getPalette, () => "neutral" as Palette);
