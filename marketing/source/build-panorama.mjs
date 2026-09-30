// A 3-post panorama for the Instagram profile grid: one 3240×1350 top-down desk cut into three 1080×1350 posts.
// Left: a card with the logo · middle: the phone on the calm timer · right: a sheet with the idea and the address.
// The profile grid shows each post as a centred 3:4 crop, so the cards stay well inside each tile; only the
// wood, the light and a few props run across the joins.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "url";

const ROOT = "C:/Users/peter/OneDrive/Desktop/Claude/Timetracker/timetrack";
const M = `${ROOT}/marketing`, OUT = `${M}/instagram/panorama`;
fs.mkdirSync(OUT, { recursive: true });
const img = (p) => pathToFileURL(p).href;
const FONT_CSS = [400, 600, 700, 800].map((w) =>
  `@font-face{font-family:Inter;font-weight:${w};src:url("${img(`${M}/fonts/Inter-${w}.woff2`)}") format("woff2");}`).join("");
const W = 3240, H = 1350;

// warm oak: stretched turbulence for the grain, a fine noise for the pores
const wood = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <filter id="g" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.0022 0.075" numOctaves="4" seed="11"/>
    <feColorMatrix type="matrix" values="0 0 0 0 .80  0 0 0 0 .64  0 0 0 0 .47  0 0 0 -1.1 1.05"/>
  </filter>
  <filter id="p" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
    <feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .38  0 0 0 0 .27  0 0 0 .08 0"/>
  </filter>
  <rect width="100%" height="100%" fill="#dcbd97"/>
  <rect width="100%" height="100%" filter="url(#g)" opacity=".72"/>
  <rect width="100%" height="100%" filter="url(#p)"/>
  <!-- plank seams -->
  <rect y="430" width="100%" height="3" fill="#a8845f" opacity=".45"/>
  <rect y="905" width="100%" height="3" fill="#a8845f" opacity=".45"/>
</svg>`;
const woodUrl = `data:image/svg+xml;base64,${Buffer.from(wood).toString("base64")}`;

// a small plant seen from above: a pot and a rosette of leaves
const leaves = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * 360 + (i % 2) * 12, len = 120 + (i % 3) * 26;
  return `<ellipse cx="0" cy="${-len / 2}" rx="${26 + (i % 2) * 6}" ry="${len / 2}" fill="${i % 2 ? "#4f8a4a" : "#3f7a3d"}" transform="rotate(${a})"/>`;
}).join("");
const plant = `<svg width="420" height="420" viewBox="-210 -210 420 420">
  <circle r="150" fill="#c4b6a4"/><circle r="128" fill="#6b523d"/>${leaves}
  ${Array.from({ length: 8 }, (_, i) => `<ellipse cx="0" cy="-45" rx="18" ry="48" fill="#5f9a57" transform="rotate(${i * 45 + 20})"/>`).join("")}
  <circle r="20" fill="#72ad66"/></svg>`;

