import { Server } from 'bittorrent-tracker';
import { WebSocket } from 'ws';
const server = new Server({ ws: true, http: false, udp: false, stats: false });
server.listen(0, async () => {
  const port = server.ws.address().port;
  const hashHex = 'a'.repeat(40);
  const announceFrame = (pid) => JSON.stringify({ action: 'announce', 'info_hash': 'aaaaaaaaaaaaaaaaaaaa', peer_id: pid, numwant: 50, compact: false, negotiated: true, left: 1 });
  const mk = (pid) => new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${hashHex}`);
    let first = true;
    ws.onopen = () => ws.send(announceFrame(pid));
    ws.onmessage = (m) => { if (first) { first = false; res({ ws, data: String(m.data) }); } };
    ws.onerror = () => res(null);
  });
  const c1 = await mk('-P2PTEST000000000001');
  console.log('R1:', c1.data.slice(0, 300));
  const c2 = await mk('-P2PTEST000000000002');
  console.log('R2:', c2.data.slice(0, 300));
  // re-announce c1 on same socket
  const upd = new Promise(res => { c1.ws.onmessage = (m) => res(String(m.data)); setTimeout(() => res('none'), 500); });
  c1.ws.send(announceFrame('-P2PTEST000000000001'));
  console.log('C1 UPDATE:', (await upd).slice(0, 300));
  c1.ws.close(); c2.ws.close();
  server.close(() => process.exit(0));
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8000);
