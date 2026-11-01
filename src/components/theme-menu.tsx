import { CheckIcon, MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PALETTES, setPalette, setTheme, THEMES, usePalette, useTheme, type Palette, type Theme } from "@/lib/theme";
import { m } from "@/messages";

const themeIcon = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };
const themeLabel = (t: Theme) => ({ light: m.themeLight, dark: m.themeDark, system: m.themeSystem })[t];
const paletteLabel = (p: Palette) => ({ neutral: m.paletteNeutral, accent: m.paletteAccent })[p];
const swatch = { neutral: "bg-neutral-800 dark:bg-neutral-200", accent: "bg-teal-600 dark:bg-teal-300" };

export function ThemeMenu() {
  const theme = useTheme();
  const Icon = themeIcon[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`${m.theme}: ${themeLabel(theme)}`}>
          <Icon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(THEMES.find((t) => t === v) ?? "system")}>
          {THEMES.map((t) => {
            const I = themeIcon[t];
            return (
              <DropdownMenuRadioItem key={t} value={t} className="min-h-11 md:min-h-8">
                <I />
                {themeLabel(t)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PaletteMenu() {
  const palette = usePalette();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`${m.palette}: ${paletteLabel(palette)}`}>
          <PaletteIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={palette} onValueChange={(v) => setPalette(PALETTES.find((p) => p === v) ?? "neutral")}>
          {PALETTES.map((p) => (
            <DropdownMenuRadioItem key={p} value={p} className="min-h-11 md:min-h-8">
              <span className={`size-3 rounded-full ${swatch[p]}`} aria-hidden="true" />
              {paletteLabel(p)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Theme and colour as labelled segmented controls (mobile "More" sheet). */
export function AppearanceControls() {
  const theme = useTheme();
  const palette = usePalette();
  const seg = "h-11 flex-1 gap-1.5 px-2";
  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={theme} aria-label={m.theme}
        onValueChange={(v) => { const t = THEMES.find((x) => x === v); if (t) setTheme(t); }}>
        {THEMES.map((t) => {
          const I = themeIcon[t];
          return (
            <ToggleGroupItem key={t} value={t} className={seg}>
              <I />
              {themeLabel(t)}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={palette} aria-label={m.palette}
        onValueChange={(v) => { const p = PALETTES.find((x) => x === v); if (p) setPalette(p); }}>
        {PALETTES.map((p) => (
          <ToggleGroupItem key={p} value={p} className={seg}>
            {palette === p ? <CheckIcon /> : <span className={`size-3 rounded-full ${swatch[p]}`} aria-hidden="true" />}
            {paletteLabel(p)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
