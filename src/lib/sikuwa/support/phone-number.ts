/**
 * Normalisasi nomor HP Indonesia ke format internasional tanpa tanda plus,
 * mis. "0812-3456-7890" / "+62 812 3456 7890" => "6281234567890".
 */
export class PhoneNumber {
  static readonly COUNTRY_CODE = '62';

  static normalize(number: string): string {
    // buang spasi, strip, kurung, titik, dan tanda plus
    const digits = number.replace(/\D+/g, '');

    if (digits === '') return '';

    // 0812... => 62812...
    if (digits.startsWith('0')) {
      return PhoneNumber.COUNTRY_CODE + digits.slice(1);
    }

    // 62812... sudah benar
    if (digits.startsWith(PhoneNumber.COUNTRY_CODE)) {
      return digits;
    }

    // 812... (tanpa awalan apa pun) => 62812...
    if (digits.startsWith('8')) {
      return PhoneNumber.COUNTRY_CODE + digits;
    }

    // nomor luar negeri atau format tak dikenal: biarkan apa adanya
    return digits;
  }

  /**
   * Ubah nomor menjadi WhatsApp ID perorangan (WID), mis. "6281234567890@c.us".
   * Nomor yang sudah berupa JID/WID (mengandung "@") dikembalikan apa adanya.
   */
  static toWid(number: string): string {
    if (number.includes('@')) return number;

    return PhoneNumber.normalize(number) + '@c.us';
  }
}
