// Three "fact" posts for Instagram: a person (or hands) with a phone showing Moonglare, one researched fact,
// and a line that points to the app. 1080×1350. Illustrations are drawn in SVG in the brand colours.
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "url";

const ROOT = "C:/Users/peter/OneDrive/Desktop/Claude/Timetracker/timetrack";
const M = `${ROOT}/marketing`, OUT = `${M}/instagram`;
const img = (p) => pathToFileURL(p).href;
const LOGO = img(`${ROOT}/public/logo.svg`), SHOT = (n) => img(`${M}/screenshots/${n}.png`);
const FONT_CSS = [400, 600, 700, 800].map((w) =>
  `@font-face{font-family:Inter;font-weight:${w};src:url("${img(`${M}/fonts/Inter-${w}.woff2`)}") format("woff2");}`).join("");

const CSS = `${FONT_CSS}
  *{box-sizing:border-box} html,body{margin:0}
  body{font-family:Inter,sans-serif;color:#142230;-webkit-font-smoothing:antialiased}
  .slide{position:relative;width:1080px;height:1350px;overflow:hidden;background:#f3f7fb}
  .brand{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px;font-weight:800;font-size:34px;letter-spacing:-.01em}
  .brand img{width:40px;height:43px}
  .tag{position:absolute;right:72px;top:70px;font-weight:700;font-size:24px;letter-spacing:.14em;text-transform:uppercase;color:#1f8fd6}
  .text{position:absolute;left:72px;right:72px;top:170px}
  .big{font-weight:800;font-size:210px;line-height:.9;letter-spacing:-.05em;color:#1f8fd6;margin:0}
  .big small{font-size:.42em;letter-spacing:-.03em}
  h1{margin:22px 0 0;font-weight:800;font-size:60px;line-height:1.08;letter-spacing:-.03em;max-width:900px;text-wrap:balance}
  .art{position:absolute;left:72px;right:72px;top:612px;height:548px;border-radius:48px;overflow:hidden;background:#e3f0fa}
  .art svg{display:block;width:100%;height:100%}
  .foot{position:absolute;left:72px;right:72px;bottom:56px;display:flex;justify-content:space-between;align-items:flex-end;gap:40px}
  .line{font-size:32px;font-weight:700;letter-spacing:-.01em;max-width:620px;line-height:1.25}
  .line span{color:#1f8fd6}
  .src{font-size:20px;color:#9fadbc;text-align:right;max-width:330px;line-height:1.35}
`;

// ---- drawing helpers ----
// a phone showing a screenshot, drawn at (x, y), w wide, rotated by deg around its centre
function phone(id, x, y, w, deg, shot, fy = 0) {
  const h = w * 2.05, r = w * 0.16, b = w * 0.045;
  const sw = w - 2 * b, sh = h - 2 * b, imgH = sw * 1688 / 780;
  const off = -(imgH - sh) * fy;
  return `<g transform="rotate(${deg} ${x + w / 2} ${y + h / 2})">
    <rect x="${x + 6}" y="${y + 18}" width="${w}" height="${h}" rx="${r}" fill="#0d1620" opacity=".14" filter="url(#blur)"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#142230"/>
    <clipPath id="${id}"><rect x="${x + b}" y="${y + b}" width="${sw}" height="${sh}" rx="${r - b}"/></clipPath>
    <image href="${SHOT(shot)}" x="${x + b}" y="${y + b + off}" width="${sw}" height="${imgH}" clip-path="url(#${id})" preserveAspectRatio="xMidYMin slice"/>
    <rect x="${x + w / 2 - w * 0.13}" y="${y + b + 8}" width="${w * 0.26}" height="${w * 0.07}" rx="${w * 0.035}" fill="#142230"/>
  </g>`;
}
const defs = `<defs><filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter></defs>`;

// 1 · a person looking at their phone (upper body)
const personArt = `<svg viewBox="60 206 960 562" preserveAspectRatio="xMidYMid slice">${defs}
  <circle cx="540" cy="430" r="300" fill="#d3eaf9"/>
  <!-- body -->
  <path d="M300 760 C300 620 360 560 450 548 L630 548 C720 560 780 620 780 760 Z" fill="#1c3550"/>
  <path d="M488 548 L540 612 L592 548 Z" fill="#f3f7fb" opacity=".9"/>
  <!-- neck and head -->
  <rect x="505" y="440" width="70" height="120" rx="30" fill="#c98e67"/>
  <ellipse cx="540" cy="372" rx="92" ry="104" fill="#e0a984"/>
  <path d="M448 372 C440 270 520 238 568 250 C640 262 660 318 634 372 C628 330 600 300 560 300 C520 300 470 318 448 372 Z" fill="#2b1d17"/>
  <ellipse cx="452" cy="392" rx="14" ry="22" fill="#d49a74"/>
  <!-- looking down: closed eyes and a small smile -->
  <path d="M500 392 q14 10 28 0 M560 392 q14 10 28 0" stroke="#2b1d17" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M526 432 q16 10 32 0" stroke="#a8674a" stroke-width="5" fill="none" stroke-linecap="round"/>
  <!-- arms up to the phone -->
  <path d="M350 760 C360 690 400 650 470 640" stroke="#1c3550" stroke-width="86" fill="none" stroke-linecap="round"/>
  <path d="M730 760 C720 690 680 650 620 640" stroke="#1c3550" stroke-width="86" fill="none" stroke-linecap="round"/>
  ${phone("p1", 462, 470, 170, -6, "idle")}
  <ellipse cx="468" cy="648" rx="34" ry="42" fill="#e0a984"/>
  <ellipse cx="626" cy="640" rx="34" ry="42" fill="#e0a984"/>
</svg>`;

