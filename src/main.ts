/**
 * ==============================================================================
 * SMART ATTENDANCE SYSTEM - Complete College Project Web Portal
 * ==============================================================================
 * Candidate Name : Sahil Pasula
 * Class          : TYBSC-A-39
 * Seat Number    : 24TCS076
 * Degree Course  : TY BSc Computer Science College Project
 * Backend Arch   : Python 3, Flask, SQLite3, Jinja2
 * Frontend Tech  : Modern TypeScript, @vladmandic/face-api, jsPDF, Web Audio API
 * ==============================================================================
 */

import JSZip from 'jszip';
import { faceEngine, FaceMatchResult } from './faceRecognition';
import { exportTableToPDF } from './pdfExport';
import { apiClient } from './apiClient';
import { CODE_FILES, VIVA_QUESTIONS, renderSynopsisBodyHtml } from './projectDocs';

// -----------------------------------------------------------------------------
// Data Types & Database Entities (Mirroring SQLite Tables)
// -----------------------------------------------------------------------------
export interface Student {
  id: number;
  name: string;
  roll_number: string;
  seat_number: string;
  class: string;
  email: string;
  phone: string;
  photo: string;
  parent_name?: string;
  parent_phone?: string;
  created_at: string;
}

export interface AttendanceRecord {
  id: number;
  student_id: number;
  date: string;
  time: string;
  status: 'Present' | 'Absent';
  subject?: string;
  marked_by: string;
  method?: 'Face Recognition' | 'Manual Roll Call';
}

export interface NotificationRecord {
  id: number;
  student_id: number;
  title: string;
  message: string;
  percentage: number;
  created_at: string;
  is_read: boolean;
  dispatched_at?: string;
  dispatch_channel?: string;
}

export interface SystemSettings {
  attendance_threshold: number;
  face_distance_threshold: number;
  min_detection_confidence: number;
  institution_name: string;
  academic_year: string;
  default_subject: string;
}

export type UserRole = 'Administrator' | 'Teacher/Faculty' | 'Student' | 'Parent/Guardian';

export interface UserSession {
  username: string;
  name: string;
  role: UserRole;
  baseRole: UserRole;
  student_id?: number;
}

interface StoredAccount {
  username: string;
  passwordSha256: string;
  name: string;
  role: UserRole;
  student_id?: number;
}

// -----------------------------------------------------------------------------
// Date, Security & Sanitization Helpers
// -----------------------------------------------------------------------------
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalMonthString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getLocalTimeString(d: Date = new Date()): string {
  return d.toTimeString().split(' ')[0];
}

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pureJsSha256(ascii: string): string {
  const rightRotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const utf8Bytes = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  return pureJsSha256(utf8Bytes);
}

// Precomputed SHA-256 digests so plaintext passwords are not stored in account store
const DEFAULT_ACCOUNTS: StoredAccount[] = [
  {
    username: 'admin',
    // sha256('admin123')
    passwordSha256: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
    name: 'Sahil Pasula (Admin)',
    role: 'Administrator',
  },
  {
    username: 'teacher',
    // sha256('teacher123')
    passwordSha256: 'cde383eee8ee7a4400adf7a15f716f179a2eb97646b37e089eb8d6d04e663416',
    name: 'Prof. R. K. Sharma (Faculty)',
    role: 'Teacher/Faculty',
  },
  {
    username: 'student',
    // sha256('student123')
    passwordSha256: '703b0a3d6ad75b649a28adde7d83c6251da457549263bc7ff45ec709b0a8448b',
    name: 'Sahil Pasula',
    role: 'Student',
    student_id: 1,
  },
  {
    username: 'parent',
    // sha256('parent123')
    passwordSha256: '82e3edf5f5f3a46b5f94579b61817fd9a1f356adcef5ee22da3b96ef775c4860',
    name: 'Mr. M. Verma (Guardian)',
    role: 'Parent/Guardian',
    student_id: 4,
  },
];

// -----------------------------------------------------------------------------
// Initial Seed Data
// -----------------------------------------------------------------------------
const INITIAL_STUDENTS: Student[] = [
  {
    id: 1,
    name: 'Sahil Pasula',
    roll_number: 'TYBSC-A-39',
    seat_number: '24TCS076',
    class: 'TYBSC-CS',
    email: 'pasulasahil77@gmail.com',
    phone: '+91 98765 43210',
    parent_name: 'Mr. R. Pasula',
    parent_phone: '+91 98765 43219',
    photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:00:00',
  },
  {
    id: 2,
    name: 'Rohan Sharma',
    roll_number: 'TYBSC-A-12',
    seat_number: '24TCS012',
    class: 'TYBSC-CS',
    email: 'rohan.sharma@college.edu',
    phone: '+91 98201 11223',
    parent_name: 'Mr. K. Sharma',
    parent_phone: '+91 98201 11229',
    photo: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:05:00',
  },
  {
    id: 3,
    name: 'Priya Nair',
    roll_number: 'TYBSC-A-24',
    seat_number: '24TCS045',
    class: 'TYBSC-CS',
    email: 'priya.nair@college.edu',
    phone: '+91 98202 33445',
    parent_name: 'Mrs. S. Nair',
    parent_phone: '+91 98202 33449',
    photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:10:00',
  },
  {
    id: 4,
    name: 'Amit Verma',
    roll_number: 'TYBSC-A-05',
    seat_number: '24TCS008',
    class: 'TYBSC-CS',
    email: 'amit.verma@college.edu',
    phone: '+91 98203 55667',
    parent_name: 'Mr. M. Verma',
    parent_phone: '+91 98203 55669',
    photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:15:00',
  },
  {
    id: 5,
    name: 'Neha Kulkarni',
    roll_number: 'TYBSC-A-18',
    seat_number: '24TCS029',
    class: 'TYBSC-CS',
    email: 'neha.kulkarni@college.edu',
    phone: '+91 98204 77889',
    parent_name: 'Mrs. A. Kulkarni',
    parent_phone: '+91 98204 77881',
    photo: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:20:00',
  },
  {
    id: 6,
    name: 'Aditya Deshmukh',
    roll_number: 'TYBSC-A-02',
    seat_number: '24TCS003',
    class: 'TYBSC-CS',
    email: 'aditya.d@college.edu',
    phone: '+91 98205 99001',
    parent_name: 'Mr. V. Deshmukh',
    parent_phone: '+91 98205 99009',
    photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:25:00',
  },
  {
    id: 7,
    name: 'Sneha Patil',
    roll_number: 'TYBSC-A-44',
    seat_number: '24TCS089',
    class: 'TYBSC-CS',
    email: 'sneha.patil@college.edu',
    phone: '+91 98206 12345',
    parent_name: 'Mrs. R. Patil',
    parent_phone: '+91 98206 12349',
    photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:30:00',
  },
  {
    id: 8,
    name: 'Tanmay Joshi',
    roll_number: 'TYBSC-A-51',
    seat_number: '24TCS102',
    class: 'TYBSC-CS',
    email: 'tanmay.joshi@college.edu',
    phone: '+91 98207 67890',
    parent_name: 'Mr. D. Joshi',
    parent_phone: '+91 98207 67899',
    photo: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=300&auto=format&fit=crop&q=80',
    created_at: '2026-10-20 09:35:00',
  },
];

const SUBJECTS = [
  'Advanced Python Programming',
  'Database Management Systems (SQLite)',
  'Linux & Shell Scripting',
  'Computer Networks & Security',
  'Software Engineering & Project Management',
];

const DEFAULT_SETTINGS: SystemSettings = {
  attendance_threshold: 75,
  face_distance_threshold: 0.55,
  min_detection_confidence: 0.55,
  institution_name: 'Department of Computer Science',
  academic_year: '2026-2027',
  default_subject: SUBJECTS[0],
};

function generateInitialAttendance(): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  let recId = 1;
  const today = new Date();

  const patterns: Record<string, ('Present' | 'Absent')[]> = {
    'TYBSC-A-39': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present'],
    'TYBSC-A-12': ['Present', 'Present', 'Absent', 'Present', 'Present', 'Present', 'Present'],
    'TYBSC-A-24': ['Present', 'Present', 'Present', 'Present', 'Absent', 'Present', 'Present'],
    'TYBSC-A-05': ['Absent', 'Absent', 'Present', 'Absent', 'Present', 'Absent', 'Present'],
    'TYBSC-A-18': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Absent'],
    'TYBSC-A-02': ['Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present'],
    'TYBSC-A-44': ['Absent', 'Present', 'Absent', 'Present', 'Absent', 'Present', 'Absent'],
    'TYBSC-A-51': ['Present', 'Absent', 'Present', 'Present', 'Present', 'Present', 'Present'],
  };

  for (let d = 6; d >= 0; d--) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - d);
    const dateStr = getLocalDateString(targetDate);
    const timeStr = `09:${String(10 + d * 2).padStart(2, '0')}:00`;
    const subj = SUBJECTS[d % SUBJECTS.length];

    INITIAL_STUDENTS.forEach((student) => {
      const studentPatt =
        patterns[student.roll_number] || [
          'Present',
          'Present',
          'Present',
          'Present',
          'Present',
          'Present',
          'Present',
        ];
      const status = studentPatt[6 - d];
      records.push({
        id: recId++,
        student_id: student.id,
        date: dateStr,
        time: timeStr,
        status,
        subject: subj,
        marked_by: 'Prof. R. K. Sharma',
        method: d % 2 === 0 ? 'Face Recognition' : 'Manual Roll Call',
      });
    });
  }

  return records;
}

// -----------------------------------------------------------------------------
// Database Store Manager (Persistent Local Storage + Optional Backend Sync)
// -----------------------------------------------------------------------------
class DatabaseStore {
  private students: Student[];
  private attendance: AttendanceRecord[];
  private notifications: NotificationRecord[];
  private settings: SystemSettings;
  private currentUser: UserSession | null;

