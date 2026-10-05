/**
 * FreeGameStore per-game detail page — interactive layer.
 *
 * Loaded by templates/game-detail.html. Reads the game's id from a JSON island
 * (<script type="application/json" id="page-data">) so the page can stay CSP-locked
 * (script-src 'self' + theme-bootstrap hash, no 'unsafe-inline').
 */
(function () {
  var APP_ID = "";
  try {
    var raw = document.getElementById("page-data")?.textContent;
    if (raw) APP_ID = (JSON.parse(raw) || {}).id || "";
  } catch (e) {}
  if (!APP_ID) return;

  // ── Reload-preview button ──
  document.querySelectorAll('[data-action="reload-preview"]').forEach(function (btn) {
    btn.addEventListener("click", function () {
      var iframe = document.querySelector(".phone-frame iframe");
      if (!iframe) return;
      var url = new URL(iframe.src);
      url.searchParams.set("_r", Date.now().toString(36));
      iframe.src = url.toString();
    });
  });

  // ── Thumbs up / down ratings (localStorage per-browser) ──
  var KEY = "fgs_voted_" + APP_ID;
  var COUNTS_KEY = "fgs_counts_" + APP_ID;
  var upBtn = document.getElementById("rate-up");
  var downBtn = document.getElementById("rate-down");
  var countUp = document.getElementById("count-up");
  var countDown = document.getElementById("count-down");
  var statusEl = document.getElementById("rating-status");
  if (!upBtn || !downBtn || !countUp || !countDown || !statusEl) return;

  var counts = { up: 0, down: 0 };
  try { var stored = localStorage.getItem(COUNTS_KEY); if (stored) counts = JSON.parse(stored); } catch (e) {}
  countUp.textContent = counts.up;
  countDown.textContent = counts.down;

  var voted = null;
  try { voted = localStorage.getItem(KEY); } catch (e) {}
  if (voted) {
    statusEl.textContent = "You voted " + (voted === "up" ? "👍" : "👎");
    upBtn.disabled = true;
    downBtn.disabled = true;
    upBtn.style.opacity = voted === "up" ? "1" : "0.4";
    downBtn.style.opacity = voted === "down" ? "1" : "0.4";
  }

  function vote(dir) {
    try { if (localStorage.getItem(KEY)) return; } catch (e) {}
    try { localStorage.setItem(KEY, dir); } catch (e) {}
    statusEl.textContent = "Thanks!";
    upBtn.disabled = true;
    downBtn.disabled = true;
    upBtn.style.opacity = dir === "up" ? "1" : "0.4";
    downBtn.style.opacity = dir === "down" ? "1" : "0.4";
    counts[dir]++;
    var el = dir === "up" ? countUp : countDown;
    el.textContent = counts[dir];
    try { localStorage.setItem(COUNTS_KEY, JSON.stringify(counts)); } catch (e) {}
  }

  upBtn.addEventListener("click", function () { vote("up"); });
  downBtn.addEventListener("click", function () { vote("down"); });
})();
