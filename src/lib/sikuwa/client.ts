import { Config, type ConfigOptions } from './config';
import type { MessageInput, OutgoingMessage, TypingRequest } from './contracts/whatsapp';
import {
  ApiException,
  ConfigurationException,
  UnknownProviderException,
  WhatsappException,
} from './exceptions';
import { HttpExecutor, type FetchLike } from './http/http-executor';
import { isArrayLike } from './internal/scalar';
import type { NumberCheck } from './number-check';
import type { AbstractProvider } from './providers/abstract-provider';
import { ApiMe } from './providers/apime/apime';
import { EvolutionAPI } from './providers/evolution-api/evolution-api';
import { Fonnte } from './providers/fonnte/fonnte';
import { OpenWA } from './providers/openwa/openwa';
import { Waxum } from './providers/waxum/waxum';
import { Wwebjs } from './providers/wwebjs/wwebjs';
import { Wuzapi } from './providers/wuzapi/wuzapi';
import type { Session } from './session';
import { Log } from './support/log';

/**
 * Opsi `Client`, yaitu opsi `Config` ditambah cara menyuntikkan transport.
 *
 * `httpClient` sengaja tidak masuk ke `ConfigOptions`: `Config` tidak pernah
 * membacanya, dan menaruhnya di sana berarti mengesankan ia ikut tersimpan
 * sebagai konfigurasi. Di PHP kunci itu memang ikut di dalam array opsi yang
 * sama, lalu diabaikan `Config::from()` — di sini pemisahannya dibuat eksplisit
 * supaya salah ketik tidak berubah menjadi kunci konfigurasi yang diam-diam.
 */
export interface ClientOptions extends ConfigOptions {
  /** Klien HTTP pengganti; sama dengan argumen kedua konstruktor. */
  httpClient?: FetchLike | null;
}

/** Bentuk konstruktor yang dipakai seluruh gateway. */
export type ProviderConstructor = new (
  options?: ConfigOptions | Config | null,
  http?: HttpExecutor | null,
) => AbstractProvider;

/**
 * Titik masuk SDK — pemegang konfigurasi, transport, dan pemilihan gateway.
 *
 * ```ts
 * import { Client } from 'sikuwa';
 *
 * const client = new Client({
 *   provider: 'OpenWA',
 *   token: 'owa_k1_…',
 *   url: 'http://localhost:2785',
 *   session: 'my-session',
 * });
 *
 * console.log(await client.send({
 *   destination: '081234567890',
 *   message: 'Halo dari SIKUWA',
 * }));
 * // Sukses, messageId: 3EB0...
 * ```
 *
 * Opsi yang tidak diisi akan dicari di environment (`WHATSAPP_*`), jadi cukup
 * `new Client()` tanpa argumen apa pun.
 *
 * Untuk pengujian, suntikkan klien HTTP pengganti:
 *
 * ```ts
 * const client = new Client({ provider: 'Fonnte' }, backend.client());
 * ```
 *
 * ## Perbedaan nama terhadap versi PHP
 *
 * PHP punya method `config()` dan `http()` di samping properti privat dengan
 * nama yang sama; JavaScript tidak bisa, sebab properti dan method berbagi satu
 * ruang nama. Di sini keduanya menjadi properti **readonly** — `client.config`
 * dan `client.http` — yang memberi akses baca yang sama tanpa nama baru yang
 * harus dihafalkan. Ini alasan yang sama yang membuat `AbstractProvider`
 * memakai `settings()` alih-alih `config()`.
 *
 * ## Sinkron menjadi asinkron
 *
 * Setiap method di sini mengembalikan `Promise`, termasuk `notify()` — PHP
 * mengembalikan `string` karena Guzzle menunggu di dalam pemanggilan.
 *
 * ## Bukan kelas tertutup
 *
 * PHP menandainya `final`. Di sini tidak: subkelas adalah cara paling jujur
 * menguji jalur yang hanya berjalan ketika sesuatu **di luar** SDK melempar —
 * penjagaan di {@link notify}, misalnya, yang hanya berguna kalau ada error
 * yang bukan `WhatsappException`.
 */
export class Client {
  /** Nilai `provider` yang berarti "undi di antara gateway yang punya token". */
  static readonly AUTO = 'auto';

