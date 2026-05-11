import type { JSX } from "react";
import { ProgressTimeline } from "./ProgressTimeline";

export interface RoleMonitorTimelinePanelProps {
  jobId: string;
}

export function RoleMonitorTimelinePanel({
  jobId,
}: RoleMonitorTimelinePanelProps): JSX.Element {
  return (
    <section
      data-testid="ti-role-monitor-panel"
      aria-label="Role monitor timeline"
      className="flex flex-col gap-3"
    >
      <div className="rounded border border-white/10 bg-[#171717] px-4 py-3 text-[11px] text-white/60">
        Existing production-runner events are reused here so operator role and
        retry context stay on the current timeline surface.
      </div>
      <ProgressTimeline jobId={jobId} />
    </section>
  );
}
