import { AudioLines, CircleStop, Mic2 } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { defaultPanelists } from "@/data/demo";

export function PanelSequence() {
  return (
    <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/20">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-primary" aria-hidden="true" /><span className="text-sm font-medium">Adaptive panel in session</span></div>
        <Badge variant="outline"><AudioLines className="size-3" aria-hidden="true" />Agora live</Badge>
      </div>
      <div className="grid min-h-[24rem] md:grid-cols-[9rem_1fr]">
        <div className="border-b p-3 md:border-b-0 md:border-e">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Panel</p>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
            {defaultPanelists.map((person, index) => <div key={person.id} className={`flex items-center gap-2 rounded-md p-2 ${index === 2 ? "bg-primary/10" : ""}`}><Avatar initials={person.initials} active={index === 2} className="size-8" /><span className="hidden min-w-0 md:block"><span className="block truncate text-xs font-medium">{person.name.split(" ")[0]}</span><span className="block truncate text-[10px] text-muted-foreground">{person.role}</span></span></div>)}
          </div>
        </div>
        <div className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center justify-between gap-3"><Badge variant="default">Priya selected next</Badge><span className="font-mono text-[11px] text-muted-foreground">05:08</span></div>
            <p className="mt-5 text-lg font-medium leading-7">“You called pulse feedback a guardrail. Why is it not the outcome itself?”</p>
            <div className="mt-6 rounded-lg border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">Shared panel memory</p>
              <p className="mt-1 text-sm leading-6">The panel found a contradiction. Product Sense can challenge it now, while Analytics remains free to return later.</p>
            </div>
          </div>
          <div className="mt-7 flex items-center gap-3 border-t pt-4">
            <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden="true"><Mic2 className="size-4" /></span>
            <div className="flex h-8 flex-1 items-center justify-center gap-1" aria-hidden="true">
              {[12, 20, 8, 26, 16, 30, 10, 22, 14, 18].map((height, index) => <span key={`${height}-${index}`} className="w-0.5 rounded-full bg-primary" style={{ height }} />)}
            </div>
            <span className="grid size-10 place-items-center rounded-full border bg-secondary text-muted-foreground" aria-hidden="true"><CircleStop className="size-4" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}
