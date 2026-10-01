import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ConfigOptions } from '../../../src/lib/sikuwa/config';
import { Config } from '../../../src/lib/sikuwa/config';
import type { MessageInput } from '../../../src/lib/sikuwa/contracts/whatsapp';
import {
  ApiException,
  ConfigurationException,
  RateLimitException,
  TimeoutException,
  WhatsappException,
} from '../../../src/lib/sikuwa/exceptions';
import {
  AbstractProvider,
  type PlannedMessage,
} from '../../../src/lib/sikuwa/providers/abstract-provider';
import type { Session } from '../../../src/lib/sikuwa/session';
import { Presence } from '../../../src/lib/sikuwa/support/presence';

/**
 * Porting dari bagian `AbstractProvider` di `PacingTest.php`, `RetryTest.php`,
 * `AutoTypingTest.php`, dan `TypingTest.php`.
 *
 * Kelas ini yang memegang aturan yang berlaku untuk **semua** gateway, jadi
 * salah satu di sini berarti salah di tujuh provider sekaligus. Tiga hal yang
 * paling mudah rusak tanpa terlihat:
 *
 * - `null` dan `0` pada jeda berarti dua hal yang berbeda — "terserah gateway"
 *   lawan "jangan tunggu";
 * - pacing dan pembatas laju digabung dengan nilai **terbesar**, bukan
 *   dijumlahkan;
 * - kegagalan menampilkan indikator ketik tidak boleh menggagalkan pesannya.
 *
 * Tidak ada detik sungguhan yang ditunggu: penidur pengganti mencatat berapa
 * detik yang diminta, sehingga urutannya bisa diperiksa persis.
 */

/**
 * Provider tiruan yang mengirim satu pesan per request, seperti ApiMe,
 * Evolution API, wuzapi, dan Wwebjs.
 *
 * Anggota `protected` dibuka lewat pembungkus tipis supaya bisa diperiksa
 * langsung — bukan karena desainnya salah, tapi karena di sinilah satu-satunya
 * tempat aturan bersama itu bisa diuji tanpa ikut menguji sebuah gateway.
 */
class FakeProvider extends AbstractProvider {
  /** Indikator ketik yang benar-benar diminta, berurutan. */
  readonly presence: Array<{ destination: string; state: string; duration: number }> = [];

  /** Pesan yang benar-benar terkirim, berurutan. */
  readonly delivered: string[] = [];

  /** Pesan yang harus gagal dikirim, untuk menguji pengumpulan kegagalan. */
  readonly failFor = new Set<string>();

  /** Bila diisi, `sendPresence()` selalu gagal — untuk membuktikan senyapnya. */
  presenceError: WhatsappException | null = null;

  getProvider(): string {
    return 'Fake';
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: this.getToken() };
  }

  async createSession(): Promise<Session> {
    throw new Error('tidak dipakai di test ini');
  }

  async checkSession(): Promise<Session> {
    throw new Error('tidak dipakai di test ini');
  }

  async showQr(): Promise<Session> {
    throw new Error('tidak dipakai di test ini');
  }

  protected async sendMedia(): Promise<string> {
    return 'Sukses';
  }

  protected async sendPresence(destination: string, presence: Presence): Promise<string> {
    if (this.presenceError !== null) throw this.presenceError;

    this.presence.push({
      destination,
      state: presence.state,
      duration: presence.duration,
    });

    return this.presenceResult(presence, destination);
  }

  async sendMessage(message: MessageInput): Promise<string> {
    return this.sendIndividually(
      message,
      (items) => this.buildItems(items, (item) => item.message, (text) => text),
      async (text) => {
        if (this.failFor.has(text)) {
          throw new ApiException(`gagal mengirim '${text}'`, 500);
        }

        this.delivered.push(text);
        return 'Sukses';
      },
      (text) => `'${text}'`,
    );
  }

  // -- Pembuka untuk anggota protected ---------------------------------

  planOf(message: MessageInput): PlannedMessage[] {
    return this.plan(message);
  }

  retryOf<T>(attempt: () => Promise<T>): Promise<T> {
    return this.withRetry(attempt);
  }
}

