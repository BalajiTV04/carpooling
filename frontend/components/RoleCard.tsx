// Role entry card: distinct accent per actor (brief: no generic CRUD reuse).
export function RoleCard({
  title,
  desc,
  cta,
  accent,
  href
}: {
  title: string;
  desc: string;
  cta: string;
  accent: "volt" | "iris" | "rose";
  href: string;
}) {
  const ring =
    accent === "volt"
      ? "hover:border-brand-teal/60 hover:shadow-glow"
      : accent === "iris"
        ? "hover:border-accent/60 hover:shadow-card"
        : "hover:border-rose-400/60 hover:shadow-card";
  const chip =
    accent === "volt"
      ? "bg-brand-teal text-on-brand-teal"
      : accent === "iris"
        ? "bg-accent text-on-accent"
        : "bg-danger text-white";
  return (
    <a
      href={href}
      className={`panel panel-hover block p-5 ${ring}`}
    >
      <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${chip}`}>{title}</span>
      <p className="mt-3 text-sm leading-relaxed text-muted">{desc}</p>
      <p className="font-display mt-4 text-sm font-semibold text-brand-teal">{cta}</p>
    </a>
  );
}
