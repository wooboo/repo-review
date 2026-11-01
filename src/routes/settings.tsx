import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type * as React from "react";
import { ConfirmDialog } from "@/components/confirm";
import { Mono, Pill } from "@/components/domain";
import { FilterField, SwitchRow } from "@/components/filters/field";
import { OptionSelect } from "@/components/filters/controls";
import { IconButton } from "@/components/icon-button";
import { ListEditor } from "@/components/list-editor";
import { Card, PageHeader, Section } from "@/components/page-header";
import { ErrorState, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { updateSettings } from "@/lib/api/client";
import type { Agent, Forge, Host, Settings } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { m } from "@/messages";

export const Route = createFileRoute("/settings")({
  head: () => title(m.settings.title),
  component: SettingsPage,
});

const seg = "h-11 flex-1 px-2 md:h-8";

function useSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (s: Settings) => updateSettings(s),
    onSuccess: (s) => {
      client.setQueryData(q.settings().queryKey, s);
      void client.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

type Editing = { kind: "host"; index: number | null } | { kind: "forge"; index: number | null } | { kind: "agent"; index: number | null } | null;
type Removing = { kind: "host" | "forge" | "agent"; index: number; name: string } | null;

function SettingsPage() {
  const settings = useQuery(q.settings());
  const dashboard = useQuery(q.dashboard());
  const save = useSave();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Removing>(null);
  if (settings.isPending) return <><PageHeader title={m.settings.title} /><PageSkeleton /></>;
  if (settings.error) return <><PageHeader title={m.settings.title} /><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></>;
  const s = settings.data;
  const remove = () => {
    if (!removing) return;
    const without = <T,>(xs: readonly T[]) => xs.filter((_, i) => i !== removing.index);
    save.mutate({ ...s, ...(removing.kind === "host" ? { hosts: without(s.hosts) } : removing.kind === "forge" ? { forges: without(s.forges) } : { agents: without(s.agents) }) });
    setRemoving(null);
  };
  const addButton = (label: string, kind: "host" | "forge" | "agent") => (
    <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setEditing({ kind, index: null })}><PlusIcon />{label}</Button>
  );
  return (
    <>
      <PageHeader title={m.settings.title} />
      <div className="flex max-w-3xl flex-col gap-8">
        {save.error && <ErrorState error={save.error} />}
        <Section title={m.settings.hosts} id="hosts" actions={addButton(m.settings.addHost, "host")}>
          {s.hosts.length ? s.hosts.map((h, i) => (
            <ItemCard key={h.id} title={h.id} onEdit={() => setEditing({ kind: "host", index: i })} onRemove={() => setRemoving({ kind: "host", index: i, name: h.id })}
              badges={<>
                <Pill>{h.kind === "ssh" ? m.settings.kindSsh : m.settings.kindLocal}</Pill>
                <Pill t={h.enabled ? "good" : "neutral"}>{h.enabled ? m.settings.enabled : m.settings.disabled}</Pill>
              </>}>
              {h.kind === "ssh" && h.target && <Mono>{h.target}</Mono>}
              <ul className="flex flex-col gap-0.5">{h.roots.map((r) => <li key={r}><Mono className="text-muted-foreground">{r}</Mono></li>)}</ul>
            </ItemCard>
          )) : <p className="text-sm text-muted-foreground">{m.settings.noHosts}</p>}
        </Section>

        <Section title={m.settings.forges} id="forges" actions={addButton(m.settings.addForge, "forge")}>
          {s.forges.length ? s.forges.map((f, i) => (
            <ItemCard key={f.host} title={f.host} onEdit={() => setEditing({ kind: "forge", index: i })} onRemove={() => setRemoving({ kind: "forge", index: i, name: f.host })}
              badges={<Pill>{m.settings.forgeKinds[f.kind]}</Pill>}>
              <span className="text-sm text-muted-foreground">
                {m.settings.tokenSource}: {f.tokenCommand ? <Mono>{f.tokenCommand}</Mono> : f.tokenEnv ? <Mono>${f.tokenEnv}</Mono> : m.none}
              </span>
            </ItemCard>
          )) : <p className="text-sm text-muted-foreground">{m.settings.noForges}</p>}
          <p className="text-xs text-muted-foreground">{m.settings.tokenNote}</p>
        </Section>

        <Section title={m.settings.agents} id="agents" actions={addButton(m.settings.addAgent, "agent")}>
          {s.agents.length ? s.agents.map((a, i) => (
            <ItemCard key={a.id} title={a.label} onEdit={() => setEditing({ kind: "agent", index: i })} onRemove={() => setRemoving({ kind: "agent", index: i, name: a.label })}
              badges={<Pill>{m.settings.agentKinds[a.kind]}</Pill>}>
              <Mono>{[a.command, ...a.args].join(" ")}</Mono>
              <span className="text-sm text-muted-foreground">{m.settings.models_(a.models.length)} · {m.settings.defaultModel}: <Mono>{a.defaultModel}</Mono></span>
            </ItemCard>
          )) : <p className="text-sm text-muted-foreground">{m.settings.noAgents}</p>}
        </Section>

        <General settings={s} />

        <Section title={m.settings.jev} id="jev">
          <p className="flex items-center gap-2 text-sm">
            {dashboard.data?.jevEnabled ? <><CheckIcon className="size-4 text-success" />{m.settings.jevOn}</> : <span className="text-muted-foreground">{m.settings.jevOff}</span>}
          </p>
        </Section>
      </div>

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          {editing?.kind === "host" && <HostForm settings={s} index={editing.index} onDone={() => setEditing(null)} />}
          {editing?.kind === "forge" && <ForgeForm settings={s} index={editing.index} onDone={() => setEditing(null)} />}
          {editing?.kind === "agent" && <AgentForm settings={s} index={editing.index} onDone={() => setEditing(null)} />}
        </SheetContent>
      </Sheet>
      <ConfirmDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)} destructive
        title={removing?.kind === "host" ? m.settings.removeHostConfirm(removing.name) : `${m.remove} ${removing?.name ?? ""}?`}
        confirm={m.remove} onConfirm={remove} />
    </>
  );
}

