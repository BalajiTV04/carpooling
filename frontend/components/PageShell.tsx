import Link from "next/link";

/**
 * Shared page frame for every inner (non-landing) route.
 *
 * Before this existed each page hand-rolled its own <main> with a different
 * max-width (3xl, 4xl, 6xl, 2xl) and its own back-link, so the redesign on the
 * index page never carried through — pages looked visibly narrower than the nav
 * and each other. This gives them one consistent width, one spacing scale and
 * one header treatment, so a change here updates all of them at once.
 *
 * The header is a `panel-head` band (gradient lit surface + travelling road
 * rule) rather than a bare <h1>, so an inner page opens with the same weight as
 * the landing page instead of looking unfinished.
 *
 * `wide` opts a page into the full 7xl used by the landing page.
 */
export function PageShell({
  title, accent, subtitle, children, wide = false, eyebrow, actions
}: {
  title: React.ReactNode;
  /** Optional coloured suffix after the title, e.g. "· trips". */
  accent?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  /** Small uppercase kicker above the title, e.g. "Passenger". */
  eyebrow?: string;
  /** Right-aligned slot in the header (filters, status pill, primary action). */
  actions?: React.ReactNode;
}) {
  return (
    <main className="relative mx-auto w-full px-5 pb-20 pt-8">
      <div className={wide ? "max-w-7xl" : "max-w-5xl"}>
        <Link href="/" className="btn btn-ghost btn-sm">
          ← VoltRide
        </Link>

        <header className="panel-head relative mt-3 overflow-hidden p-6">
          <div className="glow-iris -right-16 -top-24 h-56 w-56 bg-iris-500/30" aria-hidden />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
              <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight">
                {title}
                {accent ? <span className="text-iris-300"> {accent}</span> : null}
              </h1>
              {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
          <div className="roadline relative mt-4 rounded-full opacity-60" aria-hidden />
        </header>

        {children}
      </div>
    </main>
  );
}