  /**
   * Seluruh gateway yang dikenali, dalam urutan yang dipakai
   * {@link configured} dan {@link providerName}.
   *
   * Urutannya sengaja tetap: `configured()` mengembalikannya apa adanya, jadi
   * daftar itu bisa dibandingkan langsung di dalam pengujian dan di log.
   */
  static readonly PROVIDERS: Readonly<Record<string, ProviderConstructor>> = {
    Fonnte,
    OpenWA,
    ApiMe,
    EvolutionAPI,
    Wuzapi,
    Wwebjs,
    Waxum,
  };

  /** Konfigurasi yang dipakai seluruh gateway yang dibangun client ini. */
  readonly config: Config;

  /** Transport bersama — satu instance untuk semua gateway. */
  readonly http: HttpExecutor;

  constructor(options?: ClientOptions | Config | null, httpClient?: FetchLike | null) {
    this.config = Config.from(options ?? null);

    // Argumen eksplisit menang atas kunci di dalam opsi, sama seperti PHP.
    const injected = httpClient ?? httpClientOption(options);

    this.http = new HttpExecutor(injected, this.config.timeout(), this.config.headers());
  }

  /** Peta nama gateway ke kelasnya, sama seperti konstanta `PROVIDERS` PHP. */
  static providers(): Readonly<Record<string, ProviderConstructor>> {
    return Client.PROVIDERS;
  }

  /**
   * Nama gateway yang tokennya benar-benar tersedia.
   *
   * Hanya menghitung `WHATSAPP_TOKEN_<Provider>` / opsi `tokens`; token umum
   * `WHATSAPP_TOKEN` tidak dihitung, karena token itu tidak menunjukkan
   * gateway mana yang siap dipakai.
   */
  static configured(config?: ConfigOptions | Config | null): string[] {
    const resolved = Config.from(config ?? null);
    const names: string[] = [];

    for (const name of Object.keys(Client.PROVIDERS)) {
      if (resolved.providerToken(name) !== null) {
        names.push(name);
      }
    }

    return names;
  }

  /**
   * Nama gateway yang akan dipakai, tanpa membangun instance-nya.
   *
   * Bedanya dengan {@link provider} hanya pada hasilnya: yang ini mengembalikan
   * **nama**, bukan objeknya, sehingga aman dipanggil untuk sekadar mencatat ke
   * log.
   *
   * Perlu diingat bahwa `provider = auto` mengundi **setiap kali** dipanggil,
   * jadi nama yang dikembalikan method ini tidak selalu sama dengan gateway yang
   * dipakai `send()` berikutnya. Untuk mengunci pilihan, bangun gateway sekali
   * lalu simpan:
   *
   * ```ts
   * const gateway = client.provider();          // undian terjadi di sini
   * const nama    = gateway.getProvider();      // "OpenWA"
   * await gateway.sendMessage(pesan);           // pasti lewat OpenWA
   * ```
   *
   * @param name Nama gateway, atau `auto`. Default dari konfigurasi.
   */
  providerName(name?: string | null): string {
    const wanted = name ?? this.config.provider();

    if (wanted === null || wanted === undefined || wanted === '') {
      throw new ConfigurationException(
        'WHATSAPP_PROVIDER belum diisi, dan tidak ada nama provider yang diberikan',
      );
    }

    if (wanted.toLowerCase() === Client.AUTO) {
      return this.pickAuto();
    }

    // Lewat resolve() supaya nama yang tidak dikenal tetap ditolak dengan pesan
    // yang sama seperti provider() — bukan diteruskan apa adanya.
    Client.resolve(wanted);

    return Client.canonical(wanted);
  }

  /**
   * Bangun gateway yang akan dipakai.
   *
   * Memanggil method ini berulang kali menghasilkan instance baru; untuk
   * `provider = auto` itu berarti undiannya diulang setiap kali. Panggil sekali
   * lalu simpan hasilnya kalau beberapa pesan harus lewat gateway yang sama.
   *
   * @param name Nama gateway, atau `auto`. Default dari konfigurasi.
   */
  provider(name?: string | null): AbstractProvider {
    const wanted = name ?? this.config.provider();

    if (wanted === null || wanted === undefined || wanted === '') {
      throw new ConfigurationException(
        'WHATSAPP_PROVIDER belum diisi, dan tidak ada nama provider yang diberikan',
      );
    }

    const selected = wanted.toLowerCase() === Client.AUTO ? this.pickAuto() : wanted;

    const Constructor = Client.resolve(selected);

    return new Constructor(this.config, this.http);
  }

