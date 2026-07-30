const STORAGE_KEY = 'papan-status-tim:nama-saya';
const TEMA_STORAGE_KEY = 'papan-status-tim:tema';
const REFRESH_MS = 8000;
const DESCRIPTION_MAX_LENGTH = 500;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB, samakan dengan batas di server.js
const STATUS_KELAS = {
  'Belum Mulai': 'lencana-belum-mulai',
  'Dikerjakan': 'lencana-dikerjakan',
  'Selesai': 'lencana-selesai',
};

const elTombolTema = document.getElementById('tombol-tema');

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
const elInputDeskripsi = document.getElementById('input-deskripsi');
const elSisaKarakterDeskripsi = document.getElementById('sisa-karakter-deskripsi');
const elInputFile = document.getElementById('input-file');
const elTombolPilihFile = document.getElementById('tombol-pilih-file');
const elNamaLampiran = document.getElementById('nama-lampiran');
const elLinkLampiran = document.getElementById('link-lampiran');
const elTombolHapusLampiran = document.getElementById('tombol-hapus-lampiran');
const elPesanError = document.getElementById('pesan-error');
const elTombolSimpan = document.getElementById('tombol-simpan');
const elTombolBatal = document.getElementById('tombol-batal');

let editorTerbuka = false;
let statusTerpilih = null;
let namaSedangDiedit = null;
let lampiranTersimpan = null;
let filePending = null;
let hapusLampiranFlag = false;

function temaAktif() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function terapkanTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  elTombolTema.setAttribute('aria-checked', tema === 'dark' ? 'true' : 'false');
}

terapkanTema(temaAktif());

elTombolTema.addEventListener('click', () => {
  const temaBaru = temaAktif() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(TEMA_STORAGE_KEY, temaBaru);
  terapkanTema(temaBaru);
});

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

  kartu.appendChild(baris);
  kartu.appendChild(tugas);

  if (anggota.description) {
    const deskripsi = document.createElement('p');
    deskripsi.className = 'kartu-deskripsi';
    deskripsi.textContent = anggota.description.length > 80
      ? anggota.description.slice(0, 80) + '…'
      : anggota.description;
    kartu.appendChild(deskripsi);
  }

  if (anggota.attachment) {
    const lampiran = document.createElement('a');
    lampiran.className = 'kartu-lampiran';
    lampiran.href = anggota.attachment.url;
    lampiran.target = '_blank';
    lampiran.rel = 'noopener';
    lampiran.textContent = '📎 ' + anggota.attachment.name;
    kartu.appendChild(lampiran);
  }

  const waktu = document.createElement('p');
  waktu.className = 'kartu-waktu';
  waktu.textContent = waktuRelatif(anggota.updatedAt);
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

function perbaruiTampilanLampiran() {
  if (filePending) {
    elNamaLampiran.textContent = filePending.name;
    elLinkLampiran.hidden = true;
    elTombolHapusLampiran.hidden = false;
  } else if (hapusLampiranFlag || !lampiranTersimpan) {
    elNamaLampiran.textContent = 'Tidak ada lampiran';
    elLinkLampiran.hidden = true;
    elTombolHapusLampiran.hidden = true;
  } else {
    elNamaLampiran.textContent = lampiranTersimpan.name;
    elLinkLampiran.href = lampiranTersimpan.url;
    elLinkLampiran.hidden = false;
    elTombolHapusLampiran.hidden = false;
  }
}

function bukaEditor(anggota) {
  editorTerbuka = true;
  namaSedangDiedit = anggota.name;
  statusTerpilih = anggota.status;
  elInputTugas.value = anggota.task || '';
  elSisaKarakter.textContent = 60 - elInputTugas.value.length;
  elInputDeskripsi.value = anggota.description || '';
  elSisaKarakterDeskripsi.textContent = DESCRIPTION_MAX_LENGTH - elInputDeskripsi.value.length;
  elPesanError.hidden = true;

  lampiranTersimpan = anggota.attachment || null;
  filePending = null;
  hapusLampiranFlag = false;
  elInputFile.value = '';
  perbaruiTampilanLampiran();

  Array.from(elPilihanStatus.children).forEach((tombol) => {
    tombol.classList.toggle('aktif', tombol.dataset.status === statusTerpilih);
  });

  elOverlay.hidden = false;
}

function tutupEditor() {
  editorTerbuka = false;
  namaSedangDiedit = null;
  lampiranTersimpan = null;
  filePending = null;
  hapusLampiranFlag = false;
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

elInputDeskripsi.addEventListener('input', () => {
  elSisaKarakterDeskripsi.textContent = DESCRIPTION_MAX_LENGTH - elInputDeskripsi.value.length;
});

elTombolPilihFile.addEventListener('click', () => {
  elInputFile.click();
});

elInputFile.addEventListener('change', () => {
  const file = elInputFile.files[0];
  if (!file) return;

  if (file.size > MAX_ATTACHMENT_SIZE) {
    elPesanError.textContent = `Ukuran lampiran maksimal ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB.`;
    elPesanError.hidden = false;
    elInputFile.value = '';
    return;
  }

  elPesanError.hidden = true;
  filePending = file;
  hapusLampiranFlag = false;
  perbaruiTampilanLampiran();
});

elTombolHapusLampiran.addEventListener('click', () => {
  filePending = null;
  hapusLampiranFlag = true;
  elInputFile.value = '';
  perbaruiTampilanLampiran();
});

elTombolBatal.addEventListener('click', () => {
  tutupEditor();
  render();
});

elTombolSimpan.addEventListener('click', async () => {
  elPesanError.hidden = true;

  if (!namaSedangDiedit) {
    elPesanError.textContent = 'Nama kamu belum diketahui. Tutup ini lalu pilih nama dulu.';
    elPesanError.hidden = false;
    return;
  }

  elTombolSimpan.disabled = true;

  try {
    const formData = new FormData();
    formData.append('name', namaSedangDiedit);
    formData.append('status', statusTerpilih);
    formData.append('task', elInputTugas.value);
    formData.append('description', elInputDeskripsi.value);
    if (filePending) {
      formData.append('attachment', filePending);
    } else if (hapusLampiranFlag) {
      formData.append('removeAttachment', 'true');
    }

    const res = await fetch('/api/status', {
      method: 'POST',
      body: formData,
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
