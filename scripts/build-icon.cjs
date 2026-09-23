const fs = require("node:fs");
const sharp = require("sharp");
(async () => {
  fs.mkdirSync("assets", { recursive: true });
  const svg = Buffer.from(
    '<svg width="256" height="256"><rect width="256" height="256" rx="48" fill="#202c38"/><rect x="42" y="70" width="172" height="130" rx="18" fill="none" stroke="white" stroke-width="12"/><circle cx="128" cy="135" r="38" fill="none" stroke="white" stroke-width="12"/><path d="M80 70 L95 48 H161 L176 70" fill="none" stroke="white" stroke-width="12"/><rect x="180" y="90" width="12" height="12" fill="#e5a657"/></svg>',
  );
  const png = await sharp(svg).png().toBuffer();
  const h = Buffer.alloc(22);
  h.writeUInt16LE(1, 2);
  h.writeUInt16LE(1, 4);
  h.writeUInt16LE(1, 10);
  h.writeUInt16LE(32, 12);
  h.writeUInt32LE(png.length, 14);
  h.writeUInt32LE(22, 18);
  fs.writeFileSync("assets/app.ico", Buffer.concat([h, png]));
})();
