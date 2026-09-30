// A 3-post panorama for the Instagram profile grid: one 3240×1350 scene cut into three 1080×1350 posts.
// The profile grid shows each post as a centred 3:4 crop, so everything important stays 60px+ away from the
// tile edges; only the horizon line and the water run across the joins.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "url";

const ROOT = "C:/Users/peter/OneDrive/Desktop/Claude/Timetracker/timetrack";
const M = `${ROOT}/marketing`, OUT = `${M}/instagram/banner-images`;
fs.mkdirSync(OUT, { recursive: true });
const img = (p) => pathToFileURL(p).href;
const FONT_CSS = [400, 600, 700, 800].map((w) =>
  `@font-face{font-family:Inter;font-weight:${w};src:url("${img(`${M}/fonts/Inter-${w}.woff2`)}") format("woff2");}`).join("");

const W = 3240, H = 1350, HZ = 900; // horizon height
const LOGO_W = 640, LOGO_H = LOGO_W * 340 / 316, LOGO_HZ = LOGO_H * (311 - 96) / 340; // the logo's own horizon

// faint glints on the water, spread across the whole width
let seed = 5;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const glints = Array.from({ length: 60 }, () => {
  const y = HZ + 30 + rnd() ** 1.6 * 380, w = 30 + rnd() * 140 * (1 - (y - HZ) / 450);
  return `<rect x="${(rnd() * W).toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="6" rx="3" fill="#5cbfef" opacity="${(0.08 + rnd() * 0.14).toFixed(2)}"/>`;
}).join("");

const html = `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}
  *{box-sizing:border-box} html,body{margin:0}
  body{font-family:Inter,sans-serif;color:#142230;-webkit-font-smoothing:antialiased}
  .pano{position:relative;width:${W}px;height:${H}px;overflow:hidden;
    background:linear-gradient(#ffffff 0%,#f3f7fb 45%,#e6f2fb ${HZ / H * 100}%,#dcecf8 ${HZ / H * 100}%,#f3f7fb 100%)}
  .glow{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(92,191,239,.30),rgba(92,191,239,0) 68%)}
  .hz{position:absolute;left:0;right:0;top:${HZ - 3}px;height:6px;
    background:linear-gradient(90deg,rgba(111,205,247,.2),#3aa8e6 18%,#6fcdf7 50%,#3aa8e6 82%,rgba(31,143,214,.2))}
  svg.water{position:absolute;left:0;top:0}
  /* left post: the logo standing on the horizon, name above */
  .logo{position:absolute;left:${540 - LOGO_W / 2}px;top:${HZ - LOGO_HZ}px;width:${LOGO_W}px}
  .name{position:absolute;left:0;width:1080px;top:150px;text-align:center;font-weight:800;font-size:150px;letter-spacing:-.045em}
  /* middle post: the phone on the water, reflected */
  .phone{position:absolute;left:${1620 - 185}px;top:${HZ - 780}px;width:370px;height:780px;border-radius:60px;background:#15191f;padding:15px;
    box-shadow:0 0 0 3px #3a4048,0 40px 80px rgba(20,50,80,.25);-webkit-box-reflect:below 12px linear-gradient(transparent 62%,rgba(0,0,0,.22))}
  .phone .scr{width:100%;height:100%;border-radius:52px;overflow:hidden;background:#000;position:relative}
  .phone img{position:absolute;left:0;top:50%;width:100%;transform:translateY(-50%)}
  .phone .island{position:absolute;left:50%;top:34px;width:116px;height:34px;margin-left:-58px;border-radius:17px;background:#000}
  /* right post: the idea */
  .idea{position:absolute;left:${2160 + 110}px;width:${1080 - 220}px;top:170px}
  .kicker{margin:0 0 26px;font-weight:700;font-size:28px;letter-spacing:.14em;text-transform:uppercase;color:#1f8fd6}
  .idea h2{margin:0;font-weight:800;font-size:84px;line-height:1.04;letter-spacing:-.035em}
  .idea ol{list-style:none;margin:48px 0 0;padding:0;display:grid;gap:22px}
  .idea li{display:flex;align-items:center;gap:22px;font-size:36px;font-weight:700;letter-spacing:-.015em}
  .idea li span{display:grid;place-items:center;flex:none;width:56px;height:56px;border-radius:50%;background:#1f8fd6;color:#fff;font-size:28px;font-weight:800}
  .url{position:absolute;left:${2160}px;width:1080px;top:${HZ + 150}px;text-align:center}
  .url b{display:inline-block;padding:26px 56px;border-radius:99px;background:#1f8fd6;color:#fff;font-size:46px;font-weight:800;letter-spacing:-.01em;
    box-shadow:0 20px 50px rgba(31,143,214,.28)}
  .url p{margin:22px 0 0;font-size:28px;color:#64748a}
</style>
<div class="pano">
  <div class="glow" style="width:1100px;height:1100px;left:-10px;top:${HZ - 820}px"></div>
  <div class="glow" style="width:1000px;height:1000px;left:${1620 - 500}px;top:${HZ - 900}px"></div>
  <svg class="water" width="${W}" height="${H}">${glints}</svg>
  <div class="hz"></div>
  <div class="name">Moonglare</div>
  <img class="logo" src="${img(`${ROOT}/public/logo.svg`)}">
  <div class="phone"><div class="scr"><img src="${img(`${M}/screenshots/mini.png`)}"><div class="island"></div></div></div>
  <div class="idea">
    <p class="kicker">The idea</p>
    <h2>Better days start with noticing how you spend them.</h2>
    <ol><li><span>1</span>Reduce bad habits</li><li><span>2</span>Reinforce good habits</li><li><span>3</span>See where the time goes</li></ol>
  </div>
  <div class="url"><b>www.moonglare.ee</b></div>
</div>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
const file = path.resolve("build-panorama.html");
fs.writeFileSync(file, html);
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));
const full = `${OUT}/moonglare-panorama-full.png`;
await page.screenshot({ path: full });
fs.unlinkSync(file);
await browser.close();

// the three posts, and a preview of how they sit in the profile grid (3:4 crops with small gaps)
for (let i = 0; i < 3; i++) {
  await sharp(full).extract({ left: i * 1080, top: 0, width: 1080, height: 1350 }).png().toFile(`${OUT}/moonglare-panorama-${i + 1}.png`);
}
const cropW = Math.round(1350 * 3 / 4), gap = 6;
const crops = await Promise.all([0, 1, 2].map((i) =>
  sharp(full).extract({ left: i * 1080 + Math.round((1080 - cropW) / 2), top: 0, width: cropW, height: 1350 }).toBuffer()));
await sharp({ create: { width: cropW * 3 + gap * 2, height: 1350, channels: 3, background: "#ffffff" } })
  .composite(crops.map((b, i) => ({ input: b, left: i * (cropW + gap), top: 0 }))).jpeg({ quality: 88 })
  .toFile(`${OUT}/preview-profile-grid.jpg`);
console.log("panorama done");
