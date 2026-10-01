import type { Config, ConfigOptions } from '../../config';
import type { MessageInput } from '../../contracts/whatsapp';
import type { HttpExecutor } from '../../http/http-executor';
import { isArrayLike, toScalarString } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import type { File } from '../../support/file';
import type { Presence } from '../../support/presence';
import {
  AbstractProvider,
  type PlannedMessage,
  type PreparedMessage,
} from '../abstract-provider';
import { WAXUM_DEFAULT_URL, WAXUM_NAME } from './constants';
import { WaxumMessage } from './waxum-message';
import { WaxumSession } from './waxum-session';
import { WaxumShowQr } from './waxum-show-qr';

/** Semua endpoint REST Waxum bernaung di bawah prefiks ini. */
const API = '/api/v1';

/**
 * Gateway Waxum (https://github.com/imtaqin/waxum), WhatsApp self-hosted
 * berbasis Rust — protokol multi-device-nya dari `whatsapp-rust`.
 *
 * Konfigurasi:
 *   WHATSAPP_PROVIDER    = Waxum
 *   WHATSAPP_TOKEN       = bearer token Waxum (header `Authorization: Bearer …`)
 *   WHATSAPP_URL_Waxum   = base URL instance, mis. http://localhost:3451
 *                          (`WHATSAPP_URL` juga dibaca sebagai fallback umum)
 *   WHATSAPP_SESSION     = id sesi yang sudah dipindai (juga id bawaan
 *                          `createSession()`/`checkSession()`).
 *                          `WHATSAPP_SESSION_Waxum` menang atasnya, sehingga
 *                          id sesi Waxum tidak perlu sama dengan gateway lain.
 *
 * Berbeda dari OpenWA dan Wwebjs, sesi di sini tidak perlu dibuat lebih dulu:
 * `createSession()` dengan id yang sudah ada akan ditolak HTTP 409, jadi
 * alurnya adalah `checkSession()` dulu, dan baru membuat kalau memang belum ada.
 *
 * Seluruh API-nya berada di bawah `/api/v1`, dan tokennya adalah token
 * superadmin — Waxum juga menerima JWT yang ditandatangani `JWT_SECRET` dengan
 * klaim `role: superadmin`, tapi token superadmin biasa cukup.
 *
 * ## Token yang berbeda dari tetangganya
 *
 * Waxum memakai `Authorization: Bearer` dengan token yang diterbitkan
 * server-nya sendiri. Itu sebabnya `authHeaders()` di sini berbeda dari
 * OpenWA (`X-API-Key`) dan wuzapi (`Token`), walaupun sama-sama self-hosted.
 */
export class Waxum extends AbstractProvider {
  static readonly NAME = WAXUM_NAME;

  static readonly DEFAULT_URL = WAXUM_DEFAULT_URL;

  private readonly baseUrl: string;

  private readonly sessionId: string;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    super(options, http);

    const url = this.config.url(Waxum.DEFAULT_URL, Waxum.NAME);

    // Terima "http://host:3451" maupun "http://host:3451/api/v1" tanpa jadi
    // "/api/v1/api/v1" — seluruh path di kelas ini sudah menuliskan `/api/v1`.
    this.baseUrl = url.replace(/\/api\/v1$/, '');

