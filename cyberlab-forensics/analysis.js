/* CyberLab analysis engine — pure static analysis, no DOM, no network, no execution.
 * Uploaded bytes are only ever read as data. Works in browsers and in Node (for tests). */
(function (root) {
'use strict';

const LIMITS = { maxBytes: 25 * 1024 * 1024, minString: 5, maxStrings: 5000, maxStringLen: 300, blocks: 64 };
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- SHA-256 (Web Crypto first, streaming JS fallback) ---------- */
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
class Sha256 {
  constructor() { this.h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); this.buf = new Uint8Array(64); this.bl = 0; this.len = 0; this.w = new Uint32Array(64); }
  _block(b, o) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++) { const j = o + i * 4; w[i] = (b[j] << 24) | (b[j+1] << 16) | (b[j+2] << 8) | b[j+3]; }
    for (let i = 16; i < 64; i++) { const a = w[i-15], c = w[i-2]; w[i] = (w[i-16] + (((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3)) + w[i-7] + (((c>>>17)|(c<<15))^((c>>>19)|(c<<13))^(c>>>10))) | 0; }
    let a = h[0], b1 = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7))) + ((e&f)^(~e&g)) + K[i] + w[i]) | 0;
      const t2 = ((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10))) + ((a&b1)^(a&c)^(b1&c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b1; b1 = a; a = (t1 + t2) | 0;
    }
    h[0]+=a; h[1]+=b1; h[2]+=c; h[3]+=d; h[4]+=e; h[5]+=f; h[6]+=g; h[7]+=hh;
  }
  update(data) {
    this.len += data.length; let i = 0;
    if (this.bl) { while (i < data.length && this.bl < 64) this.buf[this.bl++] = data[i++]; if (this.bl === 64) { this._block(this.buf, 0); this.bl = 0; } }
    for (; i + 64 <= data.length; i += 64) this._block(data, i);
    while (i < data.length) this.buf[this.bl++] = data[i++];
  }
  hex() {
    const bits = this.len * 8, pad = new Uint8Array(((this.bl < 56 ? 56 : 120) - this.bl) + 8);
    pad[0] = 0x80; const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, Math.floor(bits / 4294967296)); dv.setUint32(pad.length - 4, bits >>> 0);
    const keep = this.len; this.update(pad); this.len = keep;
    return [...this.h].map(x => x.toString(16).padStart(8, '0')).join('');
  }
}
async function sha256(bytes) {
  if (root.crypto && root.crypto.subtle) {
    try { const d = await root.crypto.subtle.digest('SHA-256', bytes); return { hex: [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''), method: 'Web Crypto API' }; } catch (e) { /* fall through to JS implementation */ }
  }
  const s = new Sha256();
  for (let i = 0; i < bytes.length; i += 1 << 20) { s.update(bytes.subarray(i, i + (1 << 20))); await tick(); }
  return { hex: s.hex(), method: 'Built-in JavaScript implementation' };
}

/* ---------- Signatures and format identification ---------- */
const SIGS = [
  ['pe','Windows PE / DOS executable (MZ)','executable',[0x4d,0x5a]], ['elf','ELF executable / library','executable',[0x7f,0x45,0x4c,0x46]],
  ['macho','Mach-O executable','executable',[0xcf,0xfa,0xed,0xfe]], ['macho','Mach-O executable','executable',[0xce,0xfa,0xed,0xfe]], ['macho','Mach-O executable','executable',[0xfe,0xed,0xfa,0xcf]],
  ['javaclass','Java class or Mach-O universal binary','executable',[0xca,0xfe,0xba,0xbe]], ['lnk','Windows shortcut (.lnk)','shortcut',[0x4c,0,0,0,0x01,0x14,0x02,0]],
  ['zip','ZIP-based container','archive',[0x50,0x4b,3,4]], ['zip','ZIP-based container (empty)','archive',[0x50,0x4b,5,6]], ['pdf','PDF document','document',[0x25,0x50,0x44,0x46,0x2d]],
  ['ole2','OLE2 compound file (legacy Office / MSI)','document',[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]], ['rtf','RTF document','document',[0x7b,0x5c,0x72,0x74,0x66]],
  ['gzip','GZIP archive','archive',[0x1f,0x8b]], ['7z','7-Zip archive','archive',[0x37,0x7a,0xbc,0xaf,0x27,0x1c]], ['rar','RAR archive','archive',[0x52,0x61,0x72,0x21,0x1a,0x07]],
  ['bzip2','BZip2 archive','archive',[0x42,0x5a,0x68]], ['xz','XZ archive','archive',[0xfd,0x37,0x7a,0x58,0x5a,0]], ['cab','Microsoft Cabinet archive','archive',[0x4d,0x53,0x43,0x46]],
  ['png','PNG image','image',[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]], ['jpeg','JPEG image','image',[0xff,0xd8,0xff]], ['gif','GIF image','image',[0x47,0x49,0x46,0x38]],
  ['sqlite','SQLite database','data',[0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66]], ['shebang','Script with interpreter line (#!)','script',[0x23,0x21]]
];
const EXT_EXPECT = { exe:['pe'],dll:['pe'],scr:['pe'],sys:['pe'],ocx:['pe'],com:['pe'],pdf:['pdf'],zip:['zip'],docx:['zip'],xlsx:['zip'],pptx:['zip'],jar:['zip','javaclass'],apk:['zip'],doc:['ole2','rtf'],xls:['ole2'],ppt:['ole2'],msi:['ole2'],png:['png'],jpg:['jpeg'],jpeg:['jpeg'],gif:['gif'],gz:['gzip'],rtf:['rtf'],'7z':['7z'],rar:['rar'],lnk:['lnk'],elf:['elf'],so:['elf'],class:['javaclass'] };
const EXEC_EXT = ['exe','dll','scr','com','sys','ocx','msi'], SCRIPT_EXT = ['js','vbs','vbe','ps1','bat','cmd','sh','py','hta','wsf','jse'];
const MIME_NOTE = 'MIME type is whatever the browser guessed from the file extension; it is not verified.';

