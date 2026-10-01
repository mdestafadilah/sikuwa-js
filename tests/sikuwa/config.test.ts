import { afterEach, describe, expect, test } from 'bun:test';
import { Config } from '../../src/lib/sikuwa/config';

/**
 * Porting dari `tests/ConfigTest.php`.
 *
 * Yang dijaga di sini adalah urutan prioritas kunci: kunci per-provider selalu
 * menang atas kunci umum, nilai eksplisit menang atas environment, dan kunci
 * per-provider **tidak pernah** jatuh ke kunci umum — sebab kalau jatuh, satu
 * token untuk Fonnte akan membuat semua gateway dianggap siap di mode `auto`.
 */
function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

afterEach(() => {
  Config.useResolver(null);
});

describe('Config', () => {
  test('membaca setiap nilai dari environment', () => {
    fakeEnv({
      WHATSAPP_TOKEN: 'tok',
      WHATSAPP_URL: 'https://gw.test/',
      WHATSAPP_SESSION: 'sess-1',
      WHATSAPP_INSTANCE: 'inst-1',
      WHATSAPP_TIMEOUT: '25',
      WHATSAPP_PROVIDER: 'OpenWA',
    });

    const config = Config.fromEnvironment();

    expect(config.token()).toBe('tok');
    expect(config.url()).toBe('https://gw.test');
    expect(config.session()).toBe('sess-1');
    expect(config.instance()).toBe('inst-1');
    expect(config.timeout()).toBe(25.0);
    expect(config.provider()).toBe('OpenWA');
  });

  test('nilai environment kosong dianggap tidak ada', () => {
    fakeEnv({ WHATSAPP_TOKEN: '', WHATSAPP_URL: '' });

    const config = Config.fromEnvironment();

    expect(config.token()).toBe('');
    expect(config.url()).toBe('');
  });

  test('nilai eksplisit menang atas environment', () => {
    fakeEnv({ WHATSAPP_TOKEN: 'dari-env', WHATSAPP_URL: 'https://env.test' });

    const config = Config.from({ token: 'eksplisit', url: 'https://eksplisit.test' });

    expect(config.token()).toBe('eksplisit');
    expect(config.url()).toBe('https://eksplisit.test');
  });

  test('token per-provider menang atas token umum', () => {
    fakeEnv({ WHATSAPP_TOKEN: 'umum', WHATSAPP_TOKEN_OpenWA: 'khusus-openwa' });

    const config = Config.fromEnvironment();

    expect(config.token('OpenWA')).toBe('khusus-openwa');
    expect(config.token('Fonnte')).toBe('umum');
  });

  test('opsi tokens menang atas WHATSAPP_TOKEN_<Provider>', () => {
    fakeEnv({ WHATSAPP_TOKEN_Fonnte: 'dari-env' });

    const config = Config.from({ tokens: { Fonnte: 'dari-opsi' } });

    expect(config.token('Fonnte')).toBe('dari-opsi');
  });

  test('token per-provider tidak jatuh ke token umum', () => {
    fakeEnv({ WHATSAPP_TOKEN: 'umum' });

    expect(Config.fromEnvironment().providerToken('Fonnte')).toBeNull();
  });

  test('url jatuh ke bawaan provider', () => {
    fakeEnv({});

    expect(Config.fromEnvironment().url('https://default.test')).toBe('https://default.test');
  });

  test.each([
    ['tidak diisi', null, 10.0],
    ['nilai wajar', '25', 25.0],
    ['nol ditolak', '0', 10.0],
    ['negatif ditolak', '-5', 10.0],
    ['terlalu besar ditolak', '999', 10.0],
    ['bukan angka ditolak', 'abc', 10.0],
  ] as const)('timeout dijepit ke rentang wajar: %s', (_label, configured, expected) => {
    fakeEnv(configured === null ? {} : { WHATSAPP_TIMEOUT: configured });

    expect(Config.fromEnvironment().timeout()).toBe(expected);
  });

  test('explicitUrl mengabaikan environment', () => {
    fakeEnv({ WHATSAPP_URL: 'https://env.test' });

    // Config tanpa opsi `url` tidak menarik WHATSAPP_URL sama sekali...
    expect(Config.from({ token: 'tok' }).explicitUrl()).toBeNull();

    // ...sedangkan URL yang benar-benar diberikan tetap terbaca.
    expect(Config.from({ url: 'https://fonnte.test' }).explicitUrl()).toBe('https://fonnte.test');

    // Jalan lain (url()) tetap membaca environment seperti biasa.
    expect(Config.from({ token: 'tok' }).url()).toBe('https://env.test');
  });

  test('withUrl mengembalikan salinan', () => {
    const config = Config.from({ url: 'https://awal.test' });
    const copy = config.withUrl('https://baru.test');

    expect(copy).not.toBe(config);
    expect(config.url()).toBe('https://awal.test');
    expect(copy.url()).toBe('https://baru.test');
  });

  test('withUrl mengabaikan nilai kosong', () => {
    const config = Config.from({ url: 'https://awal.test' });

    expect(config.withUrl(null)).toBe(config);
    expect(config.withUrl('')).toBe(config);
  });

  test('URL per-provider menang atas URL bersama', () => {
    fakeEnv({
      WHATSAPP_URL: 'https://bersama.test',
      WHATSAPP_URL_OpenWA: 'https://openwa.test',
      WHATSAPP_URL_Wuzapi: 'https://wuzapi.test',
    });

    const config = Config.fromEnvironment();

    expect(config.url('', 'OpenWA')).toBe('https://openwa.test');
    expect(config.url('', 'Wuzapi')).toBe('https://wuzapi.test');

    // Provider yang tidak punya kunci sendiri tetap memakai yang bersama.
    expect(config.url('', 'Fonnte')).toBe('https://bersama.test');
  });

  test('URL per-provider tidak jatuh ke URL bersama', () => {
    fakeEnv({ WHATSAPP_URL: 'https://bersama.test' });

    expect(Config.fromEnvironment().providerUrl('Wuzapi')).toBeNull();
  });

  test('URL per-provider jatuh ke bawaan provider', () => {
    fakeEnv({});

    expect(Config.fromEnvironment().url('https://default.test', 'OpenWA')).toBe(
      'https://default.test',
    );
  });

  test('opsi urls menang atas WHATSAPP_URL_<Provider>', () => {
    fakeEnv({ WHATSAPP_URL_OpenWA: 'https://dari-env.test' });

    const config = Config.from({ urls: { OpenWA: 'https://dari-opsi.test' } });

    expect(config.url('', 'OpenWA')).toBe('https://dari-opsi.test');
  });

  test('url tanpa nama provider mengabaikan kunci per-provider', () => {
    fakeEnv({ WHATSAPP_URL: 'https://bersama.test', WHATSAPP_URL_OpenWA: 'https://openwa.test' });

    expect(Config.fromEnvironment().url()).toBe('https://bersama.test');
  });

  test('URL per-provider dibersihkan dari garis miring di ujung', () => {
    fakeEnv({ WHATSAPP_URL_OpenWA: 'https://openwa.test/' });

    expect(Config.fromEnvironment().url('', 'OpenWA')).toBe('https://openwa.test');
  });

  test('session per-provider menang atas opsi dan environment', () => {
    fakeEnv({ WHATSAPP_SESSION: 'bersama', WHATSAPP_SESSION_OpenWA: 'sesi-openwa' });

    const config = Config.fromEnvironment();

    expect(config.session('OpenWA')).toBe('sesi-openwa');
    // Provider yang tidak punya kunci sendiri tetap memakai yang bersama.
    expect(config.session('Wwebjs')).toBe('bersama');

    // Kunci per-provider juga menang atas opsi `session` eksplisit.
    expect(Config.from({ session: 'eksplisit' }).session('OpenWA')).toBe('sesi-openwa');
    expect(Config.from({ session: 'eksplisit' }).session('Wwebjs')).toBe('eksplisit');
  });

  test('session per-provider tidak jatuh ke session bersama', () => {
    fakeEnv({ WHATSAPP_SESSION: 'bersama' });

    expect(Config.fromEnvironment().providerSession('OpenWA')).toBeNull();
  });

  test('instance per-provider menang atas opsi dan environment', () => {
    fakeEnv({ WHATSAPP_INSTANCE: 'bersama', WHATSAPP_INSTANCE_EvolutionAPI: 'instance-evo' });

    const config = Config.fromEnvironment();

    expect(config.instance('EvolutionAPI')).toBe('instance-evo');
    expect(config.instance('ApiMe')).toBe('bersama');
  });

  test('instance per-provider tidak jatuh ke instance bersama', () => {
    fakeEnv({ WHATSAPP_INSTANCE: 'bersama' });

    expect(Config.fromEnvironment().providerInstance('ApiMe')).toBeNull();
  });

  test('session dan instance tanpa provider berperilaku seperti sebelumnya', () => {
    fakeEnv({
      WHATSAPP_SESSION: 'sesi-lama',
      WHATSAPP_INSTANCE: 'inst-lama',
      WHATSAPP_SESSION_OpenWA: 'diabaikan',
      WHATSAPP_INSTANCE_ApiMe: 'diabaikan',
    });

    const config = Config.fromEnvironment();

    expect(config.session()).toBe('sesi-lama');
    expect(config.instance()).toBe('inst-lama');
  });

  test('opsi session dan instance menang atas environment', () => {
    fakeEnv({ WHATSAPP_SESSION: 'dari-env', WHATSAPP_INSTANCE: 'dari-env' });

    const config = Config.from({ session: 'sesi-opsi', instance: 'inst-opsi' });

    expect(config.session()).toBe('sesi-opsi');
    expect(config.instance()).toBe('inst-opsi');
  });

  test('session dan instance kosong di environment dianggap tidak ada', () => {
    fakeEnv({ WHATSAPP_SESSION: '', WHATSAPP_INSTANCE: '' });

    const config = Config.fromEnvironment();

    expect(config.session()).toBe('');
    expect(config.instance()).toBe('');
    expect(config.session('OpenWA')).toBe('');
    expect(config.instance('ApiMe')).toBe('');
  });

  test('from menerima instance Config apa adanya', () => {
    const config = Config.from({ token: 'tok' });

    expect(Config.from(config)).toBe(config);
  });

  test.each([
    ['tidak diisi berarti aktif', null, true],
    ['true', 'true', true],
    ['false', 'false', false],
    ['satu', '1', true],
    ['nol', '0', false],
  ] as const)('saklar notifikasi dibaca: %s', (_label, value, expected) => {
    fakeEnv(value === null ? {} : { WA_NOTIFICATION: value });

    expect(Config.notificationEnabled()).toBe(expected);
  });

  test('headers mengembalikan salinan, bukan rujukan', () => {
    const config = Config.from({ headers: { 'X-Trace': 'abc' } });
    const headers = config.headers();

    headers['X-Trace'] = 'diubah';

    expect(config.headers()).toEqual({ 'X-Trace': 'abc' });
  });
});
