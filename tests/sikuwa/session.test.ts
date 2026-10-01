import { describe, expect, test } from 'bun:test';
import { Session } from '../../src/lib/sikuwa/session';

/**
 * Porting dari `tests/SessionTest.php`, bagian value object.
 *
 * Sisanya di berkas aslinya memeriksa method HTTP, URL, dan header yang
 * dikirim tiap gateway — itu milik tes tingkat provider, jadi menyusul bersama
 * provider pilot.
 */
describe('Session', () => {
  test('serialisasi tanpa amplop mentah maupun token', () => {
    const session = new Session({
      provider: 'OpenWA',
      id: 'sess-1',
      status: 'CONNECTED',
      connected: true,
      qr: 'data:image/png;base64,AAA',
      token: 'rahasia',
      phoneNumber: '62811',
      profileName: 'Sekolah',
      raw: { id: 'sess-1', stats: { messagesSent: 12 } },
    });

    expect(session.isConnected()).toBe(true);
    expect(session.hasQr()).toBe(true);
    expect(session.token).toBe('rahasia');
    expect(session.toString()).toBe('OpenWA: CONNECTED (sess-1)');

    const expected = {
      provider: 'OpenWA',
      id: 'sess-1',
      status: 'CONNECTED',
      connected: true,
      qr: 'data:image/png;base64,AAA',
      phoneNumber: '62811',
      profileName: 'Sekolah',
    };

    // Token adalah kredensial dan raw bisa besar: keduanya sengaja tidak ikut,
    // supaya keluaran ini aman dicatat ke log.
    expect(session.toArray()).toEqual(expected);
    expect(session.toJson()).toBe(JSON.stringify(expected));
  });

  test('nilai yang tidak disebut gateway dibiarkan kosong, bukan ditebak', () => {
    const session = new Session({ provider: 'Wuzapi' });

    expect(session.id).toBe('');
    expect(session.status).toBe('');
    expect(session.connected).toBe(false);
    expect(session.qr).toBe('');
    expect(session.token).toBe('');
    expect(session.phoneNumber).toBe('');
    expect(session.profileName).toBe('');
    expect(session.raw).toEqual({});
    expect(session.hasQr()).toBe(false);
  });

  test('ringkasan log jatuh ke connected atau unknown bila statusnya kosong', () => {
    expect(new Session({ provider: 'OpenWA', connected: true }).toString()).toBe('OpenWA: connected');
    expect(new Session({ provider: 'OpenWA' }).toString()).toBe('OpenWA: unknown');
    expect(new Session({ provider: 'Fonnte', status: 'connect', id: '628222' }).toString()).toBe(
      'Fonnte: connect (628222)',
    );
  });

  test('qrImage dan qrBase64 membaca bentuk QR yang berbeda', () => {
    const session = new Session({ provider: 'Fonnte', qr: 'data:image/png;base64,AAA' });

    expect(session.qrImage()).toBe('data:image/png;base64,AAA');
    expect(session.qrBase64()).toBe('AAA');
  });

  test('qrTag siap cetak, dan kosong bila tidak ada QR', () => {
    const session = new Session({ provider: 'OpenWA', qr: 'data:image/png;base64,AAA' });

    expect(session.qrTag()).toBe(
      '<img src="data:image/png;base64,AAA" alt="QR WhatsApp" width="260" height="260">',
    );
    expect(session.qrTag('Scan untuk masuk', 320)).toBe(
      '<img src="data:image/png;base64,AAA" alt="Scan untuk masuk" width="320" height="320">',
    );
    expect(new Session({ provider: 'OpenWA' }).qrTag()).toBe('');
  });

  test('qrTag melindungi atribut alt dari tanda kutip dan tag', () => {
    const session = new Session({ provider: 'OpenWA', qr: 'data:image/png;base64,AAA' });

    expect(session.qrTag('QR "sekolah" <1>')).toBe(
      '<img src="data:image/png;base64,AAA" alt="QR &quot;sekolah&quot; &lt;1&gt;" width="260" height="260">',
    );
  });
});