function identify(bytes, name) {
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  for (const [id, label, family, magic] of SIGS) if (bytes.length >= magic.length && magic.every((v, i) => bytes[i] === v)) return { id, name: label, family, ext, matched: true };
  if (bytes.length > 262 && String.fromCharCode(...bytes.subarray(257, 262)) === 'ustar') return { id: 'tar', name: 'TAR archive', family: 'archive', ext, matched: true };
  const head = bytes.subarray(0, 4096); let text = 0;
  for (const b of head) if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) text++;
  if (head.length && text / head.length > 0.95) {
    const s = String.fromCharCode(...head.subarray(0, 64)).trimStart().toLowerCase();
    const label = SCRIPT_EXT.includes(ext) ? 'Script / source text (extension hint)' : s.startsWith('<?xml') ? 'XML text' : (s.startsWith('<!doctype html') || s.startsWith('<html')) ? 'HTML text' : 'Plain text';
    return { id: SCRIPT_EXT.includes(ext) ? 'scripttext' : 'text', name: label, family: SCRIPT_EXT.includes(ext) ? 'script' : 'text', ext, matched: false };
  }
  return { id: 'unknown', name: 'Unknown / generic binary', family: 'unknown', ext, matched: false };
}

/* ---------- Keyword table: [term, label, group, severity, why it can matter] ---------- */
const KEYWORDS = [
  ['powershell','PowerShell reference','command','medium','PowerShell is a legitimate admin shell that is also widely used to run downloaded or encoded commands.'],
  ['cmd.exe','Command shell reference','command','low','Programs spawn the Windows command shell for both legitimate and abusive purposes.'],
  ['wscript.shell','Windows Script Host shell object','script','medium','Lets scripts run programs and edit the registry.'],
  ['mshta','MSHTA reference','command','medium','mshta.exe runs HTML applications and is commonly abused to proxy execution.'],
  ['rundll32','Rundll32 reference','command','low','A signed Windows binary frequently used to launch DLL code.'],
  ['regsvr32','Regsvr32 reference','command','medium','A signed Windows binary sometimes abused to run scripts or DLLs.'],
  ['certutil','Certutil reference','command','medium','A certificate tool that can also download and decode files.'],
  ['bitsadmin','BITS job reference','network','medium','Background Intelligent Transfer Service can download files quietly.'],
  ['/bin/sh','Unix shell path','command','low','A shell invoked by a program can run arbitrary commands.'],['/bin/bash','Unix shell path','command','low','A shell invoked by a program can run arbitrary commands.'],
  ['chmod +x','Permission change to executable','command','medium','Making a downloaded file executable is a typical step in Unix droppers.'],['wget ','wget download command','network','medium','Command-line download utility.'],['curl ','curl download command','network','low','Command-line transfer utility; very common in legitimate scripts.'],
  ['http://','Plain HTTP URL','network','low','Embedded URLs can point to servers the file contacts. Many are benign (documentation, licences).'],['https://','HTTPS URL','network','low','Embedded URLs can point to servers the file contacts. Many are benign (documentation, licences).'],['ftp://','FTP URL','network','low','Embedded URLs can point to servers the file contacts.'],['.onion','Tor hidden-service address','network','high','Onion addresses are used to hide server locations.'],
  ['urldownloadtofile','URLDownloadToFile API name','network','medium','Windows API that downloads a file from a URL.'],['internetopen','WinINet API name','network','low','Windows networking API used by many applications.'],['wsastartup','Winsock API name','network','low','Indicates socket networking support.'],
  ['currentversion\\run','Registry Run key path','persistence','high','Programs listed under Run keys start at logon, a common persistence location.'],['autorun','Autorun reference','persistence','medium','Autorun mechanisms start code automatically.'],['schtasks','Scheduled task utility','persistence','medium','Scheduled tasks can re-launch software repeatedly.'],['crontab','Cron reference','persistence','low','Cron entries can run commands on a schedule.'],['launchagents','macOS LaunchAgents path','persistence','medium','Launch agents run at login on macOS.'],
  ['virtualalloc','VirtualAlloc API name','api','low','Allocates memory; common in all software but also used by loaders.'],['virtualprotect','VirtualProtect API name','api','medium','Changes memory permissions, sometimes to make data executable.'],['writeprocessmemory','WriteProcessMemory API name','api','high','Writes into another process, a technique associated with injection.'],['createremotethread','CreateRemoteThread API name','api','high','Starts a thread in another process, a technique associated with injection.'],['loadlibrary','LoadLibrary API name','api','low','Very common dynamic-loading API.'],['getprocaddress','GetProcAddress API name','api','low','Resolves functions at runtime; common in legitimate and packed code.'],['isdebuggerpresent','Debugger check API name','api','medium','Programs may check for debuggers to hinder analysis.'],['winexec','WinExec API name','api','medium','Launches programs.'],['shellexecute','ShellExecute API name','api','low','Launches programs or documents.'],
  ['getasynckeystate','Key-state API name','credential','medium','Reads keyboard state; used by keyloggers but also by games and accessibility tools.'],['setwindowshookex','Windows hook API name','credential','medium','Installs input or event hooks.'],['keylog','Keylogging term','credential','high','Literal reference to keystroke logging.'],['password','Password term','credential','low','Appears in many legitimate programs and forms.'],['mimikatz','Credential-theft tool name','credential','high','Name of a well-known credential-dumping tool.'],['/etc/shadow','Unix shadow password file','credential','high','Holds password hashes on Unix systems.'],
  ['-encodedcommand','PowerShell encoded command flag','script','high','Hides the command being run behind Base64.'],['frombase64string','Base64 decode call','script','medium','Used to decode hidden payloads, but also common in normal code.'],['invoke-expression','Invoke-Expression','script','medium','Runs a string as code.'],['downloadstring','DownloadString call','script','high','Fetches text from a URL, often to run it.'],['eval(','eval( call','script','low','Runs a string as code; common in legitimate JavaScript.'],['fromcharcode','String.fromCharCode','script','low','Frequently used to assemble obfuscated strings.'],['activexobject','ActiveXObject','script','medium','Gives scripts access to Windows components.'],
  ['vbaproject.bin','Office VBA macro project','document','medium','Indicates the Office file contains macros, a common malware delivery format.'],['autoopen','AutoOpen macro name','document','high','Macro that runs automatically when a document opens.'],['document_open','Document_Open macro name','document','high','Macro that runs automatically when a document opens.'],['/javascript','PDF JavaScript action','document','medium','PDF JavaScript can run code in some readers.'],['/openaction','PDF OpenAction','document','medium','Action that runs when the PDF opens.'],['/launch','PDF Launch action','document','high','PDF action that can start external programs.'],['/embeddedfile','PDF embedded file','document','low','PDFs can carry other files inside.'],
  ['bitcoin','Cryptocurrency reference','impact','low','Payment demands often use cryptocurrency, but so do many legitimate apps.'],['ransom','Ransom term','impact','high','Literal ransom wording.'],['vssadmin','Volume Shadow Copy utility','impact','high','Deleting shadow copies prevents recovery; typical of ransomware.'],['bcdedit','Boot configuration tool','impact','medium','Can disable recovery options.']
];
const GROUP_LABEL = { command:'Command execution', network:'Network', persistence:'Persistence', api:'API usage', credential:'Credential access', script:'Scripting / obfuscation', document:'Document-borne', impact:'Impact / extortion' };
const SEV_POINTS = { low: 3, medium: 6, high: 10 }, GROUP_CAP = 22;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;

