// Money on the Policy page always shows its cents ("$25.00"), so the
// table's column lines up.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const cents = (amount: number) => usd.format(amount / 100);
