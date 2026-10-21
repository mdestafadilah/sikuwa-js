import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '../../src/lib/sikuwa/client';
import { Config, type ConfigOptions } from '../../src/lib/sikuwa/config';
import { ConfigurationException } from '../../src/lib/sikuwa/exceptions';
import { NumberCheck } from '../../src/lib/sikuwa/number-check';
import { ApiMe } from '../../src/lib/sikuwa/providers/apime/apime';
import { EvolutionAPI } from '../../src/lib/sikuwa/providers/evolution-api/evolution-api';
import { Fonnte } from '../../src/lib/sikuwa/providers/fonnte/fonnte';
import { OpenWA } from '../../src/lib/sikuwa/providers/openwa/openwa';
import { Waxum } from '../../src/lib/sikuwa/providers/waxum/waxum';
import { Wwebjs } from '../../src/lib/sikuwa/providers/wwebjs/wwebjs';
import { Wuzapi } from '../../src/lib/sikuwa/providers/wuzapi/wuzapi';
import { MockBackend } from './mock-backend';

/**
 * Porting dari `tests/CheckNumberTest.php`.
 *
 * Yang diperiksa bukan cuma jawabannya, tapi juga request yang benar-benar
 * dikirim — method, URL, header, dan body — karena itulah bagian yang paling
 * mudah rusak diam-diam saat provider dirapikan. Perbedaan yang paling
 * menentukan di sini adalah berapa nomor yang bisa diperiksa sekali panggil:
 * empat gateway menerima daftar, tiga sisanya satu nomor per request.
 */

const BASE = 'https://gw.test';

beforeEach(() => {
  Config.useResolver(() => null);
});

afterEach(() => {
  Config.useResolver(null);
});

function openWa(backend: MockBackend, options: ConfigOptions = {}): OpenWA {
  return new OpenWA(
    { token: 'k', url: BASE, session: 'sess-1', ...options },
    backend.executor(),
  );
}

describe('checkNumbers — Fonnte', () => {
  test('memeriksa seluruh daftar dalam satu panggilan', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        status: true,
        registered: ['6281234567890'],
        not_registered: ['6289876543210'],
      }),
    ]);

    const hasil = await new Fonnte({ token: 'device-tok' }, backend.executor()).checkNumbers([
      '081234567890',
      '089876543210',
    ]);

    expect(backend.methodAt(0)).toBe('POST');
    expect(backend.lastUrl()).toBe('https://api.fonnte.com/validate');
    // /validate memakai token perangkat, sama seperti /qr dan /typing.
    expect(backend.lastHeader('Authorization')).toBe('device-tok');

    // Nomornya dinormalkan lebih dulu, jadi yang terkirim sudah berbentuk
    // internasional tanpa tanda plus.
    expect(backend.lastForm()['target']).toBe('6281234567890,6289876543210');

    expect(hasil.provider).toBe('Fonnte');
    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.isRegistered('089876543210')).toBe(false);
    expect(hasil.registered()).toEqual(['6281234567890']);
    expect(hasil.unregistered()).toEqual(['6289876543210']);
  });

  /** Fonnte menolak lebih dari 500 nomor sekaligus — seluruh panggilannya. */
  test('memecah daftar yang melewati batasnya', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: true, registered: [], not_registered: [] }),
      MockBackend.json({ status: true, registered: [], not_registered: [] }),
    ]);

    const numbers: string[] = [];

    for (let i = 1; i <= 501; i++) {
      numbers.push(`0812${String(i).padStart(7, '0')}`);
    }

    await new Fonnte({ token: 't' }, backend.executor()).checkNumbers(numbers);

    expect(backend.count()).toBe(2);

    // Potongan pertama berisi tepat 500 nomor: 499 pemisah.
    const target = backend.formAt(0)['target'] ?? '';

    expect(target.split(',').length - 1).toBe(499);
  });

  test('amplop penolakan tetap dilempar', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: false, reason: 'device disconnected' }),
    ]);

    await expect(
      new Fonnte({ token: 't' }, backend.executor()).checkNumbers('081234567890'),
    ).rejects.toThrow('device disconnected');
  });
});

describe('checkNumbers — OpenWA', () => {
  test('memeriksa tiap nomor terpisah', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        number: '6281234567890',
        exists: true,
        whatsappId: '6281234567890@c.us',
      }),
      MockBackend.json({
        number: '6289876543210',
        exists: false,
        whatsappId: null,
      }),
    ]);

    const hasil = await openWa(backend).checkNumbers(['081234567890', '089876543210']);

    expect(backend.count()).toBe(2);
    expect(backend.methodAt(1)).toBe('GET');
    expect(backend.lastUrl()).toBe(`${BASE}/api/sessions/sess-1/contacts/check/6289876543210`);
    expect(backend.lastHeader('X-API-Key')).toBe('k');

    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.isRegistered('089876543210')).toBe(false);
    expect(hasil.whatsappId('081234567890')).toBe('6281234567890@c.us');
    // Gateway yang tidak menyebut id WhatsApp membiarkannya kosong.
    expect(hasil.whatsappId('089876543210')).toBe('');
  });

  test('menerima amplop yang dibungkus data', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        success: true,
        data: { number: '6281234567890', exists: true },
      }),
    ]);

    const hasil = await openWa(backend).checkNumbers('081234567890');

    expect(hasil.isRegistered('081234567890')).toBe(true);
  });

  test('tanpa id sesi ditolak sebelum request apa pun', async () => {
    const backend = new MockBackend([]);

    await expect(
      new OpenWA({ token: 'k', url: BASE }, backend.executor()).checkNumbers('081234567890'),
    ).rejects.toThrow('WHATSAPP_SESSION belum diisi di .env');
  });
});