/* ---------- Entropy ---------- */
const H = c => { let t = 0; for (const n of c) t += n; let h = 0; if (t) for (const n of c) if (n) { const p = n / t; h -= p * Math.log2(p); } return h; };
function entropyBand(h, size) {
  if (size < 256) return 'Sample too small for a reliable estimate';
  return h < 2 ? 'Very low — highly repetitive' : h < 5 ? 'Typical of text or structured data' : h < 6.8 ? 'Typical of compiled code or mixed data' : h < 7.5 ? 'Elevated — possible compression or packing' : 'Very high — consistent with compression or encryption';
}
async function entropyProfile(bytes, progress) {
  const n = Math.max(1, Math.min(LIMITS.blocks, Math.ceil(bytes.length / 256))), size = Math.ceil(bytes.length / n), total = new Array(256).fill(0), blocks = [];
  for (let b = 0; b < n; b++) {
    const c = new Array(256).fill(0), end = Math.min(bytes.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) c[bytes[i]]++;
    for (let i = 0; i < 256; i++) total[i] += c[i];
    blocks.push({ start: b * size, end, h: H(c) });
    if (b % 4 === 3) { progress && progress((b + 1) / n); await tick(); }
  }
  return { overall: H(total), blocks, blockSize: size, histogram: total, band: entropyBand(H(total), bytes.length) };
}
function sectionEntropy(bytes, off, len) { const c = new Array(256).fill(0); for (let i = off; i < Math.min(bytes.length, off + len); i++) c[bytes[i]]++; return H(c); }

