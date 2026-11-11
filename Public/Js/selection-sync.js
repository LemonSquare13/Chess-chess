(function () {
  let currentSocket = null;

  window.initSelectionSync = function (socket) {
    currentSocket = socket;
  };

  window.broadcastLiveSelection = function (x, y) {
    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      currentSocket.send(JSON.stringify({ type: 'select_square', square: [x, y] }));
    }
  };

  window.clearLiveSelectionBroadcast = function () {
    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      currentSocket.send(JSON.stringify({ type: 'select_square', square: null }));
    }
  };
})();