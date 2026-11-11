(function () {
  const SETTING_KEY = 'lca_show_opponent_selection';

  window.getShowOpponentSelection = function () {
    const val = localStorage.getItem(SETTING_KEY);
    return val === null ? true : val === 'true'; // Default to true (ON)
  };

  window.setShowOpponentSelection = function (val) {
    localStorage.setItem(SETTING_KEY, val ? 'true' : 'false');
  };
})();