const STORAGE_KEY = 'papan-status-tim:nama-saya';
const REFRESH_MS = 8000;
const STATUS_KELAS = {
  'Belum Mulai': 'lencana-belum-mulai',
  'Dikerjakan': 'lencana-dikerjakan',
  'Selesai': 'lencana-selesai',
};

const elPilihNama = document.getElementById('pilih-nama');
const elDaftarNama = document.getElementById('daftar-nama');
const elPapan = document.getElementById('papan');
const elDaftarKartu = document.getElementById('daftar-kartu');
const elNamaSayaLabel = document.getElementById('nama-saya-label');
const elTombolGantiNama = document.getElementById('tombol-ganti-nama');

const elOverlay = document.getElementById('editor-overlay');
const elPilihanStatus = document.getElementById('pilihan-status');
const elInputTugas = document.getElementById('input-tugas');
const elSisaKarakter = document.getElementById('sisa-karakter');
const elPesanError = document.getElementById('pesan-error');
const elTombolSimpan = document.getElementById('tombol-simpan');
const elTombolBatal = document.getElementById('tombol-batal');

let editorTerbuka = false;
let statusTerpilih = null;

function namaSaya() {
  return localStorage.getItem(STORAGE_KEY);
}

function waktuRelatif(iso) {
  if (!iso) return 'belum pernah diubah';
  const detik = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (detik < 60) return 'baru saja';
  const menit = Math.floor(detik / 60);
  if (menit < 60) return `diubah ${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `diubah ${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  return `diubah ${hari} hari lalu`;
}

async function ambilData() {
  const res = await fetch('/api/team');
  if (!res.ok) throw new Error('gagal mengambil data');
  return res.json();
}

function tampilkanPilihNama(anggota) {
  elDaftarNama.innerHTML = '';
  anggota.forEach((a) => {
    const tombol = document.createElement('button');
    tombol.className = 'tombol-nama';
    tombol.textContent = a.name;
    tombol.addEventListener('click', () => {
      localStorage.setItem(STORAGE_KEY, a.name);
      render();
    });
    elDaftarNama.appendChild(tombol);
  });
  elPilihNama.hidden = false;
  elPapan.hidden = true;
}

function buatKartu(anggota, milikSaya) {
  const kartu = document.createElement('div');
  kartu.className = 'kartu' + (milikSaya ? ' kartu-saya' : '');

  const baris = document.createElement('div');
  baris.className = 'kartu-baris-atas';

  const nama = document.createElement('p');
  nama.className = 'kartu-nama';
  nama.textContent = anggota.name;

  const lencana = document.createElement('span');
  lencana.className = 'lencana-status ' + STATUS_KELAS[anggota.status];
  lencana.textContent = anggota.status;

  baris.appendChild(nama);
  baris.appendChild(lencana);

  const tugas = document.createElement('p');
  tugas.className = 'kartu-tugas' + (anggota.task ? '' : ' kosong');
  tugas.textContent = anggota.task || 'Belum ada tugas';

  const waktu = document.createElement('p');
  waktu.className = 'kartu-waktu';
  waktu.textContent = waktuRelatif(anggota.updatedAt);

  kartu.appendChild(baris);
  kartu.appendChild(tugas);
  kartu.appendChild(waktu);

  if (milikSaya) {
    const tombolUbah = document.createElement('button');
    tombolUbah.className = 'tombol-ubah';
    tombolUbah.textContent = 'Ubah Status Kamu';
    tombolUbah.addEventListener('click', () => bukaEditor(anggota));
    kartu.appendChild(tombolUbah);
  }

  return kartu;
}

function tampilkanPapan(anggota) {
  const saya = namaSaya();
  elNamaSayaLabel.textContent = saya;

  elDaftarKartu.innerHTML = '';
  anggota.forEach((a) => {
    elDaftarKartu.appendChild(buatKartu(a, a.name === saya));
  });

  elPilihNama.hidden = true;
  elPapan.hidden = false;
}

async function render() {
  let anggota;
  try {
    anggota = await ambilData();
  } catch (e) {
    return;
  }

  if (editorTerbuka) return;

  const saya = namaSaya();
  const namaValid = saya && anggota.some((a) => a.name === saya);

  if (!namaValid) {
    localStorage.removeItem(STORAGE_KEY);
    tampilkanPilihNama(anggota);
  } else {
    tampilkanPapan(anggota);
  }
}

elTombolGantiNama.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  render();
});

function bukaEditor(anggota) {
  editorTerbuka = true;
  statusTerpilih = anggota.status;
  elInputTugas.value = anggota.task || '';
  elSisaKarakter.textContent = 60 - elInputTugas.value.length;
  elPesanError.hidden = true;

  Array.from(elPilihanStatus.children).forEach((tombol) => {
    tombol.classList.toggle('aktif', tombol.dataset.status === statusTerpilih);
  });

  elOverlay.hidden = false;
}

function tutupEditor() {
  editorTerbuka = false;
  elOverlay.hidden = true;
}

Array.from(elPilihanStatus.children).forEach((tombol) => {
  tombol.addEventListener('click', () => {
    statusTerpilih = tombol.dataset.status;
    Array.from(elPilihanStatus.children).forEach((t) => {
      t.classList.toggle('aktif', t === tombol);
    });
  });
});

elInputTugas.addEventListener('input', () => {
  elSisaKarakter.textContent = 60 - elInputTugas.value.length;
});

elTombolBatal.addEventListener('click', () => {
  tutupEditor();
  render();
});

elTombolSimpan.addEventListener('click', async () => {
  const saya = namaSaya();
  elPesanError.hidden = true;
  elTombolSimpan.disabled = true;

  try {
    const res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: saya,
        status: statusTerpilih,
        task: elInputTugas.value,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      elPesanError.textContent = data.error || 'Gagal menyimpan. Coba lagi.';
      elPesanError.hidden = false;
      return;
    }

    tutupEditor();
    tampilkanPapan(data);
  } catch (e) {
    elPesanError.textContent = 'Tidak bisa terhubung ke server. Coba lagi.';
    elPesanError.hidden = false;
  } finally {
    elTombolSimpan.disabled = false;
  }
});

render();
setInterval(render, REFRESH_MS);
