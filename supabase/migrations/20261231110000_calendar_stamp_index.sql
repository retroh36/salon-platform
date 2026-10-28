-- The calendar's "has anything changed?" check (loadCalendarStamp: the
-- location's latest appointments.updated_at) runs on every calendar load
-- and every 20 seconds on every open calendar. Without an index it read and
-- checked access to every visit the location has ever had (about a second
-- on the demo); with one it reads the newest.
create index appointments_location_updated_at_idx on public.appointments (location_id, updated_at desc);
