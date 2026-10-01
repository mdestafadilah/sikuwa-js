import type { Config, ConfigOptions } from '../../config';
import type { MessageInput } from '../../contracts/whatsapp';
import { ConfigurationException } from '../../exceptions';
import type { HttpExecutor } from '../../http/http-executor';
import { isArrayLike } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import type { File } from '../../support/file';
import type { Presence } from '../../support/presence';
import { Text } from '../../support/text';
import {
  AbstractProvider,
  type PlannedMessage,
  type PreparedMessage,
} from '../abstract-provider';
import { WWEBJS_DEFAULT_URL, WWEBJS_NAME } from './constants';
import { WwebjsMessage, type WwebjsPayload } from './wwebjs-message';
import { WwebjsSession } from './wwebjs-session';
import { WwebjsShowQr } from './wwebjs-show-qr';

/**
 * Gateway Wwebjs (https://github.com/avoylenko/wwebjs-api), pembungkus REST
 * untuk whatsapp-web.js — WhatsApp self-hosted berbasis Node.js + Chromium.
 *
 * Konfigurasi:
 *   WHATSAPP_PROVIDER   = Wwebjs
 *   WHATSAPP_TOKEN      = API key global (env `API_KEY` di sisi server), header `x-api-key`
 *   WHATSAPP_URL_Wwebjs = base URL instance, mis. https://wwebjs.example.com
 *                         (`WHATSAPP_URL` juga dibaca sebagai fallback umum)
 *   WHATSAPP_SESSION    = id session: huruf, angka, `_`, dan `-` saja
 *                         (`WHATSAPP_SESSION_Wwebjs` menang atasnya, jadi
 *                         session wwebjs tidak bertabrakan dengan gateway lain)
 *
 * Dua hal yang membedakannya dari gateway lain di SDK ini:
 *
 * - **API key-nya opsional.** Selama `API_KEY` tidak diisi di sisi server,
 *   wwebjs menerima request tanpa autentikasi apa pun. SDK tetap mengirim
 *   headernya, jadi keduanya bekerja.
 * - **Pengiriman menuntut session yang sudah tersambung.** Middleware
 *   `sessionValidation` menolak dengan HTTP 404 selama session belum
 *   `CONNECTED`, sehingga pesan errornya di sini menjelaskan keadaan itu alih-
 *   alih meneruskan "Not Found" apa adanya.
 */
export class Wwebjs extends AbstractProvider {
  static readonly NAME = WWEBJS_NAME;

  static readonly DEFAULT_URL = WWEBJS_DEFAULT_URL;

  private readonly baseUrl: string;

  private readonly sessionId: string;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    super(options, http);

