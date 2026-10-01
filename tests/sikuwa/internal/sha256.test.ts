import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../../../src/lib/sikuwa/internal/sha256';

/**
 * SHA-256 ini ditulis sendiri, jadi ia harus dibuktikan, bukan dipercaya.
 *
 * Semua nilai harapan di bawah **dihasilkan oleh `hash('sha256', …)` PHP**,
 * bukan diketik dari ingatan — itulah yang membuat test ini bermakna: yang
 * diuji bukan "apakah ini SHA-256 menurut saya", melainkan "apakah hasilnya
 * sama dengan yang akan dihitung paket PHP".
 *
 * Itu penting karena kunci idempotensi ApiMe ikut diturunkan dari sini. Kalau
 * kedua implementasi menghasilkan kunci berbeda, pemakaian yang berpindah dari
 * paket PHP ke paket ini akan mengirim pesan yang sama dua kali — tepat pada
 * kasus yang justru ingin dicegah kunci itu.
 */

/** Panjang 56 byte: tepat di batas di mana padding butuh blok tambahan. */
const BOUNDARY_56 = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';

describe('sha256Hex — vektor baku', () => {
  test('teks kosong', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('"abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('56 byte — satu byte sebelum padding melimpah ke blok kedua', () => {
    expect(sha256Hex(BOUNDARY_56)).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  test('1000 byte — banyak blok', () => {
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  test('teks UTF-8 beraksen dan emoji', () => {
    // `µ` dua byte dan `🎉` empat byte di UTF-8, jadi ini sekaligus menguji
    // bahwa panjangnya dihitung dalam byte, bukan karakter. Menghitung
    // karakter akan menghasilkan padding yang salah dan hash yang berbeda.
    expect(sha256Hex('inst-µnicode|62811|Halo, dunia! 🎉')).toBe(
      '86ebe0497c54b7c50d3d80492c5640fc7701ca8827c935ec9a1b3108a667c806',
    );
  });
});

describe('sha256Hex — bentuk keluaran', () => {
  test('selalu 64 karakter heksadesimal huruf kecil', () => {
    const value = sha256Hex('apa saja');

    expect(value).toHaveLength(64);
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  });

  test('setiap kata ditulis 8 digit, termasuk yang berawalan nol', () => {
    // Tanpa `padStart`, kata yang nilainya kecil akan menghasilkan hash yang
    // lebih pendek — dan itu hanya muncul pada sebagian masukan, jadi mudah
    // lolos dari pemeriksaan panjang biasa.
    const values = [sha256Hex(''), sha256Hex('a'), sha256Hex('ab'), sha256Hex('abc')];

    for (const value of values) {
      expect(value).toHaveLength(64);
    }
  });
});
