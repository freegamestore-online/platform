// /ideas — client-side filtering (status, category, search) and copy-prompt.
// Progressive enhancement: the full list renders server-side; this only
// filters what's already there.
(function () {
  "use strict";
  var grid = document.getElementById("ideas-grid");
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll(".ideas-card"));
  var empty = grid.querySelector(".ideas-empty");
  var search = document.getElementById("ideas-search");
  var statusBtns = Array.prototype.slice.call(document.querySelectorAll(".ideas-filters [data-status], .ideas-filters [data-statuses]"));
  var catBtns = Array.prototype.slice.call(document.querySelectorAll(".ideas-filters-cat [data-category]"));

  var activeStatuses = null; // null = all
  var activeCategory = ""; // "" = all
  var query = "";

  function apply() {
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var okStatus = !activeStatuses || activeStatuses.indexOf(c.getAttribute("data-status")) !== -1;
      var okCat = !activeCategory || c.getAttribute("data-category") === activeCategory;
      var okSearch = !query || (c.getAttribute("data-search") || "").indexOf(query) !== -1;
      var show = okStatus && okCat && okSearch;
      c.hidden = !show;
      if (show) shown++;
    }
    if (empty) empty.hidden = shown !== 0;
  }

  function selectStatus(btn) {
    for (var i = 0; i < statusBtns.length; i++) {
      var on = statusBtns[i] === btn;
      statusBtns[i].classList.toggle("active", on);
      statusBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var list = btn.getAttribute("data-statuses");
    activeStatuses = list ? list.split(" ").filter(Boolean) : null;
    apply();
  }

  function selectCategory(btn) {
    for (var i = 0; i < catBtns.length; i++) {
      var on = catBtns[i] === btn;
      catBtns[i].classList.toggle("active", on);
      catBtns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    activeCategory = btn.getAttribute("data-category") || "";
    apply();
  }

  statusBtns.forEach(function (b) { b.addEventListener("click", function () { selectStatus(b); }); });
  catBtns.forEach(function (b) { b.addEventListener("click", function () { selectCategory(b); }); });

  if (search) {
    search.addEventListener("input", function () {
      query = search.value.trim().toLowerCase();
      apply();
    });
  }

  // Copy build prompt
  grid.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".ideas-copy") : null;
    if (!btn) return;
    var prompt = btn.getAttribute("data-prompt") || "";
    var done = function () {
      var old = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(function () { btn.textContent = old; btn.classList.remove("copied"); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(prompt).then(done, function () {});
    } else {
      var ta = document.createElement("textarea");
      ta.value = prompt;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (err) {}
      document.body.removeChild(ta);
    }
  });

  // Honour the server-marked active status button so the highlighted filter
  // and the visible cards agree on load (#411). apply() runs as a side effect.
  var initialBtn = statusBtns.filter(function (b) { return b.classList.contains("active"); })[0];
  if (initialBtn) selectStatus(initialBtn); else apply();

  // Deep link: #idea-<id> opens that card's build notes and scrolls to it.
  if (location.hash && /^#idea-/.test(location.hash)) {
    var target = document.getElementById(location.hash.slice(1));
    if (target && target.classList.contains("ideas-card")) {
      var d = target.querySelector(".ideas-details");
      if (d) d.open = true;
      target.scrollIntoView();
    }
  }
})();
