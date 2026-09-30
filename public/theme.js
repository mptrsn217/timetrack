// apply a chosen theme before anything is drawn, so the page never flashes the other one
try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}
// the startup intro plays once per app launch (a new session), not on every reload
try { if (sessionStorage.getItem("introSeen")) document.documentElement.classList.add("nointro"); } catch {}
