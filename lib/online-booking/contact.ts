// Phone numbers and emails typed on the booking site.

// The digits of a US phone number ("(312) 555-0101" -> "3125550101"), or
// null if it isn't 10 digits (an 11-digit number starting with 1 is fine).
export function phoneDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

// "3125550101" -> "(312) 555-0101", the way the salon's records write them.
export function formatPhone(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

// For showing where a code went without spelling it out: "•••-•••-0101",
// "a•••@example.com".
export function maskDestination(channel: "sms" | "email", destination: string): string {
  if (channel === "sms") return `•••-•••-${destination.slice(-4)}`;
  const [name, domain] = destination.split("@");
  return `${name[0]}•••@${domain}`;
}
