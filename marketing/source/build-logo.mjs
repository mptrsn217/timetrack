import fs from "fs";
const P = process.argv[2];
const C = "#5b50d8", cx = 256;
const moonY = 196, R = 84, SW = 18;          // the moon: one hollow circle
const hz = moonY + R + SW / 2 + 22;           // horizon just under it
// the reflection: rows inside a half-circle as wide as the moon, with uneven breaks and a slight drift
const rows = [
  [0, [0.78]], [3, [0.34]], [-3, [0.62]], [4, [0.22, 0.7]], [-2, [0.5]], [2, []],
];
const top = hz + 21, gap = 18, RR = R + SW / 2;
// violet near the horizon, cooling to light blue with depth: crisp colours instead of fading opacity
const ROWC = ["#2596db", "#31a3e3", "#43b1ea", "#5cbfef", "#7fcdf3", "#a8def8"];
let lines = "";
rows.forEach(([dx, breaks], i) => {
  // an ellipse whose widest row sits a little below the horizon: narrower at the top, rounded at the bottom
  const y = top + i * gap, u = (i - 2) / 3.45;
  const hw = RR * 0.97 * Math.sqrt(Math.max(0, 1 - u * u));
  const x1 = cx - hw + dx, x2 = cx + hw + dx;
  const cuts = [x1, ...breaks.map((b) => x1 + b * (x2 - x1)), x2];
  const col = ROWC[i];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k] + (k ? 9 : 0), b = cuts[k + 1] - (k < cuts.length - 2 ? 9 : 0);
    if (b - a > 4) lines += `    <line x1="${a.toFixed(1)}" y1="${y}" x2="${b.toFixed(1)}" y2="${y}" stroke="${col}"/>\n`;
  }
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Moonglare: a hollow moon over a horizon, with its reflection broken on the water.
       Full-bleed so it also works as a maskable icon. -->
  <defs>
    <linearGradient id="moon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6fcdf7"/>
      <stop offset="1" stop-color="#1f8fd6"/>
    </linearGradient>
    <linearGradient id="horizon" gradientUnits="userSpaceOnUse" x1="${cx - 150}" y1="0" x2="${cx + 150}" y2="0">
      <stop offset="0" stop-color="#6fcdf7" stop-opacity=".25"/>
      <stop offset=".5" stop-color="#3aa8e6"/>
      <stop offset="1" stop-color="#1f8fd6" stop-opacity=".25"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#ffffff"/>
  <circle cx="${cx}" cy="${moonY}" r="${R}" fill="none" stroke="url(#moon)" stroke-width="${SW}"/>
  <line x1="${cx - 150}" y1="${hz}" x2="${cx + 150}" y2="${hz}" stroke="url(#horizon)" stroke-width="8" stroke-linecap="round"/>
  <g stroke-width="10" stroke-linecap="round">
${lines}  </g>
</svg>
`;
fs.writeFileSync(`${P}/icon.svg`, svg);
// the free-standing logo: same drawing, no background, cropped to the artwork
const logo = svg
  .replace('viewBox="0 0 512 512"', 'viewBox="98 96 316 340"')
  .replace('  <rect width="512" height="512" fill="#ffffff"/>\n', "")
  .replace(/<!--[\s\S]*?-->/, "<!-- Moonglare logo on a transparent background (the app icon is icon.svg) -->");
fs.writeFileSync(`${P}/logo.svg`, logo);
console.log("moon top", moonY - R - SW / 2, "horizon", hz, "last row", top + (rows.length - 1) * gap);
