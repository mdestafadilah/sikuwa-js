import type { Config, ConfigOptions } from '../../config';
import type { MessageInput } from '../../contracts/whatsapp';
import { ApiException, ConfigurationException } from '../../exceptions';
import type { HttpExecutor } from '../../http/http-executor';
import { isArrayLike, toInt, toScalarString } from '../../internal/scalar';
import type { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { File } from '../../support/file';
import type { Presence } from '../../support/presence';
import {
  AbstractProvider,
  type PlannedMessage,
  type PreparedMessage,
} from '../abstract-provider';
import { WUZAPI_DEFAULT_URL, WUZAPI_NAME } from './constants';
import { WuzapiMessage } from './wuzapi-message';
import { WuzapiSession } from './wuzapi-session';
import { WuzapiShowQr } from './wuzapi-show-qr';

/**
 * Gateway wuzapi (https://github.com/asternic/wuzapi), WhatsApp self-hosted
 * berbasis Go + WhatsMeow.
 *
 * Konfigurasi:
 *   WHATSAPP_PROVIDER = Wuzapi
 *   WHATSAPP_TOKEN    = token milik user/sesi (header `Token`)
 *   WHATSAPP_URL_Wuzapi = base URL instance, mis. https://v4.example.com
 *                         (`WHATSAPP_URL` juga dibaca sebagai fallback umum)
 *
 * Tidak butuh `WHATSAPP_INSTANCE`: tokennya sendiri yang menentukan sesi
 * WhatsApp mana yang dipakai, jadi URL-nya tanpa id instance.
 *
 * Catatan: README wuzapi menyebut endpoint user memakai header
 * `Authorization`. Kodenya tidak demikian — `authalice()` membaca header
 * `token`, sedangkan `Authorization` hanya dibaca `authadmin()` untuk endpoint
 * `/admin`. Yang dipakai di sini adalah yang sesuai kode.
 */
export class Wuzapi extends AbstractProvider {
  static readonly NAME = WUZAPI_NAME;

  static readonly DEFAULT_URL = WUZAPI_DEFAULT_URL;

  private readonly baseUrl: string;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    super(options, http);

    this.baseUrl = this.config.url(Wuzapi.DEFAULT_URL, Wuzapi.NAME);
  }

  getProvider(): string {
    return Wuzapi.NAME;
  }

  protected authHeaders(): Record<string, string> {
    return { Token: this.getToken() };
  }

  /**
   * Sambungkan sesi: `POST /session/connect`.
   *
   * wuzapi tidak punya id sesi — token yang terpasang sudah menentukan sesi
   * mana yang dipakai, jadi tidak ada nama yang perlu dikirim. Bila sesi
   * belum pernah dipindai, wuzapi mulai menghasilkan QR; pantau kesiapannya
   * dengan {@link checkSession}.
   *
   * Kunci `options` yang dikenali: `subscribe` (list jenis event), `immediate`
   * (bool).
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    const body = await this.postJson(
      `${this.baseUrl}/session/connect`,
      WuzapiSession.payload(options),
    );

    return WuzapiSession.fromConnect(this.requireSuccess(body));
  }

  /**
   * Baca keadaan sesi: `GET /session/status`.
   *
   * @param _id Diabaikan: wuzapi tidak mengenal id sesi, token yang terpasang
   *            sudah menentukan sesinya. Diterima supaya tanda tangannya sama
   *            dengan gateway lain.
   */
  async checkSession(_id?: string | null): Promise<Session> {
    const body = await this.getJson(`${this.baseUrl}/session/status`);

    return WuzapiSession.fromStatus(this.requireSuccess(body));
  }

  /**
   * Ambil QR sesi: `GET /session/qr`.
   *
   * wuzapi hanya mengeluarkan QR saat sesinya tersambung ke server WhatsApp
   * tetapi belum login. Ketiga penolakannya dibedakan di sini supaya
   * pemanggil tidak perlu mencocokkan pesan teks: `already logged in`
   * dilaporkan sebagai sesi `connected` tanpa QR — memang tidak ada lagi yang
   * perlu dipindai — sedangkan `no session` dan `not connected` adalah
   * kegagalan sungguhan dan tetap dilempar.
   *
   * @param _id Diabaikan, seperti di {@link checkSession}.
   */
  async showQr(_id?: string | null): Promise<Session> {
    const response = await this.http.get(`${this.baseUrl}/session/qr`, this.authHeaders());
    const body = this.read(response);

    // Diperiksa sebelum amplopnya ditolak: wuzapi melaporkan "sudah login"
    // sebagai error HTTP, padahal bagi pemanggil itu keadaan, bukan gagal.
    if (body !== null && WuzapiShowQr.isAlreadyLoggedIn(body)) {
      return WuzapiShowQr.alreadyLoggedIn(body);
    }

    if (!response.isSuccess()) {
      this.reject(response, body);
    }

    return WuzapiShowQr.fromResponse(
      this.requireSuccess(this.requireJson(body, response.status), response.status),
    );
  }

  /**
   * Kirim pesan lewat wuzapi.
   *
   * wuzapi tidak punya endpoint batch, jadi beberapa pesan dikirim satu per
   * satu. Jeda antar pesan dihormati lewat kunci `delay` atau, bila tidak
   * diisi, lewat pacing (`WHATSAPP_PACING_*`), sehingga mengirim banyak
   * pesan menahan pemanggil selama total jeda itu. Halaman scan hanya
   * mengirim satu pesan.
   */
  async sendMessage(message: MessageInput): Promise<string> {
    return this.sendIndividually(
      message,
      (items) => this.build(items),
      (msg) => this.sendText(msg),
      (msg) => msg.phone,
    );
  }

  /** Susun item `plan()` menjadi pesan wuzapi. */
  private build(items: PlannedMessage[]): PreparedMessage<WuzapiMessage>[] {
    return this.buildItems(
      items,
      (item) => new WuzapiMessage(item.destination, item.message),
      (message) => message.phone,
    );
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik": `POST /chat/presence`.
   *
   * wuzapi tidak punya keadaan "recording" tersendiri: merekam suara
   * dikirim sebagai `composing` dengan `Media` berisi `audio`. `duration`
   * tidak ikut dikirim — statusnya bertahan sampai dihapus dengan `paused`.
   */
  protected async sendPresence(destination: string, presence: Presence): Promise<string> {
    const phone = this.target(destination);

    await this.postChat('chat/presence', {
      Phone: phone,
      State: presence.isPaused() ? 'paused' : 'composing',
      // Penanda rekaman suara; string kosong berarti pesan teks biasa.
      Media: presence.isRecording() ? 'audio' : '',
    });

    return this.presenceResult(presence, phone);
  }

  /** `POST /chat/send/text` */
  private async sendText(message: WuzapiMessage): Promise<string> {
    const body = await this.sendJson('text', message.toArray());
    const data = isArrayLike(body['data']) ? body['data'] : {};

    return `Sukses, messageId: ${toScalarString(data['Id'] ?? '-')}`;
  }

  /**
   * Kirim satu berkas lewat wuzapi.
   *
   * Ada dua endpoint terpisah — `image` dan `document` — dan keduanya hanya
   * menerima data URI, bukan URL publik: wuzapi tidak mengunduh apa pun
   * sendiri. Isi yang datang sebagai base64 telanjang dibungkus lebih dulu
   * oleh `File.dataUri()`, jadi yang berangkat ke gateway selalu data URI.
   *
   * Dokumen diminta sebagai `octet-stream` apa pun jenis aslinya, jadi jenis
   * berkasnya tidak diteruskan ke sana — inilah satu-satunya tempat di SDK ini
   * yang sengaja membuang jenis berkas yang sudah dikenali `File`.
   */
  protected async sendMedia(
    destination: string,
    file: File,
    caption: string,
  ): Promise<string> {
    if (file.isUrl()) {
      throw new ConfigurationException(
        'wuzapi hanya menerima isi berkas sebagai data URI, bukan URL: ' +
          'unduh berkasnya lebih dulu, lalu kirim isinya sebagai base64 atau data URI',
      );
    }

    const phone = this.target(destination);

    let body: JsonObject;

    if (file.isImage()) {
      const payload: Record<string, unknown> = { Phone: phone, Image: file.dataUri() };

      if (caption !== '') {
        payload['Caption'] = caption;
      }

      body = await this.sendJson('image', payload);
    } else {
      body = await this.sendJson('document', {
        Phone: phone,
        FileName: file.filename,
        // Dokumentasi wuzapi meminta dokumen dikirim sebagai
        // octet-stream, bukan sebagai jenis berkas sebenarnya.
        Document: `data:${File.DEFAULT_MIME};base64,${file.base64()}`,
      });
    }

    const data = isArrayLike(body['data']) ? body['data'] : {};

    return `Sukses, messageId: ${toScalarString(data['Id'] ?? '-')}`;
  }

  /**
   * POST JSON ke `/chat/send/<jenis>`, lalu wajibkan penanda `success`.
   *
   * Dipakai bersama pengiriman teks dan berkas: keduanya memakai amplop yang
   * sama, dan wuzapi membalas HTTP 200 bahkan saat gagal.
   */
  private sendJson(kind: string, payload: Record<string, unknown>): Promise<JsonObject> {
    return this.postChat(`chat/send/${kind}`, payload);
  }

  /**
   * POST JSON ke jalur mana pun di bawah `/chat`, lalu wajibkan `success`.
   *
   * Dipisahkan dari {@link sendJson} karena indikator ketik tidak berada di
   * bawah `/chat/send` melainkan di `/chat/presence`, sementara amplop
   * balasan dan cara menolaknya sama persis.
   *
   * Ditulis tangan, bukan lewat `postJson()` milik kelas dasar, justru karena
   * `requireSuccess()` butuh status HTTP sebagai cadangan saat amplopnya tidak
   * menyebut `code` — dan `postJson()` menelan status itu.
   */
  private async postChat(path: string, payload: Record<string, unknown>): Promise<JsonObject> {
    const response = await this.http.post(
      `${this.baseUrl}/${path}`,
      JSON.stringify(payload),
      this.jsonHeaders(),
    );

    const body = this.read(response);

    if (!response.isSuccess()) {
      this.reject(response, body);
    }

    return this.requireSuccess(this.requireJson(body, response.status), response.status);
  }

  /**
   * wuzapi membalas HTTP 200 pada hampir semua jalur, termasuk yang gagal.
   * Amplopnya sendiri punya penanda `success` yang lebih dipercaya, jadi
   * inilah yang diperiksa — bukan status HTTP-nya.
   */
  private requireSuccess(body: JsonObject, fallbackStatus = 0): JsonObject {
    if (body['success'] !== true) {
      const status = toInt(body['code'] ?? fallbackStatus);

      throw ApiException.classify(
        status,
        this.describe(status, body),
        body,
        this.kind(body),
      );
    }

    return body;
  }

  /**
   * Amplop error wuzapi: `{"code":N,"error":"...","success":false}`
   * (lihat `server.Respond` di handlers.go).
   */
  protected describe(status: number, body: JsonObject | null): string {
    const detail = this.detail(body);

    const konteks =
      status === 401
        ? 'token salah, cek WHATSAPP_TOKEN'
        : detail.includes('no session')
          ? 'sesi WhatsApp belum tersambung, scan QR di /login'
          : '';

    const pesan = super.describe(status, body);

    return konteks === '' ? pesan : `${pesan} [${konteks}]`;
  }
}
