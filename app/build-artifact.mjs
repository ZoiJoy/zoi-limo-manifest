// Packs the app into one self-contained HTML page (no separate files), for publishing as a Claude artifact.
// Usage: node build-artifact.mjs [output.html]
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const out = process.argv[2] || path.join(dir, 'dist', 'reservations.html');

const stripImports = (src) => src.replace(/^import[\s\S]*?from\s+'[^']+';\n/gm, '');
const stripExports = (src) => src.replace(/^export (?=(const|let|function|async function|class) )/gm, '');

// store.js is used as a namespace (`db.x`) by app.js, so wrap it and return its exports.
const storeSrc = read('store.js');
const storeExports = [...storeSrc.matchAll(/^export (?:const|let|function|async function|class) (\w+)/gm)].map((m) => m[1]);
const storeModule = `const db = (() => {\n${stripExports(storeSrc)}\nreturn { ${storeExports.join(', ')} };\n})();`;

const js = [
  stripExports(read('pricing.js')),
  stripExports(stripImports(read('invoice.js'))),
  storeModule,
  stripImports(read('app.js')),
].join('\n\n');

// The artifact frame already pads the page for the phone's notch, so the sticky header doesn't add it again.
const css = `${read('styles.css')}
.topbar { top: env(safe-area-inset-top, 0px); padding-top: 10px; }
`;

const body = read('index.html').match(/<body>([\s\S]*?)<script/)[1].trim();

const html = `<title>ZOI LIMO Bookings</title>
<meta name="theme-color" content="#111111">
<style>
${css}</style>
${body}
<script type="module">
${js.replaceAll('</script', '<\\/script')}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