function ItemCard({ title, badges, children, onEdit, onRemove }: { title: string; badges: React.ReactNode; children: React.ReactNode; onEdit: () => void; onRemove: () => void }) {
  return (
    <Card className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2"><span className="font-medium break-all">{title}</span>{badges}</span>
        {children}
      </div>
      <IconButton label={`${m.edit} ${title}`} onClick={onEdit}><PencilIcon /></IconButton>
      <IconButton label={`${m.remove} ${title}`} onClick={onRemove}><Trash2Icon /></IconButton>
    </Card>
  );
}

function FormShell({ title, children, onSave, saving, error, valid }: { title: string; children: React.ReactNode; onSave: () => void; saving: boolean; error: unknown; valid: boolean }) {
  return (
    <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(); }}>
      <SheetHeader className="border-b"><SheetTitle>{title}</SheetTitle></SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {children}
        {error ? <ErrorState error={error} /> : null}
      </div>
      <SheetFooter className="border-t">
        <Button type="submit" className="h-11 w-full md:h-9" disabled={!valid || saving}>
          {saving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}{m.save}
        </Button>
      </SheetFooter>
    </form>
  );
}

const replaceAt = <T,>(xs: readonly T[], index: number | null, value: T) => (index === null ? [...xs, value] : xs.map((x, i) => (i === index ? value : x)));

function HostForm({ settings, index, onDone }: { settings: Settings; index: number | null; onDone: () => void }) {
  const initial: Host = index === null ? { id: "", kind: "ssh", roots: ["~/Work"], enabled: true } : settings.hosts[index];
  const [id, setId] = useState(initial.id);
  const [kind, setKind] = useState(initial.kind);
  const [target, setTarget] = useState(initial.target ?? "");
  const [bun, setBun] = useState(initial.bun ?? "");
  const [roots, setRoots] = useState([...initial.roots]);
  const [enabled, setEnabled] = useState(initial.enabled);
  const save = useSave();
  const duplicate = settings.hosts.some((h, i) => h.id === id.trim() && i !== index);
  const valid = !!id.trim() && !duplicate && (kind === "local" || !!target.trim());
  const host: Host = { id: id.trim(), kind, ...(kind === "ssh" ? { target: target.trim() } : {}), ...(bun.trim() ? { bun: bun.trim() } : {}), roots: roots.map((r) => r.trim()).filter(Boolean), enabled };
  return (
    <FormShell title={index === null ? m.settings.addHost : m.settings.editHost} valid={valid} saving={save.isPending} error={save.error}
      onSave={() => save.mutate({ ...settings, hosts: replaceAt(settings.hosts, index, host) }, { onSuccess: onDone })}>
      <FilterField label={m.settings.hostId} labelFor="host-id">
        <Input id="host-id" className="h-11 md:h-9" value={id} onChange={(e) => setId(e.target.value)} aria-invalid={duplicate || undefined} autoComplete="off" />
        {duplicate && <p className="text-xs text-destructive">{m.settings.duplicateHost}</p>}
      </FilterField>
      <FilterField label={m.settings.hostKind}>
        <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={kind} onValueChange={(v) => { if (v === "local" || v === "ssh") setKind(v); }}>
          <ToggleGroupItem value="local" className={seg}>{m.settings.kindLocal}</ToggleGroupItem>
          <ToggleGroupItem value="ssh" className={seg}>{m.settings.kindSsh}</ToggleGroupItem>
        </ToggleGroup>
      </FilterField>
      {kind === "ssh" && (
        <FilterField label={m.settings.sshTarget} labelFor="host-target">
          <Input id="host-target" className="h-11 font-mono md:h-9" value={target} placeholder={m.settings.sshTargetPlaceholder} onChange={(e) => setTarget(e.target.value)} autoComplete="off" />
        </FilterField>
      )}
      <FilterField label={m.settings.roots} labelFor="host-roots">
        <ListEditor id="host-roots" values={roots} onChange={setRoots} placeholder={m.settings.rootPlaceholder} addLabel={m.settings.addRoot} />
      </FilterField>
      <FilterField label={m.settings.bunPath} labelFor="host-bun">
        <Input id="host-bun" className="h-11 font-mono md:h-9" value={bun} placeholder={m.settings.bunPlaceholder} onChange={(e) => setBun(e.target.value)} autoComplete="off" />
      </FilterField>
      <SwitchRow label={m.settings.enabled}><Switch checked={enabled} onCheckedChange={setEnabled} /></SwitchRow>
    </FormShell>
  );
}

