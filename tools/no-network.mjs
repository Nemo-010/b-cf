// Poison every way a Node process can reach the network, then let the test
// runner load.  Used to prove the reference implementation's test suite is
// hermetic: it must pass with no sockets and no name resolution at all.
//
//   node --import tools/no-network.mjs --test reference/test/*.test.mjs
//
// If a test reaches for the Electrosphere, this throws with the call site
// instead of quietly succeeding on a machine that happens to be online.
import net from 'node:net';
import dns from 'node:dns';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

const block = (what) => (...args) => {
  throw new Error(`NETWORK ACCESS ATTEMPTED via ${what}(${args.map((a) => JSON.stringify(a)).join(', ')})`);
};

net.connect = block('net.connect');
net.createConnection = block('net.createConnection');
net.Socket.prototype.connect = block('net.Socket#connect');
dns.lookup = block('dns.lookup');
dns.resolve = block('dns.resolve');
dns.resolve4 = block('dns.resolve4');
dns.resolve6 = block('dns.resolve6');
if (dns.promises) {
  dns.promises.lookup = block('dns.promises.lookup');
  dns.promises.resolve = block('dns.promises.resolve');
}
tls.connect = block('tls.connect');
http.request = block('http.request');
https.request = block('https.request');
http.get = block('http.get');
https.get = block('https.get');

globalThis.fetch = block('globalThis.fetch');
