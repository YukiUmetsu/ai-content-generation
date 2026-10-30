import type { CharacterPackDefinition } from "./character-pack";

/** Original, deliberately small teaching artwork. These are not Pip or Quill rigs. */
const sprites = {
  "layers/body.png": "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAlElEQVR4nO3SwQ2AIBBEUeqwBBswsVrj3U6sx6veiAfF2XUmiwYSbsh/wU2pra+tYVr3px0WlkA8YRqEEXcjmHEzQhE3IUIByjiECAWUPur6MW/GuQYI+/8N4AJs85I3cjlyHgacL0MQ6Pk6AVcIBeA2jrwCYwaKgNIwyqa/OoAKAccVCHOciXDH30IoYQ9EEv7tOgAc/R+XqKTTIwAAAABJRU5ErkJggg==",
  "layers/mouth-closed.png": "iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAYAAADwdn+XAAAAF0lEQVR4nGNgGF5ARtfmPzGYdgYMTQAAsdoeUSYJazYAAAAASUVORK5CYII=",
  "layers/mouth-open.png": "iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAYAAADwdn+XAAAAJ0lEQVR4nGNgoAWQ0bX5jw1TpJkoQwhpJmgIxQZQ7AVChhClmVQAAKgPSMGzizkKAAAAAElFTkSuQmCC",
} as const;

const provenance = { source: "Original ContentGen teaching artwork", license: "CC0-1.0" };
export const EXAMPLE_CHARACTER: CharacterPackDefinition = {
  schemaVersion: 1,
  characterId: "example-sprite",
  revision: "1",
  mode: "sprite-2d",
  design: { width: 32, height: 32 },
  channels: ["body", "mouth"],
  palette: { body: "#37a0cc" },
  assets: {
    body: { kind: "image", uri: "layers/body.png", mediaType: "image/png", width: 32, height: 32, provenance },
    mouthClosed: { kind: "image", uri: "layers/mouth-closed.png", mediaType: "image/png", width: 16, height: 8, provenance },
    mouthOpen: { kind: "image", uri: "layers/mouth-open.png", mediaType: "image/png", width: 16, height: 8, provenance },
  },
  parts: [
    { id: "body", channel: "body", asset: "body", pivot: { x: 16, y: 16 }, z: 0 },
    { id: "mouth", parent: "body", channel: "mouth", asset: "mouthClosed",
      variants: { open: "mouthOpen" }, pivot: { x: 8, y: 4 }, rest: { x: 16, y: 20 }, z: 1 },
  ],
  poses: { idle: {} },
  basePose: "idle",
  speech: { mouthPart: "mouth", rest: "closed", visemes: { A: "open" },
    approximateCycle: ["closed", "open"], approximateStepFrames: 3, transitionFrames: 0 },
  capabilities: [],
};

export const exampleCharacterJson = () => JSON.stringify(EXAMPLE_CHARACTER, null, 2) + "\n";

const utf8 = new TextEncoder();
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let v = n;
  for (let i = 0; i < 8; i++) v = (v >>> 1) ^ ((v & 1) ? 0xedb88320 : 0);
  return v >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
const short = (bytes: Uint8Array, at: number, value: number) => new DataView(bytes.buffer).setUint16(at, value, true);
const long = (bytes: Uint8Array, at: number, value: number) => new DataView(bytes.buffer).setUint32(at, value >>> 0, true);

/** Build a portable, CRC-checked stored ZIP with no untrusted inputs or external requests. */
export function exampleCharacterZip(): Uint8Array<ArrayBuffer> {
  const files = [
    { name: "character.json", bytes: utf8.encode(exampleCharacterJson()) },
    ...Object.entries(sprites).map(([name, encoded]) => ({ name, bytes: decodeBase64(encoded) })),
  ];
  const locals: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = utf8.encode(file.name), size = file.bytes.length, crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length + size);
    long(local, 0, 0x04034b50); short(local, 4, 20); short(local, 6, 0x800);
    long(local, 14, crc); long(local, 18, size); long(local, 22, size); short(local, 26, name.length);
    local.set(name, 30); local.set(file.bytes, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    long(central, 0, 0x02014b50); short(central, 4, 20); short(central, 6, 20);
    short(central, 8, 0x800); long(central, 16, crc); long(central, 20, size); long(central, 24, size);
    short(central, 28, name.length); long(central, 42, offset); central.set(name, 46);
    directory.push(central);
    offset += local.length;
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  long(end, 0, 0x06054b50); short(end, 8, files.length); short(end, 10, files.length);
  long(end, 12, directorySize); long(end, 16, offset);
  const output = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...directory, end]) { output.set(part, cursor); cursor += part.length; }
  return output;
}
