export type FeedbackTone = "success" | "error" | "info" | "warning";

const styles: Record<FeedbackTone, string> = {
  success: "border-emerald-500/30 bg-emerald-500/8 text-emerald-300",
  error: "border-red-500/30 bg-red-500/8 text-red-300",
  info: "border-blue-500/30 bg-blue-500/8 text-blue-300",
  warning: "border-amber-500/30 bg-amber-500/8 text-amber-300",
};

const icons: Record<FeedbackTone, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
};

export function ActionFeedback({
  tone,
  title,
  detail,
  next,
}: {
  tone: FeedbackTone;
  title: string;
  detail?: string;
  next?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`rounded-md border px-3 py-2.5 text-sm ${styles[tone]}`}
    >
      <p className="font-medium">{icons[tone]} {title}</p>
      {detail && <p className="mt-1 text-xs opacity-80">{detail}</p>}
      {next && <p className="mt-1 text-xs opacity-80">Next: {next}</p>}
    </div>
  );
}
