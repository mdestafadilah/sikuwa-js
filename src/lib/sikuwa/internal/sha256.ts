/**
 * SHA-256 murni JavaScript, sinkron, tanpa dependensi.
 *
 * ## Kenapa tidak memakai yang sudah ada
 *
 * `node:crypto` tidak ada di Cloudflare Workers, sedangkan `crypto.subtle`
 * ada di mana-mana **tetapi asinkron**. Versi PHP dari fungsi ini —
 * `ApiMeMessage::idempotencyKey()` — memanggil `hash('sha256', …)` secara
 * sinkron, dan menjadikannya `Promise` akan mengubah tanda tangan publiknya
 * hanya demi satu header. Karena pustaka ini juga tidak boleh punya dependensi
 * runtime, implementasi sendiri adalah satu-satunya jalan yang mempertahankan
 * ketiganya: sinkron, tanpa dependensi, dan jalan di Node, Bun, Workers, serta
 * peramban.
 *
 * Hasilnya wajib **identik dengan PHP**, karena kunci idempotensi yang berbeda
 * berarti pesan yang sama bisa terkirim dua kali saat pemakaian berpindah
 * antara paket PHP dan paket ini. Kesamaan itu dibuktikan test terhadap vektor
 * baku SHA-256 dan terhadap keluaran `hash()` PHP yang sebenarnya.
 *
 * Sengaja tidak diekspor dari `index.ts`: ia detail internal, sama seperti
 * `internal/scalar.ts`.
 */

/** 64 konstanta pembulatan SHA-256 (akar kubik 64 bilangan prima pertama). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Nilai awal H (akar kuadrat 8 bilangan prima pertama). */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/**
 * SHA-256 dari sebuah teks UTF-8, sebagai heksadesimal huruf kecil.
 *
 * Bentuk ini yang diminta PHP `hash('sha256', $s)`, dan huruf kecil itu penting:
 * PHP selalu mengembalikan huruf kecil, sedangkan `toString(16)` JavaScript
 * juga — jadi keduanya bertemu di bentuk yang sama tanpa perlu penyesuaian.
 */
export function sha256Hex(input: string): string {
  const message = new TextEncoder().encode(input);
  const bitLength = message.length * 8;

  // Tata letak padding SHA-256: isi, satu byte 0x80, lalu panjang dalam bit
  // sebagai bilangan 64-bit big-endian. Seluruhnya dibulatkan ke kelipatan 64
  // byte, dan satu blok penuh ditambahkan bila isinya sudah pas.
  const padded = new Uint8Array((((message.length + 9) + 63) >> 6) << 6);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  // Untuk masukan sependek apa pun di sini bagian atasnya nol, tapi ditulis
  // tetap supaya implementasinya benar untuk panjang berapa pun.
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  const h = H0.slice();
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }

    for (let i = 16; i < 64; i++) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);

      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }

  let hex = '';

  for (const word of h) {
    hex += word.toString(16).padStart(8, '0');
  }

  return hex;
}

/** Geser kanan melingkar 32-bit. */
function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