  /**
   * Kirim pesan dan lempar exception bila gagal.
   *
   * Jeda antar pesan pada pengiriman massal diatur lewat `WHATSAPP_PACING_*`
   * (siklus, jitter acak, dan pengali untuk pesan panjang); untuk menimpanya
   * pada satu panggilan saja, bungkus list-nya bersama kunci `pacing`:
   *
   * ```ts
   * await client.send({
   *   messages: [
   *     { destination: '0811111111', message: 'Pesan pertama' },
   *     { destination: '0822222222', message: 'Pesan kedua' },
   *   ],
   *   pacing: { cycle: '0,45', interval: '10-20' },
   * });
   * ```
   *
   * Indikator "sedang mengetik" yang dimunculkan sendiri sebelum mengirim
   * diatur lewat `WHATSAPP_TYPING`; kunci `typing` menimpanya untuk satu
   * panggilan — dan menulis kunci itu sudah cukup menyalakannya, tanpa perlu
   * `WHATSAPP_TYPING` di `.env`:
   *
   * ```ts
   * await client.send({
   *   destination: '081234567890',
   *   message: 'Laporan harian sudah siap',
   *   typing: { speed: 8, max: 30 },
   * });
   * ```
   *
   * Satu batch bisa juga dibagi ke beberapa gateway sekaligus lewat
   * `WHATSAPP_ROTATE` — hanya berguna bersama `provider = auto`, karena satu
   * gateway yang dipilih tetap tidak punya apa pun untuk dibagi:
   *
   * ```ts
   * // .env: WHATSAPP_PROVIDER=auto, WHATSAPP_ROTATE=1, tiga token terisi
   * await client.send({ messages: seratusPesan });
   * // Sukses, 100/100 pesan terkirim lewat 3 gateway (Fonnte 34, OpenWA 33, Wuzapi 33)
   * ```
   */
  async send(message: MessageInput): Promise<string> {
    // Rotasi hanya menyentuh bentuk daftar: satu pesan tidak punya apa pun
    // untuk dibagi, dan jalur lamanya sudah benar. Saklarnya diperiksa lebih
    // dulu supaya selama ia mati tidak ada satu pun pekerjaan tambahan di
    // jalur kirim.
    if (this.config.rotate().isEnabled() && typeof message !== 'string') {
      const batch = Client.batchOf(message);

      if (batch !== null && batch.length > 1) {
        return this.sendAcrossGateways(message, batch);
      }
    }

    return this.provider().sendMessage(message);
  }

  /**
   * Kirim pesan untuk dicatat ke log — tidak pernah melempar exception.
   *
   * Kegagalan dikembalikan sebagai string, dengan teks yang sama seperti kalau
   * exception-nya dibaca. Cocok untuk notifikasi yang tidak boleh menggagalkan
   * request pemanggil.
   *
   * Hanya `WhatsappException` yang ditangkap; kesalahan lain — mis. bug di kode
   * pemanggil — tetap dilempar, karena menyamarkannya sebagai teks justru
   * menyembunyikan masalah yang tidak ada hubungannya dengan pengiriman.
   */
  async notify(message: MessageInput): Promise<string> {
    try {
      return await this.send(message);
    } catch (error) {
      if (error instanceof WhatsappException) return error.message;

      throw error;
    }
  }

  /**
   * Kirim satu gambar.
   *
   * Bentuk pesannya seragam di semua gateway; daftar lengkap kuncinya ada di
   * {@link OutgoingMessage}:
   *
   * ```ts
   * await client.sendImage({
   *   destination: '081234567890',
   *   image: 'data:image/png;base64,iVBORw0KGgo…',
   *   caption: 'Bukti transfer',
   * });
   * ```
   *
   * Isi `image` boleh berupa data URI, base64 telanjang, atau URL publik —
   * kecuali di ApiMe dan wuzapi, yang menuntut isi berkasnya ikut dikirim.
   */
  async sendImage(message: OutgoingMessage): Promise<string> {
    return this.provider().sendImage(message);
  }

