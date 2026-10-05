// Runs before first paint (render-blocking <script> in index.html) so the
// page never flashes the wrong theme. Saved choice wins; else the OS setting.
(function () {
  var t = "dark";
  try {
    t = localStorage.getItem("theme");
    if (t !== "light" && t !== "dark") {
      t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
  } catch (e) { /* storage blocked: keep dark */ }
  document.documentElement.dataset.theme = t;
})();