/** Jalankan `run`, dan kembalikan exception yang dilempar. */
async function capture(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error('Seharusnya melempar exception, tapi berhasil');
}

/** Penidur pengganti yang mencatat setiap permintaan tidur. */
function recordSleeps(): number[] {
  const slept: number[] = [];

  AbstractProvider.useSleeper((seconds) => {
    slept.push(seconds);
  });

  return slept;
}

/** Pacing deterministik: siklus tetap, tanpa kejutan acak. */
function pacing(cycle: string, longChars = 300, longFactor = 3): ConfigOptions['pacing'] {
  return { cycle, interval: '0-0', long_chars: longChars, long_factor: longFactor };
}

function typing(speed = 15, min = 2, max = 20): ConfigOptions['typing'] {
  return { enabled: true, speed, min, max };
}

beforeEach(() => {
  // Resolver kosong, bukan `null`: `null` berarti "baca process.env", dan
  // mesin yang kebetulan punya WHATSAPP_PACING_CYCLE akan membuat test ini
  // gagal tanpa sebab yang jelas.
  Config.useResolver(() => null);
  AbstractProvider.useSleeper(null);
});

afterEach(() => {
  Config.useResolver(null);
  AbstractProvider.useSleeper(null);
});

describe('AbstractProvider.plan — jeda', () => {
  test('pacing mati: delay null, bukan nol', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(provider.planOf({ destination: '0811', message: 'halo' })).toEqual([
      { destination: '0811', message: 'halo', delay: null, typing: null },
    ]);
  });

  test('delay dari pemanggil menang atas pacing', () => {
    const provider = new FakeProvider({ token: 'tok', pacing: pacing('10,20') });

    const items = provider.planOf([
      { destination: '0811', message: 'a', delay: 0 },
      { destination: '0822', message: 'b' },
    ]);

    // Angka yang disebut pemanggil selalu dihormati apa adanya — termasuk nol,
    // yang berarti "jangan tunggu", bukan "terserah gateway".
    expect(items.map((item) => item.delay)).toEqual([0, 20]);
  });

  test('delay diterima sebagai teks dan tidak boleh negatif', () => {
    const provider = new FakeProvider({ token: 'tok' });

    const [fromText] = provider.planOf({ destination: '0811', message: 'a', delay: '5' });
    expect(fromText?.delay).toBe(5);

    const [negative] = provider.planOf({ destination: '0811', message: 'a', delay: -3 });
    expect(negative?.delay).toBe(0);
  });

  test('delay null berarti jatuh ke pacing', () => {
    const provider = new FakeProvider({ token: 'tok', pacing: pacing('10') });

    const [item] = provider.planOf({ destination: '0811', message: 'a', delay: null });

    expect(item?.delay).toBe(10);
  });

  test('pacing berputar mengikuti posisi di daftar, bukan kunci asli', () => {
    const provider = new FakeProvider({ token: 'tok', pacing: pacing('10,20,30') });

    const items = provider.planOf([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b' },
      { destination: '0833', message: 'c' },
      { destination: '0844', message: 'd' },
    ]);

    expect(items.map((item) => item.delay)).toEqual([10, 20, 30, 10]);
  });

  test('pesan panjang ditunggu lebih lama', () => {
    const provider = new FakeProvider({ token: 'tok', pacing: pacing('10', 300, 3) });

    const items = provider.planOf([
      { destination: '0811', message: 'pendek' },
      { destination: '0822', message: 'x'.repeat(300) },
    ]);

    expect(items.map((item) => item.delay)).toEqual([10, 30]);
  });

  test('jeda mengikuti panjang pesan dalam karakter, bukan byte', () => {
    const provider = new FakeProvider({ token: 'tok', pacing: pacing('10', 300, 3) });

    // 300 karakter, tapi 900 byte kalau dihitung sebagai UTF-8. Pesan ini
    // justru harus dianggap panjang, sama seperti di PHP.
    const [item] = provider.planOf({ destination: '0811', message: 'é'.repeat(300) });

    expect(item?.delay).toBe(30);
  });

  /**
   * Keduanya sama-sama menahan pemanggil. Menjumlahkannya berarti menunggu
   * dua kali lebih lama daripada yang diminta pemanggil.
   */
  test('pacing dan pembatas laju digabung dengan nilai terbesar, bukan dijumlahkan', () => {
    const provider = new FakeProvider({
      token: 'tok',
      pacing: pacing('30'),
      throttle: { max: 2, window: 60 },
    });

    const items = provider.planOf([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b' },
      { destination: '0833', message: 'c' },
    ]);

    // Pesan pertama dan kedua masih jatah jendela (0 detik), jadi pacinya
    // yang menang; pesan ketiga menunggu satu jendela penuh.
    expect(items.map((item) => item.delay)).toEqual([30, 30, 60]);
  });
});