/* ---------- Strings + keyword scan (single chunked pass) ---------- */
const printable = b => b >= 32 && b <= 126;
async function extractStrings(bytes, family, progress) {
  const items = [], hits = new Map(), tags = {}, urls = new Set(), markers = new Set(); let total = 0, ips = 0, ipSample = '';
  const isZip = family === 'zip';
  const add = (text, offset, enc) => {
    total++; const lower = text.toLowerCase(); let tag = 'text';
    for (const k of KEYWORDS) if (lower.includes(k[0])) {
      const h = hits.get(k[0]) || { term: k[0], label: k[1], group: k[2], severity: k[3], why: k[4], count: 0, offset, sample: text.slice(0, 120) }; h.count++; hits.set(k[0], h);
      if (tag === 'text' || (k[3] === 'high')) tag = k[2];
    }
    if (tag === 'text') { if (/^[a-z]:\\|^\/[\w.-]+\/[\w./-]+/i.test(text)) tag = 'path'; }
    const m = text.match(/https?:\/\/[^\s"'<>\\)]+/i); if (m && urls.size < 25) urls.add(m[0].slice(0, 200));
    if (IPV4.test(text)) { ips++; ipSample = ipSample || text.slice(0, 80); }
    if (isZip) for (const mk of ['[content_types].xml', 'word/', 'xl/', 'ppt/', 'meta-inf/manifest.mf', 'androidmanifest.xml']) if (lower.includes(mk)) markers.add(mk);
    tags[tag] = (tags[tag] || 0) + 1;
    if (items.length < LIMITS.maxStrings) items.push({ text: text.length > LIMITS.maxStringLen ? text.slice(0, LIMITS.maxStringLen) + '…' : text, offset, enc, tag });
  };
  const n = bytes.length; let start = -1, cur = '';
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (printable(b)) { if (start < 0) { start = i; cur = ''; } cur += String.fromCharCode(b); }
    else { if (start >= 0 && cur.length >= LIMITS.minString) add(cur, start, 'ascii'); start = -1; cur = ''; }
    if ((i & 0x3ffff) === 0x3ffff) { progress && progress(0.9 * i / n); await tick(); }
  }
  if (start >= 0 && cur.length >= LIMITS.minString) add(cur, start, 'ascii');
  for (let i = 0; i < n - 1;) { // UTF-16LE: printable byte followed by 0x00
    if (printable(bytes[i]) && bytes[i + 1] === 0) { let j = i, s = ''; while (j < n - 1 && printable(bytes[j]) && bytes[j + 1] === 0) { s += String.fromCharCode(bytes[j]); j += 2; } if (s.length >= LIMITS.minString) add(s, i, 'utf16'); i = j; } else i++;
    if ((i & 0x3ffff) === 0) { progress && progress(0.9 + 0.1 * i / n); await tick(); }
  }
  items.sort((a, b) => a.offset - b.offset);
  return { items, total, truncated: total > items.length, tags, hits: [...hits.values()], urls: [...urls], ips, ipSample, markers: [...markers] };
}

/* ---------- Format-specific structure parsing (bounds-checked) ---------- */
function parsePE(b) {
  if (b.length < 0x40) return null; const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), pe = dv.getUint32(0x3c, true);
  if (pe < 0 || pe + 24 > b.length || dv.getUint32(pe, true) !== 0x4550) return { valid: false };
  const machine = dv.getUint16(pe + 4, true), nsec = dv.getUint16(pe + 6, true), ts = dv.getUint32(pe + 8, true), optSize = dv.getUint16(pe + 20, true), chars = dv.getUint16(pe + 22, true);
  const opt = pe + 24, magic = opt + 2 <= b.length ? dv.getUint16(opt, true) : 0, sub = opt + 70 <= b.length ? dv.getUint16(opt + 68, true) : 0;
  const MACH = { 0x14c: 'x86 (32-bit)', 0x8664: 'x64', 0x1c0: 'ARM', 0xaa64: 'ARM64' }, SUB = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows console' };
  const sections = []; let p = opt + optSize;
  for (let i = 0; i < Math.min(nsec, 96) && p + 40 <= b.length; i++, p += 40) {
    const name = String.fromCharCode(...b.subarray(p, p + 8)).replace(/\0+$/, '').replace(/[^\x20-\x7e]/g, '?'), rawSize = dv.getUint32(p + 16, true), rawPtr = dv.getUint32(p + 20, true), fl = dv.getUint32(p + 36, true);
    sections.push({ name, rawSize, exec: !!(fl & 0x20000000), write: !!(fl & 0x80000000), entropy: rawSize && rawPtr < b.length ? sectionEntropy(b, rawPtr, rawSize) : 0 });
  }
  return { valid: true, machine: MACH[machine] || '0x' + machine.toString(16), bits: magic === 0x20b ? 'PE32+' : magic === 0x10b ? 'PE32' : 'unknown', isDll: !!(chars & 0x2000), subsystem: SUB[sub] || String(sub), sectionCount: nsec, timestamp: ts, sections };
}
function parseELF(b) {
  if (b.length < 20) return null; const le = b[5] !== 2, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const TYPE = { 1: 'Relocatable', 2: 'Executable', 3: 'Shared object / PIE', 4: 'Core dump' }, MACH = { 3: 'x86', 0x3e: 'x86-64', 0x28: 'ARM', 0xb7: 'AArch64', 0xf3: 'RISC-V' };
  const t = dv.getUint16(16, le), m = dv.getUint16(18, le);
  return { bits: b[4] === 2 ? '64-bit' : '32-bit', endian: le ? 'little-endian' : 'big-endian', type: TYPE[t] || String(t), machine: MACH[m] || '0x' + m.toString(16) };
}

