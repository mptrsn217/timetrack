// apply a chosen theme before anything is drawn, so the page never flashes the other one
try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}