function ForgeForm({ settings, index, onDone }: { settings: Settings; index: number | null; onDone: () => void }) {
  const initial: Forge = index === null ? { host: "", kind: "github", tokenCommand: "gh auth token" } : settings.forges[index];
  const [host, setHost] = useState(initial.host);
  const [kind, setKind] = useState(initial.kind);
  const [source, setSource] = useState<"env" | "command">(initial.tokenEnv && !initial.tokenCommand ? "env" : "command");
  const [value, setValue] = useState(initial.tokenCommand ?? initial.tokenEnv ?? "");
  const save = useSave();
  const valid = !!host.trim();
  const forge: Forge = { host: host.trim().toLowerCase(), kind, ...(value.trim() ? (source === "env" ? { tokenEnv: value.trim() } : { tokenCommand: value.trim() }) : {}) };
  return (
    <FormShell title={index === null ? m.settings.addForge : m.settings.editForge} valid={valid} saving={save.isPending} error={save.error}
      onSave={() => save.mutate({ ...settings, forges: replaceAt(settings.forges, index, forge) }, { onSuccess: onDone })}>
      <FilterField label={m.settings.forgeKind}>
        <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={kind} onValueChange={(v) => { if (v === "github" || v === "forgejo") setKind(v); }}>
          <ToggleGroupItem value="github" className={seg}>{m.settings.forgeKinds.github}</ToggleGroupItem>
          <ToggleGroupItem value="forgejo" className={seg}>{m.settings.forgeKinds.forgejo}</ToggleGroupItem>
        </ToggleGroup>
      </FilterField>
      <FilterField label={m.settings.forgeHost} labelFor="forge-host">
        <Input id="forge-host" className="h-11 font-mono md:h-9" value={host} placeholder={m.settings.forgeHostPlaceholder} onChange={(e) => setHost(e.target.value)} autoComplete="off" />
      </FilterField>
      <FilterField label={m.settings.tokenSource} labelFor="forge-token">
        <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={source} onValueChange={(v) => { if (v === "env" || v === "command") setSource(v); }}>
          <ToggleGroupItem value="command" className={seg}>{m.settings.tokenCommand}</ToggleGroupItem>
          <ToggleGroupItem value="env" className={seg}>{m.settings.tokenEnv}</ToggleGroupItem>
        </ToggleGroup>
        <Input id="forge-token" className="h-11 font-mono md:h-9" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off"
          placeholder={source === "env" ? m.settings.tokenEnvPlaceholder : m.settings.tokenCommandPlaceholder} />
        <p className="text-xs text-muted-foreground">{m.settings.tokenNote}</p>
      </FilterField>
    </FormShell>
  );
}

