(function () {
  let currentSocket = null;

  window.initEmoteSync = function (socket) {
    currentSocket = socket;
  };

  window.sendEmoteToServer = function (emoteId) {
    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      currentSocket.send(JSON.stringify({ type: 'send_emote', emote: emoteId }));
    }
  };
})();