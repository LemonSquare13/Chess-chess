(function () {
  const emoteMap = {
    'haha': '😂',
    'blee': '😝',
    'inlove': '😍',
    'wow': '😲'
  };

  window.initEmoteSystem = function () {
    const btn = document.getElementById('emoteBtn');
    const menu = document.getElementById('emoteMenu');
    const popupContainer = document.getElementById('emotePopupContainer');

    if (!btn || !menu || !popupContainer) return;

    // Toggle menu
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    // Close menu if clicked elsewhere
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.classList.remove('open');
      }
    });

    // Init drag
    window.initEmoteDrag((emoteId) => {
      menu.classList.remove('open');
      window.sendEmoteToServer(emoteId);
      // TINANGGAL NATIN YUNG LOCAL PREVIEW DITO PARA HINDI MAG-DOBLE
    });

    // Listen to socket (tinatawag ito ng app.js)
    window.receiveEmoteFromServer = function (emoteId, senderName) {
      showEmoteOnScreen(emoteId, senderName);
    };

    function showEmoteOnScreen(emoteId, senderName) {
      const char = emoteMap[emoteId];
      if (!char) return;

      const el = document.createElement('div');
      el.className = 'emote-popup';
      el.innerHTML = `
        <div class="popup-sender">${senderName}</div>
        <div class="popup-icon">${char}</div>
      `;

      popupContainer.appendChild(el);

      // Auto dismiss after 3 seconds
      setTimeout(() => {
        el.classList.add('exit');
        setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
      }, 3000);
    }
  };
})();