/* ---------- Indicators and scoring ---------- */
function buildFindings(r) {
  const checks = [], inds = [], f = r.file, sig = r.signature, e = r.entropy;
  const ind = (id, title, category, severity, points, evidence, why, benign) => inds.push({ id, title, category, severity, points, evidence, why, benign, kind: 'static' });
  checks.push(['Format identification', sig.name + (sig.matched ? ' (matched by file signature)' : ' (no signature match; heuristic)')]);
  checks.push(['SHA-256 calculated', 'Fingerprint generated via ' + r.hashMethod + '.']);
  checks.push(['Entropy estimated', e.overall.toFixed(3) + ' bits/byte across ' + e.blocks.length + ' block(s). ' + e.band]);
  checks.push(['Printable strings extracted', r.strings.total + ' strings of ' + LIMITS.minString + '+ characters (ASCII and UTF-16LE).']);
  const ext = f.ext, name = f.name;
  if (/[\u202e]/.test(name)) ind('rlo-name', 'Right-to-left override in file name', 'Naming', 'high', 15, 'The file name contains U+202E.', 'This control character reverses how part of a name is displayed and can hide a real extension.', 'Rare in legitimate files.');
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|jpe?g|png|gif|zip|rtf)\.(exe|scr|com|bat|cmd|js|vbs|ps1|hta|lnk|dll)$/i.test(name)) ind('double-ext', 'Double file extension', 'Naming', 'medium', 12, 'Name: ' + name, 'A document-like name followed by an executable extension is a classic way to disguise a program.', 'Occasionally produced by careless naming.');
  const exp = EXPECT_FOR(ext);
  if (exp && sig.matched && !exp.includes(sig.id)) ind('ext-mismatch', 'Extension does not match file signature', 'Naming', ['pe', 'elf', 'macho', 'lnk'].includes(sig.id) ? 'high' : 'medium', ['pe', 'elf', 'macho', 'lnk'].includes(sig.id) ? 14 : 8, '.' + ext + ' file with a ' + sig.name + ' signature.', 'Files whose content differs from their extension may be disguised, or may simply be misnamed.', 'Renamed or mis-saved files are common.');
  else if (EXEC_EXT.includes(ext) && !['pe', 'elf', 'macho'].includes(sig.id) && sig.id !== 'ole2') ind('ext-exec-nohdr', 'Executable extension without executable header', 'Naming', 'low', 4, '.' + ext + ' but identified as: ' + sig.name, 'The name claims executable content that the bytes do not show; the file may be truncated, corrupted or mislabeled.', 'Test or placeholder files.');
  if (['pe', 'elf', 'macho'].includes(sig.id)) ind('exec-header', 'Executable file structure', 'Structure', 'low', 8, sig.name, 'Executable content can run code when launched. This is expected for software and is not evidence of malicious intent.', 'Almost all software has this structure.');
  if (SCRIPT_EXT.includes(ext)) ind('script-type', 'Script file type', 'Structure', 'low', 4, '.' + ext + ' script file.', 'Script files are run by interpreters and are a common delivery format.', 'Scripts are also everyday automation tools.');
  if (sig.id === 'lnk') ind('lnk', 'Windows shortcut file', 'Structure', 'medium', 8, sig.name, 'Shortcuts can launch commands with arguments and are used as lures.', 'Normal shortcuts exist everywhere.');
  const compressed = ['archive', 'image'].includes(sig.family);
  if (e.overall > 7.2 && r.size >= 256) { if (compressed) checks.push(['High entropy (expected)', 'High entropy is normal for ' + sig.name + ', so it is not counted as an indicator.']); else ind('entropy', 'High overall entropy', 'Entropy', 'medium', 10, e.overall.toFixed(3) + ' bits/byte.', 'High entropy is consistent with compression, encryption or packing, which can hide content from static inspection.', 'Legitimate compressed or encrypted data is also high-entropy.'); }
  else checks.push(['Entropy check', 'No unusually high entropy detected.']);
  const pe = r.structure && r.structure.pe;
  if (pe && pe.valid) {
    const packed = pe.sections.filter(s => /^(\.?upx|\.aspack|\.themida|\.vmp|\.petite|\.mpress)/i.test(s.name));
    if (packed.length) ind('pe-packer', 'Packer-style section names', 'Structure', 'medium', 10, packed.map(s => s.name).join(', '), 'Section names such as UPX or Themida are left by executable packers, which compress or protect code.', 'Legitimate software is sometimes packed to save space.');
    const hot = pe.sections.filter(s => s.exec && s.entropy > 7.0);
    if (hot.length) ind('pe-hot-exec', 'High-entropy executable section', 'Structure', 'medium', 8, hot.map(s => s.name + ' (' + s.entropy.toFixed(2) + ')').join(', '), 'Executable sections that look compressed or encrypted may be unpacked at runtime.', 'Some protected commercial software does this.');
    const wx = pe.sections.filter(s => s.exec && s.write);
    if (wx.length) ind('pe-wx', 'Writable and executable section', 'Structure', 'low', 5, wx.map(s => s.name).join(', '), 'Sections that are both writable and executable make self-modifying code possible.', 'Some old or hand-written toolchains produce these.');
  }
  const grouped = {};
  for (const k of r.strings.hits) {
    const pts = SEV_POINTS[k.severity]; (grouped[k.group] = grouped[k.group] || []).push(k);
    ind('kw-' + k.term, k.label, 'Strings', k.severity, pts, '"' + k.term + '" found ' + k.count + '×. First at offset 0x' + k.offset.toString(16) + '.', k.why + ' Context is unknown.', 'Matching text alone does not show that anything is executed.');
  }
  if (r.strings.ips) ind('ipv4', 'IPv4-like strings', 'Strings', 'low', 3, r.strings.ips + ' string(s), e.g. ' + r.strings.ipSample, 'Hard-coded addresses may point to servers the file contacts.', 'Version numbers also look like IP addresses.');
  if (!inds.length) checks.push(['No obvious static red flags', 'Basic heuristics did not match any listed indicator. This does not establish that the file is safe.']);
  // Cap each keyword group so many similar strings cannot dominate the score.
  let used = {}; for (const i of inds) if (i.category === 'Strings' && i.id.startsWith('kw-')) { const g = (KEYWORDS.find(k => 'kw-' + k[0] === i.id) || [])[2]; used[g] = (used[g] || 0) + i.points; if (used[g] > GROUP_CAP) { i.points = Math.max(0, i.points - (used[g] - GROUP_CAP)); used[g] = GROUP_CAP; } }
  const value = Math.min(100, inds.reduce((a, i) => a + i.points, 0)), level = value < 10 ? 'Minimal' : value < 25 ? 'Low' : value < 50 ? 'Moderate' : value < 75 ? 'Elevated' : 'High';
  const by = {}; inds.forEach(i => by[i.category] = (by[i.category] || 0) + i.points);
  return { checks, indicators: inds, score: { value, level, breakdown: Object.entries(by).map(([category, points]) => ({ category, points })) } };
}
function EXPECT_FOR(ext) { return EXT_EXPECT[ext]; }

