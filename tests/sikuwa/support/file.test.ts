import { describe, expect, test } from 'bun:test';
import { ConfigurationException } from '../../../src/lib/sikuwa/exceptions';
import { File } from '../../../src/lib/sikuwa/support/file';

/**
 * Porting dari `tests/Support/FileTest.php`.
 *
 * Tidak ada satu bentuk kiriman berkas yang diterima semua gateway — ada yang
 * mau data URI, ada yang mau base64 telanjang, ada yang mau byte mentah — jadi
 * kelas inilah yang menerjemahkannya. Yang diuji di sini terjemahannya, bukan
 * pengirimannya.
 */

/** Base64 dari "halo dunia" — isinya sengaja terbaca supaya mudah ditelusuri. */
const B64 = 'aGFsbyBkdW5pYQ==';

/** Base64 dari `count` byte, dipakai menguji perhitungan ukuran. */
function base64OfLength(count: number): string {
  return Buffer.from(new Uint8Array(count)).toString('base64');
}

describe('File', () => {
  test('jenis berkas datang dari ekstensinya', () => {
    expect(File.from(B64, 'bukti.png').mime).toBe('image/png');
    expect(File.from(B64, 'invoice.PDF').mime).toBe('application/pdf');
    expect(File.from(B64, 'arsip.zip').mime).toBe('application/zip');
  });

  test('ekstensi tak dikenal menjadi octet-stream', () => {
    // Berkas yang jenisnya tidak dikenali tetap bisa dikirim — WhatsApp
    // memperlakukannya sebagai dokumen biasa, bukan menolaknya.
    expect(File.from(B64, 'aneh.xyz').mime).toBe('application/octet-stream');
    expect(File.from(B64, 'tanpa-ekstensi').mime).toBe('application/octet-stream');
  });

  test('jenis dari data URI menang atas nama berkas', () => {
    const file = File.from(`data:image/jpeg;base64,${B64}`, 'salah-tulis.png');

    // Isi berkas lebih dipercaya daripada nama berkasnya.
    expect(file.mime).toBe('image/jpeg');
    expect(file.isImage()).toBe(true);
  });

  test('nama berkas yang diberikan dipertahankan', () => {
    expect(File.from(B64, 'bukti.png').filename).toBe('bukti.png');
    // Spasi di sekitar nama dibuang supaya tidak ikut terkirim.
    expect(File.from(B64, '  bukti.png  ').filename).toBe('bukti.png');
  });

  test('nama berkas bawaan mengikuti jenisnya', () => {
    // Nama berkas wajib ada: wuzapi menolak dokumen tanpa nama, jadi nama
    // bawaan harus selalu terisi.
    expect(File.from(`data:image/png;base64,${B64}`).filename).toBe('lampiran.png');
    expect(File.from(`data:application/pdf;base64,${B64}`).filename).toBe('lampiran.pdf');
    expect(File.from(B64).filename).toBe('lampiran.bin');
  });

  test('isImage mengikuti jenisnya', () => {
    expect(File.from(B64, 'a.png').isImage()).toBe(true);
    expect(File.from(B64, 'a.jpeg').isImage()).toBe(true);
    expect(File.from(B64, 'a.pdf').isImage()).toBe(false);
    expect(File.from(B64, 'a.zip').isImage()).toBe(false);
  });

  test('isUrl hanya untuk http dan https', () => {
    expect(File.from('https://contoh.test/bukti.png').isUrl()).toBe(true);
    expect(File.from('http://contoh.test/bukti.png').isUrl()).toBe(true);
    expect(File.from(B64, 'a.png').isUrl()).toBe(false);
    // Data URI tidak pernah dianggap URL, walaupun isinya panjang.
    expect(File.from(`data:image/png;base64,${B64}`).isUrl()).toBe(false);
  });

  test('dataUri idempoten', () => {
    const wrapped = File.from(B64, 'a.png').dataUri();

    expect(wrapped).toBe(`data:image/png;base64,${B64}`);
    // Yang sudah data URI tidak boleh dibungkus dua kali.
    expect(File.from(wrapped).dataUri()).toBe(wrapped);
  });

  test('base64 membuang awalan data URI', () => {
    expect(File.from(`data:image/png;base64,${B64}`).base64()).toBe(B64);
    // Yang memang sudah base64 telanjang dikembalikan apa adanya.
    expect(File.from(B64, 'a.png').base64()).toBe(B64);
  });

  test('bytes mengembalikan isi mentahnya', () => {
    const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

    expect(decode(File.from(B64, 'a.txt').bytes())).toBe('halo dunia');
    expect(decode(File.from(`data:text/plain;base64,${B64}`).bytes())).toBe('halo dunia');
  });

  test('bytes menolak isi yang bukan base64 dan bukan URL yang bisa dipakai', () => {
    const file = File.from('https://contoh.test/bukti.png');

    // Gateway yang mengunggah byte mentah tidak bisa memakai URL, dan
    // kegagalannya harus menjelaskan kenapa.
    expect(() => file.bytes()).toThrow(ConfigurationException);
    expect(() => file.bytes()).toThrow('bukan base64 yang sah');
  });

  test('isi kosong ditolak', () => {
    expect(() => File.from('   ')).toThrow(ConfigurationException);
    expect(() => File.from('   ')).toThrow('Isi berkas kosong');
  });
});

