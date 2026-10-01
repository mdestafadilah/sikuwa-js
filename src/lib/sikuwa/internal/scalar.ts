/**
 * Penolong tipe longgar, meniru semantik PHP yang diandalkan porting ini.
 *
 * Nilai konfigurasi SIKUWA datang dari `.env` (selalu string) atau dari array
 * opsi pemanggil (bisa apa saja). Versi PHP menyerahkan penafsirannya ke
 * `is_numeric()`, `(int)`, `filter_var(..., FILTER_VALIDATE_BOOLEAN)`, dan
 * `is_scalar()` — dan perilaku itulah yang harus bertahan di sini, karena
 * berkas `.env` pengguna lama harus tetap terbaca sama.
 *
 * Modul ini sengaja tidak ikut diekspor dari `index.ts`: ia bagian dalam,
 * bukan permukaan API.
 */

/** `is_scalar()` PHP: string, angka, dan boolean — bukan null/array/objek. */
export function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** `(string) $value` PHP untuk nilai skalar; nilai lain menjadi string kosong. */
export function toScalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '';
  return '';
}

/** Sama seperti {@link toScalarString}, lalu dibuang spasi di kedua ujungnya. */
export function trimmedScalar(value: unknown): string {
  return toScalarString(value).trim();
}

/**
 * `is_numeric()` PHP.
 *
 * Menerima spasi di ujung, tanda, desimal, dan eksponen — tetapi tidak
 * menerima pengenal heksadesimal maupun pemisah ribuan, sama seperti PHP.
 */
export function isNumeric(value: unknown): boolean {
  // PHP `is_numeric(true)` bernilai salah walaupun `(string) true` bernilai
  // '1'. Perbedaan itu nyata: pemanggil yang menulis `duration: true` harus
  // ditolak sebagai bukan angka, bukan diterima sebagai satu detik.
  if (typeof value === 'boolean') return false;

  const text = trimmedScalar(value);
  if (text === '') return false;
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text);
}

/** `(int)` PHP: memotong ke arah nol; nilai tak terbaca menjadi 0. */
export function toInt(value: unknown): number {
  if (!isNumeric(value)) return 0;
  return Math.trunc(Number(trimmedScalar(value)));
}

/** `(float)` PHP: nilai tak terbaca menjadi 0, bukan NaN. */
export function toFloat(value: unknown): number {
  if (!isNumeric(value)) return 0;
  const parsed = Number(trimmedScalar(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `filter_var($value, FILTER_VALIDATE_BOOLEAN)` PHP.
 *
 * Hanya `1`, `true`, `on`, dan `yes` yang berarti benar — sisanya salah,
 * termasuk angka selain satu dan teks tak dikenal. Sengaja tidak memakai
 * `Boolean()` JavaScript, yang menganggap `"0"` dan `"false"` sebagai benar.
 */
export function validateBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;

  const text = value.trim().toLowerCase();

  return text === '1' || text === 'true' || text === 'on' || text === 'yes';
}

/** `random_int($min, $max)` PHP: bilangan bulat pada rentang tertutup. */
export function randomInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** `intdiv($a, $b)` PHP. */
export function intdiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** `get_debug_type()` PHP seadanya, dipakai menyusun pesan exception. */
export function debugType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') {
    const name = (value as { constructor?: { name?: string } }).constructor
      ?.name;
    return name && name !== 'Object' ? name : 'stdClass';
  }
  return typeof value;
}

/** `array_key_exists($key, $spec)` PHP — kunci bernilai null tetap terhitung ada. */
export function hasKey(spec: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(spec, key);
}

/**
 * `is_array()` PHP.
 *
 * Mencakup daftar **maupun** peta berkunci teks — di PHP keduanya array yang
 * sama, dan banyak pemeriksaan di SDK ini bertumpu pada persamaan itu
 * (`is_array($message['messages'])`, `is_array($body['data'])`).
 */
export function isArrayLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `empty()` PHP.
 *
 * Perhatikan bedanya dengan `Boolean()` JavaScript: `'0'` dianggap **kosong**,
 * sedangkan `'0.0'` dan `'false'` tidak — persis seperti PHP. Array dan objek
 * kosong juga kosong, karena `json_decode(..., true)` di PHP mengubah keduanya
 * menjadi array yang sama.
 *
 * Dipakai di tempat versi PHP-nya memeriksa keberhasilan dengan `empty()` —
 * mis. amplop Fonnte yang menandai sukses lewat `status`.
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value === false) return true;
  if (value === 0 || value === '0' || value === '') return true;
  if (isArrayLike(value)) return Object.keys(value).length === 0;

  return false;
}

/**
 * Kebenaran gaya PHP.
 *
 * Bukan `Boolean()` JavaScript — `'0'` dan `'false'` di sini benar, sedangkan
 * `''` dan `[]` salah. Dipakai saat gateway menuntut flag teks `"true"`/
 * `"false"` dari nilai yang datang apa adanya dari pemanggil.
 */
export function toPhpBool(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '' && value !== '0';

  // Objek dan array kosong dianggap salah, karena `json_decode(..., true)`
  // di PHP mengubah keduanya menjadi array kosong yang sama.
  if (isArrayLike(value)) return Object.keys(value).length > 0;

  return true;
}
