// A product-style mockup: the phone lying on a wooden desk in window light, showing the minimal timer.
// Drawn with CSS 3D and SVG textures (no photo). Outputs a clean image and an Instagram post version.
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "url";

const ROOT = "C:/Users/peter/OneDrive/Desktop/Claude/Timetracker/timetrack";
const M = `${ROOT}/marketing`, OUT = `${M}/instagram`;
const img = (p) => pathToFileURL(p).href;
const FONT_CSS = [400, 600, 700, 800].map((w) =>
  `@font-face{font-family:Inter;font-weight:${w};src:url("${img(`${M}/fonts/Inter-${w}.woff2`)}") format("woff2");}`).join("");

// warm oak: stretched turbulence for the grain, tinted with a colour matrix
const wood = `<svg xmlns="http://www.w3.org/2000/svg" width="2600" height="2600">
  <filter id="g" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.0025 0.09" numOctaves="4" seed="11"/>
    <feColorMatrix type="matrix" values="0 0 0 0 .80  0 0 0 0 .64  0 0 0 0 .47  0 0 0 -1.1 1.05"/>
  </filter>
  <filter id="p" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
    <feColorMatrix type="matrix" values="0 0 0 0 .5  0 0 0 0 .38  0 0 0 0 .27  0 0 0 .08 0"/>
  </filter>
  <rect width="100%" height="100%" fill="#d9b891"/>
  <rect width="100%" height="100%" filter="url(#g)" opacity=".75"/>
  <rect width="100%" height="100%" filter="url(#p)"/>
</svg>`;
const woodUrl = `data:image/svg+xml;base64,${Buffer.from(wood).toString("base64")}`;

const scene = (w, h) => `
<div class="scene" style="width:${w}px;height:${h}px">
  <div class="desk" style="background-image:url(${woodUrl})">
    <!-- notebook and pen -->
    <div class="note"><div class="lines"></div></div>
    <div class="pen"></div>
    <!-- coffee -->
    <div class="saucer"><div class="cup"><div class="coffee"></div></div></div>
    <!-- the phone -->
    <div class="phone"><div class="screen"><img src="${img(`${M}/screenshots/mini.png`)}"></div><div class="island"></div></div>
  </div>
  <!-- window light and leaf shadows falling across the desk -->
  <div class="light"></div>
  <div class="vignette"></div>
</div>`;