function AgentForm({ settings, index, onDone }: { settings: Settings; index: number | null; onDone: () => void }) {
  const initial: Agent = index === null ? { id: "", label: "", kind: "acp", command: "", args: [], models: [], defaultModel: "" } : settings.agents[index];
  const [id, setId] = useState(initial.id);
  const [label, setLabel] = useState(initial.label);
  const [kind, setKind] = useState(initial.kind);
  const [command, setCommand] = useState(initial.command);
  const [args, setArgs] = useState([...initial.args]);
  const [models, setModels] = useState([...initial.models]);
  const [defaultModel, setDefault] = useState(initial.defaultModel);
  const save = useSave();
  const cleanModels = models.map((x) => x.trim()).filter(Boolean);
  const effectiveDefault = cleanModels.includes(defaultModel) ? defaultModel : (cleanModels[0] ?? "");
  const duplicate = settings.agents.some((a, i) => a.id === id.trim() && i !== index);
  const valid = !!id.trim() && !duplicate && !!label.trim() && !!command.trim() && cleanModels.length > 0;
  const agent: Agent = { id: id.trim(), label: label.trim(), kind, command: command.trim(), args: args.filter((a) => a !== ""), models: cleanModels, defaultModel: effectiveDefault };
  return (
    <FormShell title={index === null ? m.settings.addAgent : m.settings.editAgent} valid={valid} saving={save.isPending} error={save.error}
      onSave={() => save.mutate({ ...settings, agents: replaceAt(settings.agents, index, agent) }, { onSuccess: onDone })}>
      <FilterField label={m.settings.agentLabel} labelFor="agent-label">
        <Input id="agent-label" className="h-11 md:h-9" value={label} onChange={(e) => setLabel(e.target.value)} />
      </FilterField>
      <FilterField label={m.settings.agentId} labelFor="agent-id">
        <Input id="agent-id" className="h-11 font-mono md:h-9" value={id} onChange={(e) => setId(e.target.value)} aria-invalid={duplicate || undefined} autoComplete="off" />
      </FilterField>
      <FilterField label={m.settings.agentKind}>
        <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={kind} onValueChange={(v) => { if (v === "acp" || v === "cli") setKind(v); }}>
          <ToggleGroupItem value="acp" className={seg}>{m.settings.agentKinds.acp}</ToggleGroupItem>
          <ToggleGroupItem value="cli" className={seg}>{m.settings.agentKinds.cli}</ToggleGroupItem>
        </ToggleGroup>
      </FilterField>
      <FilterField label={m.settings.command} labelFor="agent-command">
        <Input id="agent-command" className="h-11 font-mono md:h-9" value={command} onChange={(e) => setCommand(e.target.value)} autoComplete="off" />
      </FilterField>
      <FilterField label={m.settings.args} labelFor="agent-args">
        <ListEditor id="agent-args" values={args} onChange={setArgs} placeholder={m.settings.argPlaceholder} addLabel={m.settings.addArg} />
      </FilterField>
      <FilterField label={m.settings.models} labelFor="agent-models">
        <ListEditor id="agent-models" values={models} onChange={setModels} placeholder={m.settings.modelPlaceholder} addLabel={m.settings.addModel} />
      </FilterField>
      {cleanModels.length > 0 && (
        <FilterField label={m.settings.defaultModel} labelFor="agent-default">
          <OptionSelect id="agent-default" value={effectiveDefault} onChange={setDefault} options={cleanModels.map((x) => ({ value: x, label: x }))} />
        </FilterField>
      )}
    </FormShell>
  );
}

function General({ settings }: { settings: Settings }) {
  const [time, setTime] = useState(settings.dailyScanTime);
  const [stale, setStale] = useState(String(settings.staleDays));
  const [dir, setDir] = useState(settings.worktreeDir);
  const save = useSave();
  const staleDays = Number(stale);
  const valid = /^\d{2}:\d{2}$/.test(time) && Number.isInteger(staleDays) && staleDays > 0 && !!dir.trim();
  const dirty = time !== settings.dailyScanTime || staleDays !== settings.staleDays || dir !== settings.worktreeDir;
  return (
    <Section title={m.settings.general} id="general">
      <Card>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate({ ...settings, dailyScanTime: time, staleDays, worktreeDir: dir.trim() }); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FilterField label={m.settings.dailyScan} labelFor="daily">
              <Input id="daily" type="time" className="h-11 md:h-9" value={time} onChange={(e) => setTime(e.target.value)} />
            </FilterField>
            <FilterField label={m.settings.staleDays} labelFor="stale">
              <Input id="stale" inputMode="numeric" className="h-11 md:h-9" value={stale} onChange={(e) => setStale(e.target.value.replace(/\D/g, ""))} />
            </FilterField>
          </div>
          <FilterField label={m.settings.worktreeDir} labelFor="wtdir">
            <Input id="wtdir" className="h-11 font-mono md:h-9" value={dir} onChange={(e) => setDir(e.target.value)} />
          </FilterField>
          <div className="flex items-center gap-3">
            <Button type="submit" className="h-11 md:h-9" disabled={!valid || !dirty || save.isPending}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}{m.save}
            </Button>
            {save.isSuccess && !dirty && <span className="text-sm text-muted-foreground">{m.saved}</span>}
          </div>
          {save.error && <ErrorState error={save.error} />}
        </form>
      </Card>
    </Section>
  );
}
