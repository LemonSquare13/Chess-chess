LOCAL CHESS ARENA — UPDATED BUILD

WHAT'S NEW
- Added working draw offers (offer, accept, decline) and resignation handling on the server.
- Added clear end-of-game status messages for checkmate, stalemate, draw, and resignation.
- Added board coordinates, stronger board styling, responsive mobile spacing, keyboard focus states, and reduced-motion support.
- Hardened chat rendering against HTML/script injection.
- Added username validation and limits for room names and chat messages.
- Improved passworded-account recovery after a reload or reconnect.
- Kept the project dependency-free: it uses Node.js built-in modules only.

RUN
1. Extract the folder.
2. Open the folder in your Node.js server app / terminal.
3. Run: node server.js
4. Open http://127.0.0.1:3000 on the same device.
5. For another device on the same Wi-Fi, open the LAN address printed by the server, using port 3000.

NOTES
- The server creates users.json automatically when first started.
- The default admin account is admin / admin. Change its password and master key in Settings before using the app on a shared network.
- This is a local-network project; it does not include internet hosting or encrypted WebSocket transport by default.
