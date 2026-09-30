// Builds timetrack/marketing: logos, fonts, colour swatches, screenshots and the Instagram posts.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "url";

const ROOT = "C:/Users/peter/OneDrive/Desktop/Claude/Timetracker/timetrack";
const M = `${ROOT}/marketing`, PUB = `${ROOT}/public`, SHOTS = "./out";
const mk = (d) => fs.mkdirSync(`${M}/${d}`, { recursive: true });
["logo", "fonts", "colors", "screenshots", "instagram", "source"].forEach(mk);

// ---- fonts: Inter (SIL Open Font License) ----
const FS = "node_modules/@fontsource/inter", FV = "node_modules/@fontsource-variable/inter";
for (const w of [400, 600, 700, 800]) {
  fs.copyFileSync(`${FS}/files/inter-latin-${w}-normal.woff2`, `${M}/fonts/Inter-${w}.woff2`);
  fs.copyFileSync(`${FS}/files/inter-latin-ext-${w}-normal.woff2`, `${M}/fonts/Inter-${w}-latin-ext.woff2`);
}
fs.copyFileSync(`${FV}/files/inter-latin-wght-normal.woff2`, `${M}/fonts/Inter-Variable.woff2`);
fs.copyFileSync(`${FS}/LICENSE`, `${M}/fonts/LICENSE-Inter.txt`);
const FONT_CSS = [400, 600, 700, 800].map((w) =>
  `@font-face{font-family:Inter;font-weight:${w};src:url("${pathToFileURL(`${M}/fonts/Inter-${w}.woff2`)}") format("woff2");}`).join("");

// ---- logos ----
fs.copyFileSync(`${PUB}/logo.svg`, `${M}/logo/moonglare-logo.svg`);
fs.copyFileSync(`${PUB}/icon.svg`, `${M}/logo/moonglare-app-icon.svg`);
const logoSvg = fs.readFileSync(`${PUB}/logo.svg`), iconSvg = fs.readFileSync(`${PUB}/icon.svg`);
for (const w of [512, 1024, 2048]) {
  await sharp(logoSvg, { density: 72 * w / 316 }).resize(w).png().toFile(`${M}/logo/moonglare-logo-${w}.png`);
}
for (const w of [512, 1024]) {
  await sharp(iconSvg, { density: 72 * w / 512 }).resize(w).png().toFile(`${M}/logo/moonglare-app-icon-${w}.png`);
}
await sharp(iconSvg, { density: 72 * 1080 / 512 }).resize(1080).jpeg({ quality: 92 }).toFile(`${M}/logo/moonglare-profile-picture-1080.jpg`);

// ---- screenshots (2x phone captures of the demo account) ----
for (const f of fs.readdirSync(SHOTS)) fs.copyFileSync(`${SHOTS}/${f}`, `${M}/screenshots/${f}`);

