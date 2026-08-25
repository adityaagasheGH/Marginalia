export function SummaryPanel({ summary }: { summary: string | null }) {
  if (!summary) {
    return <p className="p-4 text-sm text-ink-muted">No summary available.</p>;
  }
  return (
    <div className="p-4">
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{summary}</p>
    </div>
  );
}