describe('checkNumbers — ApiMe', () => {
  test('membaca entri bersarang di data.results', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        data: {
          results: [
            {
              Query: '+6281234567890',
              JID: '6281234567890@s.whatsapp.net',
              IsIn: true,
            },
          ],
        },
      }),
    ]);

    const hasil = await new ApiMe(
      { token: 'inst-token', url: BASE, instance: 'uuid-9' },
      backend.executor(),
    ).checkNumbers('081234567890');

    expect(backend.methodAt(0)).toBe('POST');
    expect(backend.lastUrl()).toBe(`${BASE}/api/instances/uuid-9/whatsapp/check`);
    expect(backend.lastHeader('Authorization')).toBe('Bearer inst-token');
    expect(backend.lastJson()).toEqual({ phone: '6281234567890' });

    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.whatsappId('081234567890')).toBe('6281234567890@s.whatsapp.net');
  });
});

describe('checkNumbers — Evolution API', () => {
  test('memeriksa seluruh daftar sekaligus', async () => {
    const backend = new MockBackend([
      MockBackend.json([
        {
          jid: '6281234567890@s.whatsapp.net',
          exists: true,
          number: '6281234567890',
        },
        {
          jid: '6289876543210@s.whatsapp.net',
          exists: false,
          number: '6289876543210',
        },
      ]),
    ]);

    const hasil = await new EvolutionAPI(
      { token: 't', url: BASE, instance: 'sikuwa' },
      backend.executor(),
    ).checkNumbers(['081234567890', '089876543210']);

    expect(backend.count()).toBe(1);
    expect(backend.lastUrl()).toBe(`${BASE}/chat/whatsappNumbers/sikuwa`);
    expect(backend.lastHeader('apikey')).toBe('t');
    expect(backend.jsonAt(0)).toEqual({
      numbers: ['6281234567890', '6289876543210'],
    });

    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.isRegistered('089876543210')).toBe(false);
    expect(hasil.whatsappId('081234567890')).toBe('6281234567890@s.whatsapp.net');
  });

  /** Entri tanpa kolom `number` tetap terbaca lewat JID-nya. */
  test('jatuh ke JID bila number tidak diisi', async () => {
    const backend = new MockBackend([
      MockBackend.json([{ jid: '6281234567890@s.whatsapp.net', exists: true }]),
    ]);

    const hasil = await new EvolutionAPI(
      { token: 't', url: BASE, instance: 'sikuwa' },
      backend.executor(),
    ).checkNumbers('081234567890');

    expect(hasil.isRegistered('081234567890')).toBe(true);
  });
});

describe('checkNumbers — wuzapi', () => {
  test('memeriksa seluruh daftar dan membaca data.Users', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        code: 200,
        success: true,
        data: {
          Users: [
            {
              IsInWhatsapp: true,
              JID: '6281234567890@s.whatsapp.net',
              Query: '6281234567890',
            },
            {
              IsInWhatsapp: false,
              JID: '6289876543210@s.whatsapp.net',
              Query: '6289876543210',
            },
          ],
        },
      }),
    ]);

    const hasil = await new Wuzapi(
      { token: 'user-token', url: BASE },
      backend.executor(),
    ).checkNumbers(['081234567890', '089876543210']);

    expect(backend.lastUrl()).toBe(`${BASE}/user/check`);
    expect(backend.lastHeader('Token')).toBe('user-token');
    expect(backend.lastJson()).toEqual({
      Phone: ['6281234567890', '6289876543210'],
    });

    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.isRegistered('089876543210')).toBe(false);
  });

  /** wuzapi membalas HTTP 200 walau menolak; amplopnya yang menentukan. */
  test('amplop gagal tetap ditolak', async () => {
    const backend = new MockBackend([
      MockBackend.json({ code: 401, success: false, error: 'Invalid token' }),
    ]);

    await expect(
      new Wuzapi({ token: 't', url: BASE }, backend.executor()).checkNumbers('081234567890'),
    ).rejects.toThrow('Invalid token');
  });
});

describe('checkNumbers — Wwebjs', () => {
  test('memeriksa tiap nomor terpisah', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, result: true }),
      MockBackend.json({ success: true, result: false }),
    ]);

    const hasil = await new Wwebjs(
      { token: 't', url: BASE, session: 'sess-a' },
      backend.executor(),
    ).checkNumbers(['081234567890', '089876543210']);

    expect(backend.count()).toBe(2);
    expect(backend.lastUrl()).toBe(`${BASE}/client/isRegisteredUser/sess-a`);
    expect(backend.lastHeader('x-api-key')).toBe('t');
    expect(backend.lastJson()).toEqual({ number: '6289876543210' });

    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.isRegistered('089876543210')).toBe(false);
  });
});

