import { inflateRawSync } from "node:zlib";
import { statusError } from "./status.mjs";
/** Read one ZIP member in memory; never extract paths, and cap actual decompression. */
export function readZipMember(bytes, name, limit = 1024 * 1024) {
  try {
    let end = -1;
    for (
      let offset = bytes.length - 22;
      offset >= Math.max(0, bytes.length - 65557);
      offset--
    )
      if (
        bytes.readUInt32LE(offset) === 0x06054b50 &&
        offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
      ) {
        end = offset;
        break;
      }
    if (
      end < 0 ||
      bytes.readUInt16LE(end + 4) !== 0 ||
      bytes.readUInt16LE(end + 6) !== 0
    )
      throw Error();
    const count = bytes.readUInt16LE(end + 10),
      centralSize = bytes.readUInt32LE(end + 12),
      start = bytes.readUInt32LE(end + 16);
    if (
      count !== bytes.readUInt16LE(end + 8) ||
      count === 65535 ||
      start + centralSize !== end
    )
      throw Error();
    let cursor = start,
      selected = null;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
        throw Error();
      const flags = bytes.readUInt16LE(cursor + 8),
        method = bytes.readUInt16LE(cursor + 10),
        crc = bytes.readUInt32LE(cursor + 16),
        compressed = bytes.readUInt32LE(cursor + 20),
        size = bytes.readUInt32LE(cursor + 24),
        nameLength = bytes.readUInt16LE(cursor + 28),
        extra = bytes.readUInt16LE(cursor + 30),
        comment = bytes.readUInt16LE(cursor + 32),
        disk = bytes.readUInt16LE(cursor + 34),
        attributes = bytes.readUInt32LE(cursor + 38),
        offset = bytes.readUInt32LE(cursor + 42);
      const next = cursor + 46 + nameLength + extra + comment;
      if (next > end || disk !== 0) throw Error();
      const member = bytes
        .subarray(cursor + 46, cursor + 46 + nameLength)
        .toString("utf8");
      if (member === name) {
        if (
          selected ||
          flags & ~(method === 8 ? 0x080e : 0x0808) ||
          ![0, 8].includes(method) ||
          ((attributes >>> 16) & 0xf000) === 0xa000 ||
          size > limit ||
          compressed > 10 * 1024 * 1024 ||
          offset + 30 > start ||
          bytes.readUInt32LE(offset) !== 0x04034b50
        )
          throw Error();
        const localFlags = bytes.readUInt16LE(offset + 6),
          localMethod = bytes.readUInt16LE(offset + 8),
          localNameLength = bytes.readUInt16LE(offset + 26),
          localExtra = bytes.readUInt16LE(offset + 28);
        const dataStart = offset + 30 + localNameLength + localExtra;
        if (
          localFlags !== flags ||
          localMethod !== method ||
          bytes
            .subarray(offset + 30, offset + 30 + localNameLength)
            .toString("utf8") !== name ||
          dataStart + compressed > start
        )
          throw Error();
        if (
          !(flags & 8) &&
          (bytes.readUInt32LE(offset + 14) !== crc ||
            bytes.readUInt32LE(offset + 18) !== compressed ||
            bytes.readUInt32LE(offset + 22) !== size)
        )
          throw Error();
        const source = bytes.subarray(dataStart, dataStart + compressed);
        const data =
          method === 0
            ? Buffer.from(source)
            : inflateRawSync(source, { maxOutputLength: limit });
        if (data.length !== size || crc32(data) !== crc) throw Error();
        selected = data;
      }
      cursor = next;
    }
    if (cursor !== end || !selected) throw Error();
    return selected;
  } catch {
    throw statusError(
      "Artifact ZIP has no unique supported bounded status member, or its bytes are invalid",
    );
  }
}
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
