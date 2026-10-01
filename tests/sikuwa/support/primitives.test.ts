import { describe, expect, test } from 'bun:test';
import { PhoneNumber } from '../../../src/lib/sikuwa/support/phone-number';
import { Text } from '../../../src/lib/sikuwa/support/text';
import { Qr } from '../../../src/lib/sikuwa/support/qr';
import { Envelope } from '../../../src/lib/sikuwa/support/envelope';

/** Porting dari `tests/Support/PhoneNumberTest.php`. */
describe('PhoneNumber', () => {
  test.each([
    ['awalan nol', '081234567890', '6281234567890'],
    ['sudah internasional', '6281234567890', '6281234567890'],
    ['tanpa awalan', '81234567890', '6281234567890'],
    ['tanda plus', '+62 812-3456-7890', '6281234567890'],
    ['spasi dan strip', '0812 3456 7890', '6281234567890'],
    ['tanda kurung dan titik', '(0812) 3456.7890', '6281234567890'],
    ['nomor luar negeri', '14155552671', '14155552671'],
    ['kosong', '', ''],
    ['tanpa angka', 'abc-def', ''],
  ])('normalisasi: %s', (_label, input, expected) => {
    expect(PhoneNumber.normalize(input)).toBe(expected);
  });

  test('toWid menambahkan akhiran', () => {
    expect(PhoneNumber.toWid('081234567890')).toBe('6281234567890@c.us');
  });

  test('toWid mempertahankan JID yang sudah ada', () => {
    expect(PhoneNumber.toWid('6281234567890@s.whatsapp.net')).toBe('6281234567890@s.whatsapp.net');
    expect(PhoneNumber.toWid('1234567890-123456@g.us')).toBe('1234567890-123456@g.us');
  });
});

/**
 * `Text` belum punya tes tersendiri di versi PHP — perannya diuji lewat
 * `PacingTest` (`Text::length`). Karena itu padanannya dibuktikan langsung di
 * sini, termasuk perilaku tipe longgarnya yang dipakai seluruh provider.
 */
describe('Text', () => {
  test('of membaca nilai skalar dan mengabaikan sisanya', () => {
    expect(Text.of('halo')).toBe('halo');
    expect(Text.of(42)).toBe('42');
    expect(Text.of(true)).toBe('1');
    expect(Text.of(false)).toBe('');
    expect(Text.of(null)).toBe('');
    expect(Text.of(['halo'])).toBe('');
    expect(Text.of({ halo: 1 })).toBe('');
  });

  test('first memilih kandidat pertama yang terisi', () => {
    expect(Text.first(null, '', 'phoneNumber', 'jid')).toBe('phoneNumber');
    expect(Text.first(undefined, 0)).toBe('0');
    expect(Text.first(null, '')).toBe('');
  });

  test('equalsAny tidak peduli besar-kecil huruf', () => {
    expect(Text.equalsAny('CONNECTED', 'connected', 'open')).toBe(true);
    expect(Text.equalsAny('Closed', 'connected', 'open')).toBe(false);
  });

  test('length menghitung karakter, bukan byte', () => {
    expect(Text.length('ééé')).toBe(3);
    expect(Text.length('👋🏽')).toBe(2);
    expect(Text.length('')).toBe(0);
  });
});

/**
 * `Qr` belum punya tes tersendiri di versi PHP — ia diuji lewat `QrCodeTest`
 * tingkat provider. Padanannya dibuktikan di sini karena seluruh provider
 * bersandar padanya.
 */
describe('Qr', () => {
  test('dataUri membungkus base64 telanjang', () => {
    expect(Qr.dataUri('AAA')).toBe('data:image/png;base64,AAA');
    expect(Qr.dataUri('AAA', 'image/jpeg')).toBe('data:image/jpeg;base64,AAA');
  });

  test('dataUri idempoten', () => {
    const once = Qr.dataUri('AAA');

    expect(Qr.dataUri(once)).toBe(once);
  });

  test('dataUri mengembalikan string kosong untuk payload kosong', () => {
    expect(Qr.dataUri('   ')).toBe('');
  });

  test('base64 mengambil isi murninya', () => {
    expect(Qr.base64('data:image/png;base64,AAA')).toBe('AAA');
    expect(Qr.base64('AAA')).toBe('AAA');
  });
});

describe('Envelope', () => {
  test('unwrap memakai isi data bila ada', () => {
    expect(Envelope.unwrap({ success: true, data: { id: 's1' } })).toEqual({ id: 's1' });
  });

  test('unwrap mengembalikan body apa adanya bila data bukan objek', () => {
    expect(Envelope.unwrap({ id: 's1' })).toEqual({ id: 's1' });
    expect(Envelope.unwrap({ data: 'bukan objek' })).toEqual({ data: 'bukan objek' });
    expect(Envelope.unwrap({ data: [1, 2] })).toEqual({ data: [1, 2] });
  });

  test('data memakai objek kosong bila data tidak ada', () => {
    expect(Envelope.data({ success: true, data: { id: 's1' } })).toEqual({ id: 's1' });
    expect(Envelope.data({ id: 's1' })).toEqual({});
    expect(Envelope.data({ data: null })).toEqual({});
  });
});
