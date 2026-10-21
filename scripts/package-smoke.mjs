/**
 * Uji asap paket `sikuwa` yang sudah terpasang.
 *
 * Dijalankan dari dalam proyek sementara, terhadap paket hasil `npm pack` —
 * bukan terhadap kode sumber repo ini.
 *
 * **Selalu jalankan dengan Node biasa, bukan Bun.** Bun memaafkan impor relatif
 * tanpa ekstensi; Node tidak. Karena itu skrip ini adalah satu-satunya hal yang
 * benar-benar membuktikan keluaran `build:lib` bisa dipakai — suite tes repo
 * berjalan di Bun dan tidak akan pernah menangkap masalah itu.
 */
import http from "node:http";
import assert from "node:assert/strict";

import {
  ApiMe,
  Client,
  Config,
  EvolutionAPI,
  Fonnte,
  Log,
  NumberCheck,
  OpenWA,
  Pacing,
  PhoneNumber,
  RateLimitException,
  Rotation,
  Typing,
  Waxum,
  Wwebjs,
  Wuzapi,
} from "sikuwa";

const received = [];

const server = http.createServer((req, res) => {
  let body = "";

  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received.push({ method: req.method, url: req.url, headers: req.headers, body });

    res.writeHead(200, { "Content-Type": "application/json" });

    // Satu-satunya endpoint yang bentuk balasannya berbeda: pemeriksaan nomor.
    if (req.url === "/validate") {
      res.end(
        JSON.stringify({
          status: true,
          registered: ["6281234567890"],
          not_registered: ["6289876543210"],
        }),
      );

      return;
    }

    res.end(JSON.stringify({ status: true, detail: "2 pesan terkirim" }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "GAGAL"} ${label}`);

  if (!ok) {
    console.log(`      harap: ${JSON.stringify(expected)}\n      dapat: ${JSON.stringify(actual)}`);
  }
}

try {
  // 1. Seluruh ekspor tingkat atas benar-benar ada.
  //
  // Ketujuh gateway ikut diperiksa, bukan hanya yang kebetulan dipakai di
  // bawah: inilah satu-satunya tempat yang membuktikan tiap provider benar
  // benar ter-ekspor dan modulnya bisa dimuat Node biasa. Sebuah provider yang
  // lupa didaftarkan di `index.ts` akan lolos dari seluruh tes repo, karena
  // tes repo mengimpornya langsung dari berkasnya, bukan dari permukaan paket.
  // `Client` ada di daftar ini karena ia titik masuk utama paket.
  for (const [name, value] of Object.entries({
    Client,
    Config,
    Fonnte,
    OpenWA,
    ApiMe,
    EvolutionAPI,
    Wuzapi,
    Wwebjs,
    Waxum,
    Pacing,
    PhoneNumber,
    Typing,
    NumberCheck,
    Rotation,
    Log,
  })) {
    check(`ekspor ${name}`, typeof value, "function");
  }

  check(
    "exception bisa dipakai instanceof",
    RateLimitException.prototype instanceof Error,
    true,
  );

  // 2. Kirim sungguhan ke server lokal.
  const config = new Config({
    url: `http://127.0.0.1:${port}/send`,
    tokens: { Fonnte: "token-uji" },
    pacing: { cycle: "0,30" },
  });

  const fonnte = new Fonnte(config);

  check(
    "hasil kirim",
    await fonnte.sendMessage([
      { destination: "081234567890", message: "Halo!" },
      { destination: "081298765432", message: "Pesan kedua." },
    ]),
    "Sukses: 2 pesan terkirim",
  );

  const sends = received.filter((item) => item.url === "/send");
  const send = sends[0];

  check("tepat satu request ke /send", sends.length, 1);
  check("metode POST", send?.method, "POST");
  check("header Authorization", send?.headers["authorization"], "token-uji");
  check(
    "content-type form-urlencoded",
    send?.headers["content-type"],
    "application/x-www-form-urlencoded",
  );

  // 3. Isi payload mengikuti aturan pacing.
  const batch = JSON.parse(new URLSearchParams(send.body).get("data"));

  check("batch berisi dua pesan", batch.length, 2);
  check(
    "target diteruskan apa adanya",
    batch.map((line) => line.target),
    ["081234567890", "081298765432"],
  );
  check(
    "isi pesan",
    batch.map((line) => line.message),
    ["Halo!", "Pesan kedua."],
  );
  // Siklus `0,30`: pesan pertama tanpa jeda, kedua 30 detik, dikirim sebagai string.
  check(
    "jeda dari siklus",
    batch.map((line) => line.delay),
    ["0", "30"],
  );

  // 4. Konfigurasi dari environment juga jalan.
  process.env["WHATSAPP_TOKEN_Fonnte"] = "token-dari-env";

  check("token dari environment", new Fonnte().getToken(), "token-dari-env");

  // 5. Utilitas murni ikut terbawa utuh.
  check("PhoneNumber.normalize", PhoneNumber.normalize("0812-3456-7890"), "6281234567890");
  check("Pacing.fromArray", Pacing.fromArray({ cycle: "0,30" }).delayFor(1, 10), 30);

  // 6. `Client` — titik masuk utama — benar-benar mengirim lewat paket ini.
  //
  // Dijalankan dengan `provider: 'auto'` supaya sekaligus membuktikan pemilihan
  // gateway bekerja di Node biasa, bukan hanya di dalam tes repo.
  const client = new Client({
    provider: "auto",
    url: `http://127.0.0.1:${port}/client`,
    tokens: { Fonnte: "token-client" },
  });

  check("Client memilih gateway dari token yang ada", client.providerName(), "Fonnte");
  check("Client.providers memuat tujuh gateway", Object.keys(Client.providers()).length, 7);
  check(
    "Client.configured",
    Client.configured({ tokens: { Fonnte: "x", OpenWA: "y" } }),
    ["Fonnte", "OpenWA"],
  );
  check(
    "Client.send",
    await client.send({ destination: "081234567890", message: "Lewat Client" }),
    "Sukses: 2 pesan terkirim",
  );

  const viaClient = received.find((item) => item.url === "/client");

  check("Client memakai URL yang dikonfigurasi", viaClient?.method, "POST");
  check("Client memakai token per-provider", viaClient?.headers["authorization"], "token-client");

  // 7. Pemeriksaan nomor — jalur yang sama sekali baru, jadi ia harus
  //    dibuktikan dari paket yang benar-benar terpasang, bukan hanya di repo.
  const hasil = await fonnte.checkNumbers(["081234567890", "089876543210"]);

  check("checkNumbers menormalkan nomor", hasil.isRegistered("081234567890"), true);
  check("checkNumbers melaporkan yang tidak terdaftar", hasil.unregistered(), [
    "6289876543210",
  ]);
  check("NumberCheck.registered", hasil.registered(), ["6281234567890"]);
  check("NumberCheck.toJson", hasil.toJson().startsWith("{"), true);

  const validate = received.find((item) => item.url === "/validate");
  const validateBody = new URLSearchParams(validate.body);

  // Daftarnya dikirim dalam satu request, sudah berbentuk internasional.
  check("target pemeriksaan", validateBody.get("target"), "6281234567890,6289876543210");

  // 8. Rotasi: aritmetikanya murni, tapi modulnya harus ikut terbit dan bisa
  //    dimuat Node biasa.
  const rotate = new Client({
    provider: "auto",
    tokens: { Fonnte: "a", OpenWA: "b" },
    rotate: true,
  });

  check("rotate terbaca dari opsi", rotate.config.rotate().isEnabled(), true);
  check(
    "rotasi membagi rata",
    Object.values(Rotation.fromConfig(true).assign(4, ["Fonnte", "OpenWA"])).map(
      (bagian) => bagian.length,
    ),
    [2, 2],
  );

  assert.ok(true);
} finally {
  server.close();
}

console.log(failures === 0 ? "\nSEMUA OK" : `\n${failures} PEMERIKSAAN GAGAL`);
process.exit(failures === 0 ? 0 : 1);