    // Nama provider ikut diberikan supaya `WHATSAPP_SESSION_Waxum`
    // didahulukan — lihat `Config.session()`.
    this.sessionId = this.config.session(Waxum.NAME);
  }

  getProvider(): string {
    return Waxum.NAME;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.getToken()}` };
  }

  /**
   * Sesi Waxum tidak menahan pemanggil saat indikator ketik ditampilkan.
   *
   * `POST .../chatstate/send` hanya menyimpan statusnya, dan pesannya
   * benar-benar dikirim setelah pemanggil menghapusnya dengan `paused` atau
   * setelah sebuah pesan terkirim. Jadi durasinya tetap dihabiskan SDK
   * sendiri — lihat `AbstractProvider.announceTyping()`.
   */
  protected presenceBlocks(): boolean {
    return false;
  }

  /**
   * Buat sesi baru: `POST /api/v1/sessions`.
   *
   * Id sesi diambil dari `options` bila ada, selain itu dari
   * `WHATSAPP_SESSION`. Mengosongkan keduanya sah — Waxum akan membuat id
   * acak — tetapi sesi seperti itu tidak bisa dicari lagi lewat
   * `checkSession()` tanpa argumen.
   *
   * Sesi baru langsung mulai menyambung dan berstatus `connecting`, jadi
   * ambil QR-nya lewat `showQr()`, lalu pantau dengan `checkSession()`.
   *
   * Kunci `options` yang dikenali: `id`, `name`, `webhook`, `device`.
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    const payload = WaxumSession.payload(options, this.sessionId);
    const body = await this.postJson(`${this.baseUrl}${API}/sessions`, payload);

    return WaxumSession.fromCreate(body, toScalarString(payload['id'] ?? ''));
  }

  /**
   * Baca keadaan sesi: `GET /api/v1/sessions/{id}/status`.
   *
   * @param id Sesi yang diperiksa; default dari konfigurasi.
   */
  async checkSession(id?: string | null): Promise<Session> {
    const sessionId = this.requireConfigured(id ?? this.sessionId, 'WHATSAPP_SESSION');

    return WaxumSession.fromStatus(
      await this.getJson(this.sessionUrl(sessionId, 'status')),
      sessionId,
    );
  }

  /**
   * Ambil QR sesi: `GET /api/v1/sessions/{id}/qr`.
   *
   * Hanya menjawab saat sesi sedang menunggu dipindai. Sesi yang sudah login
   * membalas `qr_codes` kosong dengan `status: "logged_in"` — itu keadaan,
   * bukan kegagalan, jadi dilaporkan sebagai sesi `connected` tanpa QR. Sesi
   * yang belum tersambung sama sekali justru ditolak: Waxum membalas HTTP 503
   * untuk sesi yang runtime-nya belum ada, dan itu tetap dilempar karena
   * pemanggil perlu tahu sesinya memang belum siap.
   *
   * @param id Sesi yang diminta QR-nya; default dari konfigurasi.
   */
  async showQr(id?: string | null): Promise<Session> {
    const sessionId = this.requireConfigured(id ?? this.sessionId, 'WHATSAPP_SESSION');

    const body = await this.getJson(this.sessionUrl(sessionId, 'qr'));

    // Diperiksa sebelum balasannya dianggap selesai: `qr_codes` kosong
    // bersama status `logged_in` berarti sesinya sudah siap dipakai. Yang
    // menentukan `logged_in` adalah `fromStatus`, bukan tebakan di sini.
    if (qrCodesEmpty(body['qr_codes']) && WaxumSession.fromStatus(body).isConnected()) {
      return WaxumShowQr.alreadyConnected(body, sessionId);
    }

    return WaxumShowQr.fromResponse(body, sessionId);
  }

  /**
   * Kirim pesan lewat Waxum.
   *
   * Waxum tidak punya endpoint batch — satu pesan satu request — jadi beberapa
   * pesan dikirim berurutan. Jeda antar pesan dihormati lewat kunci `delay`
   * atau, bila tidak diisi, lewat pacing (`WHATSAPP_PACING_*`), sehingga
   * mengirim banyak pesan MEMBLOKIR pemanggil selama total jeda itu. Halaman
   * scan hanya mengirim satu pesan.
   */
  async sendMessage(message: MessageInput): Promise<string> {
    return this.sendIndividually(
      message,
      (items) => this.build(items),
      (msg) => this.sendText(msg),
      (msg) => msg.to,
    );
  }

  /**
   * Susun item `plan()` menjadi pesan Waxum.
   *
   * Sesi diperiksa di sini, bukan di `sendMessage()`, supaya jalurnya sama
   * dengan provider lain: `sendIndividually()` memanggil `build()` tepat sekali
   * sebelum ada request apa pun, jadi pesan tanpa sesi gagal tanpa menyentuh
   * jaringan.
   */
  private build(items: PlannedMessage[]): PreparedMessage<WaxumMessage>[] {
    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    return this.buildItems(
      items,
      (item) => new WaxumMessage(item.destination, item.message),
      (message) => message.to,
    );
  }

  /**
   * Kirim satu berkas lewat Waxum.
   *
   * Dua endpoint terpisah — `messages/image` dan `messages/document` — dan
   * yang menentukan adalah jenis berkasnya, sama seperti di gateway lain.
   * Isinya boleh URL publik maupun base64: Waxum mengunduh sendiri berkas
   * dari URL, lewat pemeriksa SSRF-nya, jadi keduanya diteruskan apa adanya.
   *
   * Bentuk base64-nya adalah `{data, mimetype}`, bukan data URI — Waxum
   * memisahkan isi dari jenisnya, jadi awalan `data:…;base64,` harus dibuang.
   * Untuk dokumen, `filename` ikut dikirim karena itulah nama yang dilihat
   * penerima.
   */
  protected async sendMedia(
    destination: string,
    file: File,
    caption: string,
  ): Promise<string> {
    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    const to = this.target(destination);

    // Waxum menerima kedua bentuk itu, dan keduanya punya arti yang
    // berbeda: URL berarti "unduh sendiri", base64 berarti "inilah isinya".
    const media: Record<string, string> = file.isUrl()
      ? { url: file.payload }
      : { data: file.base64(), mimetype: file.mime };

    const payload: Record<string, unknown> = file.isImage()
      ? { to, image: media }
      : { to, document: media, filename: file.filename };

    if (caption !== '') {
      payload['caption'] = caption;
    }

    const body = await this.postJson(
      this.sessionUrl(
        this.sessionId,
        `messages/${file.isImage() ? 'image' : 'document'}`,
      ),
      payload,
    );

    return `Sukses, messageId: ${toScalarString(body['message_id'] ?? '-')}`;
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik":
   * `POST /api/v1/sessions/{id}/chatstate/send`.
   *
   * Waxum memakai kosakata yang sama dengan SDK ini (`composing`, `paused`,
   * `recording`), jadi tidak ada penerjemahan kata yang perlu dilakukan.
   * `duration` tidak ikut dikirim: statusnya bertahan sampai dihapus dengan
   * `paused` atau sampai ada pesan yang benar-benar terkirim.
   */
  protected async sendPresence(
    destination: string,
    presence: Presence,
  ): Promise<string> {
    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    const to = this.target(destination);

    await this.postJson(this.sessionUrl(this.sessionId, 'chatstate/send'), {
      to,
      // Kosakata Waxum kebetulan sama dengan kosakata baku SDK ini, jadi
      // keadaannya diteruskan apa adanya — jangan "diperbaiki" menjadi
      // pemetaan seperti di OpenWA.
      state: presence.state,
    });

    return this.presenceResult(presence, to);
  }

  /** `POST /api/v1/sessions/{id}/messages/text` */
  private async sendText(message: WaxumMessage): Promise<string> {
    const body = await this.postJson(
      this.sessionUrl(this.sessionId, 'messages/text'),
      message.toArray(),
    );

    return `Sukses, messageId: ${toScalarString(body['message_id'] ?? '-')}`;
  }

  /**
   * Url endpoint yang bernaung di bawah satu sesi.
   *
   * Tidak memakai `encodeURIComponent()`, berbeda dari gateway lain: id sesi
   * Waxum dipakai apa adanya sebagai nama direktori penyimpanannya, dan id
   * yang butuh di-encode memang tidak bisa dipakai di sana.
   */
  private sessionUrl(sessionId: string, path: string): string {
    return `${this.baseUrl}${API}/sessions/${sessionId}/${path}`;
  }

  /**
   * Waxum memakai amplop error `{"success":false,"error":{"code":N,"message":"…"}}`
   * (lihat `ApiError::into_response`). Beberapa status punya arti khusus yang
   * layak dijelaskan di log, karena pesan bawaannya tidak menyebut apa pun
   * tentang cara memperbaikinya.
   */
  protected describe(status: number, body: JsonObject | null): string {
    const konteks =
      status === 401
        ? 'token waxum salah atau kosong, cek WHATSAPP_TOKEN'
        : status === 403
          ? 'token bukan superadmin, atau tidak berhak atas sesi ini'
          : status === 404
            ? 'sesi tidak ditemukan, cek WHATSAPP_SESSION'
            : status === 409
              ? 'sesi dengan id itu sudah ada — pakai checkSession(), bukan createSession()'
              : status === 503
                ? // HTTP 503 dari Waxum selalu berarti klien WhatsApp-nya
                  // belum hidup; pesan terpentingnya adalah bahwa tidak ada
                  // yang terkirim.
                  'sesi WhatsApp belum tersambung, tidak ada pesan yang terkirim — pindai QR-nya lewat showQr()'
                : '';

    const pesan = super.describe(status, body);

    return konteks === '' ? pesan : `${pesan} [${konteks}]`;
  }

  /**
   * Detail error Waxum bersarang di `error.message`, sedangkan penolong baku
   * hanya membaca `error` yang berupa string.
   *
   * Objek `error` di sini juga yang membuat `kind()` baku tidak menemukan
   * penanda jenis error apa pun — memang tidak ada padanannya di Waxum.
   */
  protected detail(body: JsonObject | null): string {
    const error = body?.['error'] ?? null;

    if (isArrayLike(error)) {
      return super.detail({ error: error['message'] ?? null });
    }

    return super.detail(body);
  }
}

/**
 * `($body['qr_codes'] ?? []) === []` PHP.
 *
 * Perbandingannya sengaja tidak ditulis `length === 0` saja: `json_decode(…,
 * true)` di PHP mengubah objek JSON kosong menjadi array kosong juga, jadi
 * `{}` di sini harus diperlakukan sama dengan `[]` supaya perilakunya tidak
 * berbeda dari versi PHP. Skalar (mis. string kosong) justru **bukan** daftar
 * kosong — di PHP `'' === []` bernilai salah.
 */
function qrCodesEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isArrayLike(value)) return Object.keys(value).length === 0;

  return false;
}