/* ---------- Behavior hypotheses (inferred from static indicators; never observed) ---------- */
const BEHAVIORS = [
  { cat: 'Execution', groups: ['command', 'script'], ids: ['exec-header', 'script-type', 'lnk'], statement: 'If run, the file may launch programs or shell commands.', verify: 'Review the commands in context; detonate only in a managed, isolated sandbox.' },
  { cat: 'Network', groups: ['network'], ids: ['ipv4'], statement: 'If run, the file may contact remote servers or download further content.', verify: 'Check each URL/IP against threat intelligence without visiting it; capture traffic in an isolated lab.' },
  { cat: 'Persistence', groups: ['persistence'], ids: [], statement: 'If run, the file may try to start again after reboot or logon.', verify: 'Compare registry run keys and scheduled tasks before and after execution in a sandbox.' },
  { cat: 'Obfuscation', groups: ['script'], ids: ['entropy', 'pe-packer', 'pe-hot-exec', 'rlo-name', 'double-ext', 'ext-mismatch'], statement: 'The file may be packed, encoded or disguised to hinder inspection.', verify: 'Identify the packer or encoding with a dedicated unpacker in an isolated environment.' },
  { cat: 'Credential access', groups: ['credential'], ids: [], statement: 'If run, the file may read credentials or capture input.', verify: 'Inspect the surrounding code paths that reference these names.' },
  { cat: 'Document-borne code', groups: ['document'], ids: [], statement: 'If opened, the document may run embedded macros or actions.', verify: 'Extract macros or PDF actions with a dedicated document analysis tool and read them.' },
  { cat: 'Impact', groups: ['impact'], ids: [], statement: 'The file may be associated with extortion or data destruction.', verify: 'Look for the surrounding code and notes; wording alone can also appear in security tools.' }
];
function deriveBehavior(r) {
  const out = [];
  for (const b of BEHAVIORS) {
    const basis = r.indicators.filter(i => b.ids.includes(i.id) || (i.id.startsWith('kw-') && b.groups.includes((KEYWORDS.find(k => 'kw-' + k[0] === i.id) || [])[2]))).filter(i => !(b.cat === 'Execution' && i.id === 'kw-/bin/sh' && false));
    if (!basis.length) continue;
    const pts = basis.reduce((a, i) => a + i.points, 0), strength = pts >= 16 ? 'Moderate' : 'Weak';
    out.push({ category: b.cat, statement: b.statement, strength, basis: basis.map(i => i.id), basisTitles: basis.map(i => i.title), why: 'Static clues present: ' + basis.map(i => i.title).join('; ') + '.', benign: 'The same clues occur in legitimate software, so this is a prompt for review, not a finding about behavior.', verify: b.verify });
  }
  return out;
}

