import type { ProcessStatus } from "@devhub/shared";

const LABEL: Record<ProcessStatus, string> = {
  running: "Running",
  starting: "Starting",
  crashed: "Crashed",
  stopped: "Stopped",
};

export function StatusDot({ status }: { status: ProcessStatus }) {
  return <span className={`status-dot status-dot--${status}`} title={LABEL[status]} />;
}
