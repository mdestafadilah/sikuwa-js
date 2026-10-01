import { describe, expect, test } from 'bun:test';
import { ConfigurationException } from '../../../src/lib/sikuwa/exceptions';
import { Presence } from '../../../src/lib/sikuwa/support/presence';

/**
 * Porting dari `tests/Support/PresenceTest.php`.
 *
 * Yang dijaga di sini adalah dua hal yang tidak boleh diserahkan ke tiap
 * provider: istilah gateway mana pun harus diterima dan dipetakan ke satu
 * kosakata, dan durasi tidak boleh hilang saat indikator ditampilkan — sebab
 * Fonnte dan Evolution API akan menampilkan indikator nol detik tanpa keluhan.
 */
describe('Presence', () => {
  test('composing adalah keadaan bawaan', () => {
    const presence = Presence.from('', 5);

    expect(presence.state).toBe(Presence.COMPOSING);
    expect(presence.isComposing()).toBe(true);
    expect(presence.showsIndicator()).toBe(true);
  });

  test.each([
    ['typing — istilah OpenWA', 'typing', Presence.COMPOSING],
    ['compose', 'compose', Presence.COMPOSING],
    ['menulis', 'menulis', Presence.COMPOSING],
    ['stop — istilah Fonnte', 'stop', Presence.PAUSED],
    ['pause', 'pause', Presence.PAUSED],
    ['berhenti', 'berhenti', Presence.PAUSED],
    ['audio — istilah wuzapi', 'audio', Presence.RECORDING],
    ['record', 'record', Presence.RECORDING],
  ])('istilah gateway dipetakan ke kosakata baku: %s', (_label, alias, expected) => {
    expect(Presence.from(alias, 5).state).toBe(expected);
  });

  test('keadaan tidak peduli besar-kecil huruf dan dibersihkan spasinya', () => {
    expect(Presence.from('  Recording ', 5).state).toBe(Presence.RECORDING);
  });

  test('keadaan tak dikenal menyebutkan yang diterima', () => {
    expect(() => Presence.from('melamun', 5)).toThrow(ConfigurationException);
    expect(() => Presence.from('melamun', 5)).toThrow('composing, paused, atau recording');
  });

  test('durasi wajib ada saat menampilkan indikator', () => {
    expect(() => Presence.from('composing')).toThrow(ConfigurationException);
    expect(() => Presence.from('composing')).toThrow("kunci 'duration'");
  });

  test('paused tidak butuh durasi', () => {
    const presence = Presence.from('paused');

    expect(presence.state).toBe(Presence.PAUSED);
    expect(presence.duration).toBe(0);
    expect(presence.showsIndicator()).toBe(false);
  });

  test('detik pecahan dibulatkan ke atas', () => {
    expect(Presence.from('composing', 1.2).duration).toBe(2);
    expect(Presence.from('composing', '2.5').duration).toBe(3);
  });

  test('durasi nol ditolak', () => {
    expect(() => Presence.from('composing', 0)).toThrow(ConfigurationException);
    expect(() => Presence.from('composing', 0)).toThrow('minimal 1 detik');
  });

  test('durasi bukan angka ditolak', () => {
    expect(() => Presence.from('composing', 'sebentar')).toThrow(ConfigurationException);
    expect(() => Presence.from('composing', 'sebentar')).toThrow('harus berupa angka detik');
  });

  test('durasi bukan skalar ditolak sebagai kesalahan konfigurasi', () => {
    // Nilainya datang dari array pesan pemanggil, jadi tipe yang salah harus
    // menjadi ConfigurationException — bukan error tipe yang tidak menjelaskan
    // apa pun tentang cara memperbaikinya.
    expect(() => Presence.from('composing', ['lima'])).toThrow(ConfigurationException);
    expect(() => Presence.from('composing', ['lima'])).toThrow('bukan array');
  });

  test('milidetik mengubah durasinya', () => {
    expect(Presence.from('composing', 5).milliseconds()).toBe(5000);
  });

  test('label menggambarkan keadaannya dalam bahasa Indonesia', () => {
    expect(Presence.from('typing', 5).label()).toBe('sedang mengetik');
    expect(Presence.from('recording', 5).label()).toBe('sedang merekam suara');
    expect(Presence.from('paused').label()).toBe('berhenti mengetik');
  });

  test('isRecording dan isPaused menandai keadaannya', () => {
    expect(Presence.from('recording', 5).isRecording()).toBe(true);
    expect(Presence.from('recording', 5).isPaused()).toBe(false);
    expect(Presence.from('paused').isPaused()).toBe(true);
    expect(Presence.from('paused').isRecording()).toBe(false);
  });
});
