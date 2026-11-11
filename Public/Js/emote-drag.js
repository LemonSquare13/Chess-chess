(function () {
  let draggedEmote = null;
  let ghostEl = null;

  window.initEmoteDrag = function (onDropCallback) {
    document.querySelectorAll('.emote-item').forEach(item => {
      // Mouse events
      item.addEventListener('mousedown', startDrag);
      // Touch events
      item.addEventListener('touchstart', startDrag, { passive: false });
    });

    function startDrag(e) {
      e.preventDefault();
      const emoteId = e.target.dataset.emote;
      const emoteChar = e.target.textContent;
      draggedEmote = emoteId;

      // Create ghost
      ghostEl = document.createElement('div');
      ghostEl.className = 'emote-drag-ghost';
      ghostEl.textContent = emoteChar;
      document.body.appendChild(ghostEl);

      moveGhost(e);

      // Attach global listeners
      window.addEventListener('mousemove', moveGhost);
      window.addEventListener('touchmove', moveGhost, { passive: false });
      
      window.addEventListener('mouseup', endDrag);
      window.addEventListener('touchend', endDrag);
    }

    function moveGhost(e) {
      if (!ghostEl) return;
      e.preventDefault(); // Iwasan mag-scroll habang dinadrag
      
      let clientX, clientY;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      ghostEl.style.left = clientX + 'px';
      ghostEl.style.top = clientY + 'px';
    }

    function endDrag(e) {
      if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
      }
      
      window.removeEventListener('mousemove', moveGhost);
      window.removeEventListener('touchmove', moveGhost);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchend', endDrag);

      if (draggedEmote) {
        onDropCallback(draggedEmote);
        draggedEmote = null;
      }
    }
  };
})();