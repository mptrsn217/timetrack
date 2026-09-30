// Phone-sized screenshots of the demo account, for the landing page.
import puppeteer from "puppeteer-core";
import crypto from "crypto";
import fs from "fs";

const OUT = process.argv[2] || "./out";
fs.mkdirSync(OUT, { recursive: true });
const iat = Date.now(), exp = iat + 864e5, p = `1.${iat}.${exp}`;
const sid = `${p}.${crypto.createHmac("sha256", "testsecret").update(p).digest("base64url")}`;

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--hide-scrollbars", "--lang=en-US"],
});
const page = await browser.newPage();
await page.emulateTimezone("Europe/Tallinn");
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setCookie({ name: "sid", value: sid, domain: "localhost", path: "/" });
await page.evaluateOnNewDocument(() => {
  sessionStorage.setItem("introSeen", "1");
  localStorage.setItem("theme", "light");
  localStorage.setItem("autoScreen", "off");
  localStorage.setItem("installGuideSeen", "1");
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.evaluate(() => document.activeElement?.blur()); await wait(900); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log("shot", name); };

await page.goto("http://localhost:3999/", { waitUntil: "networkidle0" });
await wait(1200);
await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
await shot("track");

await page.evaluate(() => { const m = document.querySelector("h2.section:last-of-type"); window.scrollTo(0, document.body.scrollHeight); });
await shot("mastery");
await page.evaluate(() => window.scrollTo(0, 0));

await page.evaluate(() => openLive());
await shot("live");
await page.evaluate(() => closeLive());

await page.evaluate(() => openMini());
await wait(1400);
await shot("mini");
await page.evaluate(() => closeMini());
await wait(500);

await page.evaluate(() => go("habits"));
await wait(1500);
await shot("habits");

await page.evaluate(() => go("overview"));
await wait(1800);
await shot("overview");
await page.evaluate(() => window.scrollTo(0, 900));
await shot("overview2");

await page.evaluate(() => go("track"));
await wait(800);
await page.evaluate(async () => { await stop(); window.scrollTo(0, 0); });
await wait(1500);
await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
await shot("idle");
await browser.close();