  /**
   * Kirim satu berkas/dokumen.
   *
   * Sama seperti {@link sendImage}, hanya kuncinya `file`. Isilah `filename`,
   * karena itulah yang menentukan nama dan jenis berkas yang dilihat penerima:
   *
   * ```ts
   * await client.sendFile({
   *   destination: '081234567890',
   *   file: base64Pdf,
   *   filename: 'invoice-1209.pdf',
   * });
   * ```
   */
  async sendFile(message: OutgoingMessage): Promise<string> {
    return this.provider().sendFile(message);
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik".
   *
   * `duration` wajib diisi saat menampilkan indikator — Fonnte dan Evolution
   * API memakainya untuk menentukan berapa lama indikator tampil. Di Evolution
   * API panggilan ini ikut menunggu selama durasi tersebut, karena servernya
   * yang menidurkan permintaan.
   *
   * ```ts
   * await client.sendTyping({ destination: '081234567890', duration: 5 });
   * await client.send({ destination: '081234567890', message: 'Halo' });
   * await client.sendTyping({ destination: '081234567890', state: 'paused' });
   * ```
   */
  async sendTyping(message: TypingRequest): Promise<string> {
    return this.provider().sendTyping(message);
  }

  /**
   * Periksa nomor mana yang terdaftar di WhatsApp.
   *
   * Berguna untuk menyaring daftar tujuan sebelum mengirim: WhatsApp tidak
   * memberi tahu apakah sebuah nomor bisa dihubungi sebelum pesannya benar-
   * benar dikirim, dan menembak nomor yang tidak pernah ada adalah pemicu
   * pemblokiran yang paling sering.
   *
   * ```ts
   * const hasil = await client.checkNumbers(['081234567890', '089876543210']);
   *
   * for (const nomor of hasil.registered()) {
   *   await client.send({ destination: nomor, message: 'Halo' });
   * }
   * ```
   *
   * Seperti {@link provider}, gateway dipilih ulang pada tiap pemanggilan —
   * untuk `provider = auto` itu berarti undiannya diulang. Simpan instance
   * gateway kalau pemeriksaan dan pengiriman harus mengenai gateway yang sama.
   *
   * @param numbers Satu nomor, atau daftar nomor.
   */
  async checkNumbers(numbers: string | string[]): Promise<NumberCheck> {
    return this.provider().checkNumbers(numbers);
  }

  /**
   * Apakah notifikasi diaktifkan (`WA_NOTIFICATION`).
   *
   * SDK tidak menegakkannya sendiri — ini hanya pembacaan environment yang
   * disediakan supaya pemanggil tidak perlu mengurainya sendiri:
   *
   * ```ts
   * if (!client.enabled()) return;
   * ```
   */
  enabled(): boolean {
    return Config.notificationEnabled();
  }

  /**
   * Buat sesi/instance baru di gateway yang sedang dipilih.
   *
   * Sama seperti {@link provider}, gateway dipilih ulang pada tiap pemanggilan
   * — untuk `provider = auto` itu berarti undiannya diulang. Simpan instance
   * gateway kalau pembuatan dan pemeriksaan sesi harus mengenai gateway yang
   * sama.
   *
   * @param options Kunci spesifik gateway, mis. `name`, `id`, `config`.
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    return this.provider().createSession(options);
  }

  /**
   * Baca keadaan sesi yang sudah ada.
   *
   * @param id Sesi yang diperiksa; default dari konfigurasi
   *           (`WHATSAPP_SESSION_<Provider>` / `WHATSAPP_INSTANCE_<Provider>`,
   *           lalu kunci bersamanya).
   */
  async checkSession(id?: string | null): Promise<Session> {
    return this.provider().checkSession(id);
  }

  /**
   * Ambil QR sesi yang sudah ada, untuk dipindai.
   *
   * Dipakai setelah {@link createSession} atau {@link checkSession}
   * menunjukkan sesi belum tersambung:
   *
   * ```ts
   * const qr = await client.showQr();
   *
   * if (qr.hasQr()) {
   *   console.log(`<img src="${qr.qrImage()}">`);   // atau qr.qrBase64()
   * }
   * ```
   *
   * Sesi yang sudah tersambung tidak punya QR, dan itu dilaporkan sebagai
   * `isConnected() === true` dengan `hasQr() === false` — bukan exception.
   *
   * @param id Sesi yang diminta QR-nya; default dari konfigurasi
   *           (`WHATSAPP_SESSION_<Provider>` / `WHATSAPP_INSTANCE_<Provider>`,
   *           lalu kunci bersamanya).
   */
  async showQr(id?: string | null): Promise<Session> {
    return this.provider().showQr(id);
  }

  /**
   * Daftar pesan bila panggilan ini berbentuk batch, atau null bila satu pesan.
   *
   * Bentuknya dikenali persis seperti `plan()` di tiap gateway: elemen pertama
   * yang berupa array pesan. Elemen yang bukan pesan — kunci pengaturan seperti
   * `pacing` yang ikut berdiri di daftar yang sama — tidak dihitung, supaya
   * jumlah pesannya tidak meleset satu.
   *
   * Daftar yang isinya tidak lengkap dikembalikan sependek yang bisa dikenali,
   * bukan ditolak di sini: yang berhak mengeluh soal pesan cacat adalah
   * gateway-nya, dengan pesan yang menyebut posisinya.
   */
  private static batchOf(message: MessageInput): OutgoingMessage[] | null {
    if (typeof message === 'string') return null;

    const record = message as Record<string, unknown>;
    const list: unknown = isArrayLike(record.messages) ? record.messages : message;
    const items: unknown[] = Array.isArray(list)
      ? list
      : isArrayLike(list)
        ? Object.values(list)
        : [];

    if (!isArrayLike(items[0])) return null;

    return items.filter(
      (item): item is OutgoingMessage =>
        isArrayLike(item) &&
        item['destination'] !== undefined &&
        item['message'] !== undefined,
    );
  }

  /**
   * Kunci pengaturan tingkat panggilan yang harus ikut ke tiap potongan.
   *
   * Pemanggil menulisnya di amplop, jadi ia berlaku untuk seluruh batch — dan
   * batch itu sekarang dipecah. Tanpa dipindahkan, pengaturan yang disebut
   * pemanggil akan hilang diam-diam di potongan kedua dan seterusnya, yang
   * justru bagian yang paling butuh dijeda.
   */
  private static envelopeSettings(message: MessageInput): Record<string, unknown> {
    const settings: Record<string, unknown> = {};

    if (typeof message === 'string') return settings;

    const record = message as Record<string, unknown>;

    for (const key of ['pacing', 'typing', 'throttle']) {
      if (record[key] !== undefined && record[key] !== null) {
        settings[key] = record[key];
      }
    }

    return settings;
  }

  /**
   * Kirim satu batch pesan teks lewat beberapa gateway sekaligus.
   *
   * Batch dibagi bergiliran setelah urutan gatewaynya diundi, lalu tiap potongan
   * dikirim oleh gateway-nya sendiri — jadi gateway yang punya endpoint batch
   * tetap mengirim potongannya dalam satu request.
   *
   * Tiga akibat yang perlu diketahui pemanggil, dan disebut apa adanya daripada
   * disembunyikan:
   *
   * - **Urutan pesan tidak lagi menaik.** Potongan pertama dikirim habis
   *   sebelum potongan kedua, jadi pesan ke-6 bisa tiba sebelum pesan ke-2.
   *   Untuk pengiriman ke banyak tujuan ini tidak terasa; untuk rangkaian yang
   *   urutannya berarti, jangan nyalakan rotasi.
   * - **Jeda dan pagar laju dihitung per gateway.** Tiap gateway menerima
   *   daftarnya sendiri, dan jedanya dihitung dari posisi di dalam daftar itu.
   *   "Dua puluh pesan per menit" berarti dua puluh per gateway, bukan dua
   *   puluh untuk seluruh batch.
   * - **Kegagalan satu gateway tidak membatalkan yang lain.** Potongan yang
   *   gagal dilaporkan bersama nama gatewaynya, dan exception-nya baru dilempar
   *   setelah semua potongan dicoba.
   */
  private async sendAcrossGateways(
    message: MessageInput,
    batch: OutgoingMessage[],
  ): Promise<string> {
    const dipilih = this.config.provider();

    if (dipilih === null || dipilih === undefined || dipilih === '') {
      throw new ConfigurationException(
        'WHATSAPP_PROVIDER belum diisi, dan tidak ada nama provider yang diberikan',
      );
    }

    if (dipilih.toLowerCase() !== Client.AUTO) {
      throw new ConfigurationException(
        `WHATSAPP_ROTATE menyala, tetapi WHATSAPP_PROVIDER berisi '${dipilih}' — ` +
          'satu gateway yang dipilih tetap tidak punya apa pun untuk dibagi. ' +
          'Isi WHATSAPP_PROVIDER=auto, atau matikan WHATSAPP_ROTATE.',
      );
    }

    const kandidat = Client.configured(this.config);

    if (kandidat.length < 2) {
      // Bukan kegagalan: mode auto tetap jalan dengan satu gateway, dan rotasi
      // cuma tidak punya pilihan. Yang tidak boleh terjadi adalah pemanggil
      // mengira batchnya sudah dibagi padahal tidak.
      Log.write(
        this.config.logger(),
        'warning',
        'WHATSAPP_ROTATE menyala, tetapi hanya satu gateway yang punya token — ' +
          'seluruh batch dikirim lewat gateway itu saja',
        { provider: kandidat[0] ?? null },
      );

      return this.provider().sendMessage(message);
    }

    const potongan = this.config.rotate().assign(batch.length, kandidat);
    const pengaturan = Client.envelopeSettings(message);
    const total = batch.length;
    let terkirim = 0;
    const dipakai: string[] = [];
    const gagal: string[] = [];
    let terakhir: WhatsappException | null = null;

    for (const [nama, posisi] of Object.entries(potongan)) {
      const isi = posisi.map((i) => batch[i]);

      try {
        await this.provider(nama).sendMessage({
          ...pengaturan,
          messages: isi,
        } as unknown as MessageInput);

        terkirim += isi.length;
        dipakai.push(`${nama} ${isi.length}`);
      } catch (error) {
        if (!(error instanceof WhatsappException)) throw error;

        terakhir = error;
        gagal.push(`${nama}: ${error.message}`);
      }
    }

    if (gagal.length > 0) {
      // Angka di depan adalah yang **dipastikan** terkirim: potongan yang gagal
      // sebagian tidak menambah hitungannya, jadi laporannya meremehkan, bukan
      // membesar-besarkan. Rincian tiap gateway ada di pesan kegagalannya
      // sendiri.
      const lewat = dipakai.length === 0 ? '' : ` lewat ${dipakai.length} gateway`;

      throw new ApiException(
        `${terkirim}/${total} pesan terkirim${lewat}. Gagal: ${gagal.join(' | ')}`,
        terakhir instanceof ApiException ? terakhir.getStatus() : 0,
        null,
        null,
        terakhir,
      );
    }

    return (
      `Sukses, ${terkirim}/${total} pesan terkirim lewat ${dipakai.length} gateway ` +
      `(${dipakai.join(', ')})`
    );
  }

  /**
   * Ejaan resmi sebuah nama gateway, apa pun huruf besar-kecilnya.
   *
   * Dipakai supaya {@link providerName} mengembalikan `OpenWA`, bukan `openwa`
   * yang kebetulan diketik pemanggil — nama itu biasanya langsung dicatat ke
   * log atau ditampilkan, jadi ejaannya harus seragam.
   */
  private static canonical(name: string): string {
    const lowered = name.toLowerCase();

    for (const candidate of Object.keys(Client.PROVIDERS)) {
      if (candidate.toLowerCase() === lowered) return candidate;
    }

    // Tidak mungkin tercapai: resolve() sudah menolak nama asing sebelumnya.
    return name;
  }

  private static resolve(name: string): ProviderConstructor {
    const lowered = name.toLowerCase();

    for (const [candidate, Constructor] of Object.entries(Client.PROVIDERS)) {
      if (candidate.toLowerCase() === lowered) return Constructor;
    }

    throw UnknownProviderException.forName(name, Object.keys(Client.PROVIDERS));
  }

  /**
   * Pilih gateway acak di antara yang tokennya terisi.
   *
   * Pengundian tanpa penyaringan akan bisa jatuh ke gateway yang tidak
   * dikonfigurasi, dan notifikasinya gagal terkirim tanpa sebab yang jelas.
   */
  private pickAuto(): string {
    const candidates = Client.configured(this.config);

    if (candidates.length === 0) {
      throw new ConfigurationException(
        "WHATSAPP_PROVIDER 'auto' tidak punya kandidat: " +
          'tidak ada WHATSAPP_TOKEN_<Provider> yang diisi di .env',
      );
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}

/**
 * Klien HTTP dari kunci opsi `httpClient`, bila ada.
 *
 * Hanya kunci itu yang dibaca di sini: `Config` tidak mengenalnya, jadi ia
 * harus diambil sebelum array opsinya diteruskan ke sana.
 */
function httpClientOption(options?: ClientOptions | Config | null): FetchLike | null {
  if (options === null || options === undefined) return null;
  if (options instanceof Config) return null;

  return options.httpClient ?? null;
}
