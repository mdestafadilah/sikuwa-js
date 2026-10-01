#!/usr/bin/env bun
/**
 * Bangun pustaka `sikuwa` yang diterbitkan ke npm.
 *
 * Tiga langkah, sengaja tanpa alat tambahan apa pun selain TypeScript yang
 * sudah ada:
 *
 * 1. bersihkan `dist-lib/`;
 * 2. `tsc` mengeluarkan JS + `.d.ts` (lihat `tsconfig.lib.json`);
 * 3. tempelkan ekstensi `.js` pada seluruh impor relatif.
 *
 * Langkah ketiga bukan kerapian belaka. `tsc` menulis impor apa adanya —
 * `from './config'` — dan itu sah di Vite maupun Bun, tetapi **Node mensyaratkan
 * ekstensi eksplisit** pada impor ESM. Tanpa langkah ini, paket yang terbit akan
 * gagal di pemakai dengan `ERR_MODULE_NOT_FOUND` meski seluruh tes di repo ini
 * hijau, karena tes berjalan lewat Bun yang memaafkan.
 *
 * Karena itu skrip ini juga **memeriksa hasilnya sendiri**: kalau masih ada
 * impor relatif tanpa ekstensi, ia keluar dengan kode 1 alih-alih menerbitkan
 * paket yang rusak.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist-lib");

/** Seluruh berkas di bawah `dir`, rekursif. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Tambahkan ekstensi pada satu specifier relatif, dengan melihat berkasnya
 * benar-benar ada.
 *
 * Impor ke sebuah direktori (`./exceptions`) harus menjadi `./exceptions/index.js`
 * — Node tidak mencari `index` sendiri. Karena itu specifier-nya diselesaikan
 * lebih dulu terhadap direktori berkas, bukan sekadar ditempeli `.js`.
 */
function resolveSpecifier(file, specifier) {
  if (/\.[A-Za-z0-9]+$/.test(specifier)) return specifier; // sudah ber-ekstensi

  const target = resolve(dirname(file), specifier);

  if (existsSync(`${target}.js`)) return `${specifier}.js`;
  if (existsSync(join(target, "index.js"))) return `${specifier}/index.js`;

  return null;
}

/** Tulis ulang seluruh impor relatif di satu berkas. */
function rewrite(file) {
  const before = readFileSync(file, "utf8");
  const missed = [];

  // `from "./x"`, `import("./x")`, dan `import "./x"`.
  const after = before.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']*)\2/g,
    (match, prefix, quote, specifier) => {
      const fixed = resolveSpecifier(file, specifier);

      if (fixed === null) {
        missed.push(specifier);

        return match;
      }

      return `${prefix}${quote}${fixed}${quote}`;
    },
  );

  if (after !== before) writeFileSync(file, after);

  return missed;
}

// 1. Bersihkan.
rmSync(OUT, { recursive: true, force: true });

// 2. Kompilasi.
const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tsc)) {
  console.error("typescript tidak ditemukan di node_modules — jalankan `bun install` dulu.");
  process.exit(1);
}

execFileSync(process.execPath, [tsc, "-p", "tsconfig.lib.json"], {
  cwd: ROOT,
  stdio: "inherit",
});

// 3. Tempelkan ekstensi, lalu buktikan tidak ada yang tertinggal.
const files = walk(OUT).filter((file) => /\.(js|d\.ts)$/.test(file));
const problems = [];

for (const file of files) {
  const missed = rewrite(file);

  if (missed.length > 0) problems.push(`${file}: ${missed.join(", ")}`);
}

if (problems.length > 0) {
  console.error("\nImpor relatif berikut tidak bisa diselesaikan:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

// Periksa ulang dari berkas yang sudah ditulis: satu-satunya cara memastikan
// penggantiannya benar-benar mendarat.
const leftovers = [];

for (const file of files) {
  const match = readFileSync(file, "utf8").match(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']*)\1/g,
  );

  for (const found of match ?? []) {
    const specifier = found.replace(/^.*?(["'])/, "").replace(/["']$/, "");

    if (!/\.[A-Za-z0-9]+$/.test(specifier)) leftovers.push(`${file}: ${specifier}`);
  }
}

if (leftovers.length > 0) {
  console.error("\nMasih ada impor tanpa ekstensi setelah penulisan ulang:");
  for (const leftover of leftovers) console.error(`  ${leftover}`);
  process.exit(1);
}

console.log(`\ndist-lib siap: ${files.length} berkas, seluruh impor relatif ber-ekstensi .js`);
