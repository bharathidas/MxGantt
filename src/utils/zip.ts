/* eslint-disable no-bitwise -- checksums, UTF-8 encoding and zip headers are bit-level formats. */
/**
 * A minimal zip writer for the Excel export: entries are stored without compression, which every
 * zip reader (Excel, LibreOffice, Numbers, Google Sheets) accepts. A plan of a few thousand tasks
 * makes a sheet of a few megabytes at most, so compression is not worth a dependency.
 */

export interface ZipEntry {
    /** Path inside the archive, with forward slashes. */
    name: string;
    data: Uint8Array | string;
}

let crcTable: Uint32Array | undefined;

function table(): Uint32Array {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            crcTable[n] = c >>> 0;
        }
    }
    return crcTable;
}

/** The CRC-32 checksum zip files carry for every entry. */
export function crc32(data: Uint8Array): number {
    const t = table();
    let crc = 0xffffffff;
    for (const byte of data) {
        crc = t[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** UTF-8 bytes of a string; written out because TextEncoder is missing in some test environments. */
export function utf8(text: string): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
            const low = text.charCodeAt(i + 1);
            if (low >= 0xdc00 && low < 0xe000) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                i++;
            }
        }
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        } else if (code < 0x10000) {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        } else {
            bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        }
    }
    return Uint8Array.from(bytes);
}

/** The string a UTF-8 byte array holds. */
export function fromUtf8(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length; ) {
        const b = bytes[i];
        let code: number;
        if (b < 0x80) {
            code = b;
            i += 1;
        } else if (b < 0xe0) {
            code = ((b & 31) << 6) | (bytes[i + 1] & 63);
            i += 2;
        } else if (b < 0xf0) {
            code = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
            i += 3;
        } else {
            code = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
            i += 4;
        }
        out += String.fromCodePoint(code);
    }
    return out;
}

/** Date and time in the MS-DOS format zip headers use. */
function dosDateTime(date: Date): { time: number; date: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
}

/** Builds a zip archive of the entries, stored (method 0) with UTF-8 names. */
export function zipStore(entries: ZipEntry[], modified: Date = new Date(2026, 0, 1)): Uint8Array {
    const stamp = dosDateTime(modified);
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    entries.forEach(entry => {
        const name = utf8(entry.name);
        const data = typeof entry.data === "string" ? utf8(entry.data) : entry.data;
        const crc = crc32(data);

        const local = new Uint8Array(30 + name.length + data.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true); // version needed
        lv.setUint16(6, 0x0800, true); // flags: UTF-8 names
        lv.setUint16(8, 0, true); // stored
        lv.setUint16(10, stamp.time, true);
        lv.setUint16(12, stamp.date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, name.length, true);
        lv.setUint16(28, 0, true);
        local.set(name, 30);
        local.set(data, 30 + name.length);
        locals.push(local);

        const central = new Uint8Array(46 + name.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true); // version made by
        cv.setUint16(6, 20, true); // version needed
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, stamp.time, true);
        cv.setUint16(14, stamp.date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true);
        // Extra field, comment, disk number, internal and external attributes stay zero.
        cv.setUint32(42, offset, true);
        central.set(name, 46);
        centrals.push(central);

        offset += local.length;
    });
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const out = new Uint8Array(offset + centralSize + end.length);
    let at = 0;
    [...locals, ...centrals, end].forEach(part => {
        out.set(part, at);
        at += part.length;
    });
    return out;
}

/** Reads a stored zip back into its entries; used by the tests to check what was written. */
export function unzipStore(zip: Uint8Array): Map<string, Uint8Array> {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const files = new Map<string, Uint8Array>();
    let at = 0;
    while (at + 30 <= zip.length && view.getUint32(at, true) === 0x04034b50) {
        const size = view.getUint32(at + 18, true);
        const nameLength = view.getUint16(at + 26, true);
        const extra = view.getUint16(at + 28, true);
        const name = fromUtf8(zip.subarray(at + 30, at + 30 + nameLength));
        const start = at + 30 + nameLength + extra;
        files.set(name, zip.subarray(start, start + size));
        at = start + size;
    }
    return files;
}