describe('AbstractProvider.plan — bentuk pesan', () => {
  test('amplop messages menerima pengaturan untuk seluruh panggilan', () => {
    const provider = new FakeProvider({ token: 'tok' });

    const items = provider.planOf({
      messages: [
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
      ],
      pacing: pacing('10,20'),
    });

    expect(items.map((item) => item.delay)).toEqual([10, 20]);
  });

  test('pesan berupa string ditolak', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(() => provider.planOf('halo')).toThrow(
      'Format pesan tidak valid: Fake membutuhkan array pesan',
    );
  });

  test('item tanpa destination atau message ditolak dengan nomor urutnya', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(() =>
      provider.planOf([
        { destination: '0811', message: 'a' },
        { destination: '0822' },
      ]),
    ).toThrow("Pesan ke-1 harus berupa array dengan kunci 'destination' dan 'message'");
  });

  test('kunci pengaturan yang bukan array ditolak dengan contoh penulisannya', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(() =>
      provider.planOf({
        destination: '0811',
        message: 'a',
        pacing: '10,20',
      } as unknown as MessageInput),
    ).toThrow("kunci 'pacing' harus berupa array");
  });

  test('kunci pengaturan null dianggap tidak disebut', () => {
    const provider = new FakeProvider({ token: 'tok', pacing: pacing('10') });

    const [item] = provider.planOf({
      destination: '0811',
      message: 'a',
      pacing: null,
    });

    expect(item?.delay).toBe(10);
  });

  /**
   * PHP menyalin array begitu ia diberikan ke sebuah fungsi; JavaScript tidak.
   * Tanpa salinan, `delete` yang membuang kunci pengaturan akan mencabutnya
   * dari objek milik pemanggil — dan pemanggil yang memakai ulang pesannya
   * kehilangan pengaturannya tanpa jejak.
   */
  test('objek pesan milik pemanggil tidak diubah', () => {
    const provider = new FakeProvider({ token: 'tok' });
    const message = { destination: '0811', message: 'a', pacing: pacing('10') };

    provider.planOf(message);

    expect(message.pacing).toEqual(pacing('10'));
  });

  test('daftar pesan milik pemanggil tidak diubah', () => {
    const provider = new FakeProvider({ token: 'tok' });
    const list = [{ destination: '0811', message: 'a' }];

    provider.planOf(list);

    expect(list).toEqual([{ destination: '0811', message: 'a' }]);
  });
});

describe('AbstractProvider.plan — indikator ketik', () => {
  test('lama indikator mengikuti panjang pesan', () => {
    const provider = new FakeProvider({ token: 'tok', typing: typing() });

    const items = provider.planOf([
      { destination: '0811', message: 'Halo' },
      { destination: '0822', message: 'x'.repeat(300) },
    ]);

    // Empat karakter: ceil(4/15) = 1, dijepit ke batas bawah dua detik.
    // Tiga ratus karakter: ceil(300/15) = 20, tepat di batas atas.
    expect(items.map((item) => item.typing)).toEqual([2, 20]);
  });

  test('satu item boleh mematikan indikatornya sendiri', () => {
    const provider = new FakeProvider({ token: 'tok', typing: typing() });

    const items = provider.planOf([
      { destination: '0811', message: 'Halo', typing: { enabled: false } },
      { destination: '0822', message: 'Halo' },
    ]);

    expect(items.map((item) => item.typing)).toEqual([null, 2]);
  });

  test('fitur yang mati tidak menghasilkan indikator sama sekali', () => {
    const provider = new FakeProvider({ token: 'tok' });

    const [item] = provider.planOf({ destination: '0811', message: 'Halo' });

    expect(item?.typing).toBeNull();
  });
});

