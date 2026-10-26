export function documentTypeName(code, documentTypes) {
  return documentTypes.find((type) => type.code === code)?.name || code;
}

export function addDaysToDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function excelDateString(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const localDate = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
  if (localDate) return `${localDate[3]}-${localDate[2].padStart(2, '0')}-${localDate[1].padStart(2, '0')}`;
  return text;
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const randomValues = new Uint8Array(16);
  window.crypto.getRandomValues(randomValues);
  return `${Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join('')}Aa7!`;
}

export async function compressProfilePhoto(file) {
  if (file.size <= MAX_PROFILE_PHOTO_BYTES) return file;
  if (file.size > MAX_PROFILE_PHOTO_SOURCE_BYTES) {
    throw new Error('Ukuran gambar sumber maksimal 12 MB.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Browser ini tidak mendukung pemrosesan foto. Gunakan gambar maksimal 900 KB.');
  }

  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 40000000) {
      throw new Error('Resolusi foto terlalu besar. Pilih gambar dengan resolusi lebih rendah.');
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Foto tidak dapat diproses oleh browser.');

    let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.45, 0.9 - attempt * 0.07);
      const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!compressed) throw new Error('Foto tidak dapat dikompresi oleh browser.');
      if (compressed.size <= MAX_PROFILE_PHOTO_BYTES) {
        return new File([compressed], 'profile-photo.jpg', {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
      scale *= 0.82;
    }
    throw new Error('Foto tetap terlalu besar setelah dikompresi. Pilih gambar lain.');
  } finally {
    image.close();
  }
}

export function documentState(document) {
  if (document.status !== 'valid') {
    return {
      label: document.status === 'pending' ? 'Menunggu' : document.status === 'expired' ? 'Kedaluwarsa' : 'Ditolak',
      valid: false,
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (['mcu', 'pkwt', 'sim'].includes(document.type) && !document.valid_until) {
    return { label: 'Tanggal akhir diperlukan', valid: false };
  }
  if (document.valid_from && document.valid_from > today) return { label: 'Belum berlaku', valid: false };
  if (document.valid_until && document.valid_until < today) return { label: 'Kedaluwarsa', valid: false };
  return { label: 'Valid', valid: true };
}

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Permintaan gagal.');
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  return result.data;
}

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function attendanceStatusLabel(status) {
  return {
    present: 'Hadir',
    permission: 'Izin',
    sick: 'Sakit',
    absent: 'Tidak hadir',
    off: 'Off',
    leave: 'Cuti',
    dinas: 'Dinas',
  }[status] || 'Belum presensi';
}

export function monthlyAttendanceCode(record) {
  if (!record?.attendance_id) return '';
  if (record.approval_status === 'pending') return 'P';
  if (record.status === 'permission' || record.status === 'leave' || record.status === 'off') return 'I';
  if (record.status === 'sick') return 'S';
  if (record.status === 'late') return 'T';
  if (record.check_in_time) return record.check_out_time ? 'H' : 'X';
  if (record.status === 'absent') return 'X';
  return '';
}

export function attendanceMonthLabel(month) {
  if (!month) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

export function attendanceMonthSummary(days) {
  return Object.values(days).reduce((summary, record) => {
    const code = monthlyAttendanceCode(record);
    if (code) summary[code] += 1;
    return summary;
  }, { H: 0, T: 0, I: 0, S: 0, X: 0, P: 0 });
}

export function formatAttendanceTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function formatCoordinate(value) {
  return value == null ? null : Number(value).toFixed(6);
}
