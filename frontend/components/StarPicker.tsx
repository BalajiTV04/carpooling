// Interactive 1-5 star input (Module 22). The read-only `Stars` display lives
// beside this one and is what profile cards use.
"use client";
import { STAR_LABELS } from "@/lib/ratings";

export function StarPicker({
  value, onChange, disabled
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""} — ${STAR_LABELS[n]}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`text-2xl leading-none transition disabled:opacity-50 ${
            n <= value ? "text-volt-400" : "text-[#3d4270] hover:text-volt-300"
          }`}
        >
          ★
        </button>
      ))}
      <span className="ml-1 text-[11px] text-[#A5ABD6]">
        {value > 0 ? STAR_LABELS[value] : "tap to rate"}
      </span>
    </span>
  );
}