const html = `<!doctype html><meta charset="utf-8"><style>${FONT_CSS}
  *{box-sizing:border-box} html,body{margin:0}
  body{font-family:Inter,sans-serif;color:#142230;-webkit-font-smoothing:antialiased}
  .desk{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:url(${woodUrl}) 0 0/${W}px ${H}px}
  .shadow{box-shadow:18px 30px 38px rgba(50,28,10,.30),4px 8px 10px rgba(50,28,10,.22)}
  .paper{position:absolute;background:#fbfaf6;border-radius:10px}
  /* left: the logo card */
  .card{left:250px;top:250px;width:580px;height:760px;transform:rotate(-4deg);display:grid;justify-items:center;align-content:center;gap:34px}
  .card img{width:330px}
  .card b{font-size:92px;font-weight:800;letter-spacing:-.045em}
  .card span{font-size:26px;color:#64748a;font-weight:600;letter-spacing:.02em;margin-top:-18px}
  .plant{position:absolute;left:-120px;top:-150px;filter:drop-shadow(16px 26px 24px rgba(50,28,10,.35))}
  .pencil{position:absolute;left:880px;top:690px;width:18px;height:380px;border-radius:9px;transform:rotate(16deg);
    background:linear-gradient(90deg,#1f8fd6,#5cbfef 45%,#1a7cbc)}
  /* middle: the phone and the coffee */
  .phone{position:absolute;left:${1620 - 200}px;top:215px;width:400px;height:850px;border-radius:64px;background:#15191f;padding:15px;transform:rotate(4deg);
    box-shadow:0 0 0 3px #3a4048,0 0 0 5px #0d1014,26px 44px 50px rgba(50,28,10,.42),6px 12px 14px rgba(50,28,10,.3)}
  .phone::after{content:"";position:absolute;inset:0;border-radius:64px;background:linear-gradient(125deg,rgba(255,255,255,.14),rgba(255,255,255,0) 35%)}
  .phone .scr{width:100%;height:100%;border-radius:50px;overflow:hidden;background:#000;position:relative}
  .phone img{position:absolute;left:0;top:50%;width:100%;transform:translateY(-50%)}
  .phone .island{position:absolute;left:50%;top:32px;width:112px;height:32px;margin-left:-56px;border-radius:16px;background:#000}
  .saucer{position:absolute;left:1905px;top:900px;width:290px;height:290px;border-radius:50%;
    background:radial-gradient(circle at 42% 38%,#ffffff,#ece8e1 70%,#d9d3c9)}
  .cup{position:absolute;inset:46px;border-radius:50%;background:radial-gradient(circle at 40% 36%,#ffffff,#eeeae3);box-shadow:0 0 0 2px #e2ddd4,8px 14px 16px rgba(50,28,10,.25)}
  .coffee{position:absolute;inset:20px;border-radius:50%;background:radial-gradient(circle at 40% 38%,#8b5e3c,#5d3a22 45%,#3b2314);box-shadow:inset 0 6px 14px rgba(0,0,0,.45)}
  .buds{position:absolute;left:1140px;top:1040px;width:150px;height:120px;border-radius:40px;background:linear-gradient(135deg,#ffffff,#e9edf1);transform:rotate(-14deg)}
  /* right: the sheet with the idea, a laptop at the edge */
  .laptop{position:absolute;left:2930px;top:-60px;width:620px;height:820px;border-radius:30px;background:linear-gradient(135deg,#d7dde3,#b9c2cb);transform:rotate(8deg)}
  .laptop i{position:absolute;left:40px;top:60px;width:440px;height:600px;border-radius:14px;
    background:repeating-linear-gradient(90deg,#cbd3da 0 48px,#aeb8c2 48px 52px),#cbd3da}
  .sheet{left:2290px;top:200px;width:720px;height:900px;transform:rotate(3deg);padding:78px 70px}
  .sheet .k{margin:0 0 22px;font-weight:700;font-size:26px;letter-spacing:.14em;text-transform:uppercase;color:#1f8fd6}
  .sheet h2{margin:0;font-weight:800;font-size:66px;line-height:1.06;letter-spacing:-.035em}
  .sheet ol{list-style:none;margin:44px 0 0;padding:0;display:grid;gap:20px}
  .sheet li{display:flex;align-items:center;gap:20px;font-size:33px;font-weight:700;letter-spacing:-.015em}
  .sheet li span{display:grid;place-items:center;flex:none;width:52px;height:52px;border-radius:50%;background:#1f8fd6;color:#fff;font-size:26px;font-weight:800}
  .sheet .url{margin-top:62px;display:inline-block;padding:22px 44px;border-radius:99px;background:#1f8fd6;color:#fff;font-size:40px;font-weight:800;letter-spacing:-.01em}
  .sheet .fine{margin:18px 0 0 6px;font-size:24px;color:#64748a}
  /* window light across the whole desk */
  .light{position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;
    background:linear-gradient(112deg,rgba(255,244,220,0) 0%,rgba(255,244,220,.55) 14%,rgba(255,244,220,0) 15%,rgba(255,244,220,0) 18%,rgba(255,244,220,.5) 19%,rgba(255,244,220,0) 40%,
      rgba(255,244,220,0) 55%,rgba(255,244,220,.45) 70%,rgba(255,244,220,0) 71%,rgba(255,244,220,0) 74%,rgba(255,244,220,.45) 75%,rgba(255,244,220,0) 92%)}
  .vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 60%,rgba(30,16,6,.35) 100%)}
</style>
<div class="desk">
  <div class="plant">${plant}</div>
  <div class="paper card shadow"><img src="${img(`${ROOT}/public/logo.svg`)}"><b>Moonglare</b><span>Time &amp; habit tracker</span></div>
  <div class="pencil shadow"></div>
  <div class="buds shadow"></div>
  <div class="phone"><div class="scr"><img src="${img(`${M}/screenshots/mini.png`)}"><div class="island"></div></div></div>
  <div class="saucer shadow"><div class="cup"><div class="coffee"></div></div></div>
  <div class="laptop shadow"><i></i></div>
  <div class="paper sheet shadow">
    <p class="k">The idea</p>
    <h2>Better days start with noticing how you spend them.</h2>
    <ol><li><span>1</span>Reduce bad habits</li><li><span>2</span>Reinforce good habits</li><li><span>3</span>See where the time goes</li></ol>
    <div class="url">www.moonglare.ee</div><p class="fine">Free · private · works offline</p>
  </div>
  <div class="light"></div><div class="vignette"></div>
</div>`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
const file = path.resolve("build-panorama.html");
fs.writeFileSync(file, html);
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 500));
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
