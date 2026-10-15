// Collection card: count + index chips + geo badges. Not CRUD — a map of data.
export function CollectionCard({
  name, blurb, count, indexes, geo
}: {
  name: string; blurb: string; count: number | null; indexes: string[]; geo: string[];
}) {
  return (
    <div className="panel panel-hover p-5">
      <div className="flex items-center justify-between">
        <p className="font-display text-lg font-bold text-ink">{name}</p>
        <span className="pill pill-quiet">
          {count === null ? "…" : `${count} docs`}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{blurb}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {indexes.map((ix) => (
          <span
            key={ix}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              ix.startsWith("geo_")
                ? "bg-volt-400 font-semibold text-night-950"
                : ix.startsWith("uq_")
                  ? "border border-rose-400/50 text-rose-300"
                  : "border border-iris-400/36 text-iris-300"
            }`}
          >
            {ix.startsWith("geo_") ? "◆ " : ix.startsWith("uq_") ? "⌀ " : "▤ "}{ix}
          </span>
        ))}
        {geo.length > 0 && <span className="px-1 py-1 text-[11px] text-muted">2dsphere × {geo.length}</span>}
      </div>
    </div>
  );
}
