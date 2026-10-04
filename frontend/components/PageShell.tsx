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
 * `wide` opts a page into the full 7xl used by the landing page.
 */
export function PageShell({
  title, accent, subtitle, children, wide = false
}: {
  title: React.ReactNode;
  /** Optional coloured suffix after the title, e.g. "· trips". */
  accent?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="mx-auto w-full px-5 pb-20 pt-10">
      <div className={wide ? "max-w-7xl" : "max-w-5xl"}>
        <Link href="/" className="text-sm text-volt-300 transition hover:text-volt-400">
          ← VoltRide
        </Link>
        <div className="mt-2">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            {title}
            {accent ? <span className="text-iris-300"> {accent}</span> : null}
          </h1>
          {subtitle ? <p className="mt-1 text-sm text-[#A5ABD6]">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </main>
  );
}