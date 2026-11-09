// Reading a client CSV: quoting, guessing columns, and what can't be read.
import { describe, expect, it } from "vitest";
import { guessColumns, parseBirthday, parseCsv, planImport } from "@/lib/client-import";

describe("reading a CSV", () => {
  it("handles a BOM, quotes, doubled quotes, line breaks in cells, CRLF and blank lines", () => {
    expect(parseCsv('﻿Name,Notes\r\n"Lee, Ava","Says ""hi""\nthen leaves"\r\n\r\nBo,x')).toEqual([
      ["Name", "Notes"],
      ["Lee, Ava", 'Says "hi"\nthen leaves'],
      ["Bo", "x"],
    ]);
  });
  it("guesses columns from common headers, a mobile before a landline", () => {
    const c = guessColumns(["Client Code", "First Name", "Surname", "Phone", "Mobile", "E-mail", "Date of Birth"]);
    expect(c).toMatchObject({ first_name: 1, last_name: 2, phone: 4, email: 5, birthday: 6, notes: null, full_name: null });
  });
});

describe("birthdays", () => {
  it("reads the usual shapes and refuses what isn't a day", () => {
    expect(parseBirthday("1990-03-14")).toEqual({ month: 3, day: 14 });
    expect(parseBirthday("3/14/1990")).toEqual({ month: 3, day: 14 });
    expect(parseBirthday("02/29")).toEqual({ month: 2, day: 29 });
    expect(parseBirthday("2/30/1990")).toBeNull();
    expect(parseBirthday("soon")).toBeNull();
  });
});

describe("planning an import", () => {
  const columns = guessColumns(["Name", "Mobile", "Email", "DOB"]);
  it("splits a full name, cleans contact details, and counts problems by the file's row number", () => {
    const { rows, problems } = planImport(
      [
        ["Ava Mae Lee", "1 (312) 555-0100", "AVA@Example.com", "3/14"],
        ["", "312 555 0101", "", ""],
        ["Cher", "12345", "nope", "never"],
      ],
      columns,
    );
    expect(rows).toEqual([
      { first_name: "Ava Mae", last_name: "Lee", phone: "(312) 555-0100", email: "ava@example.com", birth_month: 3, birth_day: 14, notes: null, allergies: null },
      { first_name: "Cher", last_name: "", phone: null, email: null, birth_month: null, birth_day: null, notes: null, allergies: null },
    ]);
    expect(problems).toEqual({ no_name: [3], bad_phone: [4], bad_email: [4], bad_birthday: [4] });
  });
});
