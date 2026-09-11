import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvObjects } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and a BOM", () => {
    const text = '﻿id,name\r\n1,"Five Points, ""Downtown"""\r\n2,plain\n';
    expect(parseCsv(text)).toEqual([
      ["id", "name"],
      ["1", 'Five Points, "Downtown"'],
      ["2", "plain"],
    ]);
  });

  it("supports pipe-delimited files", () => {
    expect(parseCsv("a|b\n1|2", "|")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvObjects", () => {
  it("keys rows by header and skips blank lines", () => {
    expect(parseCsvObjects("x,y\n1,2\n\n3,4\n")).toEqual([
      { x: "1", y: "2" },
      { x: "3", y: "4" },
    ]);
  });
});
