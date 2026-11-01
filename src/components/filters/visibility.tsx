import { FilterField, SwitchRow } from "@/components/filters/field";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OWNERS, type OwnerFilter } from "@/lib/search";
import { m } from "@/messages";

/**
 * Contract v4.1 filters of every inventory list: whose items (all / mine / others) and whether
 * muted repositories are shown. `label` says what "mine" means here (repository owner or PR author).
 */
export function VisibilityFilters({ owner, muted, onChange, label = m.visibility.owner }: {
  owner: OwnerFilter;
  muted: boolean;
  onChange: (patch: { owner?: OwnerFilter; muted?: boolean }) => void;
  label?: string;
}) {
  return (
    <>
      <FilterField label={label}>
        <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={owner} aria-label={label}
          onValueChange={(v) => { const next = OWNERS.find((o) => o === v); if (next) onChange({ owner: next }); }}>
          {OWNERS.map((o) => (
            <ToggleGroupItem key={o} value={o} className="h-11 flex-1 px-2 md:h-8">{m.visibility.owners[o]}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FilterField>
      <SwitchRow label={m.visibility.showMuted}>
        <Switch checked={muted} onCheckedChange={(on) => onChange({ muted: on })} />
      </SwitchRow>
    </>
  );
}
