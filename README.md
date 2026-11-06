# QR Generator Free

A free, private, open-source QR code generator that runs entirely in your browser.

**No sign-up. No tracking. No expiring codes. No server.** Your data never leaves the page.

👉 **Live demo:** https://wayancc.github.io/QR-Generator-Free/

## Features

- **Content types:** Link, plain text, Wi-Fi login, email, phone call, SMS, contact card (vCard), and map location.
- **Design:** foreground, corner, and background colours; transparent background; square, rounded, or dot modules; square, rounded, or circle corners.
- **Logo:** put your own image in the centre. Error correction switches to *High* automatically so the code still scans.
- **Export:** PNG (128–2048 px), SVG (vector, for print), or copy the image to the clipboard.
- **Settings:** adjustable quiet zone (margin) and error correction level (L / M / Q / H).
- **No dependencies:** a built-in QR encoder ([`js/qrcode.js`](js/qrcode.js)) supports versions 1–40, numeric, alphanumeric, and UTF-8 byte modes, and automatic mask selection.
- **Light and dark mode,** responsive layout, and keyboard accessible.

## Usage

Open `index.html` in any modern browser. No build step or install is needed.

To run it on a local server instead:

```bash
# Python
python -m http.server 8080
# or Node
npx serve .
```

Then visit http://localhost:8080.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
4. The site will be available at `https://<user>.github.io/QR-Generator-Free/`.

## Use the encoder in your own project

`js/qrcode.js` is a standalone, dependency-free module. It works in the browser (as the `QRGen` global) and in Node.js (with `require`).

```js
const QRGen = require('./js/qrcode.js'); // or <script src="js/qrcode.js">

const qr = QRGen.encode('https://example.com', { ecl: 'M' }); // ecl: L | M | Q | H
console.log(qr.version, qr.size); // e.g. 2, 25
for (let y = 0; y < qr.size; y++) {
  let row = '';
  for (let x = 0; x < qr.size; x++) row += qr.isDark(x, y) ? '██' : '  ';
  console.log(row);
}
```

Options:

| Option       | Default | Description                                      |
|--------------|---------|--------------------------------------------------|
| `ecl`        | `'M'`   | Error correction level: `L`, `M`, `Q`, or `H`    |
| `mask`       | `-1`    | Mask pattern `0`–`7`; `-1` chooses the best one automatically |
| `minVersion` | `1`     | Smallest QR version (symbol size) to use         |

## Project structure

```
index.html        UI
css/style.css     Styles (light and dark)
js/qrcode.js      QR code encoder (no dependencies)
js/app.js         UI logic, rendering, and export
favicon.svg       Icon
```

## Contributing

Issues and pull requests are welcome. Please keep the project dependency-free and fully client-side.

## License

[MIT](LICENSE)

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
