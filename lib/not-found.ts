// Where the not-found page points, from the address that wasn't found:
// staff back to the Dashboard; a client on a salon's booking site (an old
// manage link, say) to that salon's booking page; a client on any other
// link of theirs (unsubscribe, pay, card, event) nowhere, since they don't
// sign in to Maestra. Null: no link.
const CLIENT_PATHS = ["/book", "/unsubscribe", "/pay", "/card", "/event"];

export function notFoundLink(path: string): { href: string; label: string } | null {
  const booking = /^\/book\/([a-z0-9-]+)\/./.exec(path);
  if (booking) return { href: `/book/${booking[1]}`, label: "Go to the booking page" };
  if (CLIENT_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return { href: "/dashboard", label: "Go to the Dashboard" };
}
