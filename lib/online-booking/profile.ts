// How long the booking page's own words may be (Settings → Booking page),
// the same limits the database checks (migration …_booking_page.sql, and
// the welcome line's in …_online_booking.sql).
export const DESCRIPTION_MAX = 280;
export const SPECIALTY_MAX = 60;
export const BIO_MAX = 400;
export const PORTFOLIO_MAX = 3;
export const SERVICE_DESCRIPTION_MAX = 200;