describe('checkNumbers — Waxum', () => {
  test('memeriksa seluruh daftar sekaligus', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        results: [
          {
            phone: '6281234567890',
            exists: true,
            jid: '6281234567890@s.whatsapp.net',
          },
          { phone: '6289876543210', exists: false, jid: null },
        ],
      }),
    ]);

    const hasil = await new Waxum(
      { token: 't', url: BASE, session: 'sess-1' },
      backend.executor(),
    ).checkNumbers(['081234567890', '089876543210']);

    expect(backend.count()).toBe(1);
    expect(backend.lastUrl()).toBe(`${BASE}/api/v1/sessions/sess-1/contacts/check`);
    expect(backend.lastHeader('Authorization')).toBe('Bearer t');
    expect(backend.lastJson()).toEqual({
      phones: ['6281234567890', '6289876543210'],
    });

    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.isRegistered('089876543210')).toBe(false);
    expect(hasil.whatsappId('081234567890')).toBe('6281234567890@s.whatsapp.net');
  });
});

describe('checkNumbers — aturan yang berlaku di semua gateway', () => {
  /** Memeriksa nomor yang sama dua kali hanya memakan traffic tambahan. */
  test('nomor duplikat diperiksa sekali', async () => {
    const backend = new MockBackend([
      MockBackend.json({ number: '6281234567890', exists: true }),
    ]);

    await openWa(backend).checkNumbers([
      '081234567890',
      '6281234567890',
      '+62 812-3456-7890',
    ]);

    expect(backend.count()).toBe(1);
  });

  test('masukan kosong ditolak sebelum request apa pun', async () => {
    const backend = new MockBackend([]);

    await expect(openWa(backend).checkNumbers([])).rejects.toBeInstanceOf(
      ConfigurationException,
    );
    await expect(openWa(backend).checkNumbers([])).rejects.toThrow('sertakan minimal satu nomor');
    expect(backend.count()).toBe(0);
  });

  test('nomor yang tidak terbaca ditolak sebelum request apa pun', async () => {
    const backend = new MockBackend([]);

    await expect(openWa(backend).checkNumbers('bukan nomor')).rejects.toBeInstanceOf(
      ConfigurationException,
    );
    expect(backend.count()).toBe(0);
  });

  test('Client meneruskan checkNumbers ke provider', async () => {
    const backend = new MockBackend([
      MockBackend.json({ number: '6281234567890', exists: true }),
    ]);

    const hasil = await new Client(
      {
        provider: 'OpenWA',
        token: 'k',
        url: BASE,
        session: 'sess-1',
      },
      backend.client(),
    ).checkNumbers('081234567890');

    expect(hasil.provider).toBe('OpenWA');
    expect(hasil.isRegistered('081234567890')).toBe(true);
  });
});

describe('NumberCheck — value object-nya sendiri', () => {
  test('isRegistered menormalkan bentuk apa pun yang dipakai pemanggil', () => {
    const hasil = new NumberCheck('OpenWA', { '6281234567890': true });

    expect(hasil.isRegistered('081234567890')).toBe(true);
    expect(hasil.isRegistered('+62 812-3456-7890')).toBe(true);
    expect(hasil.isRegistered('6281234567890')).toBe(true);
    // Nomor yang tidak diperiksa bukan berarti tidak terdaftar — ia memang
    // tidak punya jawaban, dan itu dijawab false.
    expect(hasil.isRegistered('081200000000')).toBe(false);
  });

  test('registered dan unregistered mengembalikan nomor sebagai string', () => {
    const hasil = new NumberCheck('OpenWA', {
      '6281234567890': true,
      '6289876543210': false,
    });

    expect(hasil.registered()).toEqual(['6281234567890']);
    expect(hasil.unregistered()).toEqual(['6289876543210']);
    expect(hasil.isEmpty()).toBe(false);
    expect(hasil.toString()).toBe('OpenWA: 1 terdaftar, 1 tidak terdaftar');
  });

  test('hasil kosong dilaporkan kosong', () => {
    const hasil = new NumberCheck('Wuzapi');

    expect(hasil.isEmpty()).toBe(true);
    expect(hasil.registered()).toEqual([]);
    expect(hasil.unregistered()).toEqual([]);
    expect(hasil.toJson()).toBe('{}');
  });

  /** `raw` dan `ids` tidak ikut ke `toArray()`: keduanya bisa besar. */
  test('serialisasi hanya menyimpan jawabannya', () => {
    const hasil = new NumberCheck(
      'Waxum',
      { '6281234567890': true },
      { '6281234567890': '6281234567890@s.whatsapp.net' },
      { results: [{ phone: '6281234567890', exists: true }] },
    );

    expect(hasil.toArray()).toEqual({ '6281234567890': true });
    expect(hasil.toJson()).toBe('{"6281234567890":true}');
  });
});