const CSS = `${FONT_CSS}
  *{box-sizing:border-box} html,body{margin:0;background:#1a120c}
  body{font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}
  .scene{position:relative;overflow:hidden;perspective:1600px;background:#b8946c}
  .desk{position:absolute;left:50%;top:50%;width:2600px;height:2600px;margin:-1300px 0 0 -1300px;background-size:cover;
    transform:rotateX(34deg) rotateZ(-9deg) translateY(40px);transform-style:preserve-3d}
  .phone{position:absolute;left:1120px;top:960px;width:380px;height:808px;border-radius:62px;background:#15191f;
    box-shadow:0 0 0 3px #3a4048, 0 0 0 5px #0d1014, 30px 60px 60px rgba(40,22,8,.45), 8px 16px 18px rgba(40,22,8,.35);
    transform:rotate(7deg)}
  .phone::after{content:"";position:absolute;inset:0;border-radius:62px;pointer-events:none;
    background:linear-gradient(125deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,0) 35%,rgba(255,255,255,0) 70%,rgba(255,255,255,.06) 100%)}
  .screen{position:absolute;inset:14px;border-radius:50px;overflow:hidden;background:#000}
  .screen img{position:absolute;left:0;top:50%;width:100%;transform:translateY(-50%)}
  .island{position:absolute;left:50%;top:30px;width:110px;height:32px;margin-left:-55px;border-radius:16px;background:#000}
  .note{position:absolute;left:1560px;top:1300px;width:420px;height:540px;border-radius:14px;background:#f6f3ec;transform:rotate(-12deg);
    box-shadow:22px 34px 40px rgba(40,22,8,.30),inset -14px 0 0 #e9e4d8}
  .lines{position:absolute;left:44px;right:56px;top:80px;bottom:60px;
    background:repeating-linear-gradient(to bottom,transparent 0 38px,#d8e3ee 38px 40px)}
  .pen{position:absolute;left:1520px;top:1160px;width:22px;height:430px;border-radius:11px;transform:rotate(28deg);
    background:linear-gradient(90deg,#1f8fd6,#5cbfef 45%,#1a7cbc);box-shadow:16px 20px 18px rgba(40,22,8,.35)}
  .saucer{position:absolute;left:820px;top:780px;width:300px;height:300px;border-radius:50%;
    background:radial-gradient(circle at 42% 38%,#ffffff,#ece8e1 70%,#d9d3c9);box-shadow:24px 36px 36px rgba(40,22,8,.32)}
  .cup{position:absolute;left:48px;top:48px;width:204px;height:204px;border-radius:50%;background:radial-gradient(circle at 40% 36%,#ffffff,#eeeae3);
    box-shadow:0 0 0 2px #e2ddd4, 10px 16px 18px rgba(40,22,8,.25)}
  .coffee{position:absolute;inset:20px;border-radius:50%;
    background:radial-gradient(circle at 40% 38%,#8b5e3c 0,#5d3a22 45%,#3b2314 100%);box-shadow:inset 0 6px 14px rgba(0,0,0,.45)}
  .light{position:absolute;inset:0;pointer-events:none;mix-blend-mode:soft-light;
    background:
      linear-gradient(118deg,rgba(255,244,220,.0) 0%,rgba(255,244,220,.55) 30%,rgba(255,244,220,.0) 31%,rgba(255,244,220,.0) 36%,rgba(255,244,220,.55) 37%,rgba(255,244,220,0) 62%),
      radial-gradient(ellipse at 15% 10%,rgba(255,240,210,.6),rgba(255,240,210,0) 60%)}
  .vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 55% 50%,rgba(0,0,0,0) 55%,rgba(30,16,6,.45) 100%)}

  .post{position:relative;width:1080px;height:1350px;overflow:hidden}
  .post .scene{position:absolute;inset:0}
  .overlay{position:absolute;left:0;right:0;top:0;height:420px;background:linear-gradient(rgba(12,8,4,.62),rgba(12,8,4,0))}
  .brand{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px;font-weight:800;font-size:34px;color:#fff;letter-spacing:-.01em}
  .brand img{width:40px;height:43px}
  .head{position:absolute;left:72px;right:72px;top:150px;color:#fff;font-weight:800;font-size:70px;line-height:1.05;letter-spacing:-.035em;
    text-shadow:0 2px 24px rgba(0,0,0,.35)}
  .bottom{position:absolute;left:0;right:0;bottom:0;height:300px;background:linear-gradient(rgba(12,8,4,0),rgba(12,8,4,.7))}
  .sub{position:absolute;left:72px;right:72px;bottom:64px;display:flex;justify-content:space-between;align-items:flex-end;color:#fff}
  .sub p{margin:0;font-size:34px;font-weight:600;line-height:1.3;max-width:640px}
  .sub b{font-size:28px;font-weight:800;color:#8fd4f7}
`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
async function render(name, body, w, h) {
  const file = path.resolve(`build-${name}.html`);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${body}`);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  fs.unlinkSync(file);
  console.log("made", name);
}
await render("moonglare-desk-timer", scene(1080, 1350), 1080, 1350);
await render("moonglare-desk-timer-post", `<div class="post">${scene(1080, 1350)}
  <div class="overlay"></div><div class="bottom"></div>
  <div class="brand"><img src="${img(`${ROOT}/public/logo.svg`)}">Moonglare</div>
  <div class="head">Start the timer.<br>Put the phone down.</div>
  <div class="sub"><p>Just the time and one quiet line on how you're doing.</p><b>www.moonglare.ee</b></div></div>`, 1080, 1350);
await browser.close();
