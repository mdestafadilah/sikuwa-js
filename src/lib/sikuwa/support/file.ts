import { ConfigurationException } from '../exceptions';

/**
 * Satu berkas media yang siap dikirim, apa pun gateway-nya.
 *
 * Gateway tidak sepakat soal bentuk kiriman berkas — dan tidak ada satu bentuk
 * yang diterima semua. Fonnte menuntut berkasnya diunggah sebagai multipart;
 * OpenWA menerima base64 telanjang dengan `mimetype` terpisah; wuzapi hanya
 * mau data URI; Evolution API justru menolak data URI dan baru menerima base64
 * telanjang. Pemanggil tidak perlu tahu semua itu: ia cukup menyerahkan isi
 * berkas dalam bentuk apa pun yang sudah ia punya — data URI, base64
 * telanjang, atau URL publik — dan kelas ini yang menerjemahkannya ke bentuk
 * yang diminta masing-masing gateway.
 *
 * Jenis berkas ditentukan dari data URI bila ada, sebab data URI membawa
 * jenisnya sendiri dan itu lebih dipercaya daripada nama berkas yang bisa
 * salah tulis; kalau tidak ada, baru dari ekstensi nama berkas. Jenis inilah
 * yang menentukan sebuah berkas dikirim sebagai gambar (muncul dengan
 * pratinjau di WhatsApp) atau sebagai dokumen.
 */
export class File {
  /** Dipakai kalau jenis berkas sama sekali tidak bisa dikenali. */
  static readonly DEFAULT_MIME = 'application/octet-stream';

  /**
   * Batas ukuran media yang diterima WhatsApp, dalam byte (16 MB).
   *
   * Angka ini milik WhatsApp, bukan milik gateway — Fonnte, OpenWA, dan
   * lainnya hanya meneruskan. Karena itu batasnya dipasang di sini sekali,
   * bukan di tujuh provider: berkas yang ditolak WhatsApp akan ditolak sama
   * di gateway mana pun.
   *
   * Sengaja dipakai sebagai peringatan dini, bukan larangan: WhatsApp bisa
   * mengubah batasnya tanpa memberi tahu, jadi SDK memeriksa **di sisi
   * pemanggil** supaya kegagalannya cepat dan jelas, bukan setelah seluruh
   * berkas terunggah.
   */
  static readonly WHATSAPP_MAX_BYTES = 16 * 1024 * 1024;

  /** Penanda awal bagian base64 pada sebuah data URI. */
  private static readonly MARKER = 'base64,';

