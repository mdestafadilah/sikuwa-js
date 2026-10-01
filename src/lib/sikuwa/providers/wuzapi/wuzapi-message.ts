import { PhoneNumber } from '../../support/phone-number';

/**
 * Satu pesan teks wuzapi dalam bentuk yang diminta endpoint `chat/send/text`.
 *
 * Ditulis sebagai `type`, bukan `interface`, dan itu bukan pilihan gaya:
 * hanya type alias yang mendapat *implicit index signature*, sehingga hasilnya
 * bisa diteruskan ke `postJson()` yang menuntut `Record<string, unknown>`.
 * Sebuah `interface` dengan bentuk yang sama persis akan ditolak TypeScript.
 */
export type WuzapiTextPayload = {
  Phone: string;
  Body: string;
};

/**
 * Satu pesan teks untuk wuzapi.
 *
 * Kunci payload memakai PascalCase (`Phone`, `Body`) sesuai struct Go-nya.
 * Kolom `Phone` menerima nomor polos — awalan `+` dibuang server — atau JID
 * lengkap yang mengandung `@`, yang diteruskan apa adanya. JID grup tidak
 * boleh dinormalkan: angka di dalamnya bukan nomor telepon, dan memberi
 * awalan negara akan merusak identitasnya.
 *
 * `phone` sengaja **tidak** readonly: pemanggil yang menyusun objek ini
 * langsung boleh memperbaikinya, sama seperti properti publik di PHP.
 */
export class WuzapiMessage {
  phone: string;

  readonly message: string;

  constructor(destination: string, message: string) {
    this.phone = destination.includes('@')
      ? destination
      : PhoneNumber.normalize(destination);
    this.message = message;
  }

  /** Payload untuk `POST /chat/send/text`. */
  toArray(): WuzapiTextPayload {
    return {
      Phone: this.phone,
      Body: this.message,
    };
  }
}
