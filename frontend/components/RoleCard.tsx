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
      ? "hover:border-volt-400/60 hover:shadow-glow"
      : accent === "iris"
        ? "hover:border-iris-400/60 hover:shadow-card"
        : "hover:border-rose-400/60 hover:shadow-card";
  const chip =
    accent === "volt"
      ? "bg-volt-400 text-night-950"
      : accent === "iris"
        ? "bg-iris-500 text-white"
        : "bg-rose-400 text-night-950";
  return (
    <a
      href={href}
      className={`block rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-5 transition ${ring}`}
    >
      <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${chip}`}>{title}</span>
      <p className="mt-3 text-sm leading-relaxed text-[#A5ABD6]">{desc}</p>
      <p className="font-display mt-4 text-sm font-semibold text-volt-300">{cta}</p>
    </a>
  );
}
