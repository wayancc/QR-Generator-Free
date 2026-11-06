/*!
 * QR Generator Free — UI logic.
 * MIT License — https://github.com/wayancc/QR-Generator-Free
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var contentForm = $('#content-form');
  var styleForm = $('#style-form');
  var outputForm = $('#output-form');
  var canvas = $('#qr-canvas');
  var canvasBox = $('#canvas-box');
  var emptyMsg = $('#empty-msg');
  var metaEl = $('#meta');
  var errorEl = $('#error');
  var buttons = [$('#dl-png'), $('#dl-svg'), $('#copy-img')];

  var state = {
    type: 'url',
    logo: null,       // HTMLImageElement
    logoDataUrl: '',  // for SVG export
    qr: null,
    opts: null
  };

  // ---------------------------------------------------------------- content
  function val(name) {
    var el = contentForm.elements[name];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return el.value.trim();
  }

  // Escape for MECARD-style WIFI strings
  function escWifi(s) { return s.replace(/([\\;,:"])/g, '\\$1'); }
  // Escape for vCard values
  function escVcard(s) { return s.replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n'); }
  function cleanPhone(s) { return s.replace(/[^\d+*#]/g, ''); }

  var builders = {
    url: function () {
      var u = val('url');
      if (!u) return '';
      if (!/^[a-z][a-z0-9+.\-]*:/i.test(u)) u = 'https://' + u;
      return u;
    },
    text: function () { return contentForm.elements.text.value; },
    wifi: function () {
      var ssid = val('ssid');
      if (!ssid) return '';
      var type = val('wifiType');
      var out = 'WIFI:T:' + type + ';S:' + escWifi(ssid) + ';';
      if (type !== 'nopass') out += 'P:' + escWifi(contentForm.elements.wifiPass.value) + ';';
      if (val('wifiHidden')) out += 'H:true;';
      return out + ';';
    },
    email: function () {
      var to = val('emailTo');
      if (!to) return '';
      var params = [];
      if (val('emailSubject')) params.push('subject=' + encodeURIComponent(val('emailSubject')));
      if (val('emailBody')) params.push('body=' + encodeURIComponent(val('emailBody')));
      return 'mailto:' + to + (params.length ? '?' + params.join('&') : '');
    },
    phone: function () {
      var p = cleanPhone(val('phone'));
      return p ? 'tel:' + p : '';
    },
    sms: function () {
      var p = cleanPhone(val('smsTo'));
      if (!p) return '';
      return 'SMSTO:' + p + ':' + val('smsBody');
    },
    vcard: function () {
      var first = val('vFirst'), last = val('vLast');
      var fields = ['vPhone', 'vEmail', 'vOrg', 'vTitle', 'vUrl', 'vAddr'].map(val);
      if (!first && !last && !fields.some(Boolean)) return '';
      var lines = ['BEGIN:VCARD', 'VERSION:3.0',
        'N:' + escVcard(last) + ';' + escVcard(first) + ';;;',
        'FN:' + escVcard((first + ' ' + last).trim())];
      if (val('vOrg')) lines.push('ORG:' + escVcard(val('vOrg')));
      if (val('vTitle')) lines.push('TITLE:' + escVcard(val('vTitle')));
      if (val('vPhone')) lines.push('TEL;TYPE=CELL:' + cleanPhone(val('vPhone')));
      if (val('vEmail')) lines.push('EMAIL:' + escVcard(val('vEmail')));
      if (val('vUrl')) lines.push('URL:' + escVcard(val('vUrl')));
      if (val('vAddr')) lines.push('ADR:;;' + escVcard(val('vAddr')) + ';;;;');
      lines.push('END:VCARD');
      return lines.join('\n');
    },
    geo: function () {
      var lat = parseFloat(val('lat')), lng = parseFloat(val('lng'));
      if (!isFinite(lat) || !isFinite(lng)) return '';
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return '';
      return 'geo:' + lat + ',' + lng;
    }
  };

  // ---------------------------------------------------------------- options
  function readOptions() {
    var s = styleForm.elements, o = outputForm.elements;
    return {
      fg: s.fg.value,
      eye: s.eye.value,
      bg: s.bg.value,
      transparent: s.transparent.checked,
      shape: styleForm.querySelector('input[name="shape"]:checked').value,
      eyeShape: styleForm.querySelector('input[name="eyeShape"]:checked').value,
      logoSize: parseInt(s.logoSize.value, 10) / 100,
      size: parseInt(o.size.value, 10),
      margin: parseInt(o.margin.value, 10),
      ecl: o.ecl.value
    };
  }

  // ---------------------------------------------------------------- geometry
  function f(n) { return Math.round(n * 1000) / 1000; }

  function rectPath(x, y, w, h) {
    return 'M' + f(x) + ' ' + f(y) + 'h' + f(w) + 'v' + f(h) + 'h' + f(-w) + 'z';
  }
  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    return 'M' + f(x + r) + ' ' + f(y) +
      'h' + f(w - 2 * r) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(r) + ' ' + f(r) +
      'v' + f(h - 2 * r) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(-r) + ' ' + f(r) +
      'h' + f(-(w - 2 * r)) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(-r) + ' ' + f(-r) +
      'v' + f(-(h - 2 * r)) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(r) + ' ' + f(-r) + 'z';
  }
  function circlePath(cx, cy, r) {
    return 'M' + f(cx - r) + ' ' + f(cy) +
      'a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(2 * r) + ' 0' +
      'a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(-2 * r) + ' 0z';
  }

  // Returns path data in module units (including the quiet zone).
  function buildGeometry(qr, o, hasLogo) {
    var n = qr.size, m = o.margin;
    var total = n + m * 2;

    var isEye = function (x, y) {
      return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    };

    // Logo hole (in module coords, without margin)
    var logo = null;
    if (hasLogo) {
      var ls = Math.round(n * o.logoSize);
      // Never hide more modules than error correction can safely repair
      // (use part of the correctable budget to leave room for print/camera noise;
      // dots carry less ink per module, so they get a smaller budget).
      var maxModules = qr.correctableCodewords * 8 * (o.shape === 'dots' ? 0.25 : 0.4);
      ls = Math.min(ls, Math.floor(Math.sqrt(maxModules)));
      if ((n - ls) % 2) ls--; // keep it centred on module boundaries
      if (ls >= 3) {
        var start = (n - ls) / 2;
        logo = { x: start, y: start, size: ls };
      }
    }
    var inLogo = function (x, y) {
      return logo && x >= logo.x && x < logo.x + logo.size && y >= logo.y && y < logo.y + logo.size;
    };

    // For styled modules, alignment patterns are drawn as solid shapes —
    // a dotted alignment pattern is hard for scanners to lock onto.
    var align = [], alignSet = {};
    if (o.shape !== 'square') {
      (qr.alignment || []).forEach(function (c) {
        var ax = c[0], ay = c[1];
        if (inLogo(ax, ay)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) alignSet[(ax + dx) + ',' + (ay + dy)] = true;
        var cx = ax + m + 0.5, cy = ay + m + 0.5;
        if (o.shape === 'dots') {
          align.push(circlePath(cx, cy, 2.5), circlePath(cx, cy, 1.5), circlePath(cx, cy, 0.5));
        } else {
          align.push(roundRectPath(cx - 2.5, cy - 2.5, 5, 5, 1.2), roundRectPath(cx - 1.5, cy - 1.5, 3, 3, 0.7), roundRectPath(cx - 0.5, cy - 0.5, 1, 1, 0.3));
        }
      });
    }

    var body = [];
    for (var y = 0; y < n; y++) {
      if (o.shape === 'square') {
        // merge horizontal runs for a compact path
        var x = 0;
        while (x < n) {
          if (qr.isDark(x, y) && !isEye(x, y) && !inLogo(x, y)) {
            var x0 = x;
            while (x < n && qr.isDark(x, y) && !isEye(x, y) && !inLogo(x, y)) x++;
            body.push(rectPath(x0 + m, y + m, x - x0, 1));
          } else x++;
        }
      } else {
        for (var xx = 0; xx < n; xx++) {
          if (!qr.isDark(xx, y) || isEye(xx, y) || inLogo(xx, y) || alignSet[xx + ',' + y]) continue;
          // shapes fill the full module cell so scanners see solid runs
          if (o.shape === 'dots') body.push(circlePath(xx + m + 0.5, y + m + 0.5, 0.5));
          else body.push(roundRectPath(xx + m, y + m, 1, 1, 0.3));
        }
      }
    }

    var eyes = [];
    [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (p) {
      var ex = p[0] + m, ey = p[1] + m;
      if (o.eyeShape === 'circle') {
        eyes.push(circlePath(ex + 3.5, ey + 3.5, 3.5), circlePath(ex + 3.5, ey + 3.5, 2.5), circlePath(ex + 3.5, ey + 3.5, 1.5));
      } else if (o.eyeShape === 'rounded') {
        eyes.push(roundRectPath(ex, ey, 7, 7, 2.2), roundRectPath(ex + 1, ey + 1, 5, 5, 1.4), roundRectPath(ex + 2, ey + 2, 3, 3, 0.9));
      } else {
        eyes.push(rectPath(ex, ey, 7, 7), rectPath(ex + 1, ey + 1, 5, 5), rectPath(ex + 2, ey + 2, 3, 3));
      }
    });

    var logoBox = null;
    if (logo) {
      var pad = 0.6;
      logoBox = { x: logo.x + m + pad, y: logo.y + m + pad, size: logo.size - pad * 2 };
    }

    return { total: total, body: body.join(''), align: align.join(''), eyes: eyes.join(''), logo: logoBox };
  }

  // Fit an image inside a square box, preserving aspect ratio
  function fitImage(img, box) {
    var w = img.naturalWidth || img.width || 1, h = img.naturalHeight || img.height || 1;
    var s = Math.min(box.size / w, box.size / h);
    var dw = w * s, dh = h * s;
    return { x: box.x + (box.size - dw) / 2, y: box.y + (box.size - dh) / 2, w: dw, h: dh };
  }

  // ---------------------------------------------------------------- render
  function drawCanvas(geo, o) {
    var px = o.size;
    canvas.width = px;
    canvas.height = px;
    var ctx = canvas.getContext('2d');
    var scale = px / geo.total;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    if (!o.transparent) {
      ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, px, px);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = o.fg;
    ctx.fill(new Path2D(geo.body));
    if (geo.align) ctx.fill(new Path2D(geo.align), 'evenodd');
    ctx.fillStyle = o.eye;
    ctx.fill(new Path2D(geo.eyes), 'evenodd');
    if (geo.logo && state.logo) {
      var r = fitImage(state.logo, geo.logo);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(state.logo, r.x, r.y, r.w, r.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function buildSvg(geo, o) {
    var t = geo.total, parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + o.size + '" height="' + o.size + '" viewBox="0 0 ' + t + ' ' + t + '"' + (o.shape === 'square' ? ' shape-rendering="crispEdges"' : '') + '>');
    if (!o.transparent) parts.push('<rect width="' + t + '" height="' + t + '" fill="' + escAttr(o.bg) + '"/>');
    if (geo.body) parts.push('<path fill="' + escAttr(o.fg) + '" d="' + geo.body + '"/>');
    if (geo.align) parts.push('<path fill="' + escAttr(o.fg) + '" fill-rule="evenodd" d="' + geo.align + '"/>');
    parts.push('<path fill="' + escAttr(o.eye) + '" fill-rule="evenodd" shape-rendering="geometricPrecision" d="' + geo.eyes + '"/>');
    if (geo.logo && state.logo && state.logoDataUrl) {
      var r = fitImage(state.logo, geo.logo);
      parts.push('<image x="' + f(r.x) + '" y="' + f(r.y) + '" width="' + f(r.w) + '" height="' + f(r.h) + '" preserveAspectRatio="xMidYMid meet" href="' + escAttr(state.logoDataUrl) + '" xlink:href="' + escAttr(state.logoDataUrl) + '"/>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  function setEnabled(on) {
    buttons.forEach(function (b) { b.disabled = !on; });
  }

  function render() {
    var text = builders[state.type]();
    var o = readOptions();
    state.opts = o;
    canvasBox.classList.toggle('solid', !o.transparent);
    errorEl.hidden = true;

    if (!text) {
      state.qr = null;
      emptyMsg.hidden = false;
      metaEl.textContent = '';
      setEnabled(false);
      return;
    }

    try {
      state.qr = QRGen.encode(text, { ecl: o.ecl });
    } catch (e) {
      state.qr = null;
      emptyMsg.hidden = false;
      metaEl.textContent = '';
      errorEl.textContent = e.message;
      errorEl.hidden = false;
      setEnabled(false);
      return;
    }

    emptyMsg.hidden = true;
    state.geo = buildGeometry(state.qr, o, !!state.logo);
    drawCanvas(state.geo, o);
    setEnabled(true);

    var chars = Array.from(text).length;
    metaEl.textContent = 'Version ' + state.qr.version + ' · ' + state.qr.size + '×' + state.qr.size +
      ' modules · ECC ' + state.qr.ecl + ' · ' + chars + ' character' + (chars === 1 ? '' : 's');
  }

  var pending = false;
  function scheduleRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; render(); });
  }

  // ---------------------------------------------------------------- export
  function fileBase() { return 'qr-code-' + state.type; }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  $('#dl-png').addEventListener('click', function () {
    if (!state.qr) return;
    canvas.toBlob(function (blob) { downloadBlob(blob, fileBase() + '.png'); }, 'image/png');
  });

  $('#dl-svg').addEventListener('click', function () {
    if (!state.qr) return;
    var svg = buildSvg(state.geo, state.opts);
    downloadBlob(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
  });

  $('#copy-img').addEventListener('click', function () {
    if (!state.qr) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      toast('Copying images is not supported in this browser');
      return;
    }
    canvas.toBlob(function (blob) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(function () { toast('QR code copied to clipboard'); })
        .catch(function () { toast('Could not copy — try downloading instead'); });
    }, 'image/png');
  });

  // ---------------------------------------------------------------- events
  $$('.type').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.type = btn.dataset.type;
      $$('.type').forEach(function (b) { b.setAttribute('aria-selected', String(b === btn)); });
      $$('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== state.type; });
      scheduleRender();
    });
  });

  [contentForm, styleForm, outputForm].forEach(function (form) {
    form.addEventListener('input', scheduleRender);
    form.addEventListener('change', scheduleRender);
  });

  // keep corner colour in sync with foreground until the user changes it
  var eyeTouched = false;
  styleForm.elements.eye.addEventListener('input', function () { eyeTouched = true; });
  styleForm.elements.fg.addEventListener('input', function () {
    if (!eyeTouched) styleForm.elements.eye.value = styleForm.elements.fg.value;
  });

  // live labels for sliders
  outputForm.elements.size.addEventListener('input', function () { $('#size-out').textContent = this.value + ' px'; });
  outputForm.elements.margin.addEventListener('input', function () { $('#margin-out').textContent = this.value; });
  styleForm.elements.logoSize.addEventListener('input', function () { $('#logo-size-out').textContent = this.value + '%'; });

  // wifi: password not needed for open networks
  contentForm.elements.wifiType.addEventListener('change', function () {
    contentForm.elements.wifiPass.disabled = this.value === 'nopass';
  });

  // logo upload
  styleForm.elements.logo.addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Please choose an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Image is too large (max 5 MB)'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        state.logo = img;
        state.logoDataUrl = reader.result;
        $('#logo-name').textContent = file.name;
        $('#remove-logo').hidden = false;
        $('#logo-size-field').hidden = false;
        if (outputForm.elements.ecl.value !== 'H') {
          outputForm.elements.ecl.value = 'H';
          toast('Error correction set to High so the code still scans with a logo');
        }
        scheduleRender();
      };
      img.onerror = function () { toast('Could not read that image'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  $('#remove-logo').addEventListener('click', function () {
    state.logo = null;
    state.logoDataUrl = '';
    styleForm.elements.logo.value = '';
    $('#logo-name').textContent = '';
    this.hidden = true;
    $('#logo-size-field').hidden = true;
    scheduleRender();
  });

  // geolocation
  $('#use-location').addEventListener('click', function () {
    if (!navigator.geolocation) { toast('Geolocation is not available'); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      contentForm.elements.lat.value = pos.coords.latitude.toFixed(6);
      contentForm.elements.lng.value = pos.coords.longitude.toFixed(6);
      scheduleRender();
    }, function () { toast('Could not get your location'); }, { enableHighAccuracy: true, timeout: 10000 });
  });

  render();
})();
