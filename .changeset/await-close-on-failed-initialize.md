---
'@modelcontextprotocol/client': patch
---

When the `initialize` handshake fails (for example because the server answers with a protocol version the client does not support), `Client.connect()` now waits for the transport's `close()` to finish before rejecting. Before, it started the close without waiting for it, so with `StdioClientTransport` the client still held the transport when `connect()` rejected, and a `connect()` retried straight away failed with `Connection closed` once the first server process exited. An error from that close no longer surfaces as an unhandled rejection; `connect()` rejects with the handshake error.
