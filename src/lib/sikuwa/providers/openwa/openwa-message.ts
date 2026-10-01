import { PhoneNumber } from '../../support/phone-number';

/**
 * Satu pesan teks OpenWA setelah nomor tujuannya menjadi WID.
 *
 * Ditulis sebagai `type`, bukan `interface`, dan itu bukan pilihan gaya:
 * hanya type alias yang mendapat *implicit index signature*, sehingga hasilnya
 * bisa diteruskan ke `postJson()` yang menuntut `Record<string, unknown>`.
 * Sebuah `interface` dengan bentuk yang sama persis akan ditolak TypeScript.
 */
export type OpenWATextPayload = {
  chatId: string;
  text: string;
};

/** Satu pesan teks OpenWA dalam bentuk yang diminta endpoint `send-bulk`. */
export type OpenWABulkItem = {
  chatId: string;
  type: string;
  content: { text: string };
};

/**
 * Satu pesan teks untuk OpenWA.
 *
 * Nomor tujuan dinormalisasi menjadi WID (mis. `"6281234567890@c.us"`) karena
 * OpenWA menolak nomor mentah. Normalisasi ini terjadi di konstruktor, bukan
 * saat payload disusun, supaya nomor yang tidak bisa dibaca ketahuan sebelum
 * ada request apa pun dikirim.
 *
 * `chatId` sengaja **tidak** dijadikan readonly: pemanggil yang menyusun objek
 * ini langsung boleh memperbaikinya, sama seperti properti publik di PHP.
 */
export class OpenWAMessage {
  static readonly MAX_LENGTH = 4096;

  chatId: string;

  readonly message: string;

  constructor(destination: string, message: string) {
    this.chatId = PhoneNumber.toWid(destination);
    this.message = message;
  }

  /** Payload untuk `POST .../messages/send-text`. */
  toArray(): OpenWATextPayload {
    return {
      chatId: this.chatId,
      text: truncate(this.message, OpenWAMessage.MAX_LENGTH),
    };
  }

  /** Payload untuk satu item di dalam `POST .../messages/send-bulk`. */
  toBulkItem(): OpenWABulkItem {
    return {
      chatId: this.chatId,
      type: 'text',
      content: { text: truncate(this.message, OpenWAMessage.MAX_LENGTH) },
    };
  }
}

/**
 * `mb_substr($value, 0, $limit)` PHP — memotong menurut **karakter**, bukan
 * byte, sehingga emoji dan huruf beraksen tidak terbelah di tengah.
 *
 * Memakai `[...value]` dan bukan `value.slice()`: `slice()` bekerja atas unit
 * UTF-16, jadi satu emoji di luar BMP terhitung dua dan hasil potongannya bisa
 * berakhir dengan setengah pasangan surrogate.
 */
function truncate(value: string, limit: number): string {
  return [...value].slice(0, limit).join('');
}
