import { Config, type ConfigOptions } from '../config';
import type {
  MessageInput,
  OutgoingMessage,
  TypingRequest,
  Whatsapp,
} from '../contracts/whatsapp';
import {
  ApiException,
  ConfigurationException,
  TimeoutException,
  WhatsappException,
} from '../exceptions';
import { HttpExecutor, type MultipartPart } from '../http/http-executor';
import type { HttpResponse, JsonBody } from '../http/http-response';
import type { Session } from '../session';
import { isPlainObject, type JsonObject } from '../support/envelope';
import { File } from '../support/file';
import { PhoneNumber } from '../support/phone-number';
import type { PacingSpec } from '../support/pacing';
import { Presence } from '../support/presence';
import { Text } from '../support/text';
import type { ThrottleSpec } from '../support/throttle';
import type { TypingSpec } from '../support/typing';
import { hasKey, isArrayLike, isScalar, toInt, toScalarString } from '../internal/scalar';

/**
 * Penidur yang bisa dipasang sebagai pengganti.
 *
 * Sama seperti `AbstractProvider::useSleeper()` di versi PHP: ada supaya jeda
 * antar pesan bisa diuji tanpa benar-benar menunggu. Boleh mengembalikan
 * Promise — `pause()` menunggunya.
 */
export type Sleeper = (seconds: number) => void | Promise<void>;

/**
 * Penidur bersama seluruh provider, meniru `private static $sleeper` di PHP.
 *
 * Ditaruh di tingkat modul, bukan sebagai properti statis kelas abstrak,
 * supaya perilakunya tetap sama: satu penidur berlaku untuk semua gateway.
 */
let sharedSleeper: Sleeper | null = null;

/** Satu pesan setelah bentuknya diseragamkan dan jedanya diselesaikan. */
export interface PlannedMessage {
  /** Tujuan apa adanya dari pemanggil; belum dinormalkan per gateway. */
  destination: string;
  /** Isi pesan sebagai teks — satu-satunya titik di mana panjangnya diketahui. */
  message: string;
  /** Jeda sebelum pesan ini, detik. Null berarti "terserah gateway". */
  delay: number | null;
  /** Lama indikator ketik untuk pesan ini, detik. Null berarti fiturnya mati. */
  typing: number | null;
}

/** Satu pesan yang sudah dibentuk sesuai kemauan gateway, siap dikirim. */
export interface PreparedMessage<TMessage = unknown> {
  /** Pesan dalam bentuk milik gateway — DTO, objek, atau apa pun. */
  message: TMessage;
  /** Jeda yang masih harus ditunggu SDK. 0 bila jedanya dititipkan ke payload. */
  delay: number | null;
  /** Tujuan yang sudah dinormalkan, untuk penanda pesan di log. */
  destination: string;
  /** Lama indikator ketik, detik. */
  typing: number | null;
}

/** Bagian yang dibaca {@link AbstractProvider.announceTyping}. */
interface TypingAnnouncement {
  typing?: number | null;
  destination?: string;
}

/**
 * Bagian yang sama pada semua gateway: pemegang konfigurasi, penyunting bentuk
 * pesan, dan penerjemah respons menjadi exception.
 *
 * Setiap provider mengurus tiga hal sendiri — URL endpoint, header autentikasi,
 * dan amplop errornya. Sisanya ada di sini.
 *
 * ## Sinkron menjadi asinkron
 *
 * Versi PHP memanggil `sleep()` dan menunggu balasan Guzzle secara langsung.
 * Di sini semuanya `await`, jadi pemanggil tidak terkunci selama jeda pacing.
 * Yang **tidak** berubah: `plan()`, `repeatedTargets()`, dan `buildItems()`
 * tetap sinkron, karena ketiganya murni perhitungan.
 *
 * ## Satu nama yang harus berubah
 *
 * PHP membedakan `$this->config` (properti) dari `$this->config()` (method).
 * JavaScript tidak bisa, jadi properti `config` dipertahankan apa adanya —
 * tujuh provider membacanya jauh lebih sering — dan accessor publiknya
 * bernama {@link settings}.
 */