/* ---------- Main entry ---------- */
async function analyze(file, onProgress, opts) {
  opts = opts || {}; const t0 = Date.now(), log = [], report = (stage, frac, label) => onProgress && onProgress({ stage, frac, label });
  const mark = (key, label, detail) => log.push({ key, label, detail, ms: Date.now() - t0 });
  if (file.size === 0) throw new Error('The file is empty (0 bytes).');
  if (file.size > LIMITS.maxBytes) throw new Error('File exceeds the ' + (LIMITS.maxBytes / 1048576) + ' MB inspection limit.');
  const bytes = new Uint8Array(file.size); let pos = 0;
  try { while (pos < file.size) { const buf = await file.slice(pos, pos + (4 << 20)).arrayBuffer(); bytes.set(new Uint8Array(buf), pos); pos += buf.byteLength; report('read', pos / file.size, 'Reading bytes'); } }
  catch (e) { throw new Error('The file could not be read. Folders and unreadable files are not supported.'); }
  mark('read', 'Specimen received', 'Bytes read as inert data. No process was launched.');
  const hash = await sha256(bytes); report('hash', 1, 'Fingerprinting'); mark('hash', 'Fingerprint generated', 'SHA-256 ' + hash.hex.slice(0, 16) + '…');
  const signature = identify(bytes, file.name); report('sig', 1, 'Checking signatures'); mark('sig', 'Structure inspected', signature.name);
  const entropy = await entropyProfile(bytes, f => report('entropy', f, 'Estimating entropy')); mark('entropy', 'Entropy profiled', entropy.overall.toFixed(3) + ' bits/byte');
  const strings = await extractStrings(bytes, signature.id, f => report('strings', f, 'Extracting strings')); mark('strings', 'Strings scanned', strings.total + ' strings, ' + strings.hits.length + ' keyword group hit(s)');
  const structure = signature.id === 'pe' ? { pe: parsePE(bytes) } : signature.id === 'elf' ? { elf: parseELF(bytes) } : {};
  if (signature.id === 'zip') { const m = strings.markers; if (m.includes('[content_types].xml') && (m.includes('word/') || m.includes('xl/') || m.includes('ppt/'))) signature.name = 'Office Open XML document (ZIP container)'; else if (m.includes('meta-inf/manifest.mf')) signature.name = 'Java archive (JAR, ZIP container)'; else if (m.includes('androidmanifest.xml')) signature.name = 'Android package (APK, ZIP container)'; }
  const r = { id: 'case-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), demo: !!opts.demo, file: { name: file.name, ext: signature.ext, mime: file.type || 'Not declared', lastModified: file.lastModified || null }, size: file.size, sha256: hash.hex, hashMethod: hash.method, signature, format: signature.name, magicHex: [...bytes.subarray(0, 16)].map(b => b.toString(16).padStart(2, '0')).join(' '), entropy, strings, structure };
  Object.assign(r, buildFindings(r)); r.behavior = deriveBehavior(r); r.stageLog = log; r.durationMs = Date.now() - t0;
  r.caseId = 'CL-' + new Date(r.createdAt).toISOString().slice(0, 10).replace(/-/g, '') + '-' + r.sha256.slice(0, 6).toUpperCase();
  report('done', 1, 'Complete'); mark('assess', 'Assessment prepared', r.indicators.length + ' indicator(s); no runtime behavior observed.');
  return r;
}

/* ---------- Reports ---------- */
const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(2) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const LIMITATION = 'The sample was not executed. This report contains static observations and heuristic indicators only. It does not establish whether the file is malicious or safe, and behavior hypotheses are inferences, not observed runtime events.';
/* A neutral block list used by both the TXT and PDF exporters so they always agree. */
function reportBlocks(r) {
  const B = [], kv = (k, v) => B.push({ t: 'kv', k, v: String(v) }), head = s => B.push({ t: 'h', v: s });
  B.push({ t: 'title', v: 'CYBERLAB STATIC ANALYSIS REPORT' }); kv('Case ID', r.caseId); kv('Analyzed', new Date(r.createdAt).toLocaleString() + ' (' + new Date(r.createdAt).toISOString() + ')'); kv('Source', r.demo ? 'Built-in demo specimen' : 'Local file');
  head('FILE INFORMATION'); kv('Name', r.file.name); kv('Size', fmtSize(r.size) + ' (' + r.size + ' bytes)'); kv('Extension', r.file.ext ? '.' + r.file.ext : 'none'); kv('Declared MIME', r.file.mime); kv('Identified format', r.format); kv('First bytes', r.magicHex); kv('SHA-256', r.sha256); kv('Hash method', r.hashMethod);
  head('STATIC ANALYSIS'); kv('Entropy', r.entropy.overall.toFixed(3) + ' bits/byte — ' + r.entropy.band); kv('Printable strings', r.strings.total + (r.strings.truncated ? ' (first ' + r.strings.items.length + ' retained)' : ''));
  const pe = r.structure.pe, elf = r.structure.elf;
  if (pe && pe.valid) { kv('PE header', pe.bits + ', ' + pe.machine + ', ' + pe.subsystem + (pe.isDll ? ', DLL' : '')); kv('PE sections', pe.sections.map(s => s.name + ' H=' + s.entropy.toFixed(2)).join('; ') || 'none parsed'); kv('PE timestamp (claimed)', pe.timestamp ? new Date(pe.timestamp * 1000).toISOString() : 'not set'); }
  if (elf) kv('ELF header', elf.bits + ', ' + elf.endian + ', ' + elf.type + ', ' + elf.machine);
  head('SECURITY ASSESSMENT (HEURISTIC, NOT A VERDICT)'); kv('Heuristic indicator level', r.score.level + ' (' + r.score.value + '/100)'); kv('Indicators detected', r.indicators.length); kv('Execution status', 'NOT EXECUTED');
  if (!r.indicators.length) B.push({ t: 'p', v: 'No listed static indicator matched. This does not establish that the file is safe.' });
  r.indicators.forEach(i => { B.push({ t: 'li', v: '[' + i.severity.toUpperCase() + '] ' + i.title + ' — ' + i.evidence }); B.push({ t: 'sub', v: 'Why it may matter: ' + i.why }); });
  if (r.strings.urls.length) { head('URL-LIKE STRINGS FOUND'); r.strings.urls.forEach(u => B.push({ t: 'li', v: u })); }
  head('BEHAVIOR HYPOTHESES (INFERRED FROM STATIC CLUES — NOT OBSERVED)');
  if (!r.behavior.length) B.push({ t: 'p', v: 'No static clue mapped to a behavior hypothesis.' });
  r.behavior.forEach(b => B.push({ t: 'li', v: b.category + ' (' + b.strength + ' basis): ' + b.statement }));
  head('LIMITATIONS'); B.push({ t: 'p', v: LIMITATION });
  return B;
}
function reportText(r) {
  return reportBlocks(r).map(b => b.t === 'title' ? b.v + '\n' + '='.repeat(b.v.length) : b.t === 'h' ? '\n' + b.v + '\n' + '-'.repeat(b.v.length) : b.t === 'kv' ? b.k + ': ' + b.v : b.t === 'li' ? '- ' + b.v : b.t === 'sub' ? '    ' + b.v : b.v).join('\n') + '\n';
}

const api = { LIMITS, KEYWORDS, GROUP_LABEL, analyze, sha256, Sha256, identify, fmtSize, reportBlocks, reportText, LIMITATION, entropyBand };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CyberLabEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