  /**
   * Ekstensi yang dikenali, sengaja terbatas pada bentuk yang benar-benar
   * dipakai untuk notifikasi. Yang tidak ada di sini tetap bisa dikirim —
   * jenisnya jadi `application/octet-stream`, dan WhatsApp memperlakukannya
   * sebagai dokumen biasa.
   */
  private static readonly MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip',
  };

  /**
   * Kebalikan dari peta di atas, dipakai menyusun nama berkas bawaan saat
   * pemanggil tidak menyebutkan namanya. Satu jenis hanya diwakili satu
   * ekstensi — `jpeg` dan `jpg` sama-sama menjadi `jpg`.
   */
  private static readonly EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'application/zip': 'zip',
  };

  private constructor(
    /** Isi berkas apa adanya: data URI, base64 telanjang, atau URL publik. */
    readonly payload: string,
    /** Nama yang akan dilihat penerima; tidak pernah kosong. */
    readonly filename: string,
    /** Jenis berkas yang sudah disimpulkan dari data URI atau ekstensi. */
    readonly mime: string,
  ) {}

  /**
   * Susun berkas dari isi yang diberikan pemanggil.
   *
   * @param payload  data URI, base64 telanjang, atau URL publik
   * @param filename Opsional; kalau kosong disusun dari jenis berkas
   */
  static from(payload: string, filename = ''): File {
    const trimmedPayload = payload.trim();
    const trimmedFilename = filename.trim();

    if (trimmedPayload === '') {
      throw new ConfigurationException(
        'Isi berkas kosong: kirim data URI, base64 telanjang, atau URL publik ' +
          'lewat kunci media pada pesan',
      );
    }

    // Data URI menang atas nama berkas: isinya sudah menyebut jenisnya
    // sendiri, sedangkan nama berkas bisa saja kosong atau salah ekstensi.
    const mime =
      File.mimeFromDataUri(trimmedPayload) ?? File.mimeFromExtension(trimmedFilename);

    return new File(
      trimmedPayload,
      trimmedFilename === '' ? File.defaultFilename(mime) : trimmedFilename,
      mime,
    );
  }

  /**
   * Apakah isinya URL publik, bukan data yang ikut dikirim.
   *
   * Hanya sebagian gateway yang mau mengunduh sendiri berkas dari URL — yang
   * lain menuntut isinya diunggah — jadi tiap provider perlu bisa
   * membedakannya.
   */
  isUrl(): boolean {
    // Data URI diperiksa lebih dulu: "data:" tidak pernah berupa URL, dan
    // memeriksanya duluan menjaga niat kode ini tetap terbaca.
    return !this.payload.startsWith('data:') && /^https?:\/\//i.test(this.payload);
  }

  /** Gambar dikirim dengan pratinjau; selainnya menjadi dokumen. */
  isImage(): boolean {
    return this.mime.startsWith('image/');
  }

  /**
   * Isi berkas sebagai data URI, siap dipakai gateway yang menuntutnya.
   *
   * Idempoten seperti `Qr.dataUri()`: yang sudah berupa data URI dikembalikan
   * apa adanya, jadi aman dipanggil berkali-kali.
   */
  dataUri(): string {
    if (this.payload.startsWith('data:')) return this.payload;

    return `data:${this.mime};${File.MARKER}${this.payload}`;
  }

  /**
   * Isi berkas sebagai base64 telanjang, tanpa awalan data URI.
   *
   * Dibutuhkan gateway yang memisahkan isi dari jenisnya — OpenWA mengirim
   * `mimetype` di kolom sendiri, dan Evolution API tidak mengenali awalan
   * `data:` sama sekali.
   */
  base64(): string {
    const marker = this.payload.indexOf(File.MARKER);

    return marker === -1 ? this.payload : this.payload.slice(marker + File.MARKER.length);
  }

  /**
   * Isi berkas sebagai byte mentah, untuk gateway yang menuntut unggahan
   * multipart (Fonnte dan ApiMe).
   *
   * Berbeda dari versi PHP yang mengembalikan string biner, di sini hasilnya
   * `Uint8Array` — bentuk yang memang diminta `Blob`/`FormData` di JavaScript,
   * jadi tidak ada penerjemahan tambahan di jalur unggah.
   *
   * @throws ConfigurationException Bila isinya bukan base64 yang sah — mis.
   *         ketika pemanggil menyerahkan URL ke gateway yang tidak bisa
   *         mengunduhnya sendiri
   */
  bytes(): Uint8Array {
    const decoded = File.decodeStrict(this.base64());

    if (decoded === null) {
      throw new ConfigurationException(
        `Isi berkas '${this.filename}' bukan base64 yang sah, dan bukan URL publik`,
      );
    }

    return decoded;
  }

  /**
   * Ukuran isi berkas dalam byte, setelah base64-nya diterjemahkan.
   *
   * Null bila ukurannya memang tidak bisa diketahui: isinya berupa URL publik
   * (yang diunduh gateway, bukan SDK) atau base64 yang rusak. Null di sini
   * berarti "tidak tahu", bukan "nol" — pemanggil yang memeriksa batas ukuran
   * harus memperlakukan keduanya berbeda.
   *
   * Dihitung dari panjang base64, bukan dengan mendekode isinya, supaya berkas
   * 30 MB tidak perlu disalin ke memori hanya untuk ditolak.
   */
  size(): number | null {
    if (this.isUrl()) return null;

    // Spasi dan baris baru diabaikan decoder base64 (base64 MIME membungkus
    // isinya tiap 76 kolom), jadi dibuang sebelum dihitung.
    const clean = this.base64().replace(/\s+/g, '');

    if (clean === '') return null;

    // Base64 meng-encode tiap 3 byte menjadi 4 karakter, dan `=` menandai
    // grup terakhir yang tidak penuh. Karena itu panjangnya dibagi 4 dulu
    // (menghasilkan jumlah grup), baru dikali 3, lalu padding dikurangi --
    // urutan sebaliknya (mengurangi padding dulu, baru dikali) meleset
    // beberapa byte dan nyaris tak terlihat sampai ada berkas yang persis
    // di batas ukuran.
    const padding = clean.length - clean.replace(/=+$/, '').length;

    return Math.trunc(clean.length / 4) * 3 - padding;
  }

  /**
   * Apakah berkas ini melebihi batas ukuran yang diberikan.
   *
   * Ukuran yang tidak diketahui (URL publik, base64 rusak) **tidak** dianggap
   * melebihi batas: menolak berkas yang belum tentu besar akan menggagalkan
   * pengiriman yang sebenarnya sah. Untuk berkas dari URL, tanggung jawab
   * ukurannya ada di pemanggil.
   */
  exceedsLimit(limit: number = File.WHATSAPP_MAX_BYTES): boolean {
    const size = this.size();

    return size !== null && size > limit;
  }

  /** Ukuran yang bisa dibaca manusia, mis. `2.4 MB`. Kosong bila tak diketahui. */
  readableSize(): string {
    const size = this.size();

    if (size === null) return '';

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }

    // Satu angka di belakang koma sampai MB, tanpa desimal untuk byte —
    // "1536 B" lebih terbaca daripada "1.5 KB" saat nilainya kecil.
    return `${unit === 0 ? String(Math.trunc(value)) : numberFormatOneDecimal(value)} ${units[unit]}`;
  }

  /** Jenis berkas yang disebut sebuah data URI, bila isinya memang data URI. */
  private static mimeFromDataUri(payload: string): string | null {
    if (!payload.startsWith('data:')) return null;

    // Bentuknya `data:<mime>;base64,<isi>`. Data URI tanpa `;base64`
    // (`data:text/plain,halo`) juga sah, jadi koma dipakai sebagai cadangan
    // penanda akhir jenis.
    let end = payload.indexOf(';');
    if (end === -1) end = payload.indexOf(',');

    if (end === -1) return null;

    const mime = payload.slice(5, end);

    return mime !== '' ? mime : null;
  }

  private static mimeFromExtension(filename: string): string {
    return File.MIME_BY_EXTENSION[File.extensionOf(filename)] ?? File.DEFAULT_MIME;
  }

  /** Nama berkas bawaan, disusun dari jenisnya supaya penerima tetap tahu isinya. */
  private static defaultFilename(mime: string): string {
    return `lampiran.${File.EXTENSION_BY_MIME[mime] ?? 'bin'}`;
  }

  /**
   * Ekstensi sebuah nama berkas, mengikuti `pathinfo(..., PATHINFO_EXTENSION)`
   * PHP: titik terakhir menentukan, dan berkas tanpa titik tidak punya
   * ekstensi.
   */
  private static extensionOf(filename: string): string {
    const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1);
    const dot = base.lastIndexOf('.');

    if (dot === -1 || dot === base.length - 1) return '';

    return base.slice(dot + 1).toLowerCase();
  }

  /**
   * `base64_decode($payload, true)` PHP: ketat terhadap karakter di luar
   * alfabet base64 maupun padding yang salah, dan mengembalikan null bila
   * isinya tidak sah.
   */
  private static decodeStrict(payload: string): Uint8Array | null {
    const clean = payload.replace(/\s+/g, '');

    if (clean === '') return null;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
    if (clean.length % 4 !== 0) return null;
    if (clean.replace(/=+$/, '').length % 4 === 1) return null;

    try {
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      return bytes;
    } catch {
      return null;
    }
  }
}

/** `number_format($value, 1)` PHP, termasuk pemisah ribuan. */
function numberFormatOneDecimal(value: number): string {
  const [whole, fraction] = value.toFixed(1).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${grouped}.${fraction ?? '0'}`;
}
