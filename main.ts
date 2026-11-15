// IRONBOUND — entrypoint (Node 22, standard library only).
//
// The game itself is the static files under game/: the browser loads them as ES
// modules, three.js comes from the import map, and there is no build step. All
// this program does is stage the entry for the judge: it copies game/ and
// screenshots/ next to this file into the output directory and writes the
// dossier.json the scorer reads, using the vendored make.fun library.
//
//   Serve it locally with `node serve.ts`, then open http://localhost:8080.
//   Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//     mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The folder this file lives in: game/ and screenshots/ sit beside it.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Where the staged entry goes: the grader's /output, or MAKEFUN_OUTPUT_DIR
// when the run is local.
const stagingDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps (reference/gate.json). Only text_max_bytes shapes the
// dossier's bytes; the rest refuse an entry the scorer would refuse — more
// than 4 screenshots or one over 256 KiB, more than 993 files in game/ or
// 48 MiB of game files in all (game/ counts beside /output's own 1000-entry
// cap, its screenshots/ and dossier.json).
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

// Copy a folder beside this file into the staging directory, when it exists.
function stageFolder(name: string): void {
  const source = join(repoRoot, name);
  if (!existsSync(source)) return;
  cpSync(source, join(stagingDir, name), { recursive: true });
}

mkdirSync(stagingDir, { recursive: true });
stageFolder('game');
mkdirSync(join(stagingDir, 'screenshots'), { recursive: true });
stageFolder('screenshots');

writeFileSync(join(stagingDir, 'dossier.json'), buildDossier(stagingDir, dossierCaps));

console.log(`IRONBOUND staged in ${stagingDir}`);
