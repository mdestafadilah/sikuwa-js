import { PhoneNumber } from '../../support/phone-number';

/**
 * Satu pesan teks Waxum setelah nomor tujuannya disiapkan.
 *
 * Ditulis sebagai `type`, bukan `interface`: hanya type alias yang mendapat
 * *implicit index signature*, sehingga hasilnya bisa diteruskan ke `postJson()`
 * yang menuntut `Record<string, unknown>`.
 */
export type WaxumTextPayload = {
  to: string;
  text: string;
};

/**
 * Satu pesan teks untuk Waxum.
 *
 * Kolom `to` menerima JID lengkap apa adanya, atau nomor polos yang akan
 * diubah Waxum sendiri menjadi `@s.whatsapp.net` lalu ditranslasi ke `@lid`
 * bila kontaknya sudah memakai mode privasi LID. Karena itu nomornya
 * dinormalkan ke format internasional tanpa tanda plus — sama seperti gateway
 * WhatsMeow lainnya di SDK ini.
 *
 * JID yang sudah mengandung `@` sengaja diteruskan apa adanya: menormalkannya
 * akan merusak identitas grup, dan Waxum-lah yang berhak memutuskan
 * terjemahannya.
 */
export class WaxumMessage {
  to: string;

  readonly message: string;

  constructor(destination: string, message: string) {
    this.to = destination.includes('@')
      ? destination
      : PhoneNumber.normalize(destination);
    this.message = message;
  }

  /** Payload untuk `POST /api/v1/sessions/{id}/messages/text`. */
  toArray(): WaxumTextPayload {
    return {
      to: this.to,
      text: this.message,
    };
  }
}
