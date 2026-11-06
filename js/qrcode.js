/*!
 * qrcode.js — a small, dependency-free QR Code encoder (ISO/IEC 18004).
 * Supports versions 1–40, error correction levels L/M/Q/H,
 * numeric / alphanumeric / byte (UTF-8) modes and automatic mask selection.
 *
 * MIT License — part of QR Generator Free (https://github.com/wayancc/QR-Generator-Free)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Error correction levels -------------------------------------------
  // ordinal: index into tables, bits: value used in the format information
  var ECL = {
    L: { ordinal: 0, bits: 1 },
    M: { ordinal: 1, bits: 0 },
    Q: { ordinal: 2, bits: 3 },
    H: { ordinal: 3, bits: 2 }
  };

  // ECC codewords per block, indexed [ecl][version]
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  // Number of error correction blocks, indexed [ecl][version]
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  // ---- Modes --------------------------------------------------------------
  var MODE = {
    NUMERIC: { bits: 0x1, cc: [10, 12, 14] },
    ALPHANUMERIC: { bits: 0x2, cc: [9, 11, 13] },
    BYTE: { bits: 0x4, cc: [8, 16, 16] }
  };
  var ALNUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function charCountBits(mode, version) {
    return mode.cc[version <= 9 ? 0 : version <= 26 ? 1 : 2];
  }

  function toUtf8(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // Builds a single segment {mode, count, bits[]} for the whole text.
  function makeSegment(text) {
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    var i;
    if (/^[0-9]*$/.test(text)) {
      for (i = 0; i < text.length; i += 3) {
        var chunk = text.substr(i, 3);
        push(parseInt(chunk, 10), chunk.length * 3 + 1);
      }
      return { mode: MODE.NUMERIC, count: text.length, bits: bits };
    }
    if (/^[0-9A-Z $%*+\-./:]*$/.test(text)) {
      for (i = 0; i + 1 < text.length; i += 2) {
        push(ALNUM_CHARSET.indexOf(text[i]) * 45 + ALNUM_CHARSET.indexOf(text[i + 1]), 11);
      }
      if (i < text.length) push(ALNUM_CHARSET.indexOf(text[i]), 6);
      return { mode: MODE.ALPHANUMERIC, count: text.length, bits: bits };
    }
    var bytes = toUtf8(text);
    bytes.forEach(function (b) { push(b, 8); });
    return { mode: MODE.BYTE, count: bytes.length, bits: bits };
  }

  // ---- Capacity helpers ---------------------------------------------------
  function numRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8) -
      ECC_PER_BLOCK[ecl.ordinal][ver] * NUM_BLOCKS[ecl.ordinal][ver];
  }

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    var size = ver * 4 + 17;
    var numAlign = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  // ---- Reed–Solomon over GF(256), polynomial 0x11D -------------------------
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    var result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      for (var i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
    });
    return result;
  }

  function addEccAndInterleave(data, ver, ecl) {
    var numBlocks = NUM_BLOCKS[ecl.ordinal][ver];
    var eccLen = ECC_PER_BLOCK[ecl.ordinal][ver];
    var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    var numShort = numBlocks - rawCodewords % numBlocks;
    var shortLen = Math.floor(rawCodewords / numBlocks);
    var divisor = rsDivisor(eccLen);
    var blocks = [];
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var len = shortLen - eccLen + (i < numShort ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsRemainder(dat, divisor);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var c = 0; c < blocks[0].length; c++) {
      for (var b = 0; b < blocks.length; b++) {
        if (c !== shortLen - eccLen || b >= numShort) result.push(blocks[b][c]);
      }
    }
    return result;
  }

  // ---- Matrix construction ------------------------------------------------
  function QrMatrix(ver, ecl) {
    this.version = ver;
    this.size = ver * 4 + 17;
    this.ecl = ecl;
    this.modules = [];
    this.isFunction = [];
    for (var y = 0; y < this.size; y++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
  }

  QrMatrix.prototype.setFn = function (x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  };

  QrMatrix.prototype.drawFunctionPatterns = function () {
    var size = this.size, i, j;
    for (i = 0; i < size; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    var pos = alignmentPositions(this.version), n = pos.length;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  };

  QrMatrix.prototype.drawFinder = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  QrMatrix.prototype.drawAlignment = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QrMatrix.prototype.drawFormatBits = function (mask) {
    var data = (this.ecl.bits << 3) | mask;
    var rem = data;
    for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var size = this.size, i;
    var bit = function (n) { return ((bits >>> n) & 1) !== 0; };
    for (i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) this.setFn(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) this.setFn(8, size - 15 + i, bit(i));
    this.setFn(8, size - 8, true); // dark module
  };

  QrMatrix.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var k = 0; k < 12; k++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (this.version << 12) | rem;
    for (var i = 0; i < 18; i++) {
      var dark = ((bits >>> i) & 1) !== 0;
      var a = this.size - 11 + (i % 3), b = Math.floor(i / 3);
      this.setFn(a, b, dark);
      this.setFn(b, a, dark);
    }
  };

  QrMatrix.prototype.drawCodewords = function (data) {
    var size = this.size, i = 0, total = data.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < total) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  };

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
    function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
  ];

  QrMatrix.prototype.applyMask = function (mask) {
    var fn = MASKS[mask];
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && fn(x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  // Penalty score per the spec (rules N1–N4)
  QrMatrix.prototype.penalty = function () {
    var size = this.size, m = this.modules, score = 0, x, y;
    var lines = [];
    for (y = 0; y < size; y++) lines.push(m[y]);
    for (x = 0; x < size; x++) {
      var col = [];
      for (y = 0; y < size; y++) col.push(m[y][x]);
      lines.push(col);
    }
    var P1 = [true, false, true, true, true, false, true, false, false, false, false];
    var P2 = [false, false, false, false, true, false, true, true, true, false, true];
    lines.forEach(function (line) {
      // N1: runs of 5+ same-colour modules
      var run = 1;
      for (var i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      // N3: finder-like patterns
      for (var s = 0; s + 11 <= size; s++) {
        var a = true, b = true;
        for (var k = 0; k < 11; k++) {
          if (line[s + k] !== P1[k]) a = false;
          if (line[s + k] !== P2[k]) b = false;
          if (!a && !b) break;
        }
        if (a) score += 40;
        if (b) score += 40;
      }
    });
    // N2: 2x2 blocks
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    // N4: dark/light balance
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
    var total = size * size;
    var k4 = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += Math.max(0, k4) * 10;
    return score;
  };

  // ---- Public API -----------------------------------------------------------
  /**
   * Encode text into a QR Code.
   * @param {string} text
   * @param {object} [opts] { ecl: 'L'|'M'|'Q'|'H', mask: -1..7, minVersion: 1..40 }
   * @returns {{version:number, size:number, ecl:string, mask:number, modules:boolean[][], isDark:function}}
   */
  function encode(text, opts) {
    opts = opts || {};
    var eclName = (opts.ecl || 'M').toUpperCase();
    var ecl = ECL[eclName];
    if (!ecl) throw new Error('Invalid error correction level: ' + opts.ecl);
    var maskOpt = opts.mask == null ? -1 : opts.mask;
    var minVer = Math.max(1, Math.min(40, opts.minVersion || 1));

    var seg = makeSegment(String(text));
    var ver, dataBits;
    for (ver = minVer; ; ver++) {
      var capBits = numDataCodewords(ver, ecl) * 8;
      var ccBits = charCountBits(seg.mode, ver);
      if (seg.count < (1 << ccBits)) {
        dataBits = 4 + ccBits + seg.bits.length;
        if (dataBits <= capBits) break;
      }
      if (ver >= 40) throw new Error('Data too long to fit in a QR Code. Try shorter content or a lower error correction level.');
    }

    var capacity = numDataCodewords(ver, ecl) * 8;
    var bits = [];
    var push = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(seg.mode.bits, 4);
    push(seg.count, charCountBits(seg.mode, ver));
    Array.prototype.push.apply(bits, seg.bits);
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) push(pad, 8);

    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var byte = 0;
      for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }

    var qr = new QrMatrix(ver, ecl);
    qr.drawFunctionPatterns();
    qr.drawCodewords(addEccAndInterleave(codewords, ver, ecl));

    var mask = maskOpt;
    if (mask < 0) {
      var best = Infinity;
      for (var t = 0; t < 8; t++) {
        qr.applyMask(t);
        qr.drawFormatBits(t);
        var p = qr.penalty();
        if (p < best) { best = p; mask = t; }
        qr.applyMask(t); // undo (XOR)
      }
    }
    qr.applyMask(mask);
    qr.drawFormatBits(mask);

    var modules = qr.modules;
    var ap = alignmentPositions(ver), alignment = [];
    for (var ai = 0; ai < ap.length; ai++) {
      for (var aj = 0; aj < ap.length; aj++) {
        var last = ap.length - 1;
        if ((ai === 0 && aj === 0) || (ai === 0 && aj === last) || (ai === last && aj === 0)) continue;
        alignment.push([ap[ai], ap[aj]]);
      }
    }
    return {
      // centres [x, y] of alignment patterns (handy for custom renderers)
      alignment: alignment,
      version: ver,
      size: qr.size,
      ecl: eclName,
      mask: mask,
      // max codewords Reed–Solomon can repair (useful for sizing logos)
      correctableCodewords: NUM_BLOCKS[ecl.ordinal][ver] * Math.floor(ECC_PER_BLOCK[ecl.ordinal][ver] / 2),
      modules: modules,
      isDark: function (x, y) { return modules[y] ? !!modules[y][x] : false; }
    };
  }

  return { encode: encode };
});
