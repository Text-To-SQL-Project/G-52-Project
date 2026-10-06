// Runs before first paint (render-blocking <script> in index.html) so the
// page never flashes the wrong theme. Saved choice wins; else light.
(function () {
  var t = "light";
  try {
    t = localStorage.getItem("theme");
    if (t !== "light" && t !== "dark") {
      t = "light"; // light (cream) is the default look; the toggle remembers dark
    }
  } catch (e) { /* storage blocked: keep light */ }
  document.documentElement.dataset.theme = t;
})();
