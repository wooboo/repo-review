import { PlusIcon, XIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { m } from "@/messages";

/** Editable list of strings (scan roots, CLI arguments, models). */
export function ListEditor({ id, values, onChange, placeholder, addLabel, mono = true }: {
  id: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  addLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            id={i === 0 ? id : undefined}
            className={`h-11 md:h-9 ${mono ? "font-mono text-sm" : ""}`}
            value={v}
            placeholder={placeholder}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <IconButton label={`${m.remove} ${v}`.trim()} onClick={() => onChange(values.filter((_, j) => j !== i))}>
            <XIcon />
          </IconButton>
        </div>
      ))}
      <Button type="button" variant="outline" className="h-11 self-start md:h-8" onClick={() => onChange([...values, ""])}>
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  );
}