describe('AbstractProvider.repeatedTargets', () => {
  test('menemukan tujuan yang muncul lebih dari sekali', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(
      provider.repeatedTargets([
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
        { destination: '0811', message: 'c' },
      ]),
    ).toEqual(['0811']);
  });

  test('bentuk satu pesan tidak punya arti berulang', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(provider.repeatedTargets({ destination: '0811', message: 'a' })).toEqual([]);
    expect(provider.repeatedTargets('halo')).toEqual([]);
  });

  test('amplop messages ikut diperiksa', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(
      provider.repeatedTargets({
        messages: [
          { destination: '0811', message: 'a' },
          { destination: '0811', message: 'b' },
        ],
      }),
    ).toEqual(['0811']);
  });

  test('tujuan kosong dan item yang tidak lengkap dilewati', () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(
      provider.repeatedTargets([
        { destination: '   ', message: 'a' },
        { destination: '   ', message: 'b' },
        { message: 'c' },
      ] as MessageInput),
    ).toEqual([]);
  });
});

describe('AbstractProvider.withRetry', () => {
  test('bawaannya mati: percobaan pertama langsung dilempar', async () => {
    const provider = new FakeProvider({ token: 'tok' });
    let calls = 0;

    const error = await capture(() =>
      provider.retryOf(async () => {
        calls++;
        throw new RateLimitException('sibuk', 429, null, null, null, 5);
      }),
    );

    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(RateLimitException);
  });

  test('429 dengan Retry-After diulang, menunggu sesuai angka gateway', async () => {
    const slept = recordSleeps();
    const provider = new FakeProvider({ token: 'tok', retries: 2 });
    let calls = 0;

    const result = await provider.retryOf(async () => {
      calls++;
      if (calls === 1) throw new RateLimitException('sibuk', 429, null, null, null, 7);
      return 'berhasil';
    });

    expect(result).toBe('berhasil');
    expect(calls).toBe(2);
    expect(slept).toEqual([7]);
  });

  test('503 juga diulang', async () => {
    const slept = recordSleeps();
    const provider = new FakeProvider({ token: 'tok', retries: 1 });
    let calls = 0;

    await provider.retryOf(async () => {
      calls++;
      if (calls === 1) {
        throw new ApiException('sesi belum siap', 503, null, null, null, 4);
      }
      return 'berhasil';
    });

    expect(slept).toEqual([4]);
  });

  test('tanpa Retry-After tidak diulang', async () => {
    const provider = new FakeProvider({ token: 'tok', retries: 3 });
    let calls = 0;

    await capture(() =>
      provider.retryOf(async () => {
        calls++;
        throw new RateLimitException('sibuk', 429);
      }),
    );

    // Menebak jedanya sendiri hanya akan menabrak dinding yang sama lagi.
    expect(calls).toBe(1);
  });

  test('status selain 429 dan 503 tidak pernah diulang', async () => {
    const provider = new FakeProvider({ token: 'tok', retries: 5 });
    let calls = 0;

    const error = await capture(() =>
      provider.retryOf(async () => {
        calls++;
        // 401 tidak akan sembuh kalau diulang, walau Retry-After-nya ada.
        throw new ApiException('token ditolak', 401, null, null, null, 10);
      }),
    );

    expect(calls).toBe(1);
    expect((error as ApiException).getStatus()).toBe(401);
  });

  test('jatah habis: exception terakhir dilempar apa adanya', async () => {
    const slept = recordSleeps();
    const provider = new FakeProvider({ token: 'tok', retries: 1 });
    let calls = 0;

    const error = await capture(() =>
      provider.retryOf(async () => {
        calls++;
        throw new RateLimitException('sibuk', 429, null, null, null, 3);
      }),
    );

    expect(calls).toBe(2);
    expect(slept).toEqual([3]);
    // Pemanggil tetap bisa mengatur ulang jadwalnya sendiri.
    expect((error as ApiException).getRetryAfter()).toBe(3);
  });

  test('exception selain ApiException tidak pernah diulang', async () => {
    const provider = new FakeProvider({ token: 'tok', retries: 5 });
    let calls = 0;

    const error = await capture(() =>
      provider.retryOf(async () => {
        calls++;
        throw new TimeoutException(10, 'habis waktu');
      }),
    );

    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(TimeoutException);
  });
});

