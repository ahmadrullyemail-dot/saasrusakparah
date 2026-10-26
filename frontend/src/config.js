export const CONTRACT_TYPES = [
  ['pkwt', 'PKWT'],
  ['pkwtt', 'PKWTT'],
  ['freelance', 'Freelance'],
  ['daily_worker', 'Daily Worker'],
];

export const STATUS_LABELS = {
  offered: 'Offering',
  preactive: 'Pra-aktif',
  active: 'Aktif',
  inactive: 'Nonaktif',
};

export const NAVIGATION_TABS = [
  { id: 'overview', label: 'Ringkasan', icon: '⌂' },
  { id: 'workers', label: 'Data pekerja', icon: '♙' },
  { id: 'documents', label: 'Dokumen & masa berlaku', icon: '▤' },
  { id: 'attendance', label: 'Presensi', icon: '◷' },
  { id: 'history', label: 'Riwayat aktivitas', icon: '↺', managerOnly: true },
  { id: 'settings', label: 'Pengaturan', icon: '⚙' },
];

export const APP_THEMES = [
  { id: 'standard', label: 'Default / Standard', description: 'Tampilan standar rusakparah.web.id.' },
  { id: 'dark', label: 'Dark Mode', description: 'Tampilan gelap untuk kondisi cahaya rendah.' },
  { id: 'clean', label: 'Compact / Light Clean', description: 'Tampilan terang dengan jarak dan panel lebih ringkas.' },
];

export const USER_ROLE_LABELS = {
  admin: 'Admin',
  hr_manager: 'HR Staff',
  viewer: 'Viewer',
  worker: 'Pekerja',
};

export const ATTENDANCE_ACTIVITY_OPTIONS = [
  ['check_in', 'Check-In'],
  ['check_out', 'Check-Out'],
  ['off', 'Off'],
  ['permission', 'Izin'],
  ['leave', 'Cuti'],
  ['sick', 'Sakit'],
];

export const MAX_PROFILE_PHOTO_BYTES = 900 * 1024;
export const MAX_PROFILE_PHOTO_SOURCE_BYTES = 12 * 1024 * 1024;
