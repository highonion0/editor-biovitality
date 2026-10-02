// Randeaza un proiect BioVitality cu Remotion. Comunica cu aplicatia prin linii JSON pe stdout.
//   node render.mjs --prepare              -> pregateste motorul (bundle + browser), o singura data
//   node render.mjs <props.json> <out.mp4> -> randeaza
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderMedia, selectComposition} from '@remotion/renderer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(ROOT, 'build');
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const browser = process.env.BV_BROWSER || null;             // doar pentru teste
const chromeMode = browser ? 'chrome-for-testing' : 'headless-shell';

function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}

async function getBundle() {
  // fonturile aplicatiei devin fisiere statice ale motorului
  const fontsSrc = path.join(ROOT, '..', 'fonts'), fontsDst = path.join(ROOT, 'public', 'fonts');
  fs.mkdirSync(fontsDst, {recursive: true});
  for (const f of fs.readdirSync(fontsSrc)) {
    if (!f.endsWith('.ttf')) continue;
    const a = path.join(fontsSrc, f), b = path.join(fontsDst, f);
    // copiem doar daca lipseste sau difera -> nu refacem pachetul degeaba la fiecare randare
    if (!fs.existsSync(b) || fs.statSync(b).size !== fs.statSync(a).size) fs.copyFileSync(a, b);
  }
  const stamp = path.join(BUILD, '.stamp');
  const srcTime = Math.max(newest(path.join(ROOT, 'src')), newest(path.join(ROOT, 'public')));
  if (fs.existsSync(stamp) && Number(fs.readFileSync(stamp, 'utf8')) >= srcTime) return BUILD;
  say({type: 'log', msg: 'Pregătesc motorul Remotion (doar prima dată)...'});
  await bundle({entryPoint: path.join(ROOT, 'src', 'index.ts'), outDir: BUILD, publicDir: path.join(ROOT, 'public')});
  fs.writeFileSync(stamp, String(srcTime));
  return BUILD;
}

async function main() {
  const [arg1, arg2] = process.argv.slice(2);
  if (!browser) await ensureBrowser();
  const serveUrl = await getBundle();
  if (arg1 === '--prepare') { say({type: 'done'}); return; }
  const inputProps = JSON.parse(fs.readFileSync(arg1, 'utf8'));
  const composition = await selectComposition({serveUrl, id: 'Main', inputProps, browserExecutable: browser, chromeMode});
  say({type: 'log', msg: `Randez ${composition.durationInFrames} cadre (${composition.width}x${composition.height}, ${composition.fps} fps)...`});
  let last = -1;
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', crf: 18, pixelFormat: 'yuv420p',
    outputLocation: arg2, browserExecutable: browser, chromeMode,
    concurrency: Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2))),
    onProgress: ({progress}) => {
      const v = Math.floor(progress * 100);
      if (v !== last) { last = v; say({type: 'progress', value: v}); }
    },
  });
  say({type: 'done'});
}

main().catch((e) => { say({type: 'error', msg: String((e && e.stack) || e).slice(0, 1500)}); process.exit(1); });