    this.baseUrl = this.config.url(Wwebjs.DEFAULT_URL, Wwebjs.NAME);
    // Nama provider ikut diberikan supaya `WHATSAPP_SESSION_Wwebjs`
    // didahulukan — lihat `Config.session()`.
    this.sessionId = this.config.session(Wwebjs.NAME);
  }

  getProvider(): string {
    return Wwebjs.NAME;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  protected authHeaders(): Record<string, string> {
    return { 'x-api-key': this.getToken() };
  }

  /**
   * Nyalakan session: `POST /session/start/{sessionId}`.
   *
   * wwebjs tidak punya pendaftaran session di luar ini — namanya ditentukan
   * pemanggil, dan memanggil endpoint ini untuk nama yang sudah ada berarti
   * menyambungkannya kembali.
   *
   * **Panggilan ini ikut menunggu.** Servernya baru membalas setelah Chromium
   * selesai dimuat, dan itu bisa memakan waktu mendekati batas
   * `WHATSAPP_TIMEOUT` yang bawaannya 10 detik. Naikkan timeout kalau
   * pembuatan session sering berakhir `TimeoutException`.
   *
   * @param options Kunci yang dikenali: `id` (nama session, alias `name`),
   *                `webhookUrl`
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    const sessionId = WwebjsSession.name(options, this.sessionId);

    return WwebjsSession.fromStart(
      await this.postJson(
        this.endpoint('session/start/' + encodeURIComponent(sessionId)),
        WwebjsSession.payload(options),
      ),
      sessionId,
    );
  }

  /**
   * Baca keadaan session: `GET /session/status/{sessionId}`.
   *
   * @param id Session yang diperiksa; default dari konfigurasi.
   */
  async checkSession(id?: string | null): Promise<Session> {
    const sessionId = this.requireConfigured(id ?? this.sessionId, 'WHATSAPP_SESSION');

    return WwebjsSession.fromStatus(
      await this.getJson(this.endpoint('session/status/' + encodeURIComponent(sessionId))),
      sessionId,
    );
  }

  /**
   * Ambil QR session: `GET /session/qr/{sessionId}/image`.
   *
   * wwebjs menyediakan QR dalam dua bentuk — teks isinya
   * (`/session/qr/{id}`) dan gambarnya (`/session/qr/{id}/image`). Yang
   * dipakai di sini adalah gambarnya, karena hanya itu yang bisa langsung
   * dipasang di atribut `src` tanpa merender ulang QR-nya.
   *
   * Saat QR-nya tidak ada, endpoint yang sama menjawab JSON
   * `{success:false, message:...}` alih-alih PNG. Dua di antaranya adalah
   * keadaan biasa: session belum selesai dimuat, dan QR-nya sudah dipindai.
   * Yang terakhir dibedakan dengan menanyakan status session — sekali saja,
   * dan hanya di jalur itu — supaya sesi yang sudah tersambung dilaporkan
   * sebagai `connected` tanpa QR, bukan sebagai kegagalan.
   *
   * @param id Session yang diminta QR-nya; default dari konfigurasi.
   */
  async showQr(id?: string | null): Promise<Session> {
    const sessionId = this.requireConfigured(id ?? this.sessionId, 'WHATSAPP_SESSION');

    const response = await this.http.get(
      this.endpoint('session/qr/' + encodeURIComponent(sessionId) + '/image'),
      this.authHeaders(),
    );

    const body = this.read(response);

    if (!response.isSuccess()) {
      this.reject(response, body);
    }

    // Body JSON di jalur ini berarti QR-nya memang tidak ada — bukan gambar
    // yang gagal di-decode. `read()` mengembalikan null untuk PNG.
    if (body !== null) {
      if (
        WwebjsShowQr.isAlreadyScanned(body) &&
        (await this.checkSession(sessionId)).isConnected()
      ) {
        return WwebjsShowQr.alreadyConnected(body, sessionId);
      }

      this.reject(response, body);
    }

    return WwebjsShowQr.fromImage(response.body ?? '', sessionId);
  }

  /**
   * Kirim pesan lewat wwebjs.
   *
   * wwebjs tidak punya endpoint batch, jadi beberapa pesan dikirim satu per
   * satu. Jeda antar pesan dihormati lewat kunci `delay` atau, bila tidak
   * diisi, lewat pacing (`WHATSAPP_PACING_*`), sehingga mengirim banyak pesan
   * MEMBLOKIR pemanggil selama total jeda itu.
   */
  async sendMessage(message: MessageInput): Promise<string> {
    return this.sendIndividually(
      message,
      (items) => this.build(items),
      (msg) => this.sendText(msg),
      (msg) => msg.chatId,
    );
  }

  /**
   * Susun item `plan()` menjadi pesan Wwebjs.
   *
   * Session diperiksa di sini, bukan di `sendMessage()`, supaya jalurnya sama
   * dengan provider lain: `sendIndividually()` memanggil `build()` tepat sekali
   * sebelum ada request apa pun.
   */
  private build(items: PlannedMessage[]): PreparedMessage<WwebjsMessage>[] {
    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    return this.buildItems(
      items,
      (item) => WwebjsMessage.text(item.destination, item.message),
      (message) => message.chatId,
    );
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik".
   *
   * wwebjs memakai endpoint berbeda untuk tiap keadaan — bukan satu endpoint
   * dengan kolom status seperti gateway lain:
   *
   * - `POST /chat/sendStateTyping/{sessionId}`
   * - `POST /chat/sendStateRecording/{sessionId}`
   * - `POST /chat/clearState/{sessionId}` — untuk berhenti
   *
   * Tidak ada kolom durasi: indikatornya bertahan sekitar 25 detik di sisi
   * server, atau sampai dihapus. Jadi `duration` di sini hanya menentukan
   * berapa lama SDK menunggu sebelum pesannya dikirim — lihat
   * `AbstractProvider.announceTyping()`.
   */
  protected async sendPresence(destination: string, presence: Presence): Promise<string> {
    const sessionId = this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');
    const chatId = WwebjsMessage.chatIdFor(destination);

    if (chatId === '') {
      throw new ConfigurationException(`Nomor tujuan '${destination}' tidak valid`);
    }

    const path = presence.isRecording()
      ? 'chat/sendStateRecording'
      : presence.isPaused()
        ? 'chat/clearState'
        : 'chat/sendStateTyping';

    await this.postJson(this.endpoint(`${path}/` + encodeURIComponent(sessionId)), { chatId });

    return this.presenceResult(presence, chatId);
  }

  /**
   * Kirim satu berkas lewat wwebjs.
   *
   * Gambar dan dokumen memakai endpoint yang sama dengan teks; yang
   * membedakan hanya `contentType` di dalam payload — lihat
   * `WwebjsMessage.media()`. Jenis berkasnya yang menentukan gambar atau
   * dokumen, bukan method yang dipanggil pemanggil.
   */
  protected async sendMedia(destination: string, file: File, caption: string): Promise<string> {
    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    const message = WwebjsMessage.media(destination, file, caption);

    if (message.chatId === '') {
      throw new ConfigurationException(`Nomor tujuan '${destination}' tidak valid`);
    }

    return this.sent(await this.send(message.toArray()));
  }

  /** `POST /client/sendMessage/{sessionId}` untuk satu pesan teks. */
  private async sendText(message: WwebjsMessage): Promise<string> {
    return this.sent(await this.send(message.toArray()));
  }

  /** Satu-satunya endpoint pengiriman wwebjs. */
  private send(payload: WwebjsPayload): Promise<JsonObject> {
    return this.postJson(
      this.endpoint('client/sendMessage/' + encodeURIComponent(this.sessionId)),
      payload,
    );
  }

  /**
   * Terjemahkan balasan pengiriman menjadi string hasil.
   *
   * Balasannya `{"success":true,"message":{...Message}}`; id pesannya ada di
   * `message.id._serialized`, dan sebagian versi hanya mengisi `message.id.id`.
   */
  private sent(body: JsonObject): string {
    const message = isArrayLike(body['message']) ? body['message'] : {};
    const id = isArrayLike(message['id']) ? message['id'] : {};

    return (
      'Sukses, messageId: ' +
      (Text.first(id['_serialized'] ?? null, id['id'] ?? null) || '-')
    );
  }

  /** URL endpoint di bawah base URL instance. */
  private endpoint(path: string): string {
    return `${this.baseUrl}/${path}`;
  }

  /**
   * Amplop error wwebjs: `{"success":false,"error":"..."}` dengan status HTTP
   * yang sesuai (lihat `sendErrorResponse` di `src/utils.js`).
   *
   * Dua keadaan punya arti khusus yang layak dijelaskan di log, karena
   * "Not Found" dari middleware `sessionValidation` tidak menyebut session
   * sama sekali — ia hanya mengirim `session_not_found` atau
   * `session_not_connected` di kolom `error`.
   */
  protected describe(status: number, body: JsonObject | null): string {
    const detail = this.detail(body);

    const konteks =
      status === 403
        ? 'API key salah, cek WHATSAPP_TOKEN'
        : detail.includes('session_not_found')
          ? 'session belum dibuat, cek WHATSAPP_SESSION'
          : detail.includes('session_not_connected')
            ? 'session belum tersambung, pindai QR-nya lebih dulu'
            : status === 422
              ? 'nama session hanya boleh huruf, angka, garis bawah, dan tanda minus'
              : '';

    const pesan = super.describe(status, body);

    return konteks === '' ? pesan : `${pesan} [${konteks}]`;
  }
}
