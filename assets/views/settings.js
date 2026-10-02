// 设置视图：色盲 / 高对比 / 暗色
window.ColorMood = window.ColorMood || {};
window.ColorMood.views = window.ColorMood.views || {};
window.ColorMood.views.settings = (function () {
  const store = window.ColorMood.store;

  function apply() {
    const p = store.state.prefs;
    document.body.classList.toggle("dark", store.state.theme === "dark");
    document.getElementById("set-colorblind").checked = !!p.colorblind;
    document.getElementById("set-dark").checked = store.state.theme === "dark";
  }

  function init() {
    document.getElementById("btn-settings").addEventListener("click", function () {
      apply();
      document.getElementById("view-settings").classList.remove("hidden");
    });
    document.getElementById("set-colorblind").addEventListener("change", function (e) {
      store.state.prefs.colorblind = e.target.checked;
      store.savePrefs();
      store.emit("prefsChanged");
    });
    document.getElementById("set-dark").addEventListener("change", function (e) {
      store.set("theme", e.target.checked ? "dark" : "light");
      store.savePrefs();
      apply();
    });
  }

  return { init: init, apply: apply };
})();
