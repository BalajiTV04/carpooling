// Shared auth form shell: night card + error slot.
export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-14">
      <a href="/" className="text-sm text-volt-300">← VoltRide</a>
      <h1 className="font-display mt-3 text-3xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-[#A5ABD6]">{sub}</p>
      <div className="mt-6 rounded-xl3 border border-[rgba(154,151,255,.22)] bg-night-900/80 p-6 shadow-card">
        {children}
      </div>
    </main>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#A5ABD6]">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-[rgba(154,151,255,.3)] bg-night-950 px-4 py-2.5 text-sm text-[#EEF0FF] outline-none placeholder:text-[#5b6194] focus:border-volt-400";