// ---- HTML → PNG helper ----
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
const page = await browser.newPage();
async function render(html, out, w, h, transparent = false) {
  const file = path.resolve(`build-${path.basename(out)}.html`);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}${BASE_CSS}</style>${html}`);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: transparent, type: out.endsWith(".jpg") ? "jpeg" : "png", quality: out.endsWith(".jpg") ? 92 : undefined });
  fs.unlinkSync(file);
}
const img = (p) => pathToFileURL(p).href;
const LOGO = img(`${PUB}/logo.svg`);
const BASE_CSS = `
  *{box-sizing:border-box} html,body{margin:0}
  body{font-family:Inter,sans-serif;color:#142230;-webkit-font-smoothing:antialiased}
  .slide{position:relative;width:1080px;height:1350px;overflow:hidden;background:#f3f7fb}
  .brand{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px;font-weight:800;font-size:34px;letter-spacing:-.01em}
  .brand img{width:40px;height:43px}
  .count{position:absolute;right:72px;top:72px;font-weight:600;font-size:26px;color:#9fadbc;letter-spacing:.04em}
  .text{position:absolute;left:72px;right:72px;top:190px}
  .kicker{font-weight:700;font-size:26px;letter-spacing:.14em;text-transform:uppercase;color:#1f8fd6;margin:0 0 22px}
  h1{margin:0;font-weight:800;font-size:78px;line-height:1.04;letter-spacing:-.035em;text-wrap:balance}
  .body{margin:26px 0 0;font-size:34px;line-height:1.42;color:#64748a;max-width:880px}
  .num{display:inline-grid;place-items:center;width:64px;height:64px;border-radius:50%;background:#1f8fd6;color:#fff;font-weight:800;font-size:32px;margin-bottom:26px}
  .phone{position:absolute;left:50%;width:560px;margin-left:-280px;padding:14px;border-radius:70px;background:#fff;
    box-shadow:0 0 0 2px #dce6ef,0 50px 110px rgba(20,50,80,.20)}
  .phone .scr{height:var(--vh);border-radius:58px;overflow:hidden}
  .phone img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% var(--fy,0%)}
  .glow{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(92,191,239,.28),rgba(92,191,239,0) 68%)}
  .url{font-weight:700;color:#1f8fd6}
`;

// ---- lockups: logo + wordmark ----
await render(`<div style="display:flex;align-items:center;gap:56px;padding:40px 60px;width:max-content">
    <img src="${LOGO}" style="width:220px"><span style="font-weight:800;font-size:170px;letter-spacing:-.04em">Moonglare</span></div>`,
  `${M}/logo/moonglare-lockup-horizontal.png`, 1400, 320, true);
await render(`<div style="display:grid;justify-items:center;gap:40px;padding:60px;width:900px">
    <img src="${LOGO}" style="width:420px"><span style="font-weight:800;font-size:150px;letter-spacing:-.04em">Moonglare</span></div>`,
  `${M}/logo/moonglare-lockup-stacked.png`, 900, 860, true);
await render(`<div style="display:grid;justify-items:center;gap:40px;padding:60px;width:900px;color:#e8f1f8">
    <img src="${LOGO}" style="width:420px"><span style="font-weight:800;font-size:150px;letter-spacing:-.04em">Moonglare</span></div>`,
  `${M}/logo/moonglare-lockup-stacked-on-dark.png`, 900, 860, true);

// ---- colour swatches ----
const pal = JSON.parse(fs.readFileSync(`${M}/colors/palette.json`, "utf8"));
const sw = (name, hex, dark) => `<div style="border-radius:28px;overflow:hidden;background:#fff;box-shadow:0 0 0 2px #dce6ef">
  <div style="height:170px;background:${hex}"></div><div style="padding:18px 22px"><b style="font-size:26px">${name}</b>
  <div style="font-size:24px;color:#64748a;margin-top:4px">${hex}</div></div></div>`;
const row = (title, obj) => `<h2 style="font-size:30px;margin:44px 0 18px">${title}</h2>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:20px">${Object.entries(obj).filter(([, v]) => typeof v === "string").map(([k, v]) => sw(k, v)).join("")}</div>`;
await render(`<div style="padding:64px 72px;background:#f3f7fb;width:1400px">
  <div style="display:flex;align-items:center;gap:20px"><img src="${LOGO}" style="width:70px"><b style="font-size:54px;letter-spacing:-.03em">Moonglare colours</b></div>
  <div style="height:90px;border-radius:28px;margin-top:40px;background:linear-gradient(135deg,#6fcdf7,#1f8fd6)"></div>
  ${row("Brand", pal.brand)}${row("Light theme", pal.light)}${row("Dark theme", pal.dark)}</div>`,
  `${M}/colors/palette.png`, 1400, 1750);

// ---- Instagram carousel (1080×1350, 4:5) ----
const shot = (n) => img(`${SHOTS}/${n}.png`);
const N = 9, count = (i) => `<div class="count">${String(i).padStart(2, "0")} / ${String(N).padStart(2, "0")}</div>`;
const brand = `<div class="brand"><img src="${LOGO}">Moonglare</div>`;
const phone = (s, top, fy = 0) => `<div class="phone" style="top:${top}px;--vh:${1350 - top + 60}px;--fy:${fy}%"><div class="scr"><img src="${shot(s)}"></div></div>`;
const feature = (i, kicker, title, body, s, top = 700, fy = 0) => `<div class="slide">${brand}${count(i)}
  <div class="glow" style="width:1100px;height:1100px;left:-10px;top:${top - 180}px"></div>
  <div class="text"><p class="kicker">${kicker}</p><h1>${title}</h1><p class="body">${body}</p></div>
  ${phone(s, top, fy)}</div>`;
const pillar = (i, n, title, body, s) => `<div class="slide">${brand}${count(i)}
  <div class="glow" style="width:1100px;height:1100px;left:-10px;top:520px"></div>
  <div class="text"><div class="num">${n}</div><h1>${title}</h1><p class="body">${body}</p></div>
  ${phone(s, 720)}</div>`;

const slides = [
  `<div class="slide" style="display:grid;place-items:center;text-align:center">
    <div class="glow" style="width:1300px;height:1300px;left:-110px;top:-60px"></div>
    <div style="position:relative;display:grid;justify-items:center">
      <img src="${LOGO}" style="width:400px">
      <h1 style="font-size:124px;margin-top:56px">Moonglare</h1>
      <p class="body" style="font-size:40px;max-width:760px;margin-top:22px">See where your time really goes. Then do more of what matters, and less of what doesn't.</p>
    </div>
    <div style="position:absolute;bottom:72px;font-size:30px" class="url">www.moonglare.ee</div></div>`,
  `<div class="slide">${brand}${count(2)}
    <div class="glow" style="width:1300px;height:1300px;left:-110px;top:-240px"></div>
    <div class="text" style="top:250px"><p class="kicker">The idea</p>
      <h1 style="font-size:96px">Better days start with noticing how you spend them.</h1></div>
    <div style="position:absolute;left:72px;right:72px;bottom:96px;display:grid;gap:22px">
      ${[["1", "Reduce bad habits"], ["2", "Reinforce good habits"], ["3", "Understand where the time goes"]].map(([n, t]) =>
        `<div style="display:flex;align-items:center;gap:28px;background:#fff;border-radius:36px;padding:30px 34px;box-shadow:0 0 0 2px #dce6ef">
          <span class="num" style="margin:0">${n}</span><b style="font-size:40px;letter-spacing:-.02em">${t}</b></div>`).join("")}
    </div></div>`,
  pillar(3, 1, "Reduce bad habits", "Mark social media or gaming as habits to cut back. Set a limit and count the days you stay under it.", "idle"),
  pillar(4, 2, "Reinforce good habits", "Goals, streaks, yes/no check-ins and counters. Small wins, made visible, so they keep happening.", "habits"),
  pillar(5, 3, "See where the time goes", "Charts, a weekly review and year-long heatmaps show what your days are really made of.", "overview"),
  feature(6, "Track", "One tap to start, one tap to stop", "Every activity is a tile. See how today's session compares with your usual and your record.", "track"),
  feature(7, "Focus", "A calm screen while you work", "Just the time and one quiet line on how you're doing. Nothing else to look at.", "mini", 640, 50),
  feature(8, "Mastery", "Your 10,000 hours", "Mark a skill and follow every hour toward mastery, with your next milestone and when you'll get there.", "mastery", 640, 88),
  `<div class="slide" style="display:grid;place-items:center;text-align:center">
    <div class="glow" style="width:1300px;height:1300px;left:-110px;top:-60px"></div>
    <div style="position:relative;display:grid;justify-items:center">
      <img src="${LOGO}" style="width:300px">
      <h1 style="font-size:92px;margin-top:56px;max-width:880px">Start noticing today.</h1>
      <p class="body" style="font-size:40px;margin-top:26px">Free · private · works offline</p>
      <div style="margin-top:56px;padding:30px 60px;border-radius:99px;background:#1f8fd6;color:#fff;font-weight:800;font-size:46px;letter-spacing:-.01em">www.moonglare.ee</div>
      <p class="body" style="font-size:30px;margin-top:30px">Open it in your browser and add it to your Home Screen</p>
    </div></div>`,
];
for (const [i, html] of slides.entries()) {
  await render(html, `${M}/instagram/moonglare-post-${String(i + 1).padStart(2, "0")}.png`, 1080, 1350);
  console.log("post", i + 1);
}
await browser.close();
console.log("marketing built");
