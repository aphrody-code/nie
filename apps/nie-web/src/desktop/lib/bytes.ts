export { b64ToBytes, bytesToB64 } from "../../shared/base64";

/** Decode an even-length hexadecimal string without allocating per-byte substrings. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex string must contain an even number of digits");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const high = hexValue(hex.charCodeAt(i * 2));
    const low = hexValue(hex.charCodeAt(i * 2 + 1));
    if (high < 0 || low < 0) throw new Error("hex string contains an invalid digit");
    out[i] = (high << 4) | low;
  }
  return out;
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

export function humanSize(n: number): string {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

/** Une ligne hexdump façon `xxd` : offset + 16 octets hex + colonne ASCII. */
export function hexLines(bytes: Uint8Array, maxLines = 512): string[] {
  const lines: string[] = [];
  const n = Math.min(bytes.length, maxLines * 16);
  for (let off = 0; off < n; off += 16) {
    const chunk = bytes.subarray(off, off + 16);
    let hex = "";
    let ascii = "";
    for (let j = 0; j < 16; j++) {
      if (j < chunk.length) {
        const b = chunk[j];
        hex += b.toString(16).padStart(2, "0") + " ";
        ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
      } else {
        hex += "   ";
      }
    }
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex} ${ascii}`);
  }
  return lines;
}
