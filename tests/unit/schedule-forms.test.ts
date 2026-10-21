import { describe, expect, it } from "vitest";
import { parseCompensationForm, parseDayChangeForm, parseTimeOffForm, parseWeeklyHoursForm } from "@/lib/schedule-forms";

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

const TODAY = "2026-10-21";

describe("parseWeeklyHoursForm", () => {
  it("parses split shifts and skips blank rows and days off", () => {
    const result = parseWeeklyHoursForm(
      form([
        ["start_2", "09:00"], ["end_2", "13:00"],
        ["start_2", "14:00"], ["end_2", "18:00"],
        ["start_3", ""], ["end_3", ""],
        ["start_6", "08:00"], ["end_6", "14:00"],
      ]),
    );
    expect(result).toEqual({
      ok: true,
      hours: [
        { weekday: 2, start_minute: 540, end_minute: 780 },
        { weekday: 2, start_minute: 840, end_minute: 1080 },
        { weekday: 6, start_minute: 480, end_minute: 840 },
      ],
    });
  });

  it("reports problems per day", () => {
    const result = parseWeeklyHoursForm(
      form([
        ["start_2", "09:00"], ["end_2", "13:00"],
        ["start_2", "12:00"], ["end_2", "18:00"],
        ["start_4", "17:00"], ["end_4", "09:00"],
        ["start_5", "09:00"], ["end_5", ""],
        ["start_6", "09:02"], ["end_6", "12:00"],
      ]),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        2: "Shifts can't overlap.",
        4: "Each start time must be before its end time.",
        5: "Enter a start and end time.",
        6: "Use 5-minute steps.",
      },
    });
  });

  it("accepts a week with no hours", () => {
    expect(parseWeeklyHoursForm(form([]))).toEqual({ ok: true, hours: [] });
  });
});

describe("parseDayChangeForm", () => {
  it("parses a date and hours", () => {
    expect(parseDayChangeForm(form([["on_date", "2026-10-30"], ["start_day", "12:00"], ["end_day", "20:00"]]))).toEqual({
      ok: true,
      date: "2026-10-30",
      hours: [{ start_minute: 720, end_minute: 1200 }],
    });
  });

  it("treats no hours as removing the change", () => {
    expect(parseDayChangeForm(form([["on_date", "2026-10-30"]]))).toEqual({ ok: true, date: "2026-10-30", hours: [] });
  });

  it("requires a valid date", () => {
    expect(parseDayChangeForm(form([["on_date", "2026-02-30"]]))).toEqual({ ok: false, errors: { date: "Choose a date." } });
  });
});

describe("parseTimeOffForm", () => {
  const base: [string, string][] = [["starts_on", "2026-11-02"], ["ends_on", "2026-11-08"], ["reason", "vacation"], ["note", "Trip"]];

  it("parses a date range", () => {
    expect(parseTimeOffForm(form(base), { today: TODAY, allowPast: false })).toEqual({
      ok: true,
      value: { starts_on: "2026-11-02", ends_on: "2026-11-08", start_minute: null, end_minute: null, reason: "vacation", note: "Trip" },
    });
  });

  it("defaults the last day to the first", () => {
    const result = parseTimeOffForm(form([["starts_on", "2026-11-02"], ["reason", "sick"]]), { today: TODAY, allowPast: false });
    expect(result.ok && [result.value.ends_on, result.value.note]).toEqual(["2026-11-02", null]);
  });

  it("parses part of a day", () => {
    const result = parseTimeOffForm(
      form([["starts_on", "2026-10-29"], ["part_day", "on"], ["start_time", "14:00"], ["end_time", "16:00"], ["reason", "personal"]]),
      { today: TODAY, allowPast: false },
    );
    expect(result.ok && [result.value.start_minute, result.value.end_minute]).toEqual([840, 960]);
  });

  it("rejects requests in the past, but lets managers record them", () => {
    const past = form([["starts_on", "2026-10-20"], ["reason", "sick"]]);
    expect(parseTimeOffForm(past, { today: TODAY, allowPast: false })).toEqual({
      ok: false,
      errors: { starts_on: "Time off can't start in the past." },
    });
    expect(parseTimeOffForm(past, { today: TODAY, allowPast: true }).ok).toBe(true);
  });

  it("reports every problem", () => {
    const result = parseTimeOffForm(
      form([["starts_on", "2026-11-08"], ["ends_on", "2026-11-02"], ["part_day", "on"], ["start_time", "16:00"], ["end_time", "14:00"], ["reason", "holiday"]]),
      { today: TODAY, allowPast: false },
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        ends_on: "The last day can't be before the first.",
        times: "The start time must be before the end time.",
        reason: "Choose a reason.",
      },
    });
  });

  it("only allows part-day time off on a single day", () => {
    const result = parseTimeOffForm(
      form([["starts_on", "2026-11-02"], ["ends_on", "2026-11-03"], ["part_day", "on"], ["start_time", "09:00"], ["end_time", "12:00"], ["reason", "other"]]),
      { today: TODAY, allowPast: false },
    );
    expect(!result.ok && result.errors.times).toBe("Part-day time off is for a single day.");
  });

  it("caps ranges at a year", () => {
    const result = parseTimeOffForm(form([["starts_on", "2026-11-02"], ["ends_on", "2027-11-04"], ["reason", "other"]]), {
      today: TODAY,
      allowPast: false,
    });
    expect(!result.ok && result.errors.ends_on).toBe("Keep it to a year or less.");
  });
});

describe("parseCompensationForm", () => {
  it("parses a level and percentages", () => {
    expect(parseCompensationForm(form([["level", "senior"], ["service_commission_pct", "45"], ["retail_commission_pct", "12.5"]]))).toEqual({
      ok: true,
      value: { level: "senior", service_commission_pct: 45, retail_commission_pct: 12.5 },
    });
  });

  it("allows no level and blank percentages", () => {
    expect(parseCompensationForm(form([["level", ""]]))).toEqual({
      ok: true,
      value: { level: null, service_commission_pct: 0, retail_commission_pct: 0 },
    });
  });

  it("rejects bad values", () => {
    expect(parseCompensationForm(form([["level", "boss"], ["service_commission_pct", "101"], ["retail_commission_pct", "-5"]]))).toEqual({
      ok: false,
      errors: {
        level: "Choose a level.",
        service_commission_pct: "Enter a percentage from 0 to 100.",
        retail_commission_pct: "Enter a percentage from 0 to 100.",
      },
    });
  });
});
