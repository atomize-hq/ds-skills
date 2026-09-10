/**
 * Deterministic tar.gz and zip writers.
 *
 * Written here rather than shelled out to `tar` and `zip` for two reasons that
 * are both T14 criteria: the release must not depend on undeclared developer
 * tooling, and staging twice must produce identical digests. GNU tar and bsdtar
 * disagree about the flags that pin ownership and mtime, and `zip` is not
 * present on every runner — so the one thing we need to be reproducible would
 * have depended on which machine ran it.
 *
 * Unpacking still uses the platform's own tools: `tar -xzf` everywhere, and
 * PowerShell's Expand-Archive on Windows.
 */
import zlib from "node:zlib";

/** A file to archive: an in-archive path, its bytes, and whether it executes. */
export function entry(name, bytes, executable = false) {
  return { name, bytes, mode: executable ? 0o755 : 0o644 };
}

export function tarGz(entries) {
  const blocks = [];
  for (const file of sorted(entries)) {
    blocks.push(ustarHeader(file), pad(file.bytes));
  }
  // Two zero blocks end the archive, then padding to a 20-block record.
  blocks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(blocks);
  const padded = Buffer.concat([
    tar,
    Buffer.alloc((10240 - (tar.length % 10240)) % 10240),
  ]);
  // level 9 and mtime 0: gzip otherwise stamps the current time into the header
  // and the digest changes on every run.
  return zlib.gzipSync(padded, { level: 9, mtime: 0 });
}

export function zip(entries) {
  const files = sorted(entries);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.bytes);
    const deflated = zlib.deflateRawSync(file.bytes, { level: 9 });
    const useStore = deflated.length >= file.bytes.length;
    const body = useStore ? file.bytes : deflated;
    const method = useStore ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    // DOS time/date 0 is invalid; 1980-01-01 is the epoch this format has.
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    // Unix host, so the external attributes carry the mode a launcher needs.
    header.writeUInt16LE(0x031e, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(33, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(file.bytes.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((file.mode | 0o100000) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

/** Sorted by name, so archive order never depends on directory iteration. */
function sorted(entries) {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : 1));
}

function pad(bytes) {
  return Buffer.concat([
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ]);
}

function ustarHeader(file) {
  const header = Buffer.alloc(512);
  const write = (text, offset, length) =>
    header.write(text.slice(0, length - 1), offset, "utf8");

  // ustar caps the name at 100 bytes; the prefix field carries the rest.
  const [prefix, name] = splitName(file.name);
  write(name, 0, 100);
  write(file.mode.toString(8).padStart(7, "0"), 100, 8);
  write("0000000", 108, 8);
  write("0000000", 116, 8);
  write(file.bytes.length.toString(8).padStart(11, "0"), 124, 12);
  write("00000000000", 136, 12);
  header.write("        ", 148, 8, "utf8");
  header.write("0", 156, 1, "utf8");
  header.write("ustar", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  write(prefix, 345, 155);

  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  return header;
}

function splitName(full) {
  if (Buffer.byteLength(full) < 100) return ["", full];
  // The earliest split that fits both fields, which is the longest prefix.
  for (let i = 0; i < full.length; i += 1) {
    if (full[i] !== "/") continue;
    const name = full.slice(i + 1);
    if (
      Buffer.byteLength(name) < 100 &&
      Buffer.byteLength(full.slice(0, i)) < 155
    ) {
      return [full.slice(0, i), name];
    }
  }
  throw new Error(`archive path too long for ustar: ${full}`);
}

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}
