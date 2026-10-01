import { Config, type ConfigOptions } from './config';
import type { MessageInput, OutgoingMessage, TypingRequest } from './contracts/whatsapp';
import {
  ConfigurationException,
  UnknownProviderException,
  WhatsappException,
} from './exceptions';
import { HttpExecutor, type FetchLike } from './http/http-executor';
import type { AbstractProvider } from './providers/abstract-provider';
import { ApiMe } from './providers/apime/apime';
import { EvolutionAPI } from './providers/evolution-api/evolution-api';
import { Fonnte } from './providers/fonnte/fonnte';
import { OpenWA } from './providers/openwa/openwa';
import { Waxum } from './providers/waxum/waxum';
import { Wwebjs } from './providers/wwebjs/wwebjs';
import { Wuzapi } from './providers/wuzapi/wuzapi';
import type { Session } from './session';

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
   */
  async send(message: MessageInput): Promise<string> {
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