export abstract class AbstractProvider implements Whatsapp {
  protected readonly config: Config;
  protected readonly http: HttpExecutor;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    this.config = Config.from(options ?? null);
    this.http = http ?? new HttpExecutor(null, this.config.timeout(), this.config.headers());
  }

  getToken(): string {
    return this.config.token(this.getProvider());
  }

  /**
   * Nama gateway, dipakai untuk memilih token dan menandai baris log.
   *
   * Abstrak di sini supaya {@link getToken} dan setiap pesan error bisa
   * menyebut gateway mana yang sedang dipakai tanpa tiap provider harus
   * mengulanginya.
   */
  abstract getProvider(): string;

  /**
   * Header autentikasi gateway ini.
   *
   * Satu-satunya tempat token dipasang, supaya tiap provider cukup
   * menyebutkan *bagaimana* ia mengautentikasi — `Authorization: Bearer`,
   * `X-API-Key`, `apikey`, atau `Token` — tanpa mengulang cara request
   * dikirim dan dibaca.
   */
  protected abstract authHeaders(): Record<string, string>;

  /**
   * Kirim satu pesan, atau beberapa sekaligus.
   *
   * Tetap abstrak di sini walaupun bentuk pesannya sudah diseragamkan
   * {@link plan}: yang berbeda antar gateway adalah endpoint dan amplopnya —
   * Fonnte dan OpenWA punya endpoint batch sendiri, sedangkan sisanya
   * mengirim satu per satu lewat {@link sendIndividually}.
   */
  abstract sendMessage(message: MessageInput): Promise<string>;

  /**
   * Buat sesi/instance baru di gateway.
   *
   * Sengaja abstrak: setiap gateway punya istilah, endpoint, dan kredensial
   * sendiri untuk ini, jadi tidak ada perilaku bawaan yang masuk akal.
   */
  abstract createSession(options?: Record<string, unknown>): Promise<Session>;

  /**
   * Baca keadaan sesi yang sudah ada.
   *
   * @param id Sesi yang diperiksa; default dari konfigurasi.
   */
  abstract checkSession(id?: string | null): Promise<Session>;

  /**
   * Ambil QR sesi yang sudah ada, untuk dipindai.
   *
   * Sama seperti {@link createSession}: abstrak, karena endpoint dan bentuk
   * balasannya khas tiap gateway — Fonnte mengirim base64 telanjang di `url`,
   * OpenWA dan wuzapi mengirim data URI yang sudah lengkap. Penyeragamannya
   * ada di `Qr`.
   */
  abstract showQr(id?: string | null): Promise<Session>;

  /**
   * Kirim satu berkas ke satu tujuan.
   *
   * Sengaja abstrak: tiap gateway punya endpoint, bentuk body, dan cara
   * membawa berkasnya sendiri — Fonnte dan ApiMe menuntut unggahan multipart,
   * OpenWA dan Evolution API menerima base64 di dalam JSON, wuzapi hanya mau
   * data URI. Yang seragam adalah cara pemanggil menyerahkan berkasnya, dan
   * itu dirapikan di `File`.
   *
   * @param destination Nomor tujuan, sama seperti `sendMessage()`
   * @param file        Berkas yang sudah dinormalkan
   * @param caption     Teks yang menyertai berkas; boleh kosong
   */
  protected abstract sendMedia(
    destination: string,
    file: File,
    caption: string,
  ): Promise<string>;

  /**
   * Tampilkan atau hapus indikator "sedang mengetik" di satu tujuan.
   *
   * Sengaja abstrak: hanya endpoint dan nama kolomnya yang berbeda antar
   * gateway — Fonnte memakai `/typing` dengan `target` dan `stop`, OpenWA
   * memakai `chats/typing` dengan `typing`/`paused`, Evolution API menuntut
   * `delay` dalam milidetik, wuzapi menandai rekaman suara lewat `Media`.
   * Yang seragam adalah cara pemanggil memintanya, dan itu dirapikan di
   * `Presence`.
   */
  protected abstract sendPresence(
    destination: string,
    presence: Presence,
  ): Promise<string>;

  /**
   * Apakah gateway ini sudah menunggu dan membersihkan indikatornya sendiri.
   *
   * Evolution API mengirim `composing`, menunggu `delay` milidetik, lalu
   * mengirim `paused` — ketiganya di dalam satu request, sehingga request itu
   * baru selesai setelah durasinya habis. Menunggu lagi di klien berarti
   * menunggu dua kali. Gateway lain hanya menyimpan status, jadi durasinya
   * harus dihabiskan SDK sendiri lewat {@link announceTyping}.
   */
  protected presenceBlocks(): boolean {
    return false;
  }

  /**
   * Kirim satu gambar.
   *
   * Kunci yang dibaca: `destination` dan `image` (alias `media`), lalu
   * opsional `filename` dan `caption`.
   */
  sendImage(message: OutgoingMessage): Promise<string> {
    return this.dispatchMedia(message, 'image');
  }

  /**
   * Kirim satu berkas/dokumen.
   *
   * Kunci yang dibaca: `destination` dan `file` (alias `media`), lalu
   * opsional `filename` dan `caption`. `filename` menentukan nama yang
   * dilihat penerima sekaligus jenis berkasnya, jadi isilah kalau isinya
   * base64 telanjang tanpa nama yang jelas.
   */
  sendFile(message: OutgoingMessage): Promise<string> {
    return this.dispatchMedia(message, 'file');
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik".
   *
   * Kunci yang dibaca: `destination`, lalu opsional `state` (default
   * `composing`) dan `duration` dalam detik. `duration` wajib saat
   * menampilkan indikator — Fonnte dan Evolution API memakainya untuk
   * menentukan berapa lama indikator tampil, dan tanpa angka keduanya tidak
   * menampilkan apa pun.
   */
  async sendTyping(message: TypingRequest): Promise<string> {
    const destination = message.destination;

    if (typeof destination !== 'string' || destination.trim() === '') {
      throw new ConfigurationException(
        "Gagal menyusun indikator ketik: kunci 'destination' belum diisi",
      );
    }

    const state = message.state ?? '';

    return this.sendPresence(
      destination.trim(),
      Presence.from(typeof state === 'string' ? state : '', message.duration ?? null),
    );
  }

  /**
   * Normalkan pesan bermedia lalu teruskan ke gateway.
   *
   * `sendImage()` dan `sendFile()` sengaja hanya berbeda pada kunci yang
   * mereka cari: yang menentukan sebuah berkas dikirim sebagai gambar atau
   * dokumen adalah jenis berkasnya, bukan nama method yang dipanggil. Jadi
   * `sendFile()` dengan PNG tetap terkirim sebagai gambar, dan `sendImage()`
   * dengan PDF tetap terkirim sebagai dokumen — persis seperti yang
   * dilakukan gateway sendiri saat memilih endpoint.
   */
  private async dispatchMedia(
    message: OutgoingMessage,
    key: 'image' | 'file',
  ): Promise<string> {
    const record = message as Record<string, unknown>;

    // Kunci `media` berlaku untuk kedua method, supaya pemanggil yang
    // menyimpan berkasnya secara umum tidak perlu tahu mana yang dipakai.
    const payload = record[key] ?? message.media ?? null;

    if (typeof payload !== 'string' || payload.trim() === '') {
      throw new ConfigurationException(
        `Gagal menyusun berkas: kunci '${key}' harus berisi data URI, base64, atau URL publik`,
      );
    }

    const destination = message.destination;

    if (typeof destination !== 'string' || destination.trim() === '') {
      throw new ConfigurationException(
        "Gagal menyusun berkas: kunci 'destination' belum diisi",
      );
    }

    const filename = message.filename ?? '';
    const caption = message.caption ?? '';

    const file = File.from(payload, typeof filename === 'string' ? filename : '');

    // Diperiksa SEBELUM request apa pun dikirim. Kalau tidak, berkas 30 MB
    // terunggah penuh dulu, baru ditolak WhatsApp dengan pesan yang tidak
    // menjelaskan apa-apa — dan pemanggil menunggu lama untuk kegagalan
    // yang bisa diketahui sejak awal. Batasnya milik WhatsApp, bukan
    // gateway, jadi tempatnya di sini sekali, bukan di tujuh provider.
    if (file.exceedsLimit()) {
      throw new ConfigurationException(
        `Berkas '${file.filename}' berukuran ${file.readableSize()}, ` +
          'melebihi batas WhatsApp 16 MB. Kompres atau perkecil berkasnya ' +
          'lebih dulu; WhatsApp menolak media sebesar ini apa pun gateway-nya',
      );
    }

    return this.sendMedia(
      destination.trim(),
      file,
      typeof caption === 'string' ? caption : '',
    );
  }

  /**
   * Konfigurasi yang sedang dipakai provider ini.
   *
   * Bernama `settings`, bukan `config`, karena JavaScript tidak mengizinkan
   * properti dan method bernama sama — sedangkan properti `config` milik
   * kelas ini harus tetap bernama itu agar kode tiap provider terbaca sama
   * seperti versi PHP-nya.
   */
  settings(): Config {
    return this.config;
  }

  /** Transport HTTP yang sedang dipakai, termasuk klien yang disuntikkan. */
  executor(): HttpExecutor {
    return this.http;
  }

  /**
   * Kalimat hasil untuk pengiriman indikator ketik.
   *
   * Ditaruh di sini, bukan di tiap provider, supaya semua gateway melaporkan
   * hal yang sama dengan kata yang sama — pemanggil yang mencatat hasilnya ke
   * log tidak perlu tahu gateway mana yang sedang dipakai.
   *
   * @param destination Tujuan dalam bentuk yang dipakai gateway ini (nomor,
   *                    JID, atau WID), untuk memudahkan penelusuran di log.
   */
  protected presenceResult(presence: Presence, destination: string): string {
    return `Sukses, indikator ${presence.label()} dikirim ke ${destination}`;
  }

  /**
   * Tampilkan indikator "sedang mengetik" untuk satu pesan, lalu habiskan
   * durasinya — dipanggil tepat sebelum pesannya dikirim.
   *
   * Ditaruh sedekat mungkin dengan pesannya, bukan sekali di awal batch:
   * yang membuat indikator ini masuk akal adalah kedekatannya dengan pesan
   * yang menyusul.
   *
   * Kegagalan menampilkan indikator sengaja **tidak** menggagalkan
   * pengiriman, dan tidak menambah jeda apa pun. Mengirim pesan jauh lebih
   * penting daripada hiasannya, dan gateway yang tidak mengenal presence
   * tidak boleh membuat pemanggil kehilangan pesannya. Karena SDK ini tidak
   * punya logger, kegagalan itu senyap — kalau perlu diketahui, panggil
   * {@link sendTyping} sendiri dan tangani exception-nya.
   */
  protected async announceTyping(
    item: TypingAnnouncement | null | undefined,
  ): Promise<void> {
    const seconds = item?.typing ?? null;

    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0) {
      return;
    }

    const destination = item?.destination;

    if (typeof destination !== 'string' || destination.trim() === '') {
      return;
    }

    try {
      await this.sendPresence(
        destination.trim(),
        Presence.from(Presence.COMPOSING, seconds),
      );
    } catch (error) {
      if (error instanceof WhatsappException) return;
      throw error;
    }

    // Gateway yang menunggu dan membersihkan indikatornya sendiri sudah
    // menghabiskan durasi itu di dalam request-nya.
    if (!this.presenceBlocks()) {
      await this.pause(seconds);
    }
  }

  /**
   * Pasang penidur sendiri. Kirim null untuk kembali ke `setTimeout` biasa.
   *
   * Ada supaya jeda antar pesan bisa diuji tanpa benar-benar menunggu — sama
   * seperti `Config.useResolver()` yang jadi jalur test untuk environment.
   */
  static useSleeper(sleeper: Sleeper | null): void {
    sharedSleeper = sleeper;
  }

  /** Tunggu `seconds` detik, lewat penidur yang sedang terpasang. */
  protected async pause(seconds: number): Promise<void> {
    // PHP `sleep()` menolak angka negatif; di sini dijepit ke nol supaya
    // aturan yang salah tulis tidak membuat request menggantung.
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;

    if (sharedSleeper !== null) {
      await sharedSleeper(safe);
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, safe * 1000);
    });
  }

  /**
   * Normalisasi bentuk pesan menjadi list yang seragam, sekaligus
   * menyelesaikan jeda tiap pesan.
   *
   * Pacing diselesaikan **di sini**, bukan di jalur kirim: hanya di titik ini
   * isi pesan masih berupa teks, dan panjangnya ikut menentukan jeda — pesan
   * panjang ditunggu lebih lama. Kalau jedanya baru dihitung di
   * `sendSequentially()` atau di DTO tiap gateway, panjang pesan sudah
   * berubah bentuk menjadi objek dan aturannya harus diulang di setiap
   * provider.
   *
   * `delay` tetap boleh null: itu berarti pacing sedang mati, dan gateway
   * yang memutuskan nilai bawaannya sendiri (Fonnte 2 detik, OpenWA 3 detik,
   * sisanya 0). Mengisinya dengan 0 berarti "tanpa jeda" — dan angka yang
   * disebut pemanggil selalu menang atas pacing, karena pemanggil yang
   * menyebut angka pasti lebih tahu daripada nilai bawaan.
   *
   * Hal yang sama berlaku untuk `typing`: lamanya indikator ketik dihitung
   * dari panjang pesan, jadi ia pun harus diselesaikan selagi isinya masih
   * teks. Null berarti fitur itu sedang mati.
   *
   * Kunci `typing` dibaca di dua tempat, dan keduanya bekerja untuk bentuk
   * pesan apa pun: di tingkat amplop (berlaku untuk seluruh panggilan) dan
   * di dalam tiap item (berlaku untuk pesan itu saja). Yang membuatnya
   * seragam adalah posisinya — `typing` selalu ditulis di sebelah
   * `destination` dan `message` yang hendak dipengaruhinya.
   */
  protected plan(message: MessageInput): PlannedMessage[] {
    if (typeof message === 'string') {
      throw new ConfigurationException(
        `Format pesan tidak valid: ${this.getProvider()} membutuhkan array pesan`,
      );
    }

    // Pengaturan per panggilan. Dua bentuk diterima, karena daftar pesan
    // polos tidak punya tempat untuk menaruh kunci pengaturan:
    //   { messages: [...], pacing: {...} }   (amplop)
    //   { pacing: {...}, 0: {...}, 1: {...} } (kunci di samping daftar)
    const override = setting<PacingSpec>(message, 'pacing', "{ cycle: '0,30', interval: '20-30' }");
    const typingOverride = setting<TypingSpec>(message, 'typing', '{ speed: 8, max: 30 }');
    const throttleOverride = setting<ThrottleSpec>(message, 'throttle', '{ max: 50, window: 60 }');

    let raw: unknown = message;

    if (isPlainObject(raw) && isArrayLike(raw.messages)) {
      raw = raw.messages;
    }

    // PHP menyalin array begitu ia diberikan ke sebuah fungsi; JavaScript
    // tidak. Salinan ini yang membuat `delete` di bawah tidak menghapus kunci
    // milik objek pemanggil — kesalahan yang sulit terlihat karena hanya
    // muncul saat pemanggil memakai ulang objek pesannya.
    const list: unknown = Array.isArray(raw)
      ? copyList(raw)
      : isPlainObject(raw)
        ? { ...raw }
        : raw;

    // Dibuang supaya tidak ikut terbaca sebagai pesan pada bentuk daftar.
    if (isArrayLike(list)) {
      delete list.pacing;
      delete list.typing;
      delete list.throttle;
    }

    const pacing = this.config.pacing().merge(override);
    const typing = this.config.typing().merge(typingOverride);
    const throttle = this.config.throttle().merge(throttleOverride);

    // Bulk kalau elemen pertama sendiri berupa array pesan.
    const isBulk = isArrayLike(list) && issetAt(list, 0) && isArrayLike(list[0]);
    const messages: unknown[] = isBulk
      ? Array.isArray(list)
        ? list
        : Object.values(list)
      : [list];
    const items: PlannedMessage[] = [];

    // Jatah laju dijadwalkan untuk seluruh batch sekaligus, karena jumlah
    // pesan hanya diketahui di sini. Hasilnya digabung dengan jeda pacing
    // secara maksimum, bukan penjumlahan: keduanya sama-sama menahan
    // pemanggil, dan menunggu 60 detik penuh untuk tiap pesan saat kedua
    // aturan aktif hanya akan membuat pengirimannya jauh lebih lambat
    // daripada yang diminta pemanggil.
    const launch = throttle.schedule(messages.length);

    messages.forEach((item, i) => {
      if (!isArrayLike(item) || !issetKey(item, 'destination') || !issetKey(item, 'message')) {
        throw new ConfigurationException(
          `Gagal menyusun pesan: Pesan ke-${i} harus berupa array dengan kunci 'destination' dan 'message'`,
        );
      }

      const text = toScalarString(item.message);
      const length = Text.length(text);

      // Pada bentuk daftar, tiap item boleh membawa `typing`-nya sendiri
      // — mis. satu pesan sengaja dibiarkan tanpa indikator. Pada bentuk
      // satu pesan kunci itu sudah dibaca sebagai pengaturan di atas,
      // jadi tidak ada yang terbaca dua kali.
      const typingItem = typing.merge(
        setting<TypingSpec>(item, 'typing', '{ speed: 8, max: 30 }'),
      );

      items.push({
        destination: toScalarString(item.destination),
        message: text,
        // Urutan siklus mengikuti posisi di daftar, bukan kunci asli
        // pemanggil — daftar bisa datang dengan kunci yang bolong.
        // Angka yang disebut pemanggil selalu menang atas kedua aturan.
        delay: issetKey(item, 'delay')
          ? Math.max(0, toInt(item.delay))
          : combine(pacing.delayFor(items.length, length), launch[items.length] ?? null),
        // Lama indikator ketik juga bergantung pada panjang isi pesan,
        // jadi ia diselesaikan di sini bersama jeda — satu-satunya
        // titik di mana isi pesan masih berupa teks.
        typing: typingItem.durationFor(length),
      });
    });

    return items;
  }

  /**
   * Nomor tujuan yang muncul lebih dari sekali dalam satu batch.
   *
   * Mengirim beberapa pesan ke satu nomor dalam waktu singkat adalah pola
   * yang paling cepat memicu pemblokiran — jauh lebih cepat daripada
   * mengirim satu pesan ke banyak nomor. WhatsApp sendiri menandai pengirim
   * yang "menembak" satu tujuan berulang sebagai spam.
   *
   * Yang dikembalikan hanya tujuannya, bukan isi pesannya, supaya aman
   * dicatat ke log. Dihitung sekali per panggilan, bukan per pesan.
   */
  repeatedTargets(message: MessageInput): string[] {
    if (typeof message === 'string') return [];

    let raw: unknown = message;

    if (isPlainObject(raw) && isArrayLike(raw.messages)) {
      raw = raw.messages;
    }

    // Bentuk satu pesan tidak punya arti "berulang".
    if (!isArrayLike(raw) || !issetAt(raw, 0) || !isArrayLike(raw[0])) return [];

    const counts = new Map<string, number>();
    const list: unknown[] = Array.isArray(raw) ? raw : Object.values(raw);

    for (const item of list) {
      if (!isArrayLike(item) || !hasKey(item, 'destination')) continue;

      const destination = toScalarString(item.destination).trim();

      if (destination !== '') {
        counts.set(destination, (counts.get(destination) ?? 0) + 1);
      }
    }

    return [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key);
  }

  /**
   * Peringatkan bila satu batch mengirim ke nomor yang sama lebih dari sekali.
   *
   * Sengaja **tidak** dipanggil dari jalur kirim. Mengirim dua pesan ke satu
   * orang adalah hal yang sah — mis. teks lalu berkas — dan SDK ini tidak
   * punya logger, sehingga peringatan otomatis hanya akan muncul sebagai
   * kebisingan yang tidak bisa ditangkap pemanggil dengan rapi. Pemanggil
   * yang ingin memeriksanya memanggil {@link repeatedTargets} sendiri dan
   * memutuskan apa yang pantas dilakukan.
   */
  protected warnAboutRepeatedTargets(messages: OutgoingMessage[]): void {
    const repeated = this.repeatedTargets(messages);

    if (repeated.length === 0) return;

    // PHP memakai `trigger_error(..., E_USER_NOTICE)`. Padanannya di
    // JavaScript adalah `console.warn` — SDK tetap tidak punya logger sendiri.
    console.warn(
      `${this.getProvider()}: nomor berikut menerima lebih dari satu pesan dalam satu panggilan: ` +
        `${repeated.join(', ')}. Pola ini paling cepat memicu pemblokiran WhatsApp.`,
    );
  }

  /**
   * Jalankan penyusun payload, ubah kegagalannya menjadi
   * `ConfigurationException` dengan awalan yang seragam.
   */
  protected compose<T>(factory: () => T): T {
    try {
      return factory();
    } catch (error) {
      if (error instanceof ConfigurationException) throw error;

      throw new ConfigurationException(`Gagal menyusun pesan: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  /**
   * Baca body respons, dan lempar exception kalau request-nya tidak sampai.
   *
   * Sengaja tidak melempar untuk status 4xx/5xx: body-nya masih dibutuhkan
   * provider untuk menyusun pesan penolakan yang berguna.
   */
  protected read(response: HttpResponse): JsonObject | null {
    if (response.timedOut) {
      throw new TimeoutException(this.http.timeout(), response.error);
    }

    if (response.error !== '') {
      throw new ApiException(
        `Gagal menghubungi ${this.getProvider()}: ${response.error}`,
        0,
      );
    }

    return asJsonObject(response.json());
  }

  /**
   * Lempar exception bertipe untuk respons non-2xx.
   *
   * `Retry-After` ikut diteruskan supaya 429 membawa sendiri berapa lama
   * pemanggil harus menunggu — hanya di sinilah header respons masih
   * terlihat, setelah ini yang beredar hanya exception.
   */
  protected reject(response: HttpResponse, body: JsonObject | null): never {
    throw ApiException.classify(
      response.status,
      this.describe(response.status, body),
      body,
      this.kind(body),
      null,
      response.retryAfterSeconds(),
    );
  }

  /**
   * Status 2xx dengan body yang tak bisa di-decode bukan bukti pesan terkirim,
   * jadi jangan pernah dilaporkan sebagai sukses.
   */
  protected requireJson(body: JsonObject | null, status: number): JsonObject {
    if (body === null) {
      throw new ApiException(
        `Respons ${this.getProvider()} tidak valid (HTTP ${status})`,
        status,
      );
    }

    return body;
  }

  /**
   * Susun header untuk request berbadan JSON.
   *
   * @param extra Header khusus request ini, mis. `Idempotency-Key` milik ApiMe.
   */
  protected jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { 'Content-Type': 'application/json', ...this.authHeaders(), ...extra };
  }

  /**
   * POST JSON, lalu baca + tolak + wajib-JSON dalam satu langkah.
   *
   * Keempat gateway self-hosted melakukan urutan yang persis sama; hanya URL,
   * payload, dan header tambahannya yang berbeda.
   *
   * @param payload Body JSON, atau null untuk endpoint yang hanya butuh header
   *                autentikasi (mis. Fonnte `get-devices`).
   */
  protected async postJson(
    url: string,
    payload: Record<string, unknown> | null = null,
    extraHeaders: Record<string, string> = {},
  ): Promise<JsonObject> {
    const body = payload === null ? '' : (JSON.stringify(payload) ?? '');

    return this.decode(await this.http.post(url, body, this.jsonHeaders(extraHeaders)));
  }

  /**
   * POST multipart, lalu baca + tolak + wajib-JSON dalam satu langkah.
   *
   * Dipakai gateway yang menuntut berkasnya diunggah sebagai biner —
   * Fonnte dan ApiMe. `Content-Type` sengaja tidak ikut diisi: hanya runtime
   * yang tahu `boundary` milik body ini.
   */
  protected async postMultipartJson(
    url: string,
    parts: MultipartPart[],
    extraHeaders: Record<string, string> = {},
  ): Promise<JsonObject> {
    return this.decode(
      await this.http.postMultipart(url, parts, {
        ...this.authHeaders(),
        ...extraHeaders,
      }),
    );
  }

  /**
   * GET, lalu baca + tolak + wajib-JSON. Dipakai endpoint status sesi.
   */
  protected async getJson(url: string): Promise<JsonObject> {
    return this.decode(await this.http.get(url, this.authHeaders()));
  }

  /**
   * Terjemahkan satu respons menjadi body JSON, atau lempar exception yang
   * sesuai.
   */
  private decode(response: HttpResponse): JsonObject {
    const body = this.read(response);

    if (!response.isSuccess()) {
      return this.reject(response, body);
    }

    return this.requireJson(body, response.status);
  }

  /**
   * Jalankan `attempt`, dan ulangi bila gateway menolak dengan status yang
   * aman diulang dan menyebutkan `Retry-After`.
   *
   * Dua syarat harus terpenuhi sekaligus:
   *
   * - **Statusnya aman diulang** — 429 (batas laju) atau 503 (sesi belum
   *   siap). 401/403/404/409 tidak akan sembuh kalau diulang: token yang
   *   ditolak tetap ditolak, jadi mengulangnya hanya memperlambat kegagalan
   *   yang sudah pasti.
   * - **Gateway menyebut berapa lama harus menunggu.** Tanpa `Retry-After`,
   *   menebak jeda sendiri berarti menabrak dinding yang sama lagi; yang
   *   seperti itu lebih baik diserahkan ke pemanggil, yang tahu jadwalnya.
   *
   * Dijeda dengan {@link pause} supaya test tidak benar-benar menunggu.
   * Bila percobaan terakhir tetap gagal, exception terakhir dilempar apa
   * adanya — pesannya sudah memuat `Retry-After`, jadi pemanggil tetap bisa
   * mengatur ulang jadwalnya sendiri.
   */
  protected async withRetry<T>(attempt: () => Promise<T>): Promise<T> {
    let remaining = this.config.retries();

    for (;;) {
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof ApiException)) throw error;

        const wait = error.getRetryAfter();

        if (remaining <= 0 || wait === null || !isRetryableStatus(error.getStatus())) {
          throw error;
        }

        remaining--;
        await this.pause(wait);
      }
    }
  }

  /**
   * Kirim beberapa pesan satu per satu, dengan jeda di antara pengiriman.
   *
   * Dipakai gateway tanpa endpoint batch (ApiMe, Evolution API, wuzapi).
   * Kegagalan satu pesan tidak menghentikan sisanya — semuanya dikumpulkan
   * lalu dilempar sebagai satu `ApiException` supaya pemanggil melihat
   * gambaran lengkapnya, bukan cuma kegagalan pertama.
   *
   * Jedanya sudah diselesaikan {@link plan} — termasuk bagian pacing yang
   * bergantung pada panjang isi pesan. Di sini tinggal menjalankannya.
   * Pesan pertama tidak pernah ditunggu: jeda sebelum pengiriman pertama
   * adalah urusan pemanggil, bukan urusan SDK.
   *
   * Indikator "sedang mengetik" dimunculkan di sini juga, tepat sebelum tiap
   * pesan. Berbeda dari jeda, pesan **pertama** tetap dapat indikator: justru
   * pesan pertama itulah yang paling sering dikirim sendirian, dan tanpa
   * indikator di sana fiturnya tidak akan terasa sama sekali.
   *
   * @param send  Mengirim satu pesan
   * @param label Penanda pesan untuk pesan error
   */
  protected async sendSequentially<T>(
    items: PreparedMessage<T>[],
    send: (message: T) => Promise<string>,
    label: (message: T) => string,
  ): Promise<string> {
    let success = 0;
    const failed: string[] = [];
    let last: WhatsappException | null = null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const jeda = toInt(item.delay ?? 0);

      if (i > 0 && jeda > 0) {
        await this.pause(jeda);
      }

      // Indikator menyusul jeda, bukan mendahuluinya: yang dilihat
      // penerima harus "sedang mengetik" lalu pesannya, bukan "sedang
      // mengetik", diam lama, baru pesannya.
      await this.announceTyping(item);

      try {
        await this.withRetry(() => send(item.message));
        success++;
      } catch (error) {
        if (!(error instanceof WhatsappException)) throw error;

        last = error;
        failed.push(`${label(item.message)}: ${error.message}`);
      }
    }

    const total = items.length;

    if (failed.length > 0) {
      throw new ApiException(
        `${success}/${total} pesan terkirim. Gagal: ${failed.join(' | ')}`,
        last instanceof ApiException ? last.getStatus() : 0,
        null,
        null,
        last,
      );
    }

    return `Sukses, ${success}/${total} pesan terkirim`;
  }

  /**
   * Rangkai pesan penolakan dari amplop body milik gateway.
   */
  protected describe(status: number, body: JsonObject | null): string {
    const detail = this.detail(body);
    const pesan = `${this.getProvider()} menolak pesan (HTTP ${status})`;

    return detail === '' ? pesan : `${pesan}: ${detail}`;
  }

  /**
   * Ambil teks detail dari amplop body. Bentuknya berbeda-beda antar gateway
   * — OpenWA memakai amplop NestJS, Evolution API menyelipkan
   * `response.message`, ApiMe dan wuzapi memakai `error`, Fonnte `reason`.
   */
  protected detail(body: JsonObject | null): string {
    if (body === null) return '';

    const response = body['response'];
    const candidates: unknown[] = [
      isArrayLike(response) ? response['message'] : null,
      body['message'],
      body['error'],
      body['reason'],
    ];

    for (const candidate of candidates) {
      if (isArrayLike(candidate)) {
        // Kegagalan validasi per-field dikirim sebagai array.
        const parts = Array.isArray(candidate) ? candidate : Object.values(candidate);
        const flat = parts
          .map((part) => (isScalar(part) ? toScalarString(part) : (JSON.stringify(part) ?? '')))
          .filter((part) => part !== '');

        if (flat.length > 0) return flat.join('; ');
      } else if (typeof candidate === 'string' && candidate !== '') {
        return candidate;
      }
    }

    return '';
  }

  /**
   * Penanda jenis error dari amplop body, bila gateway menyediakannya.
   */
  protected kind(body: JsonObject | null): string | null {
    const value = body?.['error'] ?? body?.['reason'] ?? null;

    return typeof value === 'string' && value !== '' ? value : null;
  }

  /**
   * Pastikan kunci konfigurasi wajib sudah diisi.
   *
   * Dipakai provider self-hosted yang tidak bisa jalan tanpa id sesi atau
   * instance. Pesan errornya sengaja menyebut nama kunci `.env`-nya, karena
   * itulah satu-satunya hal yang bisa diperbaiki pemanggil.
   *
   * @param value Nilai yang diperiksa
   * @param key   Nama kunci `.env`, mis. `WHATSAPP_SESSION`
   * @return Nilai yang sama, supaya bisa langsung dipakai:
   *         `const id = this.requireConfigured(id, 'WHATSAPP_SESSION');`
   */
  protected requireConfigured(value: string, key: string): string {
    if (value === '') {
      throw new ConfigurationException(`${key} belum diisi di .env`);
    }

    return value;
  }

  /**
   * Ubah tujuan menjadi bentuk yang diminta gateway, dan tolak bila kosong.
   *
   * Nomor yang sudah berupa JID (`...@g.us`) diteruskan apa adanya:
   * menormalkannya akan merusak identitas grup. Sisanya dinormalkan menjadi
   * nomor internasional tanpa tanda plus.
   *
   * Gateway yang memakai JID berkode lain mengurus tujuannya sendiri —
   * OpenWA dan Wwebjs menuntut sufiks `@c.us`, sedangkan Fonnte tidak
   * mengenal JID sama sekali.
   *
   * @param destination Nomor mentah dari pemanggil
   */
  protected target(destination: string): string {
    const target = destination.includes('@')
      ? destination
      : PhoneNumber.normalize(destination);

    if (target === '') {
      throw new ConfigurationException(`Nomor tujuan '${destination}' tidak valid`);
    }

    return target;
  }

  /**
   * Jalur kirim gateway tanpa endpoint batch.
   *
   * Satu pesan dikirim langsung; lebih dari satu dikirim berurutan lewat
   * {@link sendSequentially} — yang juga memunculkan indikator ketik dan
   * menghabiskan jeda tiap pesan. Dipakai ApiMe, Evolution API, wuzapi, dan
   * Wwebjs; OpenWA dan Fonnte punya endpoint batch sendiri.
   *
   * @param build Menyusun item {@link plan} menjadi pesan siap kirim —
   *              biasanya lewat {@link buildItems}
   * @param send  Mengirim satu pesan
   * @param label Penanda pesan untuk pesan error
   */
  protected async sendIndividually<T>(
    message: MessageInput,
    build: (items: PlannedMessage[]) => PreparedMessage<T>[],
    send: (message: T) => Promise<string>,
    label: (message: T) => string,
  ): Promise<string> {
    const items = this.plan(message);

    if (items.length === 0) {
      return 'Tidak ada pesan untuk dikirim';
    }

    const prepared = this.compose(() => build(items));

    if (prepared.length === 1) {
      await this.announceTyping(prepared[0]);

      // Lewat withRetry() juga: satu pesan adalah kasus paling sering
      // dipakai, jadi justru di situ percobaan ulang paling terasa.
      // sendSequentially() di bawah punya jalurnya sendiri.
      return this.withRetry(() => send(prepared[0].message));
    }

    return this.sendSequentially(prepared, send, label);
  }

  /**
   * Susun tiap item hasil {@link plan} menjadi pesan siap kirim.
   *
   * Yang berbeda antar gateway hanyalah bentuk pesannya, bukan cara
   * menyusunnya. Nomor tujuan yang tidak bisa dibaca ditolak di sini, sebelum
   * ada request apa pun: pesan error gateway untuk kasus ini biasanya tidak
   * menjelaskan apa-apa.
   *
   * @param factory (item) => pesan gateway
   * @param target  (pesan) => tujuan yang sudah dinormalkan, untuk validasi
   *                sekaligus penanda pesan di log
   * @param delayOnServer true bila jeda dititipkan ke payload sehingga klien
   *                      tidak perlu menunggu — lihat Evolution API
   */
  protected buildItems<T>(
    items: PlannedMessage[],
    factory: (item: PlannedMessage) => T,
    target: (message: T) => string,
    delayOnServer = false,
  ): PreparedMessage<T>[] {
    const prepared: PreparedMessage<T>[] = [];

    items.forEach((item, i) => {
      const message = factory(item);

      if (target(message) === '') {
        throw new ConfigurationException(`Pesan ke-${i} tidak punya nomor tujuan yang valid`);
      }

      prepared.push({
        message,
        // Jeda yang dititipkan ke payload tidak boleh ditunggu lagi di
        // klien — kalau ditunggu, pemanggil menunggu dua kali.
        delay: delayOnServer ? 0 : item.delay,
        destination: item.destination,
        typing: item.typing,
      });
    });

    return prepared;
  }
}

/**
 * Gabungkan jeda dari pacing dan pembatas laju, dengan `null` berarti
 * "aturan ini tidak aktif".
 *
 * Keduanya sama-sama menahan pemanggil, jadi yang diambil adalah yang
 * **lebih panjang** — bukan jumlahnya. Menjumlahkan berarti menunggu dua
 * kali ketika kedua aturan aktif, dan itu lebih lambat daripada yang
 * diminta pemanggil.
 *
 * Null tetap null: itulah penanda "tidak ada aturan", yang membuat gateway
 * memakai jeda bawaannya sendiri. Mengubahnya menjadi 0 akan mengubah
 * perilaku gateway — nol berarti "jangan tunggu", bukan "terserah gateway".
 */
function combine(pacing: number | null, throttle: number | null): number | null {
  if (pacing === null) return throttle;
  if (throttle === null) return pacing;

  return Math.max(pacing, throttle);
}

/**
 * Baca satu kunci pengaturan dari amplop pesan pemanggil.
 *
 * @param contoh Contoh penulisan yang benar, dipakai di pesan error supaya
 *               pemanggil tahu bentuk yang diharapkan.
 * @return Null bila kuncinya tidak disebut.
 */
function setting<T>(spec: unknown, key: string, contoh: string): T | null {
  if (!isArrayLike(spec) || !hasKey(spec, key)) return null;

  const value = spec[key];

  // `$message[$key] === null` di PHP: kunci yang ada tapi bernilai null
  // dianggap sama dengan tidak disebut sama sekali.
  if (value === null || value === undefined) return null;

  if (!isArrayLike(value)) {
    throw new ConfigurationException(
      `Gagal menyusun pesan: kunci '${key}' harus berupa array, mis. ${contoh}`,
    );
  }

  return value as T;
}

/** `isset($value[$key])` PHP — kunci harus ada dan nilainya bukan null. */
function issetKey(value: Record<string, unknown>, key: string): boolean {
  const found = value[key];

  return found !== null && found !== undefined;
}

/** `isset($value[$index])` PHP untuk indeks numerik. */
function issetAt(value: Record<string, unknown>, index: number): boolean {
  return issetKey(value, String(index));
}

/**
 * Salin sebuah daftar beserta kunci non-numeriknya.
 *
 * Kunci non-numerik perlu ikut disalin karena bentuk "kunci pengaturan di
 * samping daftar" menaruh `pacing`/`typing`/`throttle` tepat di sana.
 */
function copyList(value: unknown[]): unknown[] {
  const copy = value.slice() as unknown[] & Record<string, unknown>;
  const source = value as unknown as Record<string, unknown>;

  for (const key of Object.keys(value)) {
    if (!/^\d+$/.test(key)) {
      copy[key] = source[key];
    }
  }

  return copy;
}

/**
 * Pandangan objek atas body respons.
 *
 * PHP hanya punya array, jadi `$body['reason']` pada body berbentuk daftar
 * menghasilkan null — di sini kunci string pada array juga menghasilkan
 * `undefined`, dan keduanya sama-sama dianggap "tidak ada".
 */
function asJsonObject(body: JsonBody | null): JsonObject | null {
  if (body === null) return null;

  return Array.isArray(body) ? (body as unknown as JsonObject) : body;
}

/** Status HTTP yang aman diulang: 429 dan 503. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

/** Pesan sebuah nilai yang dilempar, apa pun bentuknya. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
