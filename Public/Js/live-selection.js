(function () {
  window.clearLiveSelectionUI = function () {
    document.querySelectorAll('.live-select-w, .live-select-b').forEach(el => {
      el.classList.remove('live-select-w', 'live-select-b');
    });
  };

  window.updateLiveSelectionUI = function (selection, myColor) {
    clearLiveSelectionUI();
    if (!selection) return;

    const showOpponent = window.getShowOpponentSelection();

    // Render White's selection
    if (selection.w) {
      // Show if I am spectating, or if I am Black and toggle is ON, or if it's my own selection
      if (!myColor || (myColor === 'b' && showOpponent) || myColor === 'w') {
        const sq = document.querySelector(`.square[data-x="${selection.w[0]}"][data-y="${selection.w[1]}"]`);
        if (sq) sq.classList.add('live-select-w');
      }
    }

    // Render Black's selection
    if (selection.b) {
      // Show if I am spectating, or if I am White and toggle is ON, or if it's my own selection
      if (!myColor || (myColor === 'w' && showOpponent) || myColor === 'b') {
        const sq = document.querySelector(`.square[data-x="${selection.b[0]}"][data-y="${selection.b[1]}"]`);
        if (sq) sq.classList.add('live-select-b');
      }
    }
  };
})();