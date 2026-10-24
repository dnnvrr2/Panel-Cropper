import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const png = readFileSync(resolve(publicDir, "app-icon-192-transparent.png"));
const icon = Buffer.alloc(22 + png.length);

icon.writeUInt16LE(0, 0); // Reserved
icon.writeUInt16LE(1, 2); // Icon file
icon.writeUInt16LE(1, 4); // One PNG image
icon.writeUInt8(192, 6);
icon.writeUInt8(192, 7);
icon.writeUInt16LE(1, 10); // Color planes
icon.writeUInt16LE(32, 12); // Bits per pixel
icon.writeUInt32LE(png.length, 14);
icon.writeUInt32LE(22, 18);
png.copy(icon, 22);

writeFileSync(resolve(publicDir, "app-icon.ico"), icon);
