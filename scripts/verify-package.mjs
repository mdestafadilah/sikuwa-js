#!/usr/bin/env bun
/**
 * Buktikan paket yang akan terbit benar-benar bisa dipakai — sebelum terbit.
 *
 * Alurnya sengaja meniru pemakai sungguhan: bungkus dengan `npm pack`, pasang
 * tarball-nya di proyek kosong **di luar repo ini**, lalu jalankan uji asapnya
 * dengan **Node biasa**.
 *
 * Dua hal yang membuat langkah-langkah itu tidak boleh disederhanakan:
 *
 * - Memasang dari tarball, bukan dari `src/`, adalah satu-satunya cara tahu apa
 *   yang benar-benar ikut terbit — `files` bisa saja salah dan tes repo tetap
 *   hijau.
 * - Node, bukan Bun, adalah satu-satunya cara menangkap impor relatif tanpa
 *   ekstensi yang lolos dari `tsc`.
 *
 * Jalankan setelah `bun run build:lib`.
 *
 * Catatan penting soal alur keluar: **jangan** memanggil `process.exit()` di
 * dalam blok `try` yang punya `finally`. `process.exit()` menghentikan proses
 * saat itu juga, sehingga `finally` tidak pernah jalan dan tarball serta
 * direktori sementara tertinggal di disk — persis pada jalur gagal, jalur yang
 * paling sering dijalankan saat ada masalah. Karena itu semua kegagalan di sini
 * dilempar sebagai Error, dan keputusan keluar diambil setelah pembersihan.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.env["NODE_BIN"] ?? "node";

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8", ...options });
}

function step(text) {
  console.log(`\n=== ${text} ===`);
}

function fail(message) {
  throw new Error(message);
}

// 1. Bungkus.
step("npm pack");
const packOutput = run("npm", ["pack"]).trim();
const tarball = packOutput.split("\n").pop().trim();

if (!existsSync(join(ROOT, tarball))) {
  console.error(`tarball tidak ditemukan: ${tarball}`);
  process.exit(1);
}

console.log(tarball);

// 2. Proyek kosong di luar repo. Kalau ia berada di dalam repo, ia akan ikut
//    membaca node_modules repo ini dan buktinya jadi tidak sah.
const scratch = join(
  process.env["TEMP"] ?? process.env["TMPDIR"] ?? "/tmp",
  `sikuwa-verify-${Date.now()}`,
);

mkdirSync(scratch, { recursive: true });

let ready = false;

try {
  step("pasang di proyek kosong");
  writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "verify", type: "module" }));

  const install = run("npm", ["install", join(ROOT, tarball), "--no-audit", "--no-fund"], {
    cwd: scratch,
  });

  console.log(install.trim());

  // Nol dependensi: kalau ini bukan 1, ada yang salah pada daftar dependencies.
  const installed = readdirSync(join(scratch, "node_modules")).filter(
    (name) => !name.startsWith("."),
  );

  if (installed.length !== 1 || installed[0] !== "sikuwa") {
    fail(`harusnya hanya 'sikuwa' yang terpasang, ternyata: ${installed.join(", ")}`);
  }

  console.log("terpasang tepat satu paket: sikuwa");

  // 3. Uji asap dengan Node biasa.
  step(`uji asap dengan Node (${NODE})`);
  copyFileSync(join(ROOT, "scripts", "package-smoke.mjs"), join(scratch, "package-smoke.mjs"));

  try {
    console.log(run(NODE, ["package-smoke.mjs"], { cwd: scratch }).trim());
  } catch (error) {
    // Keluaran uji asap dimatikan oleh execFileSync, jadi cetak sendiri supaya
    // pemeriksaan mana yang gagal tetap terlihat.
    console.error(error.stdout ?? "");
    console.error(error.stderr ?? "");
    fail("uji asap gagal");
  }

  ready = true;
} catch (error) {
  console.error(`\nGAGAL: ${error.message}`);
} finally {
  // Harus jalan di jalur sukses maupun gagal — lihat catatan di atas.
  rmSync(scratch, { recursive: true, force: true });
  rmSync(join(ROOT, tarball), { force: true });
}

if (!ready) process.exit(1);

console.log("\nPaket siap diterbitkan.");
