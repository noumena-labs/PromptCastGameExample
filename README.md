# PromptCast Game

## Local Multiplayer Debugging

1. Run `npm run dev` for same-machine browser testing, or `npm run dev:network` to expose the Next dev server on the local network.
2. Open `/` in browser A and click `Inscribe Sigil`.
3. Copy the generated sigil.
4. Open `/` in browser B or an incognito window, enter the sigil, and click `Cross the Threshold`.
5. The host can click `Begin the Duel`; clients auto-route on match start or can click `Step Through` once data-ready.

The multiplayer debug panel is available in development builds and with `?debugNetwork=1`. It shows PeerJS state, lobby/store player ids, message events, drops, and debug actions.

Optional PeerJS client config:

```text
NEXT_PUBLIC_PEER_HOST=localhost
NEXT_PUBLIC_PEER_PORT=9000
NEXT_PUBLIC_PEER_PATH=/
NEXT_PUBLIC_PEER_SECURE=false
NEXT_PUBLIC_PEER_DEBUG=1
NEXT_PUBLIC_MULTIPLAYER_DEBUG=1
```

Direct `/game?mode=host&room=...` URLs only set local game mode; they do not create or rejoin PeerJS sessions. Start from the lobby for real multiplayer sessions.