  constructor() {
    const storedStudents = localStorage.getItem('smart_att_students_v2');
    const storedAtt = localStorage.getItem('smart_att_records_v2');
    const storedNotifs = localStorage.getItem('smart_att_notifications_v2');
    const storedSettings = localStorage.getItem('smart_att_settings_v2');
    const storedUser = localStorage.getItem('smart_att_user_v2');

    this.students = storedStudents ? JSON.parse(storedStudents) : [...INITIAL_STUDENTS];
    this.attendance = storedAtt ? JSON.parse(storedAtt) : generateInitialAttendance();
    this.notifications = storedNotifs ? JSON.parse(storedNotifs) : [];
    this.settings = storedSettings
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) }
      : { ...DEFAULT_SETTINGS };

    // Do NOT auto-login on fresh browser session
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        this.currentUser = parsed && parsed.username ? parsed : null;
      } catch {
        this.currentUser = null;
      }
    } else {
      this.currentUser = null;
    }

    this.refreshNotifications();
    this.save();
  }

  public save() {
    localStorage.setItem('smart_att_students_v2', JSON.stringify(this.students));
    localStorage.setItem('smart_att_records_v2', JSON.stringify(this.attendance));
    localStorage.setItem('smart_att_notifications_v2', JSON.stringify(this.notifications));
    localStorage.setItem('smart_att_settings_v2', JSON.stringify(this.settings));
    if (this.currentUser) {
      localStorage.setItem('smart_att_user_v2', JSON.stringify(this.currentUser));
    } else {
      localStorage.removeItem('smart_att_user_v2');
    }
  }

  public getSettings(): SystemSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<SystemSettings>) {
    this.settings = {
      ...this.settings,
      ...partial,
      attendance_threshold: Math.max(
        1,
        Math.min(100, Number(partial.attendance_threshold ?? this.settings.attendance_threshold))
      ),
      face_distance_threshold: Math.max(
        0.3,
        Math.min(0.8, Number(partial.face_distance_threshold ?? this.settings.face_distance_threshold))
      ),
      min_detection_confidence: Math.max(
        0.2,
        Math.min(0.95, Number(partial.min_detection_confidence ?? this.settings.min_detection_confidence))
      ),
    };
    this.refreshNotifications();
    this.save();
    void apiClient.request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(this.settings),
    });
  }

  public resetToSample() {
    this.students = [...INITIAL_STUDENTS];
    this.attendance = generateInitialAttendance();
    this.notifications = [];
    this.refreshNotifications();
    this.save();
  }

  public getStudents(): Student[] {
    return [...this.students];
  }

  public getClasses(): string[] {
    return Array.from(new Set(this.students.map((s) => s.class))).sort();
  }

  public getStudent(id: number): Student | undefined {
    return this.students.find((s) => s.id === id);
  }

  public hasDuplicateRollOrSeat(roll: string, seat: string, excludeId?: number): string | null {
    const rLow = roll.trim().toLowerCase();
    const sLow = seat.trim().toLowerCase();
    for (const s of this.students) {
      if (excludeId !== undefined && s.id === excludeId) continue;
      if (s.roll_number.trim().toLowerCase() === rLow) {
        return `Roll Number '${roll}' is already registered.`;
      }
      if (s.seat_number.trim().toLowerCase() === sLow) {
        return `Seat Number '${seat}' is already assigned to ${s.name}.`;
      }
    }
    return null;
  }

  public addStudent(studentData: Omit<Student, 'id' | 'created_at'>, descriptor?: number[] | null): Student {
    const newId = this.students.length > 0 ? Math.max(...this.students.map((s) => s.id)) + 1 : 1;
    const now = `${getLocalDateString()} ${getLocalTimeString()}`;
    const newStudent: Student = {
      ...studentData,
      id: newId,
      created_at: now,
    };
    this.students.push(newStudent);
    this.refreshNotifications();
    this.save();

    void apiClient.request('/api/students', {
      method: 'POST',
      body: JSON.stringify({ ...studentData, face_descriptor: descriptor || undefined }),
    });
    return newStudent;
  }

  public updateStudent(id: number, updated: Partial<Student>, descriptor?: number[] | null): boolean {
    const idx = this.students.findIndex((s) => s.id === id);
    if (idx !== -1) {
      this.students[idx] = { ...this.students[idx], ...updated };
      this.refreshNotifications();
      this.save();
      void apiClient.request(`/api/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...this.students[idx], face_descriptor: descriptor || undefined }),
      });
      return true;
    }
    return false;
  }

  public deleteStudent(id: number): boolean {
    const idx = this.students.findIndex((s) => s.id === id);
    if (idx !== -1) {
      this.students.splice(idx, 1);
      this.attendance = this.attendance.filter((a) => a.student_id !== id);
      this.notifications = this.notifications.filter((n) => n.student_id !== id);
      faceEngine.removeStudent(id);
      this.refreshNotifications();
      this.save();
      void apiClient.request(`/api/students/${id}`, { method: 'DELETE' });
      return true;
    }
    return false;
  }

  public getAttendance(): AttendanceRecord[] {
    return [...this.attendance];
  }

  public findExistingAttendance(studentId: number, dateStr: string, subject: string): AttendanceRecord | undefined {
    return this.attendance.find(
      (a) =>
        a.student_id === studentId &&
        a.date === dateStr &&
        (a.subject || SUBJECTS[0]) === subject
    );
  }

  public markAttendanceRecord(
    record: {
      student_id: number;
      date: string;
      time: string;
      status: 'Present' | 'Absent';
      subject?: string;
      marked_by: string;
      method?: 'Face Recognition' | 'Manual Roll Call';
    },
    options: { preventDuplicate?: boolean } = {}
  ): { ok: boolean; duplicate: boolean; existing?: AttendanceRecord } {
    const subj = record.subject || this.settings.default_subject || SUBJECTS[0];
    const existingIdx = this.attendance.findIndex(
      (a) =>
        a.student_id === record.student_id &&
        a.date === record.date &&
        (a.subject || SUBJECTS[0]) === subj
    );

    if (existingIdx !== -1 && options.preventDuplicate) {
      return { ok: false, duplicate: true, existing: this.attendance[existingIdx] };
    }

    if (existingIdx !== -1) {
      this.attendance[existingIdx] = {
        ...this.attendance[existingIdx],
        status: record.status,
        time: record.time,
        marked_by: record.marked_by,
        subject: subj,
        method: record.method || this.attendance[existingIdx].method || 'Manual Roll Call',
      };
    } else {
      const newId = this.attendance.length > 0 ? Math.max(...this.attendance.map((a) => a.id)) + 1 : 1;
      this.attendance.push({
        id: newId,
        student_id: record.student_id,
        date: record.date,
        time: record.time,
        status: record.status,
        subject: subj,
        marked_by: record.marked_by,
        method: record.method || 'Manual Roll Call',
      });
    }

    this.refreshNotifications();
    this.save();

    void apiClient.request('/api/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({
        student_id: record.student_id,
        date: record.date,
        time: record.time,
        status: record.status,
        subject: subj,
        marked_by: record.marked_by,
        method: record.method || 'Manual Roll Call',
        reject_duplicate: Boolean(options.preventDuplicate),
      }),
    });

    return { ok: true, duplicate: false };
  }

  public batchMarkAttendance(
    dateStr: string,
    records: { student_id: number; status: 'Present' | 'Absent' }[],
    marked_by: string,
    subject: string = SUBJECTS[0]
  ) {
    const time = getLocalTimeString();
    records.forEach((r) => {
      const existingIdx = this.attendance.findIndex(
        (a) =>
          a.student_id === r.student_id &&
          a.date === dateStr &&
          (a.subject || SUBJECTS[0]) === subject
      );
      if (existingIdx !== -1) {
        this.attendance[existingIdx] = {
          ...this.attendance[existingIdx],
          status: r.status,
          time,
          marked_by,
          subject,
          method: 'Manual Roll Call',
        };
      } else {
        const newId = this.attendance.length > 0 ? Math.max(...this.attendance.map((a) => a.id)) + 1 : 1;
        this.attendance.push({
          id: newId,
          student_id: r.student_id,
          date: dateStr,
          time,
          status: r.status,
          subject,
          marked_by,
          method: 'Manual Roll Call',
        });
      }
    });
    this.refreshNotifications();
    this.save();

    void apiClient.request('/api/attendance/batch', {
      method: 'POST',
      body: JSON.stringify({ date: dateStr, records, marked_by, subject }),
    });
  }

  public refreshNotifications() {
    const prevByStudent = new Map<number, NotificationRecord>();
    this.notifications.forEach((n) => prevByStudent.set(n.student_id, n));

    const threshold = this.settings.attendance_threshold;
    const nextList: NotificationRecord[] = [];
    let notifId = 1;

    this.students.forEach((st) => {
      const logs = this.attendance.filter((a) => a.student_id === st.id);
      const total = logs.length;
      if (total > 0) {
        const present = logs.filter((a) => a.status === 'Present').length;
        const pct = Math.round((present / total) * 1000) / 10;
        if (pct < threshold) {
          const prev = prevByStudent.get(st.id);
          nextList.push({
            id: notifId++,
            student_id: st.id,
            title: `Mandatory ${threshold}% Attendance Shortage Alert`,
            message: `Warning: ${st.name} (${st.roll_number}) has attended only ${present} of ${total} lectures (${pct}%). Minimum ${threshold}% required for semester examination eligibility.`,
            percentage: pct,
            created_at: prev?.created_at || `${getLocalDateString()} ${getLocalTimeString()}`,
            is_read: prev ? prev.is_read : false,
            dispatched_at: prev?.dispatched_at,
            dispatch_channel: prev?.dispatch_channel,
          });
        }
      }
    });

    this.notifications = nextList;
  }

  public getNotifications(): NotificationRecord[] {
    return [...this.notifications];
  }

  public acknowledgeNotification(studentId: number) {
    const n = this.notifications.find((item) => item.student_id === studentId);
    if (n) {
      n.is_read = true;
      this.save();
    }
  }

  public logNotificationDispatch(studentId: number, channel: string) {
    const n = this.notifications.find((item) => item.student_id === studentId);
    if (n) {
      n.is_read = true;
      n.dispatched_at = `${getLocalDateString()} ${getLocalTimeString()}`;
      n.dispatch_channel = channel;
      this.save();
    }
  }

  public getLowAttendanceStudents(filterClass = ''): {
    student: Student;
    total: number;
    present: number;
    absent: number;
    percentage: number;
    notification?: NotificationRecord;
  }[] {
    const threshold = this.settings.attendance_threshold;
    const notifMap = new Map<number, NotificationRecord>();
    this.notifications.forEach((n) => notifMap.set(n.student_id, n));

    const results: {
      student: Student;
      total: number;
      present: number;
      absent: number;
      percentage: number;
      notification?: NotificationRecord;
    }[] = [];

    this.students
      .filter((s) => !filterClass || s.class === filterClass)
      .forEach((st) => {
        const logs = this.attendance.filter((a) => a.student_id === st.id);
        const total = logs.length;
        if (total > 0) {
          const present = logs.filter((a) => a.status === 'Present').length;
          const absent = total - present;
          const percentage = Math.round((present / total) * 1000) / 10;
          if (percentage < threshold) {
            results.push({
              student: st,
              total,
              present,
              absent,
              percentage,
              notification: notifMap.get(st.id),
            });
          }
        }
      });

    return results.sort((a, b) => a.percentage - b.percentage);
  }

  public getCurrentUser(): UserSession | null {
    return this.currentUser;
  }

  public canModifyDatabase(): boolean {
    if (!this.currentUser) return false;
    return this.currentUser.role === 'Administrator' || this.currentUser.role === 'Teacher/Faculty';
  }

  public isAdmin(): boolean {
    return this.currentUser?.role === 'Administrator';
  }

  public setUserRole(role: UserRole, studentId: number = 1) {
    if (!this.currentUser || this.currentUser.baseRole !== 'Administrator') {
      return;
    }
    if (role === 'Administrator') {
      this.currentUser = {
        username: 'admin',
        name: 'Sahil Pasula (Admin)',
        role: 'Administrator',
        baseRole: 'Administrator',
      };
    } else if (role === 'Teacher/Faculty') {
      this.currentUser = {
        username: 'teacher',
        name: 'Prof. R. K. Sharma (Faculty)',
        role: 'Teacher/Faculty',
        baseRole: 'Administrator',
      };
    } else if (role === 'Student') {
      const st = this.getStudent(studentId) || this.students[0];
      this.currentUser = {
        username: st ? st.roll_number.toLowerCase() : 'student',
        name: st ? st.name : 'Student',
        role: 'Student',
        baseRole: 'Administrator',
        student_id: st?.id,
      };
    } else if (role === 'Parent/Guardian') {
      const st = this.getStudent(studentId) || this.students[3] || this.students[0];
      this.currentUser = {
        username: 'parent_' + (st ? st.roll_number.toLowerCase() : 'ward'),
        name: st?.parent_name || 'Guardian of ' + (st?.name || 'Ward'),
        role: 'Parent/Guardian',
        baseRole: 'Administrator',
        student_id: st?.id,
      };
    }
    this.save();
  }

  public async login(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    if (!cleanUser || !cleanPass) {
      return { ok: false, error: 'Please enter both username and password.' };
    }

    // If Flask backend is live, authenticate against server first
    if (apiClient.health.connected) {
      const res = await apiClient.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: cleanUser, password: cleanPass }),
      });
      if (res) {
        if (!res.ok) {
          return { ok: false, error: res.body?.error || 'Invalid username or password.' };
        }
        const u = res.body.user;
        const mappedRole: UserRole =
          u.role === 'Admin'
            ? 'Administrator'
            : u.role === 'Teacher'
              ? 'Teacher/Faculty'
              : u.role === 'Parent'
                ? 'Parent/Guardian'
                : 'Student';
        this.currentUser = {
          username: u.username,
          name: u.name,
          role: mappedRole,
          baseRole: mappedRole,
          student_id: u.student_id || undefined,
        };
        this.save();
        return { ok: true };
      }
    }

    // Verify against SHA-256 credential store
    const account = DEFAULT_ACCOUNTS.find((a) => a.username === cleanUser);
    if (!account) {
      return { ok: false, error: 'Invalid username or password.' };
    }

    const inputHash = await sha256Hex(cleanPass);
    if (inputHash !== account.passwordSha256) {
      return { ok: false, error: 'Invalid username or password.' };
    }

    this.currentUser = {
      username: account.username,
      name: account.name,
      role: account.role,
      baseRole: account.role,
      student_id: account.student_id,
    };
    this.save();
    return { ok: true };
  }

  public logout() {
    this.currentUser = null;
    this.save();
    void apiClient.request('/api/auth/logout', { method: 'POST' });
  }
}

export const db = new DatabaseStore();

// -----------------------------------------------------------------------------
// Audio Feedback (Synthesizer Chimes using Web Audio API)
// -----------------------------------------------------------------------------
function playVerificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.15);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + 0.35);
    osc2.stop(audioCtx.currentTime + 0.35);
  } catch {
    // Silent fallback
  }
}

// -----------------------------------------------------------------------------
// Toast Helper
// -----------------------------------------------------------------------------
export function showToast(
  message: string,
  type: 'success' | 'danger' | 'info' | 'warning' = 'success'
) {
  const existing = document.getElementById('toastNotification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toastNotification';
  toast.className = `alert alert-${type}`;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    box-shadow: var(--shadow-lg);
    animation: slideIn 0.3s ease;
    min-width: 280px;
    max-width: min(440px, calc(100vw - 32px));
  `;

  const icon =
    type === 'success'
      ? 'fa-circle-check'
      : type === 'danger'
        ? 'fa-circle-exclamation'
        : type === 'warning'
          ? 'fa-triangle-exclamation'
          : 'fa-info-circle';

  toast.innerHTML = `
    <div class="alert-icon"><i class="fa-solid ${icon}"></i></div>
    <div style="flex:1;"><strong>Notification:</strong> ${escapeHtml(message)}</div>
    <button class="alert-close" type="button">&times;</button>
  `;
  toast.querySelector('.alert-close')?.addEventListener('click', () => toast.remove());

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

// -----------------------------------------------------------------------------
// Router & Application State
// -----------------------------------------------------------------------------
export type PageName =
  | 'login'
  | 'dashboard'
  | 'synopsis'
  | 'camera-scanner'
  | 'attendance'
  | 'records'
  | 'reports'
  | 'students'
  | 'student-view'
  | 'register'
  | 'database-console'
  | 'notifications'
  | 'settings'
  | 'viva-defense'
  | 'source-code';

let currentPage: PageName = db.getCurrentUser() ? 'dashboard' : 'login';
let currentStudentViewId: number | null = null;
let currentReportType: 'student' | 'daily' | 'monthly' | 'subject' | 'notice-board' = 'student';
let selectedAttendanceDate: string = getLocalDateString();
let selectedAttendanceSubject: string = db.getSettings().default_subject || SUBJECTS[0];
let selectedReportMonth: string = getLocalMonthString();
let selectedReportClass: string = '';
let selectedNotifClass: string = '';
let studentSearchQuery: string = '';
let studentClassFilter: string = '';
let scannerActiveSubject: string = db.getSettings().default_subject || SUBJECTS[0];

// Live Camera & Face Recognition Loop State
let cameraStream: MediaStream | null = null;
let liveDetectTimer: number | null = null;
let liveDetectBusy = false;
let autoMarkEnabled = false;
let consecutiveMatchId: number | null = null;
let consecutiveMatchCount = 0;

function closeMobileSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarBackdrop')?.classList.remove('active');
}

export function navigateTo(page: PageName, paramId?: number) {
  if (!db.getCurrentUser() && page !== 'login') {
    currentPage = 'login';
    window.location.hash = '#login';
    renderApp();
    return;
  }

  if (currentPage === 'camera-scanner' && page !== 'camera-scanner') {
    stopCameraStream();
  }

  currentPage = page;
  if (paramId !== undefined) {
    currentStudentViewId = paramId;
  }

  closeMobileSidebar();
  window.location.hash =
    `#${currentPage}` + (currentPage === 'student-view' && currentStudentViewId ? `/${currentStudentViewId}` : '');
  renderApp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function stopCameraStream() {
  if (liveDetectTimer !== null) {
    window.clearInterval(liveDetectTimer);
    liveDetectTimer = null;
  }
  liveDetectBusy = false;
  consecutiveMatchId = null;
  consecutiveMatchCount = 0;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

// -----------------------------------------------------------------------------
// Main Application Renderer
// -----------------------------------------------------------------------------
export function renderApp() {
  const root = document.getElementById('app');
  if (!root) return;

  const user = db.getCurrentUser();
  if (!user || currentPage === 'login') {
    stopCameraStream();
    root.innerHTML = renderLoginPage();
    attachLoginEvents();
    return;
  }

  const lowAttendanceList = db.getLowAttendanceStudents();
  const unreadAlerts = lowAttendanceList.filter((item) => !item.notification?.is_read).length;
  const threshold = db.getSettings().attendance_threshold;
  const canEdit = db.canModifyDatabase();
  const isAdmin = db.isAdmin();

  root.innerHTML = `
    <div class="app-layout">
      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>

      <!-- Sidebar -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="brand-logo">
            <i class="fa-solid fa-graduation-cap"></i>
            <div>
              <h2>SMART ATTENDANCE</h2>
              <span>SYSTEM &bull; COLLEGE PROJECT</span>
            </div>
          </div>
          <button class="mobile-close-btn" id="closeSidebarBtn" type="button" aria-label="Close Menu"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <!-- Student Author Badge Card (Sahil Pasula) -->
        <div class="student-badge-card">
          <div class="badge-avatar">SP</div>
          <div class="badge-info">
            <strong>Sahil Pasula</strong>
            <small>Class: TYBSC-A-39</small>
            <small>Seat No: 24TCS076</small>
          </div>
        </div>

        <nav class="sidebar-nav">
          <span class="nav-category">PROJECT DOCUMENTATION</span>
          <a href="#synopsis" class="nav-item ${currentPage === 'synopsis' ? 'active' : ''}" data-nav="synopsis" style="background: rgba(14, 165, 233, 0.12); color: #38bdf8;">
            <i class="fa-solid fa-file-lines"></i>
            <span>Project Synopsis (PDF)</span>
          </a>

          <span class="nav-category">CORE ATTENDANCE MODULES</span>
          <a href="#dashboard" class="nav-item ${currentPage === 'dashboard' ? 'active' : ''}" data-nav="dashboard">
            <i class="fa-solid fa-gauge"></i>
            <span>Dashboard</span>
          </a>
          ${canEdit ? `
            <a href="#camera-scanner" class="nav-item ${currentPage === 'camera-scanner' ? 'active' : ''}" data-nav="camera-scanner" style="border-left: 3px solid #22c55e;">
              <i class="fa-solid fa-camera"></i>
              <span>Face Recognition Scanner</span>
            </a>
            <a href="#attendance" class="nav-item ${currentPage === 'attendance' ? 'active' : ''}" data-nav="attendance">
              <i class="fa-solid fa-clipboard-user"></i>
              <span>Manual Roll Call</span>
            </a>
          ` : ''}
          <a href="#records" class="nav-item ${currentPage === 'records' ? 'active' : ''}" data-nav="records">
            <i class="fa-solid fa-calendar-check"></i>
            <span>Attendance Records</span>
          </a>
          <a href="#reports" class="nav-item ${currentPage === 'reports' ? 'active' : ''}" data-nav="reports">
            <i class="fa-solid fa-chart-pie"></i>
            <span>Reports &amp; Analytics</span>
          </a>

          <span class="nav-category">ADMINISTRATION &amp; DATABASE</span>
          <a href="#students" class="nav-item ${['students', 'student-view'].includes(currentPage) ? 'active' : ''}" data-nav="students">
            <i class="fa-solid fa-address-book"></i>
            <span>Student Directory</span>
          </a>
          ${canEdit ? `
            <a href="#register" class="nav-item ${currentPage === 'register' ? 'active' : ''}" data-nav="register">
              <i class="fa-solid fa-user-plus"></i>
              <span>Student Registration</span>
            </a>
          ` : ''}
          <a href="#database-console" class="nav-item ${currentPage === 'database-console' ? 'active' : ''}" data-nav="database-console">
            <i class="fa-solid fa-database"></i>
            <span>SQLite &amp; ERD Architecture</span>
          </a>
          <a href="#notifications" class="nav-item ${currentPage === 'notifications' ? 'active' : ''}" data-nav="notifications">
            <i class="fa-solid fa-bell"></i>
            <span>Low-Attendance (&lt; ${threshold}%)</span>
            ${unreadAlerts > 0 ? `<span class="badge-alert">${unreadAlerts}</span>` : ''}
          </a>
          ${isAdmin ? `
            <a href="#settings" class="nav-item ${currentPage === 'settings' ? 'active' : ''}" data-nav="settings">
              <i class="fa-solid fa-sliders"></i>
              <span>Settings &amp; Thresholds</span>
            </a>
          ` : ''}

          <span class="nav-category">EXAMINATION &amp; DEFENSE</span>
          <a href="#viva-defense" class="nav-item ${currentPage === 'viva-defense' ? 'active' : ''}" data-nav="viva-defense" style="color: #fbbf24;">
            <i class="fa-solid fa-chalkboard-user"></i>
            <span>Viva Voce Preparation</span>
          </a>
          <a href="#source-code" class="nav-item ${currentPage === 'source-code' ? 'active' : ''}" data-nav="source-code">
            <i class="fa-solid fa-file-code"></i>
            <span>Python Flask Code &amp; Zip</span>
          </a>
        </nav>

        <div class="sidebar-footer">
          <div class="user-profile-preview">
            <i class="fa-solid fa-user-shield"></i>
            <div>
              <div class="uname">${escapeHtml(user.name)}</div>
              <div class="urole">${escapeHtml(user.role)}</div>
            </div>
          </div>
          <button class="logout-btn" id="logoutBtn" title="Logout" type="button">
            <i class="fa-solid fa-right-from-bracket"></i>
          </button>
        </div>
      </aside>

      <!-- Main Layout -->
      <div class="main-wrapper">
        <header class="topbar">
          <div style="display:flex; align-items:center; gap: 12px;">
            <button class="mobile-toggle" id="openSidebarBtn" type="button" aria-label="Open Menu">
              <i class="fa-solid fa-bars"></i>
            </button>
            <div class="topbar-title">
              <h1>${escapeHtml(getPageTitle(currentPage))}</h1>
            </div>
          </div>

          <div class="topbar-right">
            ${user.baseRole === 'Administrator' ? `
              <div class="role-selector-wrap" style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:11.5px; font-weight:600; color:var(--text-muted);"><i class="fa-solid fa-users-gear"></i> Role:</span>
                <select id="roleSwitcherSelect" class="form-control" style="width: auto; padding: 4px 8px; font-size: 12px; font-weight: 600; height: 32px;">
                  <option value="Administrator" ${user.role === 'Administrator' ? 'selected' : ''}>Administrator</option>
                  <option value="Teacher/Faculty" ${user.role === 'Teacher/Faculty' ? 'selected' : ''}>Teacher/Faculty</option>
                  <option value="Student" ${user.role === 'Student' ? 'selected' : ''}>Student Portal (Sahil)</option>
                  <option value="Parent/Guardian" ${user.role === 'Parent/Guardian' ? 'selected' : ''}>Parent Portal (Ward)</option>
                </select>
              </div>
            ` : `
              <span class="role-badge-pill">${escapeHtml(user.role)}</span>
            `}

            <a href="#notifications" class="icon-notification-btn" data-nav="notifications" title="Attendance Shortage Warnings">
              <i class="fa-solid fa-bell"></i>
              ${unreadAlerts > 0 ? `<span class="notification-dot"></span>` : ''}
            </a>
          </div>
        </header>

        <main class="content-container">
          ${user.role !== 'Administrator' ? `
            <div class="alert-banner-warning" style="margin-bottom: 20px; background: #f0fdf4; border-color: #bbf7d0; color: #166534;">
              <i class="fa-solid fa-user-check"></i>
              <div>
                <strong>Active Role Persona: ${escapeHtml(user.role)}</strong> &bull; Customized access view as per Section 6 of Project Synopsis.
                ${user.student_id ? ` (Linked student: <strong>${escapeHtml(db.getStudent(user.student_id)?.name || '')}</strong>)` : ''}
              </div>
            </div>
          ` : ''}

          ${renderPageContent()}

          <footer class="app-footer">
            <p>
              <strong>SMART ATTENDANCE SYSTEM</strong> &bull; TY BSc Computer Science College Project<br>
              Candidate: <strong>Sahil Pasula</strong> (Roll No: <strong>TYBSC-A-39</strong> | Seat No: <strong>24TCS076</strong>)<br>
              Backend Architecture: <code>Python Flask, SQLite3, Jinja2</code> &bull; Threshold: <code>${threshold}%</code>
            </p>
          </footer>
        </main>
      </div>
    </div>

    <!-- Global Edit Student Modal (accessible from both Directory & Student View) -->
    <div class="modal-overlay hidden" id="editStudentModal">
      <div class="modal-box" style="max-width: 640px; text-align: left;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="margin:0;"><i class="fa-solid fa-pen-to-square text-warning"></i> Edit Student Record</h3>
          <button class="alert-close" type="button" id="btnCloseEditModal">&times;</button>
        </div>
        <form id="editStudentForm">
          <input type="hidden" id="editStudentId">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label required">Student Name</label>
              <input type="text" id="editName" class="form-control" required>
            </div>
            <div class="form-group">
              <label class="form-label required">Roll Number</label>
              <input type="text" id="editRoll" class="form-control" required>
            </div>
            <div class="form-group">
              <label class="form-label required">Seat Number</label>
              <input type="text" id="editSeat" class="form-control" required>
            </div>
            <div class="form-group">
              <label class="form-label required">Class</label>
              <select id="editClass" class="form-control" required>
                <option value="TYBSC-CS">TY BSc Computer Science</option>
                <option value="SYBSC-CS">SY BSc Computer Science</option>
                <option value="FYBSC-CS">FY BSc Computer Science</option>
                <option value="TYBSC-IT">TY BSc IT</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label required">Email</label>
              <input type="email" id="editEmail" class="form-control" required>
            </div>
            <div class="form-group">
              <label class="form-label required">Phone</label>
              <input type="tel" id="editPhone" class="form-control" required>
            </div>
            <div class="form-group">
              <label class="form-label">Parent / Guardian Name</label>
              <input type="text" id="editParentName" class="form-control">
            </div>
            <div class="form-group">
              <label class="form-label">Parent Phone</label>
              <input type="tel" id="editParentPhone" class="form-control">
            </div>
            <div class="form-group col-span-2">
              <label class="form-label">Update Student Photo (Face Recognition Enrollment)</label>
              <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <img id="editPhotoPreview" src="" alt="Preview" style="width:52px; height:52px; border-radius:8px; object-fit:cover; border:1px solid #cbd5e1;">
                <input type="file" id="editPhotoFile" accept="image/*" class="form-control" style="flex:1; min-width:180px;">
              </div>
              <small id="editBiometricStatus" class="text-muted" style="display:block; margin-top:4px;"></small>
            </div>
          </div>
          <div class="modal-actions" style="margin-top:20px; display:flex; justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="btnCancelEditModal">Cancel</button>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-save"></i> Save Changes</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Global Delete Confirmation Modal -->
    <div class="modal-overlay hidden" id="deleteModal">
      <div class="modal-box">
        <div class="modal-icon-danger"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <h3>Delete Student Record</h3>
        <p>Are you sure you want to delete <strong id="deleteStudentName"></strong>? All attendance history will be cascade deleted.</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="btnCancelDeleteModal">Cancel</button>
          <button class="btn btn-danger" type="button" id="confirmDeleteBtn"><i class="fa-solid fa-trash-can"></i> Confirm Delete</button>
        </div>
      </div>
    </div>
  `;

  attachGlobalEvents();
}

function getPageTitle(page: PageName): string {
  switch (page) {
    case 'dashboard': return 'System Dashboard';
    case 'synopsis': return 'Project Synopsis & Academic Documentation';
    case 'camera-scanner': return 'Automated Face Recognition Scanner';
    case 'attendance': return 'Classroom Manual Roll Call';
    case 'records': return 'Attendance Records & Audit Trail';
    case 'reports': return 'Attendance Reports & Percentage Analytics';
    case 'students': return 'Student Directory';
    case 'register': return 'Student Registration Module';
    case 'student-view': return 'Student Academic Profile & Attendance';
    case 'database-console': return 'SQLite Database Terminal & ER Architecture';
    case 'notifications': return `${db.getSettings().attendance_threshold}% Attendance Compliance Alerts`;
    case 'settings': return 'System Settings & Recognition Thresholds';
    case 'viva-defense': return 'Viva Voce Examination & Defense Hub';
    case 'source-code': return 'Python Flask Source Code & Zip Archive';
    default: return 'Smart Attendance System';
  }
}

function renderPageContent(): string {
  const canEdit = db.canModifyDatabase();
  const isAdmin = db.isAdmin();

  switch (currentPage) {
    case 'dashboard': return renderDashboardPage();
    case 'synopsis': return renderSynopsisBodyHtml();
    case 'camera-scanner': return canEdit ? renderCameraScannerPage() : renderUnauthorizedBox('Only Faculty or Administrator can operate the Face Recognition Scanner.');
    case 'attendance': return canEdit ? renderAttendancePage() : renderUnauthorizedBox('Only Faculty or Administrator can mark classroom roll call.');
    case 'records': return renderRecordsPage();
    case 'reports': return renderReportsPage();
    case 'students': return renderStudentsPage();
    case 'register': return canEdit ? renderRegisterPage() : renderUnauthorizedBox('Only Faculty or Administrator can register new students.');
    case 'student-view': return renderStudentViewPage(currentStudentViewId || 1);
    case 'database-console': return renderDatabaseConsolePage();
    case 'notifications': return renderNotificationsPage();
    case 'settings': return isAdmin ? renderSettingsPage() : renderUnauthorizedBox('Only Administrator can modify system thresholds and settings.');
    case 'viva-defense': return renderVivaDefensePage();
    case 'source-code': return renderSourceCodePage();
    default: return renderDashboardPage();
  }
}

function renderUnauthorizedBox(msg: string): string {
  return `
    <div class="card">
      <div class="card-body" style="text-align:center; padding:40px;">
        <i class="fa-solid fa-lock fa-3x text-danger" style="margin-bottom:12px;"></i>
        <h3>Access Restricted</h3>
        <p class="text-muted">${escapeHtml(msg)}</p>
        <a href="#dashboard" class="btn btn-primary" style="margin-top:16px;">Return to Dashboard</a>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 1. LOGIN PAGE
// -----------------------------------------------------------------------------
function renderLoginPage(): string {
  return `
    <div class="login-body">
      <div class="login-wrapper">
        <div class="login-card">
          <div class="login-header">
            <div class="login-icon">
              <i class="fa-solid fa-graduation-cap"></i>
            </div>
            <h2>SMART ATTENDANCE SYSTEM</h2>
            <p>TY BSc Computer Science College Project Portal</p>
          </div>

          <div class="project-credit-box">
            <div class="credit-row"><span>Student:</span> <strong>Sahil Pasula</strong></div>
            <div class="credit-row"><span>Class:</span> <strong>TYBSC-A-39</strong></div>
            <div class="credit-row"><span>Seat No:</span> <strong>24TCS076</strong></div>
          </div>

          <div id="loginErrorBox" class="alert alert-danger hidden" style="margin-bottom:14px;">
            <div class="alert-icon"><i class="fa-solid fa-circle-exclamation"></i></div>
            <span id="loginErrorText"></span>
          </div>

          <form id="loginForm" class="login-form">
            <div class="form-group">
              <label for="loginUsername"><i class="fa-solid fa-user"></i> Username</label>
              <input type="text" id="loginUsername" class="form-control" placeholder="Enter username (e.g. admin)" required autofocus>
            </div>
            <div class="form-group">
              <label for="loginPassword"><i class="fa-solid fa-lock"></i> Password</label>
              <input type="password" id="loginPassword" class="form-control" placeholder="Enter password" required>
            </div>
            <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top: 14px;">
              <i class="fa-solid fa-right-to-bracket"></i> Login to System
            </button>
          </form>

          <div class="demo-credentials-card">
            <strong><i class="fa-solid fa-key"></i> Role Credentials (Validated Login):</strong>
            <div class="cred-items">
              <div><code>admin</code> / <code>admin123</code> &bull; Administrator (Full access)</div>
              <div><code>teacher</code> / <code>teacher123</code> &bull; Faculty (Mark roll &amp; reports)</div>
              <div><code>student</code> / <code>student123</code> &bull; Student Portal (Sahil Pasula)</div>
              <div><code>parent</code> / <code>parent123</code> &bull; Parent Portal (Shortage Ward)</div>
            </div>
          </div>

          <div class="login-footer">
            <small>Backend: Python Flask &bull; SQLite3 &bull; Real Face Recognition Engine</small>
          </div>
        </div>
      </div>
    </div>
  `;
}

function attachLoginEvents() {
  const form = document.getElementById('loginForm') as HTMLFormElement | null;
  const errBox = document.getElementById('loginErrorBox');
  const errText = document.getElementById('loginErrorText');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = (document.getElementById('loginUsername') as HTMLInputElement).value;
      const passwordInput = (document.getElementById('loginPassword') as HTMLInputElement).value;

      const result = await db.login(usernameInput, passwordInput);
      if (!result.ok) {
        if (errBox && errText) {
          errText.textContent = result.error || 'Invalid credentials.';
          errBox.classList.remove('hidden');
        }
        showToast(result.error || 'Invalid username or password.', 'danger');
        return;
      }

      showToast(`Logged in successfully as ${db.getCurrentUser()?.name}!`, 'success');
      navigateTo('dashboard');
    });
  }
}

// -----------------------------------------------------------------------------
// 2. DASHBOARD PAGE (With Live Statistics & Charts)
// -----------------------------------------------------------------------------
function getVisibleStudents(): Student[] {
  const user = db.getCurrentUser();
  const all = db.getStudents();
  if (user && (user.role === 'Student' || user.role === 'Parent/Guardian') && user.student_id) {
    return all.filter((s) => s.id === user.student_id);
  }
  return all;
}

function getVisibleAttendance(): AttendanceRecord[] {
  const user = db.getCurrentUser();
  const all = db.getAttendance();
  if (user && (user.role === 'Student' || user.role === 'Parent/Guardian') && user.student_id) {
    return all.filter((a) => a.student_id === user.student_id);
  }
  return all;
}

function renderDashboardPage(): string {
  const students = getVisibleStudents();
  const attendance = getVisibleAttendance();
  const todayStr = getLocalDateString();
  const threshold = db.getSettings().attendance_threshold;

  const todayLogs = attendance.filter((a) => a.date === todayStr);
  const totalStudents = students.length;
  const presentToday = todayLogs.filter((a) => a.status === 'Present').length;
  const absentToday = todayLogs.filter((a) => a.status === 'Absent').length;

  let attendancePercentage = 0;
  if (todayLogs.length > 0) {
    attendancePercentage = Math.round((presentToday / todayLogs.length) * 1000) / 10;
  } else if (attendance.length > 0) {
    const totalPresent = attendance.filter((a) => a.status === 'Present').length;
    attendancePercentage = Math.round((totalPresent / attendance.length) * 1000) / 10;
  }

  const allLowAtt = db.getLowAttendanceStudents();
  const user = db.getCurrentUser();
  const lowAttList =
    user && (user.role === 'Student' || user.role === 'Parent/Guardian') && user.student_id
      ? allLowAtt.filter((x) => x.student.id === user.student_id)
      : allLowAtt;

  const recentLogs = [...attendance].reverse().slice(0, 8);
  const canEdit = db.canModifyDatabase();

  return `
    <div class="dashboard-container">
      <!-- Welcome Banner -->
      <div class="welcome-card">
        <div class="welcome-text">
          <h2>Welcome to Smart Attendance Management Portal</h2>
          <p>
            TY BSc Computer Science Project by <strong>Sahil Pasula</strong> (Roll: <strong>TYBSC-A-39</strong>, Seat: <strong>24TCS076</strong>).
            Real-time facial recognition check-in, SQLite data persistence, lecture reports, and ${threshold}% attendance compliance warnings.
          </p>
        </div>
        <div class="welcome-actions">
          ${canEdit ? `
            <a href="#camera-scanner" class="btn btn-success" data-nav="camera-scanner">
              <i class="fa-solid fa-camera"></i> AI Face Scanner
            </a>
            <a href="#attendance" class="btn btn-primary" data-nav="attendance">
              <i class="fa-solid fa-clipboard-user"></i> Manual Roll Call
            </a>
          ` : ''}
          <a href="#synopsis" class="btn btn-outline" data-nav="synopsis" style="color:white; border-color:rgba(255,255,255,0.4);">
            <i class="fa-solid fa-file-lines"></i> View Synopsis PDF
          </a>
        </div>
      </div>

      <!-- 4 Metric Cards -->
      <div class="stats-grid">
        <div class="stat-card stat-blue">
          <div class="stat-icon"><i class="fa-solid fa-users"></i></div>
          <div class="stat-details">
            <span class="stat-label">${user?.role === 'Student' || user?.role === 'Parent/Guardian' ? 'Monitored Student' : 'Total Enrolled Students'}</span>
            <h3 class="stat-value">${totalStudents}</h3>
            <span class="stat-hint"><i class="fa-solid fa-database"></i> SQLite <code>students</code> table</span>
          </div>
        </div>

        <div class="stat-card stat-green">
          <div class="stat-icon"><i class="fa-solid fa-user-check"></i></div>
          <div class="stat-details">
            <span class="stat-label">Present Today</span>
            <h3 class="stat-value">${presentToday}</h3>
            <span class="stat-hint"><i class="fa-regular fa-calendar"></i> Date: ${todayStr}</span>
          </div>
        </div>

        <div class="stat-card stat-red">
          <div class="stat-icon"><i class="fa-solid fa-user-xmark"></i></div>
          <div class="stat-details">
            <span class="stat-label">Absent Today</span>
            <h3 class="stat-value">${absentToday}</h3>
            <span class="stat-hint"><i class="fa-regular fa-clock"></i> Lecture sessions</span>
          </div>
        </div>

        <div class="stat-card stat-purple">
          <div class="stat-icon"><i class="fa-solid fa-chart-pie"></i></div>
          <div class="stat-details">
            <span class="stat-label">${todayLogs.length > 0 ? "Today's Attendance Rate" : 'Overall Attendance Rate'}</span>
            <h3 class="stat-value">${attendancePercentage}%</h3>
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill ${attendancePercentage >= threshold ? 'bg-success' : 'bg-warning'}" style="width: ${attendancePercentage}%;"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Live Dashboard Charts -->
      <div class="dashboard-charts-grid">
        <div class="card">
          <div class="card-header">
            <div class="card-title">
              <i class="fa-solid fa-chart-pie"></i>
              <div>
                <h3>Today's Attendance Split</h3>
                <p class="card-subtitle">${todayStr} live breakdown</p>
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="chart-canvas-wrap">
              <canvas id="dashboardDonutChart" width="280" height="200"></canvas>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">
              <i class="fa-solid fa-chart-column"></i>
              <div>
                <h3>7-Day Attendance Rate Trend (%)</h3>
                <p class="card-subtitle">Dashed line shows ${threshold}% compliance requirement</p>
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="chart-canvas-wrap">
              <canvas id="dashboardTrendChart" width="460" height="200"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Warning Banner when attendance is below threshold -->
      ${lowAttList.length > 0 ? `
        <div class="alert-banner-warning">
          <div class="warning-header">
            <div class="warning-title">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <div>
                <h4>Mandatory ${threshold}% Attendance Shortage Warning</h4>
                <p><strong>${lowAttList.length} student(s)</strong> currently fail to meet the mandatory ${threshold}% attendance threshold. Hall ticket eligibility is at risk.</p>
              </div>
            </div>
            <a href="#notifications" class="btn btn-sm btn-outline-danger" data-nav="notifications">
              View Defaulters &amp; Alerts <i class="fa-solid fa-arrow-right"></i>
            </a>
          </div>
          <div class="low-att-pills">
            ${lowAttList.map((item) => `
              <div class="low-att-pill">
                <strong>${escapeHtml(item.student.name)}</strong> (${escapeHtml(item.student.roll_number)}):
                <span class="danger-badge">${item.percentage}%</span>
                <small>(${item.present}/${item.total} lectures)</small>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Columns Layout -->
      <div class="dashboard-columns">
        <div class="card col-span-2">
          <div class="card-header">
            <div class="card-title">
              <i class="fa-solid fa-clock-rotate-left"></i>
              <h3>Recent Attendance Audit Log</h3>
            </div>
            <a href="#records" class="btn btn-sm btn-outline" data-nav="records">Full History <i class="fa-solid fa-arrow-right"></i></a>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Roll No</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Subject</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${recentLogs.map((log) => {
                  const st = db.getStudent(log.student_id);
                  return `
                    <tr>
                      <td><strong>${escapeHtml(st ? st.name : 'Student #' + log.student_id)}</strong></td>
                      <td><span class="tag-code">${escapeHtml(st ? st.roll_number : '-')}</span></td>
                      <td>${escapeHtml(log.date)}</td>
                      <td><span class="tag-time"><i class="fa-regular fa-clock"></i> ${escapeHtml(log.time)}</span></td>
                      <td><small class="text-muted">${escapeHtml(log.subject || 'CS Theory')}</small></td>
                      <td>
                        <span class="badge-role" style="font-size:11px; padding:2px 6px;">
                          <i class="fa-solid ${log.method === 'Face Recognition' ? 'fa-camera' : 'fa-clipboard-user'}"></i>
                          ${escapeHtml(log.method || 'Manual')}
                        </span>
                      </td>
                      <td>
                        <span class="status-badge ${log.status === 'Present' ? 'badge-present' : 'badge-absent'}">
                          <i class="fa-solid ${log.status === 'Present' ? 'fa-check' : 'fa-xmark'}"></i> ${escapeHtml(log.status)}
                        </span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Academic & Synopsis Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">
              <i class="fa-solid fa-award"></i>
              <h3>Candidate &amp; Project Details</h3>
            </div>
          </div>
          <div class="card-body">
            <ul class="project-spec-list">
              <li>
                <span class="spec-label"><i class="fa-solid fa-user-graduate"></i> Student:</span>
                <span class="spec-val">Sahil Pasula</span>
              </li>
              <li>
                <span class="spec-label"><i class="fa-solid fa-id-badge"></i> Class:</span>
                <span class="spec-val">TYBSC-A-39</span>
              </li>
              <li>
                <span class="spec-label"><i class="fa-solid fa-ticket"></i> Seat No:</span>
                <span class="spec-val">24TCS076</span>
              </li>
              <li>
                <span class="spec-label"><i class="fa-brands fa-python"></i> Framework:</span>
                <span class="spec-val">Python Flask (WSGI)</span>
              </li>
              <li>
                <span class="spec-label"><i class="fa-solid fa-database"></i> Database:</span>
                <span class="spec-val">SQLite3 (<code>smart_attendance.db</code>)</span>
              </li>
              <li>
                <span class="spec-label"><i class="fa-solid fa-brain"></i> Recognition:</span>
                <span class="spec-val">128-d Face Embeddings (ML)</span>
              </li>
            </ul>

            <hr class="card-divider">

            <div class="quick-nav-box">
              <span class="box-title">Examination Readiness:</span>
              <div class="quick-nav-buttons">
                <a href="#synopsis" class="btn btn-sm btn-primary" data-nav="synopsis"><i class="fa-solid fa-file-lines"></i> Read Synopsis</a>
                <a href="#viva-defense" class="btn btn-sm btn-outline" data-nav="viva-defense"><i class="fa-solid fa-chalkboard-user"></i> Viva Q&amp;A</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDashboardCharts() {
  const students = getVisibleStudents();
  const attendance = getVisibleAttendance();
  const todayStr = getLocalDateString();
  const threshold = db.getSettings().attendance_threshold;

  // 1. Donut Chart: Today's Present / Absent / Unmarked
  const donutCanvas = document.getElementById('dashboardDonutChart') as HTMLCanvasElement | null;
  if (donutCanvas) {
    const ctx = donutCanvas.getContext('2d');
    if (ctx) {
      const todayLogs = attendance.filter((a) => a.date === todayStr);
      const presentIds = new Set(todayLogs.filter((a) => a.status === 'Present').map((a) => a.student_id));
      const absentIds = new Set(todayLogs.filter((a) => a.status === 'Absent' && !presentIds.has(a.student_id)).map((a) => a.student_id));
      const present = presentIds.size;
      const absent = absentIds.size;
      const unmarked = Math.max(0, students.length - present - absent);

      ctx.clearRect(0, 0, donutCanvas.width, donutCanvas.height);
      const total = Math.max(1, present + absent + unmarked);
      const cx = 85;
      const cy = 100;
      const r = 64;
      const slices = [
        { label: `Present (${present})`, val: present, color: '#16a34a' },
        { label: `Absent (${absent})`, val: absent, color: '#dc2626' },
        { label: `Unmarked (${unmarked})`, val: unmarked, color: '#cbd5e1' },
      ];

      let startAngle = -Math.PI / 2;
      slices.forEach((s) => {
        if (s.val <= 0) return;
        const sliceAngle = (s.val / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.fill();
        startAngle += sliceAngle;
      });

      // Inner hole
      ctx.beginPath();
      ctx.arc(cx, cy, 38, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      const rate = present + absent > 0 ? Math.round((present / (present + absent)) * 100) : 0;
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${rate}%`, cx, cy + 5);

      // Legend
      ctx.textAlign = 'left';
      slices.forEach((s, i) => {
        const y = 66 + i * 28;
        ctx.fillStyle = s.color;
        ctx.fillRect(168, y - 10, 12, 12);
        ctx.fillStyle = '#334155';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillText(s.label, 186, y);
      });
    }
  }

  // 2. 7-Day Bar Chart
  const trendCanvas = document.getElementById('dashboardTrendChart') as HTMLCanvasElement | null;
  if (trendCanvas) {
    const ctx = trendCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, trendCanvas.width, trendCanvas.height);
      const days: { label: string; pct: number }[] = [];
      const now = new Date();
      for (let d = 6; d >= 0; d--) {
        const dt = new Date(now);
        dt.setDate(now.getDate() - d);
        const ds = getLocalDateString(dt);
        const dayLogs = attendance.filter((a) => a.date === ds);
        const p = dayLogs.filter((a) => a.status === 'Present').length;
        const pct = dayLogs.length > 0 ? Math.round((p / dayLogs.length) * 100) : 0;
        days.push({ label: ds.slice(5), pct });
      }

      const padLeft = 36;
      const padBottom = 26;
      const padTop = 18;
      const chartW = trendCanvas.width - padLeft - 14;
      const chartH = trendCanvas.height - padTop - padBottom;

      // Grid lines
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      [0, 50, 100].forEach((val) => {
        const y = padTop + chartH - (val / 100) * chartH;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();
        ctx.fillStyle = '#64748b';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${val}%`, padLeft - 6, y + 3);
      });

      // Bars
      const slotW = chartW / days.length;
      const barW = Math.min(34, slotW * 0.56);
      days.forEach((day, i) => {
        const x = padLeft + i * slotW + (slotW - barW) / 2;
        const h = (day.pct / 100) * chartH;
        const y = padTop + chartH - h;
        ctx.fillStyle = day.pct >= threshold ? '#2563eb' : day.pct > 0 ? '#d97706' : '#e2e8f0';
        ctx.fillRect(x, y, barW, Math.max(2, h));

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        if (day.pct > 0) ctx.fillText(`${day.pct}%`, x + barW / 2, Math.max(12, y - 4));

        ctx.fillStyle = '#475569';
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText(day.label, x + barW / 2, padTop + chartH + 16);
      });

      // Threshold dashed line
      const threshY = padTop + chartH - (threshold / 100) * chartH;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, threshY);
      ctx.lineTo(padLeft + chartW, threshY);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// -----------------------------------------------------------------------------
// 4. REAL AUTOMATED FACE RECOGNITION SCANNER MODULE
// -----------------------------------------------------------------------------
function renderCameraScannerPage(): string {
  const students = db.getStudents();
  const todayStr = getLocalDateString();
  const logsToday = db.getAttendance().filter((a) => a.date === todayStr);
  const enrolledCount = students.filter((s) => faceEngine.isStudentEnrolled(s.id)).length;
  const settings = db.getSettings();

  return `
    <div class="camera-scanner-container">
      <div class="welcome-card" style="background: linear-gradient(135deg, #090d16, #1e293b); margin-bottom: 20px;">
        <div class="welcome-text">
          <div style="display:inline-flex; align-items:center; gap:8px; background:rgba(34,197,94,0.15); color:#4ade80; padding:4px 10px; border-radius:9999px; font-size:12px; font-weight:600; margin-bottom:10px;">
            <i class="fa-solid fa-camera"></i> MODULE 2 &bull; REAL BIOMETRIC FACE RECOGNITION
          </div>
          <h2 style="color:#ffffff;">Live Facial Recognition Entry Scanner</h2>
          <p style="color:#94a3b8;">
            Detects faces via neural network bounding box + 68 landmarks, computes real 128-d face embeddings, matches via Euclidean distance (&le; ${settings.face_distance_threshold}), rejects unknown faces, and prevents duplicate attendance.
          </p>
        </div>
        <div class="welcome-actions">
          <a href="#attendance" class="btn btn-outline" data-nav="attendance" style="color:white; border-color:rgba(255,255,255,0.4);">
            <i class="fa-solid fa-clipboard-user"></i> Switch to Manual Roll Call
          </a>
        </div>
      </div>

      <div class="camera-scanner-wrapper">
        <!-- Left: Live Camera Viewport -->
        <div class="card" style="background:#090d16; border-color:#1e293b; color:#ffffff;">
          <div class="scanner-hud-top">
            <div>
              <span class="live-indicator-dot" id="cameraLiveDot" style="background:#64748b; animation:none;"></span>
              <strong style="margin-left:6px;" id="cameraFeedLabel">CAMERA STANDBY</strong>
            </div>
            <div>
              <span id="biometricIndexStatus">INDEX: ${enrolledCount}/${students.length} ENROLLED</span>
            </div>
          </div>

          <div class="scanner-feed-box" id="scannerViewport">
            <video id="webcamElement" class="scanner-video" autoplay playsinline muted></video>
            <canvas id="scannerCanvas" class="scanner-canvas-overlay"></canvas>

            <!-- Idle / Error Placeholder (Never shows fake camera simulation) -->
            <div id="cameraIdlePlaceholder" class="scanner-video" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; background:#0f172a;">
              <i class="fa-solid fa-video-slash fa-3x" style="color:#38bdf8; margin-bottom:12px;"></i>
              <h4 style="color:#f8fafc; margin-bottom:6px;">Webcam Inactive</h4>
              <p id="cameraStatusText" style="color:#94a3b8; font-size:12.5px; max-width:320px;">
                Click <strong>Start Webcam Feed</strong> to allow camera access on desktop or Android Chrome, or test biometric matching by uploading a face photo below.
              </p>
            </div>

            <!-- Optical overlay -->
            <div class="scanner-overlay">
              <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <span class="scanner-hud-tag" style="background:rgba(0,0,0,0.7); padding:4px 8px; border-radius:4px; font-size:11px; font-family:monospace; color:#38bdf8;">
                  [128-D FACE EMBEDDING ENGINE]
                </span>
                <span id="livenessBadge" style="background:rgba(34,197,94,0.2); color:#4ade80; border:1px solid #22c55e; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:600;">
                  <i class="fa-solid fa-shield-halved"></i> UNKNOWN REJECT: ON
                </span>
              </div>

              <div class="scanner-reticle-box" id="scannerReticle">
                <span class="scanner-corner tl"></span>
                <span class="scanner-corner tr"></span>
                <span class="scanner-corner bl"></span>
                <span class="scanner-corner br"></span>
                <div class="scanner-line"></div>
                <div id="matchNoticeTag" style="position:absolute; bottom:-30px; background:#22c55e; color:#000; font-weight:700; font-size:11px; padding:3px 10px; border-radius:4px; display:none;">
                  MATCH CONFIRMED
                </div>
              </div>

              <div class="scanner-hud-bottom">
                <div>
                  <div style="font-size:12px; font-weight:700;" id="hudMatchName">Waiting for camera or photo input...</div>
                  <div style="font-size:11px; color:#94a3b8;" id="hudMatchDetails">Models initializing in background</div>
                </div>
                <div>
                  <span id="hudConfidenceScore" style="font-family:monospace; color:#38bdf8; font-weight:700;">SIMILARITY: --%</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Subject & Controls -->
          <div style="padding: 16px; display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <label for="scannerSubjectSelect" style="font-size:12px; color:#cbd5e1; font-weight:600;">Subject:</label>
                <select id="scannerSubjectSelect" class="form-control" style="background:#1e293b; color:#ffffff; border-color:#334155; width:auto; font-size:12px; padding:4px 8px;">
                  ${SUBJECTS.map((subj) => `<option value="${escapeHtml(subj)}" ${subj === scannerActiveSubject ? 'selected' : ''}>${escapeHtml(subj)}</option>`).join('')}
                </select>
              </div>
              <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#cbd5e1; cursor:pointer;">
                <input type="checkbox" id="autoMarkCheckbox" ${autoMarkEnabled ? 'checked' : ''}>
                Auto-mark on stable match
              </label>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn btn-sm btn-primary" id="btnToggleRealCamera" type="button">
                  <i class="fa-solid fa-video"></i> Start Webcam Feed
                </button>
                <button class="btn btn-sm btn-success" id="btnCaptureEntry" type="button">
                  <i class="fa-solid fa-camera-rotate"></i> Scan &amp; Verify Face
                </button>
              </div>

              <div style="display:flex; align-items:center; gap:8px;">
                <input type="file" id="verifyPhotoInput" accept="image/*" style="display:none;">
                <label for="verifyPhotoInput" class="btn btn-sm btn-outline" style="color:#ffffff; border-color:#475569; cursor:pointer; margin:0;">
                  <i class="fa-solid fa-image"></i> Verify Photo File
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Verification Result & Today's Live Attendance Feed -->
        <div class="scanner-details-panel">
          <div class="card" id="verifiedStudentCard" style="border-left: 4px solid #38bdf8;">
            <div class="card-header">
              <div class="card-title">
                <i class="fa-solid fa-id-card-clip text-primary"></i>
                <div>
                  <h3 style="font-size:16px;">Verification Result</h3>
                  <p class="card-subtitle">Real biometric matching against enrolled students</p>
                </div>
              </div>
              <span class="badge-role" style="background:#e2e8f0; color:#334155;" id="verifiedStatusBadge">Standby</span>
            </div>

            <div class="card-body" id="verifiedCardBody">
              <div style="display:flex; gap:16px; align-items:center;">
                <div class="table-avatar" style="width:72px; height:72px; border-radius:12px; overflow:hidden; border:2px solid #cbd5e1; background:#f1f5f9; display:flex; align-items:center; justify-content:center;">
                  <img id="verifiedAvatar" src="https://ui-avatars.com/api/?name=Scan&background=0f172a&color=fff" alt="Student" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div>
                  <h4 id="verifiedName" style="margin:0 0 4px 0; font-size:18px; color:var(--text-primary);">No Scan Yet</h4>
                  <div style="font-size:12px; color:var(--text-muted);">
                    <div>Roll No: <strong id="verifiedRoll" class="tag-code">--</strong></div>
                    <div>Seat No: <strong id="verifiedSeat" class="tag-code-alt">--</strong></div>
                    <div>Class: <strong id="verifiedClass">--</strong></div>
                  </div>
                </div>
              </div>

              <div style="margin-top:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; font-size:12px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div><i class="fa-regular fa-clock"></i> Timestamp: <strong id="verifiedTimestamp">--:--:--</strong></div>
                <div><i class="fa-solid fa-ruler-horizontal"></i> Match Score: <strong id="verifiedScoreText">--</strong></div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <i class="fa-solid fa-list-check"></i>
                <div>
                  <h3 style="font-size:15px;">Today's Entry Feed (${todayStr})</h3>
                  <p class="card-subtitle" id="todayEntryCountLabel">${logsToday.filter((l) => l.status === 'Present').length} Present record(s) today</p>
                </div>
              </div>
              <a href="#records" class="btn btn-sm btn-outline" data-nav="records">Full Log</a>
            </div>

            <div class="table-responsive" style="max-height: 250px; overflow-y:auto;">
              <table class="data-table" style="font-size:12.5px;">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Time</th>
                    <th>Subject</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="todayEntryTableBody">
                  ${logsToday
                    .filter((l) => l.status === 'Present')
                    .map((l) => {
                      const st = db.getStudent(l.student_id);
                      return `
                        <tr>
                          <td><strong>${escapeHtml(st ? st.name : 'Student #' + l.student_id)}</strong></td>
                          <td><span class="tag-time">${escapeHtml(l.time)}</span></td>
                          <td><small>${escapeHtml(l.subject || 'CS')}</small></td>
                          <td><span class="status-badge badge-present"><i class="fa-solid fa-check"></i> Present</span></td>
                        </tr>
                      `;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 5. MANUAL CLASSROOM ROLL CALL PAGE
// -----------------------------------------------------------------------------
function renderAttendancePage(): string {
  const students = db.getStudents();
  const dateStr = selectedAttendanceDate;
  const subj = selectedAttendanceSubject;
  const existingForDateSubj = db
    .getAttendance()
    .filter((a) => a.date === dateStr && (a.subject || SUBJECTS[0]) === subj);

  const statusMap = new Map<number, 'Present' | 'Absent'>();
  existingForDateSubj.forEach((a) => statusMap.set(a.student_id, a.status));

  let presentCount = 0;
  let absentCount = 0;

  students.forEach((s) => {
    const st = statusMap.get(s.id) || 'Present';
    if (st === 'Present') presentCount++;
    else absentCount++;
  });

  return `
    <div class="attendance-page-container">
      <div class="card">
        <div class="card-header attendance-toolbar">
          <div class="card-title">
            <i class="fa-solid fa-clipboard-user"></i>
            <div>
              <h3>Classroom Roll Call (Manual Attendance)</h3>
              <p class="card-subtitle">Mark present/absent per date &amp; subject without overwriting other lectures</p>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <a href="#camera-scanner" class="btn btn-sm btn-success" data-nav="camera-scanner">
              <i class="fa-solid fa-camera"></i> Switch to AI Face Scanner
            </a>
            <div class="date-picker-form">
              <label for="attDateSelect"><i class="fa-regular fa-calendar"></i> Date:</label>
              <input type="date" id="attDateSelect" value="${escapeHtml(dateStr)}" class="form-control date-input">
            </div>
          </div>
        </div>

        <div class="card-body">
          <div style="margin-bottom: 16px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
            <label for="lectureSubjectSelect" style="font-weight:600; font-size:13px;"><i class="fa-solid fa-book"></i> Lecture Subject:</label>
            <select id="lectureSubjectSelect" class="form-control" style="width:auto; max-width:100%;">
              ${SUBJECTS.map((s) => `<option value="${escapeHtml(s)}" ${s === subj ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            </select>
          </div>

          ${existingForDateSubj.length > 0 ? `
            <div class="alert alert-info" style="margin-bottom:14px;">
              <div class="alert-icon"><i class="fa-solid fa-circle-info"></i></div>
              <span>Existing attendance found for <strong>${escapeHtml(dateStr)}</strong> &bull; <strong>${escapeHtml(subj)}</strong>. Saving will update those entries cleanly without creating duplicate rows.</span>
            </div>
          ` : ''}

          <div class="attendance-control-bar">
            <div class="batch-buttons">
              <button type="button" class="btn btn-sm btn-outline-success" id="btnMarkAllPresent">
                <i class="fa-solid fa-check-double"></i> Mark All Present
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger" id="btnMarkAllAbsent">
                <i class="fa-solid fa-xmark"></i> Mark All Absent
              </button>
            </div>

            <div class="live-counter-chips">
              <span class="chip chip-total">Total: <strong>${students.length}</strong></span>
              <span class="chip chip-present">Present: <strong id="chipLivePresent">${presentCount}</strong></span>
              <span class="chip chip-absent">Absent: <strong id="chipLiveAbsent">${absentCount}</strong></span>
            </div>
          </div>

          <form id="attendanceMarkingForm">
            <div class="table-responsive">
              <table class="data-table attendance-table">
                <thead>
                  <tr>
                    <th style="width: 50px;">#</th>
                    <th style="width: 70px;">Photo</th>
                    <th>Student Name</th>
                    <th>Roll Number</th>
                    <th>Seat Number</th>
                    <th>Class</th>
                    <th style="width: 240px;" class="text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${students
                    .map((s, idx) => {
                      const status = statusMap.get(s.id) || 'Present';
                      return `
                        <tr class="student-row ${status === 'Present' ? 'row-present' : 'row-absent'}" id="row_${s.id}">
                          <td>${idx + 1}</td>
                          <td>
                            <div class="table-avatar">
                              <img src="${escapeHtml(s.photo)}" alt="${escapeHtml(s.name)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=0284c7&color=fff'">
                            </div>
                          </td>
                          <td><strong>${escapeHtml(s.name)}</strong></td>
                          <td><span class="tag-code">${escapeHtml(s.roll_number)}</span></td>
                          <td><span class="tag-code-alt">${escapeHtml(s.seat_number)}</span></td>
                          <td>${escapeHtml(s.class)}</td>
                          <td class="text-center">
                            <div class="status-toggle-group">
                              <label class="toggle-option present-option">
                                <input type="radio" name="att_status_${s.id}" value="Present" ${status === 'Present' ? 'checked' : ''} onchange="window.updateAttendanceLiveCount()">
                                <span class="toggle-btn"><i class="fa-solid fa-check"></i> Present</span>
                              </label>
                              <label class="toggle-option absent-option">
                                <input type="radio" name="att_status_${s.id}" value="Absent" ${status === 'Absent' ? 'checked' : ''} onchange="window.updateAttendanceLiveCount()">
                                <span class="toggle-btn"><i class="fa-solid fa-xmark"></i> Absent</span>
                              </label>
                            </div>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>

            <div class="attendance-submit-bar">
              <div class="timestamp-indicator">
                <i class="fa-solid fa-clock"></i> Local Timestamp (${getLocalTimeString()}) will be saved permanently
              </div>
              <button type="submit" class="btn btn-success btn-lg" id="btnSaveAttendance">
                <i class="fa-solid fa-check-circle"></i> Save Attendance with Date &amp; Time
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 6. ATTENDANCE RECORDS & AUDIT TRAIL PAGE
// -----------------------------------------------------------------------------
function renderRecordsPage(): string {
  const records = getVisibleAttendance();
  const students = db.getStudents();
  const classes = db.getClasses();
  const studentMap = new Map<number, Student>();
  students.forEach((s) => studentMap.set(s.id, s));

  const sorted = [...records].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  const canEdit = db.canModifyDatabase();

  return `
    <div class="records-page-container">
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-list-check"></i>
            <div>
              <h3>Attendance Records History</h3>
              <p class="card-subtitle">Student Name, Roll Number, Date, Time, Subject, Status</p>
            </div>
          </div>
          <div class="header-actions">
            <button class="btn btn-sm btn-outline" type="button" onclick="window.print()">
              <i class="fa-solid fa-print"></i> Print
            </button>
            <button class="btn btn-sm btn-outline" type="button" onclick="window.exportRecordsPDF()">
              <i class="fa-solid fa-file-pdf text-danger"></i> Export PDF
            </button>
            <button class="btn btn-sm btn-outline" type="button" onclick="window.exportAttendanceCSV()">
              <i class="fa-solid fa-file-csv"></i> Export CSV
            </button>
            ${canEdit ? `
              <a href="#camera-scanner" class="btn btn-sm btn-success" data-nav="camera-scanner">
                <i class="fa-solid fa-camera"></i> Face Scanner
              </a>
              <a href="#attendance" class="btn btn-sm btn-primary" data-nav="attendance">
                <i class="fa-solid fa-plus"></i> Roll Call
              </a>
            ` : ''}
          </div>
        </div>

        <div class="card-body">
          <div class="filter-toolbar">
            <div class="filter-group">
              <label for="recordsDateFilter"><i class="fa-regular fa-calendar"></i> Date:</label>
              <input type="date" id="recordsDateFilter" class="form-control" onchange="window.filterRecordsTable()">
            </div>
            <div class="filter-group">
              <label for="recordsClassFilter"><i class="fa-solid fa-graduation-cap"></i> Class:</label>
              <select id="recordsClassFilter" class="form-control" onchange="window.filterRecordsTable()">
                <option value="">All Classes</option>
                ${classes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            <div class="filter-group">
              <label for="recordsStatusFilter"><i class="fa-solid fa-filter"></i> Status:</label>
              <select id="recordsStatusFilter" class="form-control" onchange="window.filterRecordsTable()">
                <option value="">All Statuses</option>
                <option value="Present">Present Only</option>
                <option value="Absent">Absent Only</option>
              </select>
            </div>
            <div class="filter-group search-group" style="flex:1;">
              <label for="recordsSearch"><i class="fa-solid fa-magnifying-glass"></i> Search:</label>
              <input type="text" id="recordsSearch" class="form-control" placeholder="Search by student name or roll number..." oninput="window.filterRecordsTable()">
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table" id="allRecordsTable">
              <thead>
                <tr>
                  <th style="width: 50px;">#</th>
                  <th>Student Name</th>
                  <th>Roll Number</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Subject</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Marked By</th>
                </tr>
              </thead>
              <tbody id="recordsTbody">
                ${sorted
                  .map((r, i) => {
                    const s = studentMap.get(r.student_id);
                    return `
                      <tr data-date="${escapeHtml(r.date)}" data-class="${escapeHtml(s ? s.class : '')}" data-status="${escapeHtml(r.status)}" data-search="${escapeHtml((s ? s.name + ' ' + s.roll_number : '').toLowerCase())}">
                        <td>${i + 1}</td>
                        <td>
                          <strong>${escapeHtml(s ? s.name : 'Unknown')}</strong>
                          <small class="text-muted block">${escapeHtml(s ? s.class : '')}</small>
                        </td>
                        <td><span class="tag-code">${escapeHtml(s ? s.roll_number : '-')}</span></td>
                        <td><strong>${escapeHtml(r.date)}</strong></td>
                        <td><span class="tag-time"><i class="fa-regular fa-clock"></i> ${escapeHtml(r.time)}</span></td>
                        <td><small class="text-muted">${escapeHtml(r.subject || 'CS')}</small></td>
                        <td><span class="badge-role" style="font-size:11px; padding:2px 6px;">${escapeHtml(r.method || 'Manual')}</span></td>
                        <td>
                          <span class="status-badge ${r.status === 'Present' ? 'badge-present' : 'badge-absent'}">
                            <i class="fa-solid ${r.status === 'Present' ? 'fa-check' : 'fa-xmark'}"></i> ${escapeHtml(r.status)}
                          </span>
                        </td>
                        <td><small class="text-muted">${escapeHtml(r.marked_by)}</small></td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>

          <div class="table-summary-bar">
            <span>Showing <strong id="recordsCount">${sorted.length}</strong> total records</span>
            <span class="text-muted"><i class="fa-solid fa-database"></i> Stored in <code>attendance</code> table</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 7. REPORTS & ANALYTICS PAGE (Daily, Monthly, Cumulative, Subject, Defaulters, PDF/CSV)
// -----------------------------------------------------------------------------
function renderReportsPage(): string {
  const allStudents = getVisibleStudents();
  const students = selectedReportClass
    ? allStudents.filter((s) => s.class === selectedReportClass)
    : allStudents;
  const attendance = getVisibleAttendance();
  const classes = db.getClasses();
  const threshold = db.getSettings().attendance_threshold;

  return `
    <div class="reports-page-container">
      <div class="report-nav-tabs">
        <button type="button" class="report-tab ${currentReportType === 'student' ? 'active' : ''}" onclick="window.switchReport('student')">
          <i class="fa-solid fa-user-graduate"></i> Cumulative Percentage Report
        </button>
        <button type="button" class="report-tab ${currentReportType === 'daily' ? 'active' : ''}" onclick="window.switchReport('daily')">
          <i class="fa-solid fa-calendar-day"></i> Daily Attendance Sheet
        </button>
        <button type="button" class="report-tab ${currentReportType === 'monthly' ? 'active' : ''}" onclick="window.switchReport('monthly')">
          <i class="fa-solid fa-calendar-days"></i> Monthly Aggregation
        </button>
        <button type="button" class="report-tab ${currentReportType === 'subject' ? 'active' : ''}" onclick="window.switchReport('subject')">
          <i class="fa-solid fa-book"></i> Subject-Wise Breakdown
        </button>
        <button type="button" class="report-tab ${currentReportType === 'notice-board' ? 'active' : ''}" onclick="window.switchReport('notice-board')">
          <i class="fa-solid fa-bullhorn"></i> College Notice Board (Defaulters)
        </button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-chart-column"></i>
            <div>
              <h3>${
                currentReportType === 'student'
                  ? `Cumulative Student Attendance & ${threshold}% Rule Calculation`
                  : currentReportType === 'daily'
                    ? 'Daily Classroom Attendance Register'
                    : currentReportType === 'monthly'
                      ? 'Monthly Attendance Aggregation Report'
                      : currentReportType === 'subject'
                        ? 'Subject-wise Lecture Attendance Report'
                        : `Official College Notice Board - Attendance Defaulters List (< ${threshold}%)`
              }</h3>
              <p class="card-subtitle">Automated percentage calculation with class-wise filtering, CSV &amp; PDF export</p>
            </div>
          </div>
          <div class="header-actions">
            <button type="button" class="btn btn-sm btn-outline" onclick="window.print()">
              <i class="fa-solid fa-print"></i> Print
            </button>
            <button type="button" class="btn btn-sm btn-outline" id="btnExportReportPDF" onclick="window.exportActiveReportPDF()">
              <i class="fa-solid fa-file-pdf text-danger"></i> Download PDF
            </button>
            <button type="button" class="btn btn-sm btn-outline" onclick="window.exportActiveReportCSV()">
              <i class="fa-solid fa-file-csv"></i> Download CSV
            </button>
          </div>
        </div>

        <div class="card-body">
          <div class="filter-toolbar" style="margin-bottom: 16px;">
            <div class="filter-group">
              <label for="reportClassFilter"><i class="fa-solid fa-graduation-cap"></i> Filter by Class:</label>
              <select id="reportClassFilter" class="form-control" onchange="window.changeReportClass(this.value)">
                <option value="">All Classes</option>
                ${classes.map((c) => `<option value="${escapeHtml(c)}" ${c === selectedReportClass ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            ${
              currentReportType === 'daily'
                ? `
                  <div class="filter-group">
                    <label for="dailyReportDateInput"><i class="fa-regular fa-calendar"></i> Select Date:</label>
                    <input type="date" id="dailyReportDateInput" value="${escapeHtml(selectedAttendanceDate)}" class="form-control" onchange="window.changeDailyReportDate(this.value)">
                  </div>
                `
                : currentReportType === 'monthly'
                  ? `
                    <div class="filter-group">
                      <label for="monthlyReportInput"><i class="fa-regular fa-calendar"></i> Select Month:</label>
                      <input type="month" id="monthlyReportInput" value="${escapeHtml(selectedReportMonth)}" class="form-control" onchange="window.changeMonthlyReportMonth(this.value)">
                    </div>
                  `
                  : ''
            }
          </div>

          ${renderSpecificReport(students, attendance, threshold)}
        </div>
      </div>
    </div>
  `;
}

function renderSpecificReport(
  students: Student[],
  attendance: AttendanceRecord[],
  threshold: number
): string {
  if (currentReportType === 'student') {
    return `
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 18px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <span style="font-weight:700; color:var(--text-primary);"><i class="fa-solid fa-square-root-variable text-primary"></i> Attendance Percentage Formula:</span>
          <code style="background:#0f172a; color:#38bdf8; padding:3px 8px; border-radius:4px; margin-left:8px; font-size:12.5px;">
            Percentage = (Total Present / Total Lectures) &times; 100
          </code>
        </div>
        <div style="font-size:12px; color:var(--text-muted);">
          <span>Rule: <strong>&ge; ${threshold}%</strong> = Eligible &bull; <strong>&lt; ${threshold}%</strong> = Defaulter</span>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 50px;">#</th>
              <th>Student Name</th>
              <th>Roll Number</th>
              <th>Seat Number</th>
              <th>Class</th>
              <th>Total Lectures</th>
              <th>Present</th>
              <th>Absent</th>
              <th style="width: 170px;">Attendance %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${students
              .map((s, idx) => {
                const logs = attendance.filter((a) => a.student_id === s.id);
                const total = logs.length;
                const present = logs.filter((a) => a.status === 'Present').length;
                const absent = total - present;
                const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
                const isShortage = pct < threshold && total > 0;

                return `
                  <tr class="${isShortage ? 'row-shortage' : ''}">
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td><span class="tag-code">${escapeHtml(s.roll_number)}</span></td>
                    <td><span class="tag-code-alt">${escapeHtml(s.seat_number)}</span></td>
                    <td>${escapeHtml(s.class)}</td>
                    <td><strong>${total}</strong></td>
                    <td class="text-success"><strong>${present}</strong></td>
                    <td class="text-danger"><strong>${absent}</strong></td>
                    <td>
                      <div class="percentage-cell">
                        <div class="progress-bar-wrap" style="flex:1;">
                          <div class="progress-bar-fill ${pct >= threshold ? 'bg-success' : 'bg-danger'}" style="width: ${pct}%;"></div>
                        </div>
                        <span class="pct-num ${pct >= threshold ? 'text-success' : 'text-danger'}">${pct}%</span>
                      </div>
                    </td>
                    <td>
                      ${
                        total === 0
                          ? `<span class="status-badge badge-unmarked">No Sessions</span>`
                          : isShortage
                            ? `<span class="status-badge badge-shortage"><i class="fa-solid fa-triangle-exclamation"></i> Below ${threshold}%</span>`
                            : `<span class="status-badge badge-eligible"><i class="fa-solid fa-circle-check"></i> Eligible (&ge; ${threshold}%)</span>`
                      }
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (currentReportType === 'daily') {
    const dayStr = selectedAttendanceDate;
    const dailyLogs = attendance.filter((a) => a.date === dayStr);

    return `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Student Name</th>
              <th>Roll Number</th>
              <th>Class</th>
              <th>Date</th>
              <th>Recorded Time</th>
              <th>Subject</th>
              <th>Method</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${students
              .map((s, idx) => {
                const logsForStudent = dailyLogs.filter((a) => a.student_id === s.id);
                if (logsForStudent.length === 0) {
                  return `
                    <tr>
                      <td>${idx + 1}</td>
                      <td><strong>${escapeHtml(s.name)}</strong></td>
                      <td><span class="tag-code">${escapeHtml(s.roll_number)}</span></td>
                      <td>${escapeHtml(s.class)}</td>
                      <td>${escapeHtml(dayStr)}</td>
                      <td>-</td>
                      <td>-</td>
                      <td>-</td>
                      <td><span class="status-badge badge-unmarked">Not Marked</span></td>
                    </tr>
                  `;
                }
                return logsForStudent
                  .map(
                    (log) => `
                      <tr>
                        <td>${idx + 1}</td>
                        <td><strong>${escapeHtml(s.name)}</strong></td>
                        <td><span class="tag-code">${escapeHtml(s.roll_number)}</span></td>
                        <td>${escapeHtml(s.class)}</td>
                        <td>${escapeHtml(dayStr)}</td>
                        <td>${escapeHtml(log.time)}</td>
                        <td><small class="text-muted">${escapeHtml(log.subject || 'CS')}</small></td>
                        <td><span class="badge-role">${escapeHtml(log.method || '-')}</span></td>
                        <td>
                          <span class="status-badge ${log.status === 'Present' ? 'badge-present' : 'badge-absent'}">
                            <i class="fa-solid ${log.status === 'Present' ? 'fa-check' : 'fa-xmark'}"></i> ${escapeHtml(log.status)}
                          </span>
                        </td>
                      </tr>
                    `
                  )
                  .join('');
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (currentReportType === 'monthly') {
    const curMonth = selectedReportMonth;
    const monthLogs = attendance.filter((a) => a.date.startsWith(curMonth));

    return `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Student Name</th>
              <th>Roll Number</th>
              <th>Class</th>
              <th>Month Lectures (${escapeHtml(curMonth)})</th>
              <th>Present Count</th>
              <th>Absent Count</th>
              <th>Monthly %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${students
              .map((s, idx) => {
                const logs = monthLogs.filter((a) => a.student_id === s.id);
                const total = logs.length;
                const present = logs.filter((a) => a.status === 'Present').length;
                const absent = total - present;
                const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
                const isShortage = pct < threshold && total > 0;

                return `
                  <tr class="${isShortage ? 'row-shortage' : ''}">
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td><span class="tag-code">${escapeHtml(s.roll_number)}</span></td>
                    <td>${escapeHtml(s.class)}</td>
                    <td><strong>${total}</strong></td>
                    <td class="text-success"><strong>${present}</strong></td>
                    <td class="text-danger"><strong>${absent}</strong></td>
                    <td><strong>${total > 0 ? `${pct}%` : 'N/A'}</strong></td>
                    <td>
                      ${
                        total === 0
                          ? `<span class="status-badge badge-unmarked">No Logs</span>`
                          : isShortage
                            ? `<span class="status-badge badge-shortage"><i class="fa-solid fa-triangle-exclamation"></i> &lt; ${threshold}%</span>`
                            : `<span class="status-badge badge-eligible"><i class="fa-solid fa-check"></i> Eligible</span>`
                      }
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else if (currentReportType === 'subject') {
    return `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Student Name</th>
              <th>Roll Number</th>
              ${SUBJECTS.map((subj) => `<th><small style="display:block; font-size:10.5px;">${escapeHtml(subj.split(' ')[0])}</small>${escapeHtml(subj)}</th>`).join('')}
              <th>Overall %</th>
            </tr>
          </thead>
          <tbody>
            ${students
              .map((s, idx) => {
                const studentLogs = attendance.filter((a) => a.student_id === s.id);
                const overallTotal = studentLogs.length;
                const overallPresent = studentLogs.filter((a) => a.status === 'Present').length;
                const overallPct = overallTotal > 0 ? Math.round((overallPresent / overallTotal) * 1000) / 10 : 0;

                return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(s.name)}</strong></td>
                    <td><span class="tag-code">${escapeHtml(s.roll_number)}</span></td>
                    ${SUBJECTS.map((subj) => {
                      const subLogs = studentLogs.filter((a) => (a.subject || SUBJECTS[0]) === subj);
                      const subTot = subLogs.length;
                      const subPres = subLogs.filter((a) => a.status === 'Present').length;
                      if (subTot === 0) {
                        return `<td><span class="text-muted">0/0 (N/A)</span></td>`;
                      }
                      const subPct = Math.round((subPres / subTot) * 100);
                      return `
                        <td>
                          <span class="${subPct < threshold ? 'text-danger' : 'text-success'}" style="font-weight:700;">
                            ${subPres}/${subTot} (${subPct}%)
                          </span>
                        </td>
                      `;
                    }).join('')}
                    <td>
                      <span class="status-badge ${overallPct >= threshold ? 'badge-eligible' : 'badge-shortage'}">
                        ${overallPct}%
                      </span>
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  } else {
    const defaulters = db.getLowAttendanceStudents(selectedReportClass);
    const settings = db.getSettings();

    return `
      <div style="background:#ffffff; border:2px solid #0f172a; padding:32px; border-radius:8px; max-width:850px; margin:0 auto; font-family:'Inter', sans-serif;">
        <div style="text-align:center; border-bottom:2px solid #0f172a; padding-bottom:16px; margin-bottom:20px;">
          <h2 style="margin:0; font-size:20px; font-weight:800; letter-spacing:0.5px;">${escapeHtml(settings.institution_name.toUpperCase())}</h2>
          <h3 style="margin:4px 0; font-size:15px; color:#475569;">ACADEMIC YEAR ${escapeHtml(settings.academic_year)}</h3>
          <div style="display:inline-block; background:#dc2626; color:#ffffff; padding:4px 16px; border-radius:4px; font-weight:700; font-size:13px; margin-top:8px;">
            NOTICE: ATTENDANCE DEFAULTERS LIST (BELOW ${threshold}%)
          </div>
        </div>

        <p style="font-size:13px; color:#334155; line-height:1.6;">
          As per University Ordinance 6086, students are strictly required to maintain a minimum of <strong>${threshold}% average attendance</strong>.
          The following students${selectedReportClass ? ` from class <strong>${escapeHtml(selectedReportClass)}</strong>` : ''} have attendance below ${threshold}% up to <strong>${new Date().toLocaleDateString()}</strong>.
        </p>

        <table class="data-table" style="margin:16px 0; border:1px solid #cbd5e1;">
          <thead style="background:#f1f5f9;">
            <tr>
              <th>Sr.</th>
              <th>Roll No</th>
              <th>Seat No</th>
              <th>Student Name</th>
              <th>Class</th>
              <th>Total Lectures</th>
              <th>Attended</th>
              <th>Attendance %</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${
              defaulters.length > 0
                ? defaulters
                    .map(
                      (item, i) => `
                        <tr style="background:#fef2f2;">
                          <td>${i + 1}</td>
                          <td><strong>${escapeHtml(item.student.roll_number)}</strong></td>
                          <td>${escapeHtml(item.student.seat_number)}</td>
                          <td><strong>${escapeHtml(item.student.name)}</strong></td>
                          <td>${escapeHtml(item.student.class)}</td>
                          <td>${item.total}</td>
                          <td>${item.present}</td>
                          <td style="color:#dc2626; font-weight:800;">${item.percentage}%</td>
                          <td><strong>${item.percentage < 50 ? 'Severe Shortage' : 'Below Threshold'}</strong></td>
                        </tr>
                      `
                    )
                    .join('')
                : `<tr><td colspan="9" style="text-align:center; padding:20px;">No students below ${threshold}% attendance threshold.</td></tr>`
            }
          </tbody>
        </table>

        <div style="display:flex; justify-content:space-between; margin-top:40px; padding-top:20px; border-top:1px dashed #cbd5e1; flex-wrap:wrap; gap:16px;">
          <div style="text-align:center;">
            <div style="border-top:1px solid #000; width:160px; margin-bottom:4px;"></div>
            <small style="font-weight:700;">Prof. R. K. Sharma</small><br>
            <small class="text-muted">Class Coordinator</small>
          </div>
          <div style="text-align:center;">
            <div style="border-top:1px solid #000; width:160px; margin-bottom:4px;"></div>
            <small style="font-weight:700;">Head of Department</small><br>
            <small class="text-muted">${escapeHtml(settings.institution_name)}</small>
          </div>
          <div style="text-align:center;">
            <div style="border-top:1px solid #000; width:160px; margin-bottom:4px;"></div>
            <small style="font-weight:700;">Principal</small><br>
            <small class="text-muted">College Seal &amp; Sign</small>
          </div>
        </div>
      </div>
    `;
  }
}

// -----------------------------------------------------------------------------
// 8. STUDENT DIRECTORY (With Search, Class Filter, Safe Actions)
// -----------------------------------------------------------------------------
function renderStudentsPage(): string {
  const allStudents = getVisibleStudents();
  const classes = db.getClasses();
  const canEdit = db.canModifyDatabase();
  const isAdmin = db.isAdmin();

  const q = studentSearchQuery.toLowerCase().trim();
  const filtered = allStudents.filter((s) => {
    const matchClass = !studentClassFilter || s.class === studentClassFilter;
    const matchSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.roll_number.toLowerCase().includes(q) ||
      s.seat_number.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q);
    return matchClass && matchSearch;
  });

  return `
    <div class="students-page-container">
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-address-book"></i>
            <div>
              <h3>Registered Students Directory</h3>
              <p class="card-subtitle">Search, filter, view, edit, and manage biometric face enrollment</p>
            </div>
          </div>
          ${canEdit ? `
            <a href="#register" class="btn btn-sm btn-primary" data-nav="register">
              <i class="fa-solid fa-user-plus"></i> Register New Student
            </a>
          ` : ''}
        </div>

        <div class="card-body">
          <div class="filter-toolbar">
            <div class="filter-group">
              <label for="studentsClassFilter"><i class="fa-solid fa-graduation-cap"></i> Class:</label>
              <select id="studentsClassFilter" class="form-control">
                <option value="">All Classes</option>
                ${classes.map((c) => `<option value="${escapeHtml(c)}" ${c === studentClassFilter ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
              </select>
            </div>
            <div class="filter-group search-group" style="flex:1;">
              <label for="studentsSearch"><i class="fa-solid fa-magnifying-glass"></i> Search:</label>
              <input type="text" id="studentsSearch" class="form-control" value="${escapeHtml(studentSearchQuery)}" placeholder="Search by name, roll number, seat number, or email...">
            </div>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 50px;">#</th>
                  <th style="width: 60px;">Photo</th>
                  <th>Student Name</th>
                  <th>Roll Number</th>
                  <th>Seat Number</th>
                  <th>Class</th>
                  <th>Face ID</th>
                  <th>Contact Info</th>
                  <th style="width: 220px;" class="text-center">Actions</th>
                </tr>
              </thead>
              <tbody id="studentsDirectoryTbody">
                ${filtered
                  .map((s, idx) => {
                    const enrolled = faceEngine.isStudentEnrolled(s.id);
                    return `
                      <tr>
                        <td>${idx + 1}</td>
                        <td>
                          <div class="table-avatar">
                            <img src="${escapeHtml(s.photo)}" alt="${escapeHtml(s.name)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(s.name)}&background=0284c7&color=fff'">
                          </div>
                        </td>
                        <td>
                          <strong>${escapeHtml(s.name)}</strong>
                          ${s.roll_number === 'TYBSC-A-39' ? `<span class="badge-alert" style="background:#0284c7; margin-left:6px;">Candidate</span>` : ''}
                        </td>
                        <td><span class="tag-code">${escapeHtml(s.roll_number)}</span></td>
                        <td><span class="tag-code-alt">${escapeHtml(s.seat_number)}</span></td>
                        <td>${escapeHtml(s.class)}</td>
                        <td>
                          <span class="status-badge ${enrolled ? 'badge-present' : 'badge-unmarked'}" style="font-size:11px;">
                            <i class="fa-solid ${enrolled ? 'fa-face-smile' : 'fa-user-slash'}"></i> ${enrolled ? 'Enrolled' : 'No Face'}
                          </span>
                        </td>
                        <td>
                          <div style="font-size: 12px; color: var(--text-muted);">
                            <div><i class="fa-solid fa-envelope"></i> ${escapeHtml(s.email)}</div>
                            <div><i class="fa-solid fa-phone"></i> ${escapeHtml(s.phone)}</div>
                          </div>
                        </td>
                        <td class="text-center">
                          <div class="action-btn-group">
                            <button type="button" class="btn btn-icon btn-info" onclick="window.viewStudent(${s.id})" title="View Profile">
                              <i class="fa-solid fa-eye"></i> View
                            </button>
                            ${canEdit ? `
                              <button type="button" class="btn btn-icon btn-warning" onclick="window.openEditModal(${s.id})" title="Edit Details">
                                <i class="fa-solid fa-pen-to-square"></i> Edit
                              </button>
                            ` : ''}
                            ${isAdmin ? `
                              <button type="button" class="btn btn-icon btn-danger" onclick="window.openDeleteModal(${s.id})" title="Delete Record">
                                <i class="fa-solid fa-trash-can"></i> Delete
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>

          <div class="table-summary-bar">
            <span>Showing <strong>${filtered.length}</strong> of <strong>${allStudents.length}</strong> students</span>
            <span class="text-muted"><i class="fa-solid fa-shield-halved"></i> Foreign keys cascade delete attendance history</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 9. STUDENT REGISTRATION FORM
// -----------------------------------------------------------------------------
function renderRegisterPage(): string {
  return `
    <div class="form-page-container">
      <div class="card form-card">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-user-plus"></i>
            <div>
              <h3>Student Registration</h3>
              <p class="card-subtitle">Save student details and extract 128-d facial recognition descriptor</p>
            </div>
          </div>
          <a href="#students" class="btn btn-sm btn-outline" data-nav="students"><i class="fa-solid fa-arrow-left"></i> View Student List</a>
        </div>

        <div class="card-body">
          <form id="studentRegistrationForm" class="app-form">
            <div class="form-grid">
              <div class="form-group">
                <label for="regName" class="form-label required">Student Full Name</label>
                <input type="text" id="regName" class="form-control" placeholder="e.g. Rahul S. Mehta" required>
              </div>

              <div class="form-group">
                <label for="regRoll" class="form-label required">Roll Number</label>
                <input type="text" id="regRoll" class="form-control" placeholder="e.g. TYBSC-A-42" required>
              </div>

              <div class="form-group">
                <label for="regSeat" class="form-label required">Exam Seat Number</label>
                <input type="text" id="regSeat" class="form-control" placeholder="e.g. 24TCS095" required>
              </div>

              <div class="form-group">
                <label for="regClass" class="form-label required">Class / Department</label>
                <select id="regClass" class="form-control" required>
                  <option value="TYBSC-CS" selected>TY BSc Computer Science (TYBSC-CS)</option>
                  <option value="SYBSC-CS">SY BSc Computer Science (SYBSC-CS)</option>
                  <option value="FYBSC-CS">FY BSc Computer Science (FYBSC-CS)</option>
                  <option value="TYBSC-IT">TY BSc Information Technology</option>
                </select>
              </div>

              <div class="form-group">
                <label for="regEmail" class="form-label required">Student Email</label>
                <input type="email" id="regEmail" class="form-control" placeholder="student@college.edu" required>
              </div>

              <div class="form-group">
                <label for="regPhone" class="form-label required">Student Phone</label>
                <input type="tel" id="regPhone" class="form-control" placeholder="+91 98765 43210" required>
              </div>

              <div class="form-group">
                <label for="regParentName" class="form-label">Parent / Guardian Name</label>
                <input type="text" id="regParentName" class="form-control" placeholder="e.g. Mr. S. Mehta">
              </div>

              <div class="form-group">
                <label for="regParentPhone" class="form-label">Parent Phone (for Shortage Alerts)</label>
                <input type="tel" id="regParentPhone" class="form-control" placeholder="+91 98765 43219">
              </div>

              <!-- Photo Upload -->
              <div class="form-group col-span-2 photo-upload-container">
                <label class="form-label">Student Face Photo (For Real Face Recognition Enrollment)</label>
                <div class="photo-dropzone">
                  <div class="photo-preview-box" id="regPhotoPreview">
                    <i class="fa-solid fa-user-circle placeholder-icon" id="regPhotoIcon"></i>
                    <img src="" id="regPhotoImg" class="hidden" style="width:100%; height:100%; object-fit:cover;">
                  </div>
                  <div class="photo-inputs">
                    <input type="file" id="regPhotoFile" accept="image/*" class="file-input">
                    <label for="regPhotoFile" class="btn btn-outline btn-sm">
                      <i class="fa-solid fa-cloud-arrow-up"></i> Choose Portrait Photo
                    </label>
                    <span class="file-name-text" id="regPhotoFileName">No file chosen</span>
                    <small id="regFaceCheckStatus" class="text-muted block mt-1">Upload a clear front-facing photo to enable biometric attendance matching.</small>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-lg" id="btnRegisterStudentSubmit">
                <i class="fa-solid fa-floppy-disk"></i> Register Student in Database
              </button>
              <button type="reset" class="btn btn-secondary btn-lg">
                <i class="fa-solid fa-rotate-left"></i> Reset Form
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 10. STUDENT PROFILE & EXAM ELIGIBILITY CERTIFICATE
// -----------------------------------------------------------------------------
function renderStudentViewPage(id: number): string {
  const student = db.getStudent(id);
  if (!student) {
    return `<div class="card"><div class="card-body"><p>Student record not found.</p><a href="#students" class="btn btn-primary" data-nav="students">Back</a></div></div>`;
  }

  const threshold = db.getSettings().attendance_threshold;
  const logs = db.getAttendance().filter((a) => a.student_id === id);
  const total = logs.length;
  const present = logs.filter((a) => a.status === 'Present').length;
  const absent = total - present;
  const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
  const isEligible = pct >= threshold && total > 0;
  const canEdit = db.canModifyDatabase();

  return `
    <div class="view-student-container">
      <div class="view-student-grid">
        <div class="card student-id-card">
          <div class="id-card-header">
            <i class="fa-solid fa-graduation-cap"></i> COLLEGE STUDENT ID CARD
          </div>
          <div class="id-card-body">
            <div class="id-avatar-wrap">
              <img src="${escapeHtml(student.photo)}" alt="${escapeHtml(student.name)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(student.name)}&background=0284c7&color=fff'">
            </div>
            <h3>${escapeHtml(student.name)}</h3>
            <span class="id-class-badge">${escapeHtml(student.class)}</span>

            <div class="id-details-list">
              <div class="id-row"><span>Roll Number:</span> <strong>${escapeHtml(student.roll_number)}</strong></div>
              <div class="id-row"><span>Seat Number:</span> <strong>${escapeHtml(student.seat_number)}</strong></div>
              <div class="id-row"><span>Email:</span> <small>${escapeHtml(student.email)}</small></div>
              <div class="id-row"><span>Phone:</span> <strong>${escapeHtml(student.phone)}</strong></div>
              <div class="id-row"><span>Parent:</span> <strong>${escapeHtml(student.parent_name || 'N/A')}</strong></div>
              <div class="id-row"><span>Biometric Face:</span> <strong>${faceEngine.isStudentEnrolled(student.id) ? 'Enrolled (128-d)' : 'Not Enrolled'}</strong></div>
              <div class="id-row"><span>Registered On:</span> <small>${escapeHtml(student.created_at)}</small></div>
            </div>

            <div style="margin-top:16px; padding:12px; border-radius:8px; text-align:center; background:${isEligible ? '#f0fdf4' : '#fef2f2'}; border:1px solid ${isEligible ? '#bbf7d0' : '#fecaca'};">
              <div style="font-size:12px; font-weight:700; color:${isEligible ? '#166534' : '#991b1b'};">
                <i class="fa-solid ${isEligible ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
                EXAM HALL TICKET STATUS: ${total === 0 ? 'NO DATA' : isEligible ? 'ELIGIBLE' : 'DEFAULTER (HOLD)'}
              </div>
              <small style="color:${isEligible ? '#166534' : '#991b1b'}; font-size:11px;">
                ${total === 0 ? 'No sessions marked yet.' : isEligible ? `Satisfies ${threshold}% attendance criteria.` : `Attendance < ${threshold}%. Parent consultation required.`}
              </small>
            </div>

            <div class="id-card-actions">
              ${canEdit ? `
                <button type="button" class="btn btn-warning btn-block" onclick="window.openEditModal(${student.id})">
                  <i class="fa-solid fa-pen-to-square"></i> Edit Details
                </button>
              ` : ''}
              <a href="#students" class="btn btn-outline btn-block mt-2" data-nav="students">
                <i class="fa-solid fa-arrow-left"></i> Back to Directory
              </a>
            </div>
          </div>
        </div>

        <div class="student-stats-column">
          <div class="stats-grid-mini">
            <div class="stat-mini-card">
              <span class="lbl">Total Sessions</span>
              <h4>${total}</h4>
            </div>
            <div class="stat-mini-card">
              <span class="lbl text-success">Present</span>
              <h4 class="text-success">${present}</h4>
            </div>
            <div class="stat-mini-card">
              <span class="lbl text-danger">Absent</span>
              <h4 class="text-danger">${absent}</h4>
            </div>
            <div class="stat-mini-card">
              <span class="lbl">Attendance %</span>
              <h4 class="${pct >= threshold ? 'text-success' : 'text-danger'}">${pct}%</h4>
            </div>
          </div>

          ${!isEligible && total > 0 ? `
            <div class="alert-banner-warning" style="margin-bottom: 20px;">
              <i class="fa-solid fa-triangle-exclamation"></i>
              <div>
                <strong>Low Attendance Warning:</strong> This student's aggregate attendance is <strong>${pct}%</strong>, which is below the mandatory threshold of ${threshold}%.
              </div>
            </div>
          ` : ''}

          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <i class="fa-solid fa-history"></i>
                <h3>Individual Attendance Log History</h3>
              </div>
              <button type="button" class="btn btn-sm btn-outline" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>
            </div>
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Subject</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Marked By</th>
                  </tr>
                </thead>
                <tbody>
                  ${logs
                    .map(
                      (log) => `
                        <tr>
                          <td><strong>${escapeHtml(log.date)}</strong></td>
                          <td>${escapeHtml(log.time)}</td>
                          <td><small>${escapeHtml(log.subject || 'CS')}</small></td>
                          <td><span class="badge-role">${escapeHtml(log.method || 'Manual')}</span></td>
                          <td>
                            <span class="status-badge ${log.status === 'Present' ? 'badge-present' : 'badge-absent'}">
                              <i class="fa-solid ${log.status === 'Present' ? 'fa-check' : 'fa-xmark'}"></i> ${escapeHtml(log.status)}
                            </span>
                          </td>
                          <td>${escapeHtml(log.marked_by)}</td>
                        </tr>
                      `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 11. SQL TERMINAL & ARCHITECTURE PAGE
// -----------------------------------------------------------------------------
function renderDatabaseConsolePage(): string {
  const isAdmin = db.isAdmin();

  return `
    <div class="database-console-container">
      <div class="welcome-card" style="background: linear-gradient(135deg, #0f172a, #1e293b); margin-bottom: 20px;">
        <div class="welcome-text">
          <div style="display:inline-flex; align-items:center; gap:8px; background:rgba(56,189,248,0.15); color:#38bdf8; padding:4px 10px; border-radius:9999px; font-size:12px; font-weight:600; margin-bottom:10px;">
            <i class="fa-solid fa-database"></i> MODULE 3 &bull; DATABASE ARCHITECTURE
          </div>
          <h2 style="color:#ffffff;">SQLite Database Engine &amp; Architecture</h2>
          <p style="color:#94a3b8;">
            Active Storage: <strong>${escapeHtml(apiClient.health.backendLabel || 'Local Browser Storage')}</strong>.
            Supports ACID SQLite3 (<code>smart_attendance.db</code>) with referential integrity and cascade delete.
          </p>
        </div>
        ${isAdmin ? `
          <div class="welcome-actions">
            <button class="btn btn-warning btn-sm" id="btnResetDB" type="button">
              <i class="fa-solid fa-rotate-left"></i> Reset Database to Default Seed
            </button>
          </div>
        ` : ''}
      </div>

      <div class="card" style="margin-bottom: 24px;">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-diagram-project"></i>
            <div>
              <h3>System Architecture &amp; Data Flow Diagram (DFD Level 1)</h3>
              <p class="card-subtitle">Camera Entry &rarr; 128-d Face Recognition &rarr; SQLite3 &rarr; Reports &amp; Shortage Alerts</p>
            </div>
          </div>
        </div>
        <div class="card-body">
          <div class="dfd-diagram-wrap">
            <div class="dfd-node entity">
              <i class="fa-solid fa-user-graduate fa-2x text-primary" style="margin-bottom:8px;"></i>
              <strong>Student at Door</strong>
              <small class="text-muted block">Entry Point</small>
            </div>
            <div class="dfd-arrow"><span>Captures Face</span><i class="fa-solid fa-arrow-right"></i></div>
            <div class="dfd-node process">
              <i class="fa-solid fa-camera fa-2x text-info" style="margin-bottom:8px;"></i>
              <strong>1.0 Face Detection</strong>
              <small class="text-muted block">MobileNet / TinyFace</small>
            </div>
            <div class="dfd-arrow"><span>128-d Vector</span><i class="fa-solid fa-arrow-right"></i></div>
            <div class="dfd-node process">
              <i class="fa-solid fa-microchip fa-2x text-success" style="margin-bottom:8px;"></i>
              <strong>2.0 Euclidean Match</strong>
              <small class="text-muted block">Threshold (&le; ${db.getSettings().face_distance_threshold})</small>
            </div>
            <div class="dfd-arrow"><span>Match Found</span><i class="fa-solid fa-arrow-right"></i></div>
            <div class="dfd-node storage">
              <i class="fa-solid fa-database fa-2x text-warning" style="margin-bottom:8px;"></i>
              <strong>3.0 Database Store</strong>
              <small class="text-muted block">smart_attendance.db</small>
            </div>
            <div class="dfd-arrow"><span>If &lt; ${db.getSettings().attendance_threshold}%</span><i class="fa-solid fa-arrow-right"></i></div>
            <div class="dfd-node entity" style="border-color:#ef4444; background:#fef2f2;">
              <i class="fa-solid fa-bell fa-2x text-danger" style="margin-bottom:8px;"></i>
              <strong>4.0 Shortage Alert</strong>
              <small class="text-muted block">Persisted Notice</small>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-terminal"></i>
            <div>
              <h3>Interactive Query Terminal</h3>
              <p class="card-subtitle">Inspect live tables in the active database store (raw biometric embeddings redacted for privacy)</p>
            </div>
          </div>
        </div>

        <div class="card-body">
          <div style="margin-bottom: 12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <span style="font-size:12px; font-weight:700; color:var(--text-muted);">Preset Queries:</span>
            <button type="button" class="btn btn-sm btn-outline" onclick="window.runPresetQuery('SELECT * FROM students;')">SELECT * FROM students;</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="window.runPresetQuery('SELECT * FROM attendance WHERE status = \\'Present\\';')">Present Logs</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="window.runPresetQuery('SELECT * FROM attendance WHERE status = \\'Absent\\';')">Absent Logs</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="window.runPresetQuery('SELECT * FROM notifications;')">Defaulter Alerts</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="window.runPresetQuery('SELECT * FROM settings;')">Settings</button>
          </div>

          <div class="sql-console-container">
            <div class="sql-console-header">
              <div style="display:flex; align-items:center; gap:8px; font-family:'JetBrains Mono', monospace; font-size:12px;">
                <i class="fa-solid fa-database text-warning"></i> sqlite3 smart_attendance.db
              </div>
              <button type="button" class="btn btn-sm btn-primary" id="btnExecuteSQL">
                <i class="fa-solid fa-play"></i> Execute Query
              </button>
            </div>
            <textarea id="sqlQueryInput" class="sql-input-area" rows="3">SELECT * FROM students;</textarea>
          </div>

          <div style="margin-top: 16px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:12px; color:var(--text-muted);">
              <span id="sqlExecutionStatus">Ready</span>
              <span id="sqlRowCount">Rows returned: <strong>${db.getStudents().length}</strong></span>
            </div>
            <div class="table-responsive" id="sqlResultContainer" style="max-height:300px; overflow-y:auto;"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 12. NOTIFICATIONS & DEFAULTERS PAGE
// -----------------------------------------------------------------------------
function renderNotificationsPage(): string {
  const threshold = db.getSettings().attendance_threshold;
  const classes = db.getClasses();
  const user = db.getCurrentUser();
  let lowAttendanceList = db.getLowAttendanceStudents(selectedNotifClass);
  if (user && (user.role === 'Student' || user.role === 'Parent/Guardian') && user.student_id) {
    lowAttendanceList = lowAttendanceList.filter((item) => item.student.id === user.student_id);
  }
  const canEdit = db.canModifyDatabase();

  return `
    <div class="notifications-page-container">
      <div class="info-alert-box">
        <div class="info-icon"><i class="fa-solid fa-scale-balanced"></i></div>
        <div class="info-text">
          <h4>University ${threshold}% Attendance Compliance Rule (Ordinance 6086)</h4>
          <p>
            Students must maintain at least <strong>${threshold}% attendance</strong> across all sessions. Notifications below are computed from live attendance records; acknowledgment &amp; dispatch logs persist across refreshes.
            <small style="display:block; margin-top:4px;">Note: Internal alert logs &amp; Email drafts (<code>mailto:</code>) are active; external carrier SMS gateway requires paid provider keys.</small>
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-bell"></i>
            <div>
              <h3>Active Low-Attendance Warnings (&lt; ${threshold}%)</h3>
              <p class="card-subtitle">Computed dynamically from attendance logs against configured ${threshold}% threshold</p>
            </div>
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <select id="notifClassFilter" class="form-control" style="width:auto; font-size:12.5px;" onchange="window.changeNotifClass(this.value)">
              <option value="">All Classes</option>
              ${classes.map((c) => `<option value="${escapeHtml(c)}" ${c === selectedNotifClass ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
            ${canEdit ? `
              <button type="button" class="btn btn-sm btn-danger" onclick="window.sendBatchParentNotice()">
                <i class="fa-solid fa-clipboard-check"></i> Log Batch Guardian Alert
              </button>
            ` : ''}
            <span class="badge-alert-pill">
              <i class="fa-solid fa-triangle-exclamation"></i> ${lowAttendanceList.length} Warning(s) Active
            </span>
          </div>
        </div>

        <div class="card-body">
          ${
            lowAttendanceList.length > 0
              ? `
                <div class="notifications-list">
                  ${lowAttendanceList
                    .map((item) => {
                      const notif = item.notification;
                      const isRead = Boolean(notif?.is_read);
                      const dispatched = notif?.dispatched_at;
                      const mailSubject = encodeURIComponent(`Attendance Shortage Warning (<${threshold}%) - ${item.student.name}`);
                      const mailBody = encodeURIComponent(
                        `Dear ${item.student.parent_name || 'Parent/Guardian'},\n\nThis is to inform you that ${item.student.name} (Roll: ${item.student.roll_number}, Class: ${item.student.class}) currently has ${item.percentage}% attendance (${item.present}/${item.total} lectures), which is below the mandatory ${threshold}% requirement.\n\nPlease contact the Department of Computer Science.`
                      );
                      return `
                        <div class="notification-card ${item.percentage < 50 ? 'severe-alert' : 'warning-alert'}">
                          <div class="notif-avatar-col">
                            <div class="table-avatar large">
                              <img src="${escapeHtml(item.student.photo)}" alt="${escapeHtml(item.student.name)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(item.student.name)}&background=ef4444&color=fff'">
                            </div>
                            <div class="notif-percentage-badge">${item.percentage}%</div>
                          </div>

                          <div class="notif-details-col">
                            <div class="notif-top">
                              <span class="notif-tag"><i class="fa-solid fa-triangle-exclamation"></i> Shortage Alert</span>
                              <span class="status-badge ${isRead ? 'badge-present' : 'badge-absent'}" style="font-size:11px;">
                                ${isRead ? 'Acknowledged' : 'Unread Alert'}
                              </span>
                              ${dispatched ? `<span class="notif-time text-success"><i class="fa-solid fa-check-double"></i> Logged: ${escapeHtml(dispatched)} (${escapeHtml(notif?.dispatch_channel || '')})</span>` : ''}
                            </div>

                            <h4 class="notif-student-name">
                              ${escapeHtml(item.student.name)}
                              <span class="text-muted">(Roll: ${escapeHtml(item.student.roll_number)} | Seat: ${escapeHtml(item.student.seat_number)} | ${escapeHtml(item.student.class)})</span>
                            </h4>

                            <p class="notif-message-text">
                              ${escapeHtml(item.student.name)} has attended ${item.present} out of ${item.total} lectures (${item.percentage}% attendance). Minimum ${threshold}% required for exam hall ticket eligibility.
                            </p>

                            <div class="notif-contact-row" style="flex-wrap:wrap;">
                              <span><i class="fa-solid fa-envelope"></i> ${escapeHtml(item.student.email)}</span>
                              <span><i class="fa-solid fa-phone"></i> ${escapeHtml(item.student.phone)}</span>
                              <span><i class="fa-solid fa-user-group"></i> Parent: ${escapeHtml(item.student.parent_name || 'Guardian')} (${escapeHtml(item.student.parent_phone || item.student.phone)})</span>
                            </div>
                          </div>

                          <div class="notif-actions-col">
                            ${canEdit ? `
                              <a class="btn btn-sm btn-danger" href="mailto:${escapeHtml(item.student.email)}?subject=${mailSubject}&body=${mailBody}" onclick="window.recordParentNotice(${item.student.id}, 'Email Draft')">
                                <i class="fa-solid fa-envelope"></i> Compose Email
                              </a>
                              ${!isRead ? `
                                <button type="button" class="btn btn-sm btn-outline" onclick="window.acknowledgeAlert(${item.student.id})">
                                  <i class="fa-solid fa-check"></i> Mark Read
                                </button>
                              ` : ''}
                            ` : ''}
                            <button type="button" class="btn btn-sm btn-outline" onclick="window.viewStudent(${item.student.id})">
                              <i class="fa-solid fa-eye"></i> View History
                            </button>
                          </div>
                        </div>
                      `;
                    })
                    .join('')}
                </div>
              `
              : `
                <div class="empty-state-box" style="text-align:center; padding:40px;">
                  <i class="fa-solid fa-circle-check fa-3x text-success mb-2"></i>
                  <h3>All Students Satisfy Attendance Requirement</h3>
                  <p class="text-muted">No student currently has attendance below ${threshold}%.</p>
                </div>
              `
          }
        </div>
      </div>
    </div>

    <!-- Parent Alert Log Modal -->
    <div class="modal-overlay hidden" id="parentAlertModal">
      <div class="modal-box">
        <div class="modal-icon-success"><i class="fa-solid fa-clipboard-check"></i></div>
        <h3>Alert Dispatch Logged</h3>
        <p id="parentAlertText"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" onclick="document.getElementById('parentAlertModal').classList.add('hidden')">Done</button>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 13. SETTINGS & CONFIGURABLE THRESHOLDS PAGE
// -----------------------------------------------------------------------------
function renderSettingsPage(): string {
  const s = db.getSettings();
  return `
    <div class="form-page-container">
      <div class="card form-card">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-sliders"></i>
            <div>
              <h3>System Settings &amp; Compliance Thresholds</h3>
              <p class="card-subtitle">All settings save permanently and immediately update Dashboard, Reports, Notifications &amp; Face Recognition</p>
            </div>
          </div>
        </div>
        <div class="card-body">
          <form id="settingsForm" class="app-form">
            <div class="form-grid">
              <div class="form-group">
                <label for="settingThreshold" class="form-label required">Minimum Attendance Threshold (%)</label>
                <input type="number" id="settingThreshold" class="form-control" min="1" max="100" step="1" value="${s.attendance_threshold}" required>
                <small class="text-muted">Default university rule: 75%. Students below this appear in Defaulters &amp; Alerts.</small>
              </div>

              <div class="form-group">
                <label for="settingFaceDist" class="form-label required">Face Match Max Euclidean Distance</label>
                <input type="number" id="settingFaceDist" class="form-control" min="0.30" max="0.80" step="0.01" value="${s.face_distance_threshold}" required>
                <small class="text-muted">Lower is stricter (recommended: 0.50 - 0.58). Rejects unknown faces above this distance.</small>
              </div>

              <div class="form-group">
                <label for="settingDetConf" class="form-label required">Min Face Detection Score</label>
                <input type="number" id="settingDetConf" class="form-control" min="0.25" max="0.95" step="0.05" value="${s.min_detection_confidence}" required>
                <small class="text-muted">Minimum neural detector confidence required to attempt recognition (default: 0.55).</small>
              </div>

              <div class="form-group">
                <label for="settingDefaultSubject" class="form-label required">Default Lecture Subject</label>
                <select id="settingDefaultSubject" class="form-control">
                  ${SUBJECTS.map((sub) => `<option value="${escapeHtml(sub)}" ${sub === s.default_subject ? 'selected' : ''}>${escapeHtml(sub)}</option>`).join('')}
                </select>
              </div>

              <div class="form-group">
                <label for="settingInstitution" class="form-label required">Institution / Department Title</label>
                <input type="text" id="settingInstitution" class="form-control" value="${escapeHtml(s.institution_name)}" required>
              </div>

              <div class="form-group">
                <label for="settingAcademicYear" class="form-label required">Academic Year</label>
                <input type="text" id="settingAcademicYear" class="form-control" value="${escapeHtml(s.academic_year)}" required>
              </div>
            </div>

            <div class="alert alert-info" style="margin-top:18px;">
              <div class="alert-icon"><i class="fa-solid fa-server"></i></div>
              <div>
                <strong>Active Persistence Mode:</strong> ${escapeHtml(apiClient.health.backendLabel)}
                ${apiClient.health.lastChecked ? `(Checked ${escapeHtml(apiClient.health.lastChecked)})` : ''}
              </div>
            </div>

            <div class="form-actions" style="margin-top:18px;">
              <button type="submit" class="btn btn-primary btn-lg">
                <i class="fa-solid fa-floppy-disk"></i> Save Settings Permanently
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// 14. VIVA VOCE & SOURCE CODE PAGES
// -----------------------------------------------------------------------------
function renderVivaDefensePage(): string {
  return `
    <div class="viva-defense-container">
      <div class="welcome-card" style="background: linear-gradient(135deg, #1e1b4b, #312e81); margin-bottom: 20px;">
        <div class="welcome-text">
          <div style="display:inline-flex; align-items:center; gap:8px; background:rgba(251,191,36,0.2); color:#fbbf24; padding:4px 10px; border-radius:9999px; font-size:12px; font-weight:600; margin-bottom:10px;">
            <i class="fa-solid fa-graduation-cap"></i> VIVA VOCE DEFENSE PREPARATION
          </div>
          <h2 style="color:#ffffff;">External Examiner Viva Voce Hub</h2>
          <p style="color:#c7d2fe;">
            Candidate: <strong>Sahil Pasula</strong> &bull; Seat No: <strong>24TCS076</strong> &bull; Class: <strong>TYBSC-A-39</strong>
          </p>
        </div>
        <div class="welcome-actions">
          <button type="button" class="btn btn-warning btn-sm" onclick="window.print()">
            <i class="fa-solid fa-print"></i> Print Viva Notes
          </button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr; gap:16px;">
        ${VIVA_QUESTIONS.map(
          (item, idx) => `
          <div class="card" style="border-left: 4px solid #4f46e5;">
            <div class="card-header" style="cursor:pointer;" onclick="this.parentElement.querySelector('.viva-answer').classList.toggle('hidden')">
              <div class="card-title">
                <span class="point-num" style="background:#4f46e5; color:#fff;">Q${idx + 1}</span>
                <div>
                  <h3 style="font-size:15px; color:#1e1b4b;">${escapeHtml(item.q)}</h3>
                  <span class="badge-role" style="font-size:11px;">Category: ${escapeHtml(item.category)}</span>
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-outline"><i class="fa-solid fa-chevron-down"></i> Toggle Answer</button>
            </div>
            <div class="card-body viva-answer" style="background:#fafafa; border-top:1px solid #e2e8f0; font-size:13.5px; line-height:1.7; color:#334155;">
              <strong class="text-success"><i class="fa-solid fa-circle-check"></i> Standard Academic Answer:</strong>
              <p style="margin-top:6px;">${escapeHtml(item.a)}</p>
            </div>
          </div>
        `
        ).join('')}
      </div>
    </div>
  `;
}

function renderSourceCodePage(): string {
  return `
    <div class="source-code-container">
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header">
          <div class="card-title">
            <i class="fa-solid fa-file-code"></i>
            <div>
              <h3>Complete Python Flask Source Code &amp; Downloadable Archive</h3>
              <p class="card-subtitle">Live source files bundled cleanly for local Flask execution and Vercel serverless deployment</p>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btnDownloadZipSource">
            <i class="fa-solid fa-file-zipper"></i> Download Complete Project (.zip)
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="report-nav-tabs" style="margin-bottom:0; border:none;" id="codeFileTabs">
            <button type="button" class="report-tab active" data-tab="app_py"><i class="fa-brands fa-python"></i> app.py</button>
            <button type="button" class="report-tab" data-tab="database_py"><i class="fa-solid fa-database"></i> database.py</button>
            <button type="button" class="report-tab" data-tab="schema_sql"><i class="fa-solid fa-table"></i> schema.sql</button>
            <button type="button" class="report-tab" data-tab="init_db_py"><i class="fa-solid fa-seedling"></i> init_db.py</button>
            <button type="button" class="report-tab" data-tab="viva_md"><i class="fa-solid fa-graduation-cap"></i> viva_questions.md</button>
            <button type="button" class="report-tab" data-tab="template_dashboard"><i class="fa-solid fa-code"></i> dashboard.html</button>
            <button type="button" class="report-tab" data-tab="template_attendance"><i class="fa-solid fa-code"></i> mark_attendance.html</button>
            <button type="button" class="report-tab" data-tab="requirements_txt"><i class="fa-solid fa-list"></i> requirements.txt</button>
            <button type="button" class="report-tab" data-tab="readme_md"><i class="fa-solid fa-book"></i> README.md</button>
          </div>
        </div>
        <div class="card-body">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
            <span class="text-muted" id="currentFileName">Viewing: <strong>app.py</strong></span>
            <button type="button" class="btn btn-sm btn-outline" id="btnCopyCode"><i class="fa-solid fa-copy"></i> Copy Code</button>
          </div>
          <pre id="codeDisplayArea" style="background:#0f172a; color:#f8fafc; padding:20px; border-radius:8px; overflow:auto; max-height:600px; font-family:'JetBrains Mono', monospace; font-size:12.5px; line-height:1.6;"></pre>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Global Event Attachments
// -----------------------------------------------------------------------------
function attachGlobalEvents() {
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (openSidebarBtn && sidebar) {
    openSidebarBtn.onclick = () => {
      sidebar.classList.add('open');
      backdrop?.classList.add('active');
    };
  }
  if (closeSidebarBtn) {
    closeSidebarBtn.onclick = closeMobileSidebar;
  }
  if (backdrop) {
    backdrop.onclick = closeMobileSidebar;
  }

  // Auto-close sidebar when clicking any navigation item on mobile
  document.querySelectorAll<HTMLElement>('.sidebar-nav [data-nav], .topbar [data-nav]').forEach((el) => {
    el.addEventListener('click', () => {
      closeMobileSidebar();
    });
  });

  // Role Switcher in Topbar (Admin only)
  const roleSelect = document.getElementById('roleSwitcherSelect') as HTMLSelectElement | null;
  if (roleSelect) {
    roleSelect.onchange = () => {
      db.setUserRole(roleSelect.value as UserRole);
      showToast(`Switched active role to: ${roleSelect.value}`, 'info');
      renderApp();
    };
  }

  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      db.logout();
      showToast('Logged out successfully.', 'info');
      navigateTo('login');
    };
  }

  // Global Edit / Delete Modal close listeners
  document.getElementById('btnCloseEditModal')?.addEventListener('click', () => (window as any).closeEditModal());
  document.getElementById('btnCancelEditModal')?.addEventListener('click', () => (window as any).closeEditModal());
  document.getElementById('btnCancelDeleteModal')?.addEventListener('click', () => (window as any).closeDeleteModal());

  // Download ZIP button
  const sourceZip = document.getElementById('btnDownloadZipSource');
  if (sourceZip) sourceZip.onclick = downloadProjectZip;

  // Page specific hooks
  if (currentPage === 'dashboard') {
    renderDashboardCharts();
  } else if (currentPage === 'camera-scanner') {
    attachCameraScannerEvents();
  } else if (currentPage === 'attendance') {
    attachAttendanceFormEvents();
  } else if (currentPage === 'students') {
    attachStudentsDirectoryEvents();
  } else if (currentPage === 'register') {
    attachRegisterFormEvents();
  } else if (currentPage === 'database-console') {
    attachDatabaseConsoleEvents();
  } else if (currentPage === 'settings') {
    attachSettingsFormEvents();
  } else if (currentPage === 'source-code') {
    attachSourceCodeEvents();
  }
}

// -----------------------------------------------------------------------------
// Real Camera & Face Recognition Event Handlers
// -----------------------------------------------------------------------------
function attachCameraScannerEvents() {
  const btnToggleCamera = document.getElementById('btnToggleRealCamera') as HTMLButtonElement | null;
  const btnCaptureEntry = document.getElementById('btnCaptureEntry') as HTMLButtonElement | null;
  const verifyPhotoInput = document.getElementById('verifyPhotoInput') as HTMLInputElement | null;
  const subjectSelect = document.getElementById('scannerSubjectSelect') as HTMLSelectElement | null;
  const autoMarkCb = document.getElementById('autoMarkCheckbox') as HTMLInputElement | null;

  const videoEl = document.getElementById('webcamElement') as HTMLVideoElement | null;
  const canvasEl = document.getElementById('scannerCanvas') as HTMLCanvasElement | null;
  const idleEl = document.getElementById('cameraIdlePlaceholder');
  const statusTextEl = document.getElementById('cameraStatusText');
  const liveDot = document.getElementById('cameraLiveDot');
  const cameraFeedLabel = document.getElementById('cameraFeedLabel');
  const indexStatusEl = document.getElementById('biometricIndexStatus');

  const reticle = document.getElementById('scannerReticle');
  const matchNoticeTag = document.getElementById('matchNoticeTag');
  const hudMatchName = document.getElementById('hudMatchName');
  const hudMatchDetails = document.getElementById('hudMatchDetails');
  const hudConfidenceScore = document.getElementById('hudConfidenceScore');

  if (subjectSelect) {
    subjectSelect.onchange = () => {
      scannerActiveSubject = subjectSelect.value;
    };
  }
  if (autoMarkCb) {
    autoMarkCb.onchange = () => {
      autoMarkEnabled = autoMarkCb.checked;
    };
  }

  // Enroll registered student face descriptors using real ML models
  const students = db.getStudents();
  if (hudMatchDetails) hudMatchDetails.textContent = 'Loading face detection & 128-d recognition models...';

  faceEngine
    .enrollAllStudents(students, (done, total, enrolled) => {
      if (indexStatusEl) {
        indexStatusEl.textContent = `INDEXING: ${done}/${total} (${enrolled} FACES)`;
      }
    })
    .then(({ total, enrolled }) => {
      if (indexStatusEl) {
        indexStatusEl.textContent = `INDEX: ${enrolled}/${total} ENROLLED`;
      }
      if (hudMatchDetails && !cameraStream) {
        hudMatchDetails.textContent = `Ready (${enrolled} student faces enrolled). Start camera or upload a photo.`;
      }
    })
    .catch(() => {
      if (hudMatchDetails) {
        hudMatchDetails.textContent = 'Failed to load face recognition models. Check network/assets.';
      }
    });

  function updateVerifiedCardError(title: string, subtitle: string, reasonTag: string) {
    const card = document.getElementById('verifiedStudentCard');
    const badge = document.getElementById('verifiedStatusBadge');
    const nameEl = document.getElementById('verifiedName');
    const rollEl = document.getElementById('verifiedRoll');
    const seatEl = document.getElementById('verifiedSeat');
    const classEl = document.getElementById('verifiedClass');
    const timeEl = document.getElementById('verifiedTimestamp');
    const scoreEl = document.getElementById('verifiedScoreText');
    const avatarEl = document.getElementById('verifiedAvatar') as HTMLImageElement | null;

    if (card) card.style.borderLeftColor = '#ef4444';
    if (badge) {
      badge.textContent = reasonTag;
      badge.style.background = '#fee2e2';
      badge.style.color = '#991b1b';
    }
    if (avatarEl) avatarEl.src = 'https://ui-avatars.com/api/?name=Unknown&background=dc2626&color=fff';
    if (nameEl) nameEl.textContent = title;
    if (rollEl) rollEl.textContent = '--';
    if (seatEl) seatEl.textContent = '--';
    if (classEl) classEl.textContent = subtitle;
    if (timeEl) timeEl.textContent = getLocalTimeString();
    if (scoreEl) scoreEl.textContent = 'Rejected';
  }

  function applyVerificationOutcome(res: FaceMatchResult, commitAttendance: boolean) {
    reticle?.classList.remove('matched', 'rejected');

    if (res.status === 'no_face') {
      if (matchNoticeTag) matchNoticeTag.style.display = 'none';
      if (hudMatchName) hudMatchName.textContent = 'No face detected';
      if (hudMatchDetails) hudMatchDetails.textContent = res.message;
      if (hudConfidenceScore) hudConfidenceScore.textContent = 'SIMILARITY: --%';
      if (commitAttendance) {
        updateVerifiedCardError('No Face Detected', 'Upload or capture a clear portrait', 'No Face');
        showToast(res.message, 'warning');
      }
      return;
    }

    if (res.status === 'multiple_faces') {
      reticle?.classList.add('rejected');
      if (matchNoticeTag) {
        matchNoticeTag.textContent = 'MULTIPLE FACES';
        matchNoticeTag.style.background = '#f59e0b';
        matchNoticeTag.style.display = 'block';
      }
      if (hudMatchName) hudMatchName.textContent = 'Multiple faces in frame';
      if (hudMatchDetails) hudMatchDetails.textContent = res.message;
      if (hudConfidenceScore) hudConfidenceScore.textContent = `FACES: ${res.faceCount}`;
      if (commitAttendance) {
        updateVerifiedCardError('Multiple Faces Rejected', 'One student at a time', 'Rejected');
        showToast(res.message, 'warning');
      }
      return;
    }

    if (res.status === 'low_confidence') {
      reticle?.classList.add('rejected');
      if (matchNoticeTag) {
        matchNoticeTag.textContent = 'LOW CONFIDENCE';
        matchNoticeTag.style.background = '#f59e0b';
        matchNoticeTag.style.display = 'block';
      }
      if (hudMatchName) hudMatchName.textContent = 'Low recognition clarity';
      if (hudMatchDetails) hudMatchDetails.textContent = res.message;
      if (hudConfidenceScore) {
        hudConfidenceScore.textContent = `DET SCORE: ${Math.round((res.detectionScore || 0) * 100)}%`;
      }
      if (commitAttendance) {
        updateVerifiedCardError('Low Confidence', 'Improve front lighting', 'Retry');
        showToast(res.message, 'warning');
      }
      return;
    }

    if (res.status === 'unknown' || res.status === 'no_enrolled_students') {
      reticle?.classList.add('rejected');
      if (matchNoticeTag) {
        matchNoticeTag.textContent = 'UNKNOWN FACE REJECTED';
        matchNoticeTag.style.background = '#ef4444';
        matchNoticeTag.style.color = '#fff';
        matchNoticeTag.style.display = 'block';
      }
      if (hudMatchName) hudMatchName.textContent = 'UNKNOWN PERSON — ACCESS REJECTED';
      if (hudMatchDetails) hudMatchDetails.textContent = res.message;
      if (hudConfidenceScore) {
        hudConfidenceScore.textContent =
          res.distance !== undefined ? `DIST: ${res.distance.toFixed(2)} (> ${db.getSettings().face_distance_threshold})` : 'UNENROLLED';
      }
      if (commitAttendance) {
        updateVerifiedCardError('Unknown Face Rejected', 'Not matched to any enrolled student', 'Rejected');
        showToast(res.message, 'danger');
      }
      return;
    }

    // Genuine biometric match!
    const matchedStudent = db.getStudent(res.student!.id);
    if (!matchedStudent) return;

    reticle?.classList.add('matched');
    if (matchNoticeTag) {
      matchNoticeTag.textContent = 'MATCH CONFIRMED';
      matchNoticeTag.style.background = '#22c55e';
      matchNoticeTag.style.color = '#000';
      matchNoticeTag.style.display = 'block';
    }
    if (hudMatchName) hudMatchName.textContent = `MATCH: ${matchedStudent.name.toUpperCase()} (${matchedStudent.roll_number})`;
    if (hudMatchDetails) {
      hudMatchDetails.textContent = `Roll: ${matchedStudent.roll_number} | Dist: ${res.distance?.toFixed(3)} | Subject: ${scannerActiveSubject}`;
    }
    if (hudConfidenceScore) {
      hudConfidenceScore.textContent = `SIMILARITY: ${res.confidence?.toFixed(1)}%`;
    }

    if (!commitAttendance) return;

    const nowTime = getLocalTimeString();
    const todayStr = getLocalDateString();
    const markResult = db.markAttendanceRecord(
      {
        student_id: matchedStudent.id,
        date: todayStr,
        time: nowTime,
        status: 'Present',
        subject: scannerActiveSubject,
        marked_by: 'Face Recognition Scanner',
        method: 'Face Recognition',
      },
      { preventDuplicate: true }
    );

    const card = document.getElementById('verifiedStudentCard');
    const badge = document.getElementById('verifiedStatusBadge');
    const avatarEl = document.getElementById('verifiedAvatar') as HTMLImageElement | null;
    const nameEl = document.getElementById('verifiedName');
    const rollEl = document.getElementById('verifiedRoll');
    const seatEl = document.getElementById('verifiedSeat');
    const classEl = document.getElementById('verifiedClass');
    const timeEl = document.getElementById('verifiedTimestamp');
    const scoreEl = document.getElementById('verifiedScoreText');

    if (avatarEl) avatarEl.src = matchedStudent.photo;
    if (nameEl) nameEl.textContent = matchedStudent.name;
    if (rollEl) rollEl.textContent = matchedStudent.roll_number;
    if (seatEl) seatEl.textContent = matchedStudent.seat_number;
    if (classEl) classEl.textContent = matchedStudent.class;
    if (scoreEl) scoreEl.textContent = `${res.confidence?.toFixed(1)}% (dist ${res.distance?.toFixed(3)})`;

    if (markResult.duplicate && markResult.existing) {
      if (card) card.style.borderLeftColor = '#d97706';
      if (badge) {
        badge.textContent = 'Already Marked';
        badge.style.background = '#fef3c7';
        badge.style.color = '#92400e';
      }
      if (timeEl) timeEl.textContent = markResult.existing.time;
      showToast(
        `Duplicate prevented: ${matchedStudent.name} (${matchedStudent.roll_number}) is already marked ${markResult.existing.status} for ${scannerActiveSubject} at ${markResult.existing.time}.`,
        'warning'
      );
    } else {
      playVerificationChime();
      if (card) card.style.borderLeftColor = '#22c55e';
      if (badge) {
        badge.textContent = 'Present';
        badge.style.background = '#dcfce7';
        badge.style.color = '#166534';
      }
      if (timeEl) timeEl.textContent = nowTime;
      showToast(
        `Attendance marked Present for ${matchedStudent.name} (${matchedStudent.roll_number}) at ${nowTime}!`,
        'success'
      );
      updateTodayEntryTable();
    }
  }

  function updateTodayEntryTable() {
    const todayStr = getLocalDateString();
    const tableBody = document.getElementById('todayEntryTableBody');
    const countLabel = document.getElementById('todayEntryCountLabel');
    const logsToday = db.getAttendance().filter((a) => a.date === todayStr && a.status === 'Present');

    if (countLabel) {
      countLabel.textContent = `${logsToday.length} Present record(s) today`;
    }
    if (tableBody) {
      tableBody.innerHTML = logsToday
        .map((l) => {
          const st = db.getStudent(l.student_id);
          return `
            <tr>
              <td><strong>${escapeHtml(st ? st.name : 'Student #' + l.student_id)}</strong></td>
              <td><span class="tag-time">${escapeHtml(l.time)}</span></td>
              <td><small>${escapeHtml(l.subject || 'CS')}</small></td>
              <td><span class="status-badge badge-present"><i class="fa-solid fa-check"></i> Present</span></td>
            </tr>
          `;
        })
        .join('');
    }
  }

  async function runSingleVideoVerification(useHighAccuracy: boolean, commitAttendance: boolean) {
    if (!videoEl || !cameraStream || videoEl.readyState < 2) {
      if (commitAttendance) {
        showToast('Start the webcam feed first or use "Verify Photo File" to scan a face.', 'warning');
      }
      return;
    }

    const settings = db.getSettings();
    const res = await faceEngine.detectAndMatchFrame(videoEl, canvasEl, db.getStudents(), {
      distanceThreshold: settings.face_distance_threshold,
      minDetectionConfidence: settings.min_detection_confidence,
      useHighAccuracy,
    });

    applyVerificationOutcome(res, commitAttendance);

    if (!commitAttendance && autoMarkEnabled && res.status === 'matched' && res.student) {
      if (consecutiveMatchId === res.student.id) {
        consecutiveMatchCount++;
      } else {
        consecutiveMatchId = res.student.id;
        consecutiveMatchCount = 1;
      }
      if (consecutiveMatchCount >= 2) {
        consecutiveMatchCount = 0;
        applyVerificationOutcome(res, true);
      }
    } else if (!commitAttendance) {
      consecutiveMatchId = null;
      consecutiveMatchCount = 0;
    }
  }

  if (btnToggleCamera) {
    btnToggleCamera.onclick = async () => {
      if (cameraStream) {
        stopCameraStream();
        if (videoEl) videoEl.srcObject = null;
        if (canvasEl) {
          const c = canvasEl.getContext('2d');
          c?.clearRect(0, 0, canvasEl.width, canvasEl.height);
        }
        if (idleEl) idleEl.style.display = 'flex';
        if (liveDot) {
          liveDot.style.background = '#64748b';
          liveDot.style.animation = 'none';
        }
        if (cameraFeedLabel) cameraFeedLabel.textContent = 'CAMERA STANDBY';
        btnToggleCamera.innerHTML = '<i class="fa-solid fa-video"></i> Start Webcam Feed';
        showToast('Webcam feed stopped.', 'info');
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg = 'Camera API requires a secure HTTPS (or localhost) context in your browser.';
        if (statusTextEl) statusTextEl.textContent = msg;
        showToast(msg, 'danger');
        return;
      }

      try {
        try {
          cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          });
        } catch {
          cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (videoEl) {
          videoEl.srcObject = cameraStream;
          await videoEl.play().catch(() => {});
          videoEl.style.display = 'block';
        }
        if (idleEl) idleEl.style.display = 'none';
        if (liveDot) {
          liveDot.style.background = '#ef4444';
          liveDot.style.animation = 'blinkDot 1s infinite';
        }
        if (cameraFeedLabel) cameraFeedLabel.textContent = 'LIVE FEED: ENTRY CAMERA 01';
        btnToggleCamera.innerHTML = '<i class="fa-solid fa-video-slash"></i> Stop Webcam Feed';
        showToast('Camera started! Real-time face tracking active.', 'success');

        liveDetectTimer = window.setInterval(async () => {
          if (liveDetectBusy || !cameraStream) return;
          liveDetectBusy = true;
          try {
            await runSingleVideoVerification(false, false);
          } catch {
            // Keep tracking resilient
          } finally {
            liveDetectBusy = false;
          }
        }, 350);
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string };
        let readable = 'Unable to access webcam.';
        if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
          readable = 'Camera permission was denied. Allow camera access in browser site settings and retry.';
        } else if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
          readable = 'No camera device detected on this machine. Connect a webcam or test with "Verify Photo File".';
        } else if (e?.name === 'NotReadableError') {
          readable = 'Camera is currently in use by another application.';
        } else if (e?.name === 'SecurityError') {
          readable = 'Camera requires HTTPS connection.';
        }
        if (statusTextEl) statusTextEl.textContent = readable;
        if (idleEl) idleEl.style.display = 'flex';
        showToast(readable, 'danger');
      }
    };
  }

  if (btnCaptureEntry) {
    btnCaptureEntry.onclick = async () => {
      btnCaptureEntry.disabled = true;
      try {
        await runSingleVideoVerification(true, true);
      } finally {
        btnCaptureEntry.disabled = false;
      }
    };
  }

  if (verifyPhotoInput) {
    verifyPhotoInput.onchange = async () => {
      const file = verifyPhotoInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        if (!dataUrl) return;
        try {
          if (hudMatchName) hudMatchName.textContent = 'Analyzing uploaded photo...';
          const img = await faceEngine.loadImageForDetection(dataUrl);
          const settings = db.getSettings();
          const res = await faceEngine.detectAndMatchFrame(img, canvasEl, db.getStudents(), {
            distanceThreshold: settings.face_distance_threshold,
            minDetectionConfidence: settings.min_detection_confidence,
            useHighAccuracy: true,
          });
          applyVerificationOutcome(res, true);
        } catch {
          showToast('Failed to analyze uploaded image.', 'danger');
        } finally {
          verifyPhotoInput.value = '';
        }
      };
      reader.readAsDataURL(file);
    };
  }
}

// -----------------------------------------------------------------------------
// Remaining Event Handlers (Directory, Register, Attendance, DB, Settings, Code)
// -----------------------------------------------------------------------------
function attachStudentsDirectoryEvents() {
  const searchEl = document.getElementById('studentsSearch') as HTMLInputElement | null;
  const classEl = document.getElementById('studentsClassFilter') as HTMLSelectElement | null;

  if (searchEl) {
    searchEl.oninput = () => {
      const pos = searchEl.selectionStart || searchEl.value.length;
      studentSearchQuery = searchEl.value;
      renderApp();
      const refreshed = document.getElementById('studentsSearch') as HTMLInputElement | null;
      if (refreshed) {
        refreshed.focus();
        refreshed.setSelectionRange(pos, pos);
      }
    };
  }

  if (classEl) {
    classEl.onchange = () => {
      studentClassFilter = classEl.value;
      renderApp();
    };
  }
}

function attachDatabaseConsoleEvents() {
  const btnExec = document.getElementById('btnExecuteSQL');
  const inputEl = document.getElementById('sqlQueryInput') as HTMLTextAreaElement | null;
  const statusEl = document.getElementById('sqlExecutionStatus');
  const rowCountEl = document.getElementById('sqlRowCount');
  const resultContainer = document.getElementById('sqlResultContainer');
  const resetBtn = document.getElementById('btnResetDB');

  function runQuery(sql: string) {
    const trimmed = sql.trim().toUpperCase();
    const startTime = performance.now();

    let data: Record<string, unknown>[] = [];
    if (trimmed.includes('FROM ATTENDANCE') && trimmed.includes("STATUS = 'ABSENT'")) {
      data = db.getAttendance().filter((a) => a.status === 'Absent') as unknown as Record<string, unknown>[];
    } else if (trimmed.includes('FROM ATTENDANCE') && trimmed.includes("STATUS = 'PRESENT'")) {
      data = db.getAttendance().filter((a) => a.status === 'Present') as unknown as Record<string, unknown>[];
    } else if (trimmed.includes('FROM ATTENDANCE')) {
      data = db.getAttendance() as unknown as Record<string, unknown>[];
    } else if (trimmed.includes('FROM NOTIFICATIONS')) {
      data = db.getNotifications() as unknown as Record<string, unknown>[];
    } else if (trimmed.includes('FROM SETTINGS')) {
      data = Object.entries(db.getSettings()).map(([key, value]) => ({ key, value }));
    } else {
      data = db.getStudents().map((s) => ({
        ...s,
        photo: s.photo.startsWith('data:') ? '[uploaded-data-url]' : s.photo,
      }));
    }

    const duration = (performance.now() - startTime).toFixed(2);
    if (statusEl) statusEl.innerHTML = `Query OK, executed in <strong>${duration}ms</strong>`;
    if (rowCountEl) rowCountEl.innerHTML = `Rows returned: <strong>${data.length}</strong>`;

    if (resultContainer) {
      if (data.length === 0) {
        resultContainer.innerHTML = `<div style="padding:16px; color:#64748b;">0 rows in set.</div>`;
        return;
      }

      const keys = Object.keys(data[0]);
      resultContainer.innerHTML = `
        <table class="data-table" style="font-family:'JetBrains Mono', monospace; font-size:12px;">
          <thead><tr>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
          <tbody>
            ${data
              .map(
                (row) => `
                  <tr>${keys.map((k) => `<td>${row[k] !== undefined ? escapeHtml(row[k]) : 'NULL'}</td>`).join('')}</tr>
                `
              )
              .join('')}
          </tbody>
        </table>
      `;
    }
  }

  if (btnExec && inputEl) {
    btnExec.onclick = () => runQuery(inputEl.value);
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      db.resetToSample();
      showToast('Database re-seeded to initial sample data!', 'success');
      renderApp();
    };
  }

  (window as any).runPresetQuery = (query: string) => {
    if (inputEl) inputEl.value = query;
    runQuery(query);
  };

  runQuery('SELECT * FROM students;');
}

function attachRegisterFormEvents() {
  const form = document.getElementById('studentRegistrationForm') as HTMLFormElement | null;
  const fileInput = document.getElementById('regPhotoFile') as HTMLInputElement | null;
  const fileNameDisplay = document.getElementById('regPhotoFileName');
  const imgPreview = document.getElementById('regPhotoImg') as HTMLImageElement | null;
  const iconPreview = document.getElementById('regPhotoIcon');
  const faceCheckEl = document.getElementById('regFaceCheckStatus');

  let chosenPhotoUrl = '';
  let extractedDescriptor: number[] | null = null;

  if (fileInput) {
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (fileNameDisplay) fileNameDisplay.textContent = file.name;
      const reader = new FileReader();
      reader.onload = async (e) => {
        chosenPhotoUrl = e.target?.result as string;
        if (imgPreview && iconPreview) {
          imgPreview.src = chosenPhotoUrl;
          imgPreview.classList.remove('hidden');
          iconPreview.classList.add('hidden');
        }
        if (faceCheckEl) faceCheckEl.textContent = 'Extracting 128-d facial descriptor...';
        try {
          const img = await faceEngine.loadImageForDetection(chosenPhotoUrl);
          const extracted = await faceEngine.extractDescriptorFromImage(img);
          if (extracted) {
            extractedDescriptor = Array.from(extracted.descriptor);
            if (faceCheckEl) {
              faceCheckEl.innerHTML = `<span class="text-success"><strong>Biometric Ready:</strong> Face detected (${Math.round(extracted.score * 100)}% confidence) &amp; 128-d descriptor extracted.</span>`;
            }
          } else {
            extractedDescriptor = null;
            if (faceCheckEl) {
              faceCheckEl.innerHTML = `<span class="text-warning">No clear face detected in this photo. Manual roll call still works; upload a clearer front-facing portrait for Face Recognition.</span>`;
            }
          }
        } catch {
          extractedDescriptor = null;
        }
      };
      reader.readAsDataURL(file);
    };
  }

  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = (document.getElementById('regName') as HTMLInputElement).value.trim();
      const roll = (document.getElementById('regRoll') as HTMLInputElement).value.trim();
      const seat = (document.getElementById('regSeat') as HTMLInputElement).value.trim();
      const cls = (document.getElementById('regClass') as HTMLSelectElement).value;
      const email = (document.getElementById('regEmail') as HTMLInputElement).value.trim();
      const phone = (document.getElementById('regPhone') as HTMLInputElement).value.trim();
      const parentName = (document.getElementById('regParentName') as HTMLInputElement).value.trim();
      const parentPhone = (document.getElementById('regParentPhone') as HTMLInputElement).value.trim();

      const dupError = db.hasDuplicateRollOrSeat(roll, seat);
      if (dupError) {
        showToast(dupError, 'danger');
        return;
      }

      const photo =
        chosenPhotoUrl ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0284c7&color=fff`;

      const added = db.addStudent(
        {
          name,
          roll_number: roll,
          seat_number: seat,
          class: cls,
          email,
          phone,
          parent_name: parentName,
          parent_phone: parentPhone,
          photo,
        },
        extractedDescriptor
      );

      if (chosenPhotoUrl) {
        void faceEngine.enrollStudent(added, true);
      }

      showToast(`Student ${name} (${roll}) registered successfully!`, 'success');
      navigateTo('students');
    };
  }
}

function attachAttendanceFormEvents() {
  const form = document.getElementById('attendanceMarkingForm') as HTMLFormElement | null;
  const dateInput = document.getElementById('attDateSelect') as HTMLInputElement | null;
  const subjectInput = document.getElementById('lectureSubjectSelect') as HTMLSelectElement | null;
  const btnAllPresent = document.getElementById('btnMarkAllPresent');
  const btnAllAbsent = document.getElementById('btnMarkAllAbsent');

  if (dateInput) {
    dateInput.onchange = () => {
      selectedAttendanceDate = dateInput.value || getLocalDateString();
      renderApp();
    };
  }

  if (subjectInput) {
    subjectInput.onchange = () => {
      selectedAttendanceSubject = subjectInput.value || SUBJECTS[0];
      renderApp();
    };
  }

  if (btnAllPresent) {
    btnAllPresent.onclick = () => {
      document.querySelectorAll<HTMLInputElement>('input[type="radio"][value="Present"]').forEach((r) => {
        r.checked = true;
      });
      (window as any).updateAttendanceLiveCount();
    };
  }

  if (btnAllAbsent) {
    btnAllAbsent.onclick = () => {
      document.querySelectorAll<HTMLInputElement>('input[type="radio"][value="Absent"]').forEach((r) => {
        r.checked = true;
      });
      (window as any).updateAttendanceLiveCount();
    };
  }

  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btnSaveAttendance') as HTMLButtonElement | null;
      if (saveBtn) saveBtn.disabled = true;

      const students = db.getStudents();
      const recordsToSave: { student_id: number; status: 'Present' | 'Absent' }[] = [];
      const subject = subjectInput?.value || selectedAttendanceSubject || SUBJECTS[0];

      students.forEach((s) => {
        const checkedRadio = document.querySelector<HTMLInputElement>(`input[name="att_status_${s.id}"]:checked`);
        const status = checkedRadio ? (checkedRadio.value as 'Present' | 'Absent') : 'Present';
        recordsToSave.push({ student_id: s.id, status });
      });

      const user = db.getCurrentUser();
      db.batchMarkAttendance(selectedAttendanceDate, recordsToSave, user ? user.name : 'Teacher', subject);

      showToast(`Attendance for ${selectedAttendanceDate} (${subject}) saved permanently!`, 'success');
      navigateTo('records');
    };
  }
}

function attachSettingsFormEvents() {
  const form = document.getElementById('settingsForm') as HTMLFormElement | null;
  if (!form) return;
  form.onsubmit = (e) => {
    e.preventDefault();
    const threshold = Number((document.getElementById('settingThreshold') as HTMLInputElement).value);
    const faceDist = Number((document.getElementById('settingFaceDist') as HTMLInputElement).value);
    const detConf = Number((document.getElementById('settingDetConf') as HTMLInputElement).value);
    const defaultSubj = (document.getElementById('settingDefaultSubject') as HTMLSelectElement).value;
    const inst = (document.getElementById('settingInstitution') as HTMLInputElement).value.trim();
    const year = (document.getElementById('settingAcademicYear') as HTMLInputElement).value.trim();

    db.updateSettings({
      attendance_threshold: threshold,
      face_distance_threshold: faceDist,
      min_detection_confidence: detConf,
      default_subject: defaultSubj,
      institution_name: inst,
      academic_year: year,
    });
    showToast(`Settings saved! Threshold updated to ${threshold}%.`, 'success');
    renderApp();
  };
}

function attachSourceCodeEvents() {
  const tabs = document.querySelectorAll('#codeFileTabs .report-tab');
  const codeArea = document.getElementById('codeDisplayArea');
  const fileNameHeader = document.getElementById('currentFileName');
  const copyBtn = document.getElementById('btnCopyCode');

  let activeTabKey = 'app_py';

  function displayFile(key: string) {
    activeTabKey = key;
    const file = CODE_FILES[key];
    if (file && codeArea && fileNameHeader) {
      fileNameHeader.innerHTML = `Viewing: <strong>${escapeHtml(file.name)}</strong>`;
      codeArea.textContent = file.content;
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const tabKey = (tab as HTMLElement).dataset.tab;
      if (tabKey) displayFile(tabKey);
    });
  });

  if (copyBtn) {
    copyBtn.onclick = () => {
      const file = CODE_FILES[activeTabKey];
      if (file) {
        void navigator.clipboard.writeText(file.content);
        showToast(`Copied ${file.name} to clipboard!`, 'info');
      }
    };
  }

  displayFile('app_py');
}

async function downloadProjectZip() {
  showToast('Preparing complete Python Flask project archive...', 'info');
  try {
    const zip = new JSZip();
    Object.values(CODE_FILES).forEach((file) => {
      zip.file(file.name, file.content);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smart_attendance_system_Sahil_Pasula_24TCS076.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Downloaded updated Flask Project .zip!', 'success');
  } catch {
    showToast('Unable to generate ZIP archive.', 'danger');
  }
}

// -----------------------------------------------------------------------------
// Window Globals
// -----------------------------------------------------------------------------
(window as any).updateAttendanceLiveCount = function () {
  const present = document.querySelectorAll('input[type="radio"][value="Present"]:checked').length;
  const absent = document.querySelectorAll('input[type="radio"][value="Absent"]:checked').length;

  const presentEl = document.getElementById('chipLivePresent');
  const absentEl = document.getElementById('chipLiveAbsent');
  if (presentEl) presentEl.textContent = String(present);
  if (absentEl) absentEl.textContent = String(absent);

  document.querySelectorAll<HTMLTableRowElement>('.student-row').forEach((row) => {
    const sId = row.id.replace('row_', '');
    const isPresent = (document.querySelector(`input[name="att_status_${sId}"][value="Present"]`) as HTMLInputElement)?.checked;
    if (isPresent) {
      row.classList.remove('row-absent');
      row.classList.add('row-present');
    } else {
      row.classList.remove('row-present');
      row.classList.add('row-absent');
    }
  });
};

(window as any).filterRecordsTable = function () {
  const dateVal = (document.getElementById('recordsDateFilter') as HTMLInputElement)?.value;
  const classVal = (document.getElementById('recordsClassFilter') as HTMLSelectElement)?.value;
  const statusVal = (document.getElementById('recordsStatusFilter') as HTMLSelectElement)?.value;
  const searchVal = (document.getElementById('recordsSearch') as HTMLInputElement)?.value.toLowerCase().trim();

  const rows = document.querySelectorAll<HTMLTableRowElement>('#recordsTbody tr');
  let count = 0;

  rows.forEach((r) => {
    const rDate = r.dataset.date || '';
    const rClass = r.dataset.class || '';
    const rStatus = r.dataset.status || '';
    const rSearch = r.dataset.search || '';

    const matchDate = !dateVal || rDate === dateVal;
    const matchClass = !classVal || rClass === classVal;
    const matchStatus = !statusVal || rStatus === statusVal;
    const matchSearch = !searchVal || rSearch.includes(searchVal);

    if (matchDate && matchClass && matchStatus && matchSearch) {
      r.style.display = '';
      count++;
    } else {
      r.style.display = 'none';
    }
  });

  const countEl = document.getElementById('recordsCount');
  if (countEl) countEl.textContent = String(count);
};

function csvCell(val: unknown): string {
  const s = String(val ?? '').replace(/"/g, '""');
  return `"${s}"`;
}

function downloadCsvFile(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

(window as any).exportAttendanceCSV = function () {
  const records = getVisibleAttendance();
  const students = db.getStudents();
  const map = new Map<number, Student>();
  students.forEach((s) => map.set(s.id, s));

  let csv = 'ID,Student Name,Roll Number,Seat Number,Class,Date,Time,Subject,Method,Status,Marked By\n';
  records.forEach((r) => {
    const s = map.get(r.student_id);
    csv +=
      [
        r.id,
        s ? s.name : '',
        s ? s.roll_number : '',
        s ? s.seat_number : '',
        s ? s.class : '',
        r.date,
        r.time,
        r.subject || 'CS',
        r.method || 'Manual',
        r.status,
        r.marked_by,
      ]
        .map(csvCell)
        .join(',') + '\n';
  });

  downloadCsvFile(csv, `attendance_audit_${getLocalDateString()}.csv`);
  showToast('Attendance records exported to CSV!', 'info');
};

(window as any).exportRecordsPDF = function () {
  const records = getVisibleAttendance();
  const students = db.getStudents();
  const map = new Map<number, Student>();
  students.forEach((s) => map.set(s.id, s));
  const sorted = [...records].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

  exportTableToPDF({
    title: 'Attendance Records Audit Trail',
    subtitle: `Exported ${sorted.length} records`,
    filename: `attendance_records_${getLocalDateString()}.pdf`,
    institutionName: db.getSettings().institution_name,
    headers: ['#', 'Student Name', 'Roll No', 'Class', 'Date', 'Time', 'Subject', 'Status'],
    rows: sorted.map((r, i) => {
      const s = map.get(r.student_id);
      return [
        i + 1,
        s ? s.name : 'Unknown',
        s ? s.roll_number : '-',
        s ? s.class : '-',
        r.date,
        r.time,
        r.subject || 'CS',
        r.status,
      ];
    }),
  });
  showToast('Attendance audit trail downloaded as PDF!', 'success');
};

(window as any).exportActiveReportCSV = function () {
  const allStudents = getVisibleStudents();
  const students = selectedReportClass
    ? allStudents.filter((s) => s.class === selectedReportClass)
    : allStudents;
  const attendance = getVisibleAttendance();
  const threshold = db.getSettings().attendance_threshold;

  if (currentReportType === 'student') {
    let csv = 'Sr,Student Name,Roll Number,Seat Number,Class,Total Lectures,Present,Absent,Percentage,Status\n';
    students.forEach((s, idx) => {
      const logs = attendance.filter((a) => a.student_id === s.id);
      const total = logs.length;
      const present = logs.filter((a) => a.status === 'Present').length;
      const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
      const status = total === 0 ? 'No Sessions' : pct < threshold ? `Below ${threshold}%` : 'Eligible';
      csv += [idx + 1, s.name, s.roll_number, s.seat_number, s.class, total, present, total - present, `${pct}%`, status].map(csvCell).join(',') + '\n';
    });
    downloadCsvFile(csv, `cumulative_report_${getLocalDateString()}.csv`);
  } else if (currentReportType === 'monthly') {
    const monthLogs = attendance.filter((a) => a.date.startsWith(selectedReportMonth));
    let csv = `Sr,Student Name,Roll Number,Class,Month,Lectures,Present,Absent,Percentage,Status\n`;
    students.forEach((s, idx) => {
      const logs = monthLogs.filter((a) => a.student_id === s.id);
      const total = logs.length;
      const present = logs.filter((a) => a.status === 'Present').length;
      const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
      const status = total === 0 ? 'No Logs' : pct < threshold ? `Below ${threshold}%` : 'Eligible';
      csv += [idx + 1, s.name, s.roll_number, s.class, selectedReportMonth, total, present, total - present, `${pct}%`, status].map(csvCell).join(',') + '\n';
    });
    downloadCsvFile(csv, `monthly_report_${selectedReportMonth}.csv`);
  } else if (currentReportType === 'daily') {
    const dailyLogs = attendance.filter((a) => a.date === selectedAttendanceDate);
    let csv = 'Sr,Student Name,Roll Number,Class,Date,Time,Subject,Status\n';
    students.forEach((s, idx) => {
      const log = dailyLogs.find((a) => a.student_id === s.id);
      csv += [idx + 1, s.name, s.roll_number, s.class, selectedAttendanceDate, log?.time || '-', log?.subject || '-', log?.status || 'Not Marked'].map(csvCell).join(',') + '\n';
    });
    downloadCsvFile(csv, `daily_report_${selectedAttendanceDate}.csv`);
  } else if (currentReportType === 'notice-board') {
    const defaulters = db.getLowAttendanceStudents(selectedReportClass);
    let csv = 'Sr,Roll Number,Seat Number,Student Name,Class,Total Lectures,Attended,Percentage,Status\n';
    defaulters.forEach((d, idx) => {
      csv += [idx + 1, d.student.roll_number, d.student.seat_number, d.student.name, d.student.class, d.total, d.present, `${d.percentage}%`, 'Defaulter'].map(csvCell).join(',') + '\n';
    });
    downloadCsvFile(csv, `defaulters_${getLocalDateString()}.csv`);
  } else {
    (window as any).exportAttendanceCSV();
    return;
  }
  showToast('Report exported to CSV!', 'info');
};

(window as any).exportActiveReportPDF = function () {
  const allStudents = getVisibleStudents();
  const students = selectedReportClass
    ? allStudents.filter((s) => s.class === selectedReportClass)
    : allStudents;
  const attendance = getVisibleAttendance();
  const settings = db.getSettings();
  const threshold = settings.attendance_threshold;

  if (currentReportType === 'student') {
    exportTableToPDF({
      title: `Cumulative Attendance Report (${threshold}% Rule)`,
      subtitle: `Class Filter: ${selectedReportClass || 'All Classes'} | Formula: (Present / Total) x 100`,
      filename: `cumulative_attendance_${getLocalDateString()}.pdf`,
      institutionName: settings.institution_name,
      headers: ['#', 'Name', 'Roll No', 'Class', 'Total', 'Present', 'Absent', '%', 'Status'],
      rows: students.map((s, idx) => {
        const logs = attendance.filter((a) => a.student_id === s.id);
        const total = logs.length;
        const present = logs.filter((a) => a.status === 'Present').length;
        const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
        const status = total === 0 ? 'No Sessions' : pct < threshold ? `Below ${threshold}%` : 'Eligible';
        return [idx + 1, s.name, s.roll_number, s.class, total, present, total - present, `${pct}%`, status];
      }),
    });
  } else if (currentReportType === 'daily') {
    const dailyLogs = attendance.filter((a) => a.date === selectedAttendanceDate);
    exportTableToPDF({
      title: `Daily Attendance Register (${selectedAttendanceDate})`,
      subtitle: `Class Filter: ${selectedReportClass || 'All Classes'}`,
      filename: `daily_attendance_${selectedAttendanceDate}.pdf`,
      institutionName: settings.institution_name,
      headers: ['#', 'Name', 'Roll No', 'Class', 'Time', 'Subject', 'Status'],
      rows: students.map((s, idx) => {
        const log = dailyLogs.find((a) => a.student_id === s.id);
        return [idx + 1, s.name, s.roll_number, s.class, log?.time || '-', log?.subject || '-', log?.status || 'Not Marked'];
      }),
    });
  } else if (currentReportType === 'monthly') {
    const monthLogs = attendance.filter((a) => a.date.startsWith(selectedReportMonth));
    exportTableToPDF({
      title: `Monthly Attendance Report (${selectedReportMonth})`,
      subtitle: `Class Filter: ${selectedReportClass || 'All Classes'} | Threshold: ${threshold}%`,
      filename: `monthly_attendance_${selectedReportMonth}.pdf`,
      institutionName: settings.institution_name,
      headers: ['#', 'Name', 'Roll No', 'Class', 'Lectures', 'Present', 'Absent', '%', 'Status'],
      rows: students.map((s, idx) => {
        const logs = monthLogs.filter((a) => a.student_id === s.id);
        const total = logs.length;
        const present = logs.filter((a) => a.status === 'Present').length;
        const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : 0;
        const status = total === 0 ? 'No Logs' : pct < threshold ? `Below ${threshold}%` : 'Eligible';
        return [idx + 1, s.name, s.roll_number, s.class, total, present, total - present, total > 0 ? `${pct}%` : 'N/A', status];
      }),
    });
  } else if (currentReportType === 'subject') {
    exportTableToPDF({
      title: 'Subject-Wise Attendance Breakdown',
      subtitle: `Class Filter: ${selectedReportClass || 'All Classes'}`,
      filename: `subject_attendance_${getLocalDateString()}.pdf`,
      institutionName: settings.institution_name,
      headers: ['#', 'Name', 'Roll No', ...SUBJECTS.map((sub) => sub.split(' ')[0]), 'Overall %'],
      rows: students.map((s, idx) => {
        const logs = attendance.filter((a) => a.student_id === s.id);
        const overallPct = logs.length > 0 ? Math.round((logs.filter((a) => a.status === 'Present').length / logs.length) * 1000) / 10 : 0;
        return [
          idx + 1,
          s.name,
          s.roll_number,
          ...SUBJECTS.map((sub) => {
            const subLogs = logs.filter((a) => (a.subject || SUBJECTS[0]) === sub);
            if (subLogs.length === 0) return '0/0 (N/A)';
            const p = subLogs.filter((a) => a.status === 'Present').length;
            return `${p}/${subLogs.length} (${Math.round((p / subLogs.length) * 100)}%)`;
          }),
          `${overallPct}%`,
        ];
      }),
    });
  } else {
    const defaulters = db.getLowAttendanceStudents(selectedReportClass);
    exportTableToPDF({
      title: `Official Attendance Defaulters List (< ${threshold}%)`,
      subtitle: `Class Filter: ${selectedReportClass || 'All Classes'} | Academic Year ${settings.academic_year}`,
      filename: `defaulters_list_${getLocalDateString()}.pdf`,
      institutionName: settings.institution_name,
      headers: ['Sr', 'Roll No', 'Seat No', 'Student Name', 'Class', 'Lectures', 'Attended', '%'],
      rows: defaulters.map((d, i) => [
        i + 1,
        d.student.roll_number,
        d.student.seat_number,
        d.student.name,
        d.student.class,
        d.total,
        d.present,
        `${d.percentage}%`,
      ]),
    });
  }
  showToast('PDF Report generated and downloaded!', 'success');
};

(window as any).switchReport = function (
  type: 'student' | 'daily' | 'monthly' | 'subject' | 'notice-board'
) {
  currentReportType = type;
  renderApp();
};

(window as any).changeDailyReportDate = function (val: string) {
  if (val) selectedAttendanceDate = val;
  renderApp();
};

(window as any).changeMonthlyReportMonth = function (val: string) {
  if (val) selectedReportMonth = val;
  renderApp();
};

(window as any).changeReportClass = function (val: string) {
  selectedReportClass = val;
  renderApp();
};

(window as any).changeNotifClass = function (val: string) {
  selectedNotifClass = val;
  renderApp();
};

(window as any).viewStudent = function (id: number) {
  navigateTo('student-view', id);
};

(window as any).openEditModal = function (id: number) {
  const s = db.getStudent(id);
  if (!s) return;

  const modal = document.getElementById('editStudentModal');
  if (!modal) return;

  (document.getElementById('editStudentId') as HTMLInputElement).value = String(s.id);
  (document.getElementById('editName') as HTMLInputElement).value = s.name;
  (document.getElementById('editRoll') as HTMLInputElement).value = s.roll_number;
  (document.getElementById('editSeat') as HTMLInputElement).value = s.seat_number;
  (document.getElementById('editClass') as HTMLSelectElement).value = s.class;
  (document.getElementById('editEmail') as HTMLInputElement).value = s.email;
  (document.getElementById('editPhone') as HTMLInputElement).value = s.phone;
  (document.getElementById('editParentName') as HTMLInputElement).value = s.parent_name || '';
  (document.getElementById('editParentPhone') as HTMLInputElement).value = s.parent_phone || '';

  const previewImg = document.getElementById('editPhotoPreview') as HTMLImageElement | null;
  const photoInput = document.getElementById('editPhotoFile') as HTMLInputElement | null;
  const bioStatus = document.getElementById('editBiometricStatus');
  if (previewImg) previewImg.src = s.photo;
  if (photoInput) photoInput.value = '';
  if (bioStatus) {
    bioStatus.textContent = faceEngine.isStudentEnrolled(s.id)
      ? 'Current photo is biometrically enrolled (128-d).'
      : 'No face descriptor indexed for current photo.';
  }

  let updatedPhoto = s.photo;
  let updatedDescriptor: number[] | null = null;

  if (photoInput) {
    photoInput.onchange = () => {
      const f = photoInput.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        updatedPhoto = ev.target?.result as string;
        if (previewImg) previewImg.src = updatedPhoto;
        if (bioStatus) bioStatus.textContent = 'Checking face detection on new photo...';
        try {
          const img = await faceEngine.loadImageForDetection(updatedPhoto);
          const ext = await faceEngine.extractDescriptorFromImage(img);
          if (ext) {
            updatedDescriptor = Array.from(ext.descriptor);
            if (bioStatus) bioStatus.textContent = 'Face detected & new 128-d descriptor ready.';
          } else {
            updatedDescriptor = null;
            if (bioStatus) bioStatus.textContent = 'No clear face detected in new photo.';
          }
        } catch {
          updatedDescriptor = null;
        }
      };
      reader.readAsDataURL(f);
    };
  }

  modal.classList.remove('hidden');

  const form = document.getElementById('editStudentForm') as HTMLFormElement | null;
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const newName = (document.getElementById('editName') as HTMLInputElement).value.trim();
      const newRoll = (document.getElementById('editRoll') as HTMLInputElement).value.trim();
      const newSeat = (document.getElementById('editSeat') as HTMLInputElement).value.trim();

      const dupError = db.hasDuplicateRollOrSeat(newRoll, newSeat, s.id);
      if (dupError) {
        showToast(dupError, 'danger');
        return;
      }

      const photoChanged = updatedPhoto !== s.photo;
      db.updateStudent(
        s.id,
        {
          name: newName,
          roll_number: newRoll,
          seat_number: newSeat,
          class: (document.getElementById('editClass') as HTMLSelectElement).value,
          email: (document.getElementById('editEmail') as HTMLInputElement).value.trim(),
          phone: (document.getElementById('editPhone') as HTMLInputElement).value.trim(),
          parent_name: (document.getElementById('editParentName') as HTMLInputElement).value.trim(),
          parent_phone: (document.getElementById('editParentPhone') as HTMLInputElement).value.trim(),
          photo: updatedPhoto,
        },
        updatedDescriptor
      );

      if (photoChanged) {
        const refreshed = db.getStudent(s.id);
        if (refreshed) void faceEngine.enrollStudent(refreshed, true);
      }

      (window as any).closeEditModal();
      showToast(`Student ${newName} updated successfully!`, 'success');
      renderApp();
    };
  }
};

(window as any).closeEditModal = function () {
  document.getElementById('editStudentModal')?.classList.add('hidden');
};

let studentToDeleteId: number | null = null;
(window as any).openDeleteModal = function (id: number) {
  const s = db.getStudent(id);
  if (!s) return;
  studentToDeleteId = id;
  const nameEl = document.getElementById('deleteStudentName');
  if (nameEl) nameEl.textContent = `${s.name} (${s.roll_number})`;
  document.getElementById('deleteModal')?.classList.remove('hidden');

  const confirmBtn = document.getElementById('confirmDeleteBtn');
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      if (studentToDeleteId !== null) {
        db.deleteStudent(studentToDeleteId);
        (window as any).closeDeleteModal();
        showToast('Student and associated attendance records deleted.', 'warning');
        if (currentPage === 'student-view') {
          navigateTo('students');
        } else {
          renderApp();
        }
      }
    };
  }
};

(window as any).closeDeleteModal = function () {
  studentToDeleteId = null;
  document.getElementById('deleteModal')?.classList.add('hidden');
};

(window as any).acknowledgeAlert = function (studentId: number) {
  db.acknowledgeNotification(studentId);
  showToast('Shortage alert acknowledged and saved.', 'info');
  renderApp();
};

(window as any).recordParentNotice = function (studentId: number, channel: string) {
  db.logNotificationDispatch(studentId, channel);
  renderApp();
  const st = db.getStudent(studentId);
  const textEl = document.getElementById('parentAlertText');
  if (textEl && st) {
    textEl.innerHTML = `Shortage notice logged for <strong>${escapeHtml(st.name)}</strong> via <strong>${escapeHtml(channel)}</strong>.<br><small class="text-muted">Saved persistently in notifications log.</small>`;
  }
  document.getElementById('parentAlertModal')?.classList.remove('hidden');
};

(window as any).sendBatchParentNotice = function () {
  const defaulters = db.getLowAttendanceStudents(selectedNotifClass);
  if (defaulters.length === 0) {
    showToast('No students currently below threshold.', 'info');
    return;
  }
  defaulters.forEach((d) => db.logNotificationDispatch(d.student.id, 'Batch Internal Notice Log'));
  renderApp();
  const textEl = document.getElementById('parentAlertText');
  if (textEl) {
    textEl.innerHTML = `Logged guardian alert status for <strong>${defaulters.length} attendance defaulter(s)</strong>.<br><br>Note: External cellular SMS delivery requires an institutional SMS gateway API; individual Email drafts remain available per card.`;
  }
  document.getElementById('parentAlertModal')?.classList.remove('hidden');
};

// -----------------------------------------------------------------------------
// Hash change listener & Application Bootstrap
// -----------------------------------------------------------------------------
function syncRouteFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (!db.getCurrentUser()) {
    currentPage = 'login';
    return;
  }
  if (!hash || hash === 'login') {
    currentPage = 'dashboard';
  } else if (hash.startsWith('student-view/')) {
    currentPage = 'student-view';
    currentStudentViewId = parseInt(hash.split('/')[1]) || 1;
  } else {
    currentPage = (hash.split('/')[0] as PageName) || 'dashboard';
  }
}

window.addEventListener('hashchange', () => {
  syncRouteFromHash();
  renderApp();
});

document.addEventListener('DOMContentLoaded', async () => {
  await apiClient.checkHealth();
  syncRouteFromHash();
  renderApp();
});
