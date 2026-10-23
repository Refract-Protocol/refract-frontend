/** Canonical API-to-realtime endpoint derivation shared by Next config and browser code. */
function endpointFromApiBase(apiBaseUrl) {
  const api = new URL(apiBaseUrl || "http://localhost:4001/api/v1");
  const websocketProtocol = api.protocol === "https:" ? "wss:" : "ws:";
  const websocket = new URL(api.pathname.replace(/\/api\/v1\/?$/, "/ws"), api);
  websocket.protocol = websocketProtocol;
  return {
    url: websocket.toString(),
    apiOrigin: api.origin,
    websocketOrigin: `${websocket.protocol}//${websocket.host}`,
  };
}

module.exports = { endpointFromApiBase };