describe('File — ukuran', () => {
  /**
   * Ukuran harus persis, apa pun panjang isinya.
   *
   * Dihitung dari panjang base64, jadi panjang yang tidak habis dibagi 3
   * (yang menghasilkan padding `=`) adalah kasus yang paling mudah salah —
   * itulah sebabnya daftar ini memuat 1, 2, 4, dan 100 byte, bukan hanya
   * angka bulat yang enak dibagi.
   */
  test('ukuran persis untuk setiap panjang isi', () => {
    for (const expected of [1, 2, 3, 4, 5, 100, 1023, 1024, 1025, 70000]) {
      const base64 = base64OfLength(expected);

      expect(
        File.from(`data:application/octet-stream;base64,${base64}`, 'x.bin').size(),
        `Ukuran salah untuk isi ${expected} byte lewat data URI`,
      ).toBe(expected);

      expect(
        File.from(base64, 'x.bin').size(),
        `Ukuran salah untuk isi ${expected} byte lewat base64 telanjang`,
      ).toBe(expected);
    }
  });

  test('ukuran mengabaikan baris baru pada base64 terbungkus', () => {
    // Base64 gaya MIME dibungkus tiap 76 kolom; decoder mengabaikan baris
    // baru, jadi hitungan ukurannya pun harus mengabaikannya.
    const wrapped = base64OfLength(1000).replace(/(.{76})/g, '$1\r\n');

    expect(File.from(`data:application/octet-stream;base64,${wrapped}`, 'x.bin').size()).toBe(1000);
  });

  test('ukuran null saat memang tidak bisa diketahui', () => {
    // URL publik diunduh gateway, bukan SDK — ukurannya tidak diketahui, dan
    // itu berbeda dari nol.
    expect(File.from('https://contoh.test/besar.pdf').size()).toBeNull();
  });

  test('exceedsLimit dibandingkan dengan batas maksimum WhatsApp', () => {
    const justUnder = File.from(
      `data:application/pdf;base64,${base64OfLength(16 * 1024 * 1024)}`,
      'a.pdf',
    );
    const justOver = File.from(
      `data:application/pdf;base64,${base64OfLength(16 * 1024 * 1024 + 1)}`,
      'b.pdf',
    );

    expect(justUnder.exceedsLimit()).toBe(false);
    expect(justOver.exceedsLimit()).toBe(true);
  });

  test('exceedsLimit menerima batas sendiri', () => {
    const file = File.from(`data:application/pdf;base64,${base64OfLength(2000)}`, 'a.pdf');

    expect(file.exceedsLimit(1000)).toBe(true);
    expect(file.exceedsLimit(3000)).toBe(false);
  });

  test('ukuran yang tidak diketahui tidak pernah dianggap melebihi batas', () => {
    expect(File.from('https://contoh.test/besar.pdf').exceedsLimit()).toBe(false);
  });

  test('readableSize memakai satuan yang tepat', () => {
    expect(File.from(base64OfLength(512), 'a.bin').readableSize()).toBe('512 B');
    expect(File.from(base64OfLength(2048), 'a.bin').readableSize()).toBe('2.0 KB');
    expect(File.from(base64OfLength(1048576), 'a.bin').readableSize()).toBe('1.0 MB');
    expect(File.from('https://contoh.test/a.pdf').readableSize()).toBe('');
  });
});
