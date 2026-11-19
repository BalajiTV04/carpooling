// Phone utilities: 10-digit Indian mobile input with canonical +91 E.164 storage.
// Default country code comes from NEXT_PUBLIC_DEFAULT_COUNTRY_CODE (default "+91").
export const DEFAULT_COUNTRY_CODE = (
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE
) || "+91";

// Strip everything except digits.
export function toDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  // Drop leading country code / trunk prefix if present.
  let d = digits;
  if (d.startsWith("91") && d.length > 10) d = d.slice(2);
  else if (d.startsWith("+91") && d.length > 13) d = d.slice(3);
  else if (d.startsWith("0") && d.length > 10) d = d.slice(1);
  return d.slice(0, 10);
}

export function isValidMobile10(digits: string): boolean {
  return /^[6-9][0-9]{9}$/.test(digits);
}

export function formatDisplay(digits: string): string {
  if (!isValidMobile10(digits)) return digits;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
