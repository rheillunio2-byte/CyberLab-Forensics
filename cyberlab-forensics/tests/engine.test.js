// Run with: node tests/engine.test.js   (no dependencies; uses only Node's built-in modules)
const assert = require('assert'), crypto = require('crypto');
const E = require('../analysis.js'), P = require('../pdf-export.js');
const fake = (name, bytes, type) => ({ name, size: bytes.length, type: type || '', lastModified: 0, slice: (s, e) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset + s, bytes.byteOffset + Math.min(e, bytes.length)) }) });
(async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100000]) { // JS fallback must match Node's SHA-256
    const b = new Uint8Array(n).map((_, i) => i * 7), s = new E.Sha256(); s.update(b.subarray(0, n >> 1)); s.update(b.subarray(n >> 1));
    assert.strictEqual(s.hex(), crypto.createHash('sha256').update(b).digest('hex'), 'sha256 length ' + n);
  }
  const text = new TextEncoder().encode('demo\nhttps://example.invalid/x\npowershell -EncodedCommand AAA\n');
  const r = await E.analyze(fake('demo.txt', text, 'text/plain'), null, { demo: true });
  assert.strictEqual(r.sha256, crypto.createHash('sha256').update(text).digest('hex'));
  assert(r.indicators.some(i => i.id === 'kw-powershell') && r.indicators.some(i => i.id === 'kw--encodedcommand'));
  assert(r.behavior.length > 0 && r.score.value > 0 && r.score.value <= 100);
  assert(/NOT EXECUTED/.test(E.reportText(r)));
  const pe = new Uint8Array(1024); pe[0] = 0x4d; pe[1] = 0x5a; pe[0x3c] = 0x80; const dv = new DataView(pe.buffer);
  dv.setUint32(0x80, 0x4550, true); dv.setUint16(0x84, 0x8664, true); dv.setUint16(0x86, 1, true); dv.setUint16(0x94, 0xf0, true); dv.setUint16(0x98, 0x20b, true);
  const pr = await E.analyze(fake('invoice.pdf.exe', pe));
  assert.strictEqual(pr.signature.id, 'pe'); assert(pr.structure.pe.valid); assert(pr.indicators.some(i => i.id === 'double-ext'));
  await assert.rejects(E.analyze(fake('empty', new Uint8Array(0))), /empty/);
  assert(P.build(r, E.reportBlocks(r)).startsWith('%PDF-1.4'));
  console.log('engine tests passed');
})().catch(e => { console.error(e); process.exit(1); });