describe('AbstractProvider — jalur kirim berurutan', () => {
  test('jeda dihormati antar pesan, tapi tidak sebelum pesan pertama', async () => {
    const slept = recordSleeps();
    const provider = new FakeProvider({ token: 'tok', pacing: pacing('5,7') });

    const result = await provider.sendMessage([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b' },
      { destination: '0833', message: 'c' },
    ]);

    // Jeda sebelum pengiriman pertama adalah urusan pemanggil, bukan SDK.
    expect(slept).toEqual([7, 5]);
    expect(provider.delivered).toEqual(['a', 'b', 'c']);
    expect(result).toBe('Sukses, 3/3 pesan terkirim');
  });

  test('satu pesan dikirim langsung, tanpa jalur berurutan', async () => {
    const provider = new FakeProvider({ token: 'tok' });

    expect(await provider.sendMessage({ destination: '0811', message: 'a' })).toBe('Sukses');
    expect(provider.delivered).toEqual(['a']);
  });

  test('kegagalan satu pesan tidak menghentikan sisanya', async () => {
    const provider = new FakeProvider({ token: 'tok' });
    provider.failFor.add('b');

    const error = await capture(() =>
      provider.sendMessage([
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
        { destination: '0833', message: 'c' },
      ]),
    );

    // Pemanggil menerima gambaran lengkapnya, bukan cuma kegagalan pertama.
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toBe(
      "2/3 pesan terkirim. Gagal: 'b': gagal mengirim 'b'",
    );
    expect(provider.delivered).toEqual(['a', 'c']);
  });

  test('indikator dimunculkan tepat sebelum tiap pesan, termasuk yang pertama', async () => {
    const slept = recordSleeps();
    const provider = new FakeProvider({
      token: 'tok',
      pacing: pacing('5'),
      typing: typing(),
    });

    await provider.sendMessage([
      { destination: '0811', message: 'Halo' },
      { destination: '0822', message: 'Halo' },
    ]);

    expect(provider.presence).toEqual([
      { destination: '0811', state: 'composing', duration: 2 },
      { destination: '0822', state: 'composing', duration: 2 },
    ]);

    // Pesan pertama tidak punya jeda pacing — ia dikirim lebih dulu, baru
    // indikatornya dihabiskan (2 detik). Pesan kedua menunggu pacing 5 detik
    // dulu, baru indikatornya (2 detik) — indikator menyusul jeda, bukan
    // mendahuluinya, supaya penerima melihat "sedang mengetik" lalu pesannya.
    expect(slept).toEqual([2, 5, 2]);
  });

  test('fitur mati: tidak ada request indikator sama sekali', async () => {
    const provider = new FakeProvider({ token: 'tok' });

    await provider.sendMessage({ destination: '0811', message: 'Halo' });

    expect(provider.presence).toEqual([]);
  });

  /**
   * Mengirim pesan jauh lebih penting daripada hiasannya: gateway yang tidak
   * mengenal presence tidak boleh membuat pemanggil kehilangan pesannya.
   */
  test('kegagalan menampilkan indikator tidak menggagalkan pengiriman', async () => {
    const slept = recordSleeps();
    const provider = new FakeProvider({ token: 'tok', typing: typing() });
    provider.presenceError = new ConfigurationException('gateway tidak kenal presence');

    const result = await provider.sendMessage({ destination: '0811', message: 'Halo' });

    expect(result).toBe('Sukses');
    expect(provider.delivered).toEqual(['Halo']);
    // Kegagalan itu juga tidak menambah jeda apa pun.
    expect(slept).toEqual([]);
  });
});
