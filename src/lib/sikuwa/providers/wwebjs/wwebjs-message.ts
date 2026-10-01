import type { File } from '../../support/file';
import { PhoneNumber } from '../../support/phone-number';

/**
 * Payload untuk `POST /client/sendMessage/{sessionId}`.
 *
 * Ditulis sebagai `type`, bukan `interface`, dan itu bukan pilihan gaya:
 * hanya type alias yang mendapat *implicit index signature*, sehingga hasilnya
 * bisa diteruskan ke `postJson()` yang menuntut `Record<string, unknown>`.
 * Sebuah `interface` dengan bentuk yang sama persis akan ditolak TypeScript.
 */
export type WwebjsPayload = {
  chatId: string;
  contentType: string;
  content: unknown;
  options?: Record<string, unknown>;
};

/**
 * Satu pesan untuk wwebjs.
 *
 * Berbeda dari gateway lain, wwebjs tidak punya endpoint terpisah per jenis
 * pesan: semuanya lewat `POST /client/sendMessage/{sessionId}`, dan yang
 * membedakan adalah kolom `contentType` —
 *
 * - `string` untuk teks biasa;
 * - `MessageMedia` untuk berkas yang ikut dikirim, berisi
 *   `{mimetype, data, filename}`;
 * - `MessageMediaFromURL` untuk berkas yang diunduh server wwebjs sendiri.
 *
 * Tujuan wajib berupa JID lengkap (`6281234567890@c.us`), sama seperti OpenWA.
 * JID grup (`...@g.us`) diteruskan apa adanya.
 */
export class WwebjsMessage {
  private constructor(
    readonly chatId: string,
    readonly contentType: string,
    /** Isi pesan: teks, atau objek media — bentuknya ditentukan `contentType`. */
    readonly content: unknown,
    /** Opsi pengiriman whatsapp-web.js; kosong berarti memang tidak ada. */
    readonly options: Record<string, unknown> = {},
  ) {}

  /** Pesan teks biasa. */
  static text(destination: string, message: string): WwebjsMessage {
    return new WwebjsMessage(WwebjsMessage.chatIdFor(destination), 'string', message);
  }

  /**
   * Pesan bermedia, dengan caption opsional.
   *
   * Caption dititipkan di `options.caption`, bukan dijadikan isi pesan:
   * itulah kolom yang diteruskan whatsapp-web.js sebagai keterangan berkas.
   * Satu berkas berteks pengantar tetap satu request.
   */
  static media(destination: string, file: File, caption = ''): WwebjsMessage {
    const options: Record<string, unknown> = caption === '' ? {} : { caption };

    if (file.isUrl()) {
      return new WwebjsMessage(
        WwebjsMessage.chatIdFor(destination),
        'MessageMediaFromURL',
        file.payload,
        options,
      );
    }

    return new WwebjsMessage(
      WwebjsMessage.chatIdFor(destination),
      'MessageMedia',
      {
        mimetype: file.mime,
        // whatsapp-web.js menerima base64 mentah, bukan data URI.
        data: file.base64(),
        filename: file.filename,
      },
      options,
    );
  }

  /**
   * Tujuan sebagai JID, atau string kosong bila nomornya tidak bisa dibaca.
   *
   * Berbeda dari `PhoneNumber.toWid()` yang tetap membentuk `@c.us` walau
   * nomornya kosong: di sini kekosongan itu justru yang penting, karena
   * itulah yang membuat pemanggil tahu tujuannya tidak valid sebelum ada
   * request yang terkirim. `@c.us` telanjang akan ditolak server dengan pesan
   * yang tidak menjelaskan apa-apa.
   */
  static chatIdFor(destination: string): string {
    const wid = PhoneNumber.toWid(destination);

    return wid.startsWith('@') ? '' : wid;
  }

  /** Payload untuk `POST /client/sendMessage/{sessionId}`. */
  toArray(): WwebjsPayload {
    const payload: WwebjsPayload = {
      chatId: this.chatId,
      contentType: this.contentType,
      content: this.content,
    };

    // `options` sengaja tidak ikut kalau kosong: whatsapp-web.js menimpa
    // bawaannya dengan apa pun yang dikirim, termasuk objek kosong.
    if (Object.keys(this.options).length > 0) {
      payload.options = this.options;
    }

    return payload;
  }
}
