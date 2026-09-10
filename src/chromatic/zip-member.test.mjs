import { expect, it } from "vitest";
import { zip, entry } from "../../scripts/release/archive.mjs";
import { readZipMember, crc32 } from "./zip-member.mjs";
const make = (value = Buffer.from("{}")) => zip([entry("status.json", value)]);
it.each([Buffer.from("{}"), Buffer.from("long status ".repeat(100))])(
  "reads stored/deflated member %j",
  (bytes) => {
    expect(readZipMember(make(bytes), "status.json")).toEqual(bytes);
  },
);
it("checks an independent standard CRC-32 vector", () => {
  expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
});
it("ignores unrelated paths without extracting anything", () => {
  const bytes = zip([
    entry("../untrusted", Buffer.from("x")),
    entry("status.json", Buffer.from("{}")),
  ]);
  expect(readZipMember(bytes, "status.json").toString()).toBe("{}");
});
it.each([
  ["truncation", (b) => b.subarray(0, b.length - 1)],
  [
    "wrong signature",
    (b) => {
      b.writeUInt32LE(0, 0);
      return b;
    },
  ],
  [
    "wrong CRC",
    (b) => {
      b.writeUInt32LE(1, 14);
      return b;
    },
  ],
  [
    "encryption",
    (b) => {
      const i = b.indexOf(Buffer.from("504b0102", "hex"));
      b.writeUInt16LE(1, i + 8);
      return b;
    },
  ],
  [
    "symlink",
    (b) => {
      const i = b.indexOf(Buffer.from("504b0102", "hex"));
      b.writeUInt32LE(0xa1ff0000, i + 38);
      return b;
    },
  ],
  [
    "ZIP64 marker",
    (b) => {
      b.writeUInt16LE(65535, b.length - 12);
      return b;
    },
  ],
  [
    "local name mismatch",
    (b) => {
      b[30] = 120;
      return b;
    },
  ],
  [
    "uncompressed bomb size",
    (b) => {
      const i = b.indexOf(Buffer.from("504b0102", "hex"));
      b.writeUInt32LE(2 ** 30, i + 24);
      return b;
    },
  ],
])("rejects %s", (_, mutate) => {
  expect(() => readZipMember(mutate(make()), "status.json")).toThrow();
});
it("refuses missing or ambiguous members", () => {
  expect(() => readZipMember(make(), "other.json")).toThrow();
  expect(() =>
    readZipMember(
      zip([
        entry("status.json", Buffer.from("{}")),
        entry("status.json", Buffer.from("{}")),
      ]),
      "status.json",
    ),
  ).toThrow();
});
it("enforces actual decompression limits even when the size header lies", () => {
  const b = make(Buffer.alloc(2048, 97));
  const i = b.indexOf(Buffer.from("504b0102", "hex"));
  b.writeUInt32LE(1, 22);
  b.writeUInt32LE(1, i + 24);
  expect(() => readZipMember(b, "status.json", 32)).toThrow();
});

it("refuses unsupported flags even when both headers agree", () => {
  const b = make();
  const i = b.indexOf(Buffer.from("504b0102", "hex"));
  b.writeUInt16LE(0x20, 6);
  b.writeUInt16LE(0x20, i + 8);
  expect(() => readZipMember(b, "status.json")).toThrow();
});