// 2 · a desk seen from above: hands at the laptop, the phone lying face up on the minimal screen
const deskArt = `<svg viewBox="60 60 960 680" preserveAspectRatio="xMidYMid slice">${defs}
  <!-- laptop -->
  <rect x="140" y="150" width="560" height="360" rx="28" fill="#c9d6e2"/>
  <rect x="170" y="180" width="500" height="200" rx="14" fill="#dbe5ee"/>
  ${Array.from({ length: 4 }, (_, r) => Array.from({ length: 11 }, (_, c) =>
    `<rect x="${182 + c * 44}" y="${192 + r * 46}" width="36" height="36" rx="8" fill="#eef3f8"/>`).join("")).join("")}
  <rect x="330" y="400" width="180" height="90" rx="14" fill="#dbe5ee"/>
  <!-- hands and sleeves -->
  <path d="M210 740 L250 560" stroke="#1f8fd6" stroke-width="110" stroke-linecap="round"/>
  <path d="M640 740 L590 560" stroke="#1f8fd6" stroke-width="110" stroke-linecap="round"/>
  <ellipse cx="262" cy="505" rx="62" ry="74" fill="#8d5a3b"/>
  <ellipse cx="578" cy="505" rx="62" ry="74" fill="#8d5a3b"/>
  <!-- coffee -->
  <circle cx="880" cy="170" r="74" fill="#ffffff"/>
  <circle cx="880" cy="170" r="54" fill="#6b4a36"/>
  <circle cx="866" cy="156" r="12" fill="#8b6650" opacity=".7"/>
  <!-- notebook and pen -->
  <rect x="770" y="520" width="200" height="170" rx="16" fill="#ffffff" transform="rotate(-6 870 605)"/>
  ${[0, 1, 2, 3].map((i) => `<rect x="${795}" y="${560 + i * 30}" width="${140 - i * 22}" height="8" rx="4" fill="#dce6ef" transform="rotate(-6 870 605)"/>`).join("")}
  <rect x="930" y="470" width="14" height="190" rx="7" fill="#1f8fd6" transform="rotate(20 937 565)"/>
  ${phone("p2", 752, 240, 150, 8, "mini", 0.42)}
</svg>`;

// 3 · a hand holding the phone on the habits screen, with a 66-day grid filling up behind it
const days = Array.from({ length: 66 }, (_, i) => i);
const gridArt = `<svg viewBox="60 20 960 740" preserveAspectRatio="xMidYMid slice">${defs}
  ${days.map((i) => {
    const c = i % 11, r = Math.floor(i / 11), filled = i < 49;
    return `<rect x="${110 + c * 78}" y="${40 + r * 78}" width="62" height="62" rx="16" fill="${filled ? (i > 40 ? "#5cbfef" : "#1f8fd6") : "#c9d9e6"}" opacity="${filled ? 0.35 + (i / 66) * 0.65 : 1}"/>`;
  }).join("")}
  <!-- sleeve, then the palm behind the phone -->
  <path d="M300 800 C340 720 400 680 470 660" stroke="#d95926" stroke-width="170" fill="none" stroke-linecap="round"/>
  <path d="M430 700 C400 600 420 470 470 440 L700 430 C740 440 745 600 720 680 C680 740 480 760 430 700 Z" fill="#e8b48f"/>
  ${phone("p3", 450, 120, 250, 3, "habits", 0.1)}
  <!-- fingertips curling over the right edge, thumb over the left -->
  ${[0, 1, 2, 3].map((i) => `<rect x="${672 - i * 3}" y="${380 + i * 64}" width="64" height="46" rx="23" fill="#e8b48f" stroke="#d49a74" stroke-width="3"/>`).join("")}
  <path d="M452 600 C430 540 440 480 478 470 C510 462 520 520 510 580 C505 620 470 640 452 600 Z" fill="#e8b48f" stroke="#d49a74" stroke-width="3"/>
</svg>`;

const posts = [
  {
    file: "moonglare-fact-01", tag: "Clarity",
    big: "2×", title: "We use our phones about twice as much as we think we do.",
    line: `You can't change what you can't see. <span>Moonglare shows the real numbers.</span>`,
    src: "Andrews et al. (2015), PLOS ONE: estimated vs. measured smartphone use",
    art: personArt,
  },
  {
    file: "moonglare-fact-02", tag: "Focus",
    big: "23<small> min</small>", title: "After an interruption, it takes about 23 minutes to get fully back on task.",
    line: `Start a timer, put the phone down. <span>One calm screen, nothing to tap.</span>`,
    src: "Gloria Mark, University of California, Irvine: research on interrupted work",
    art: deskArt,
  },
  {
    file: "moonglare-fact-03", tag: "Habits",
    big: "66<small> days</small>", title: "On average, that's how long a new habit takes to become automatic.",
    line: `Missing a day is fine. Keep going. <span>Watch the streak and heatmap fill up.</span>`,
    src: "Lally et al. (2010), European Journal of Social Psychology",
    art: gridArt,
  },
];

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
for (const p of posts) {
  const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="slide">
    <div class="brand"><img src="${LOGO}">Moonglare</div><div class="tag">${p.tag}</div>
    <div class="text"><p class="big">${p.big}</p><h1>${p.title}</h1></div>
    <div class="art">${p.art}</div>
    <div class="foot"><div class="line">${p.line}</div><div class="src">${p.src}</div></div></div>`;
  const file = path.resolve(`build-${p.file}.html`);
  fs.writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}/${p.file}.png` });
  fs.unlinkSync(file);
  console.log("made", p.file);
}
await browser.close();
