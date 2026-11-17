/**
 * Optional REST API client connecting frontend actions to Python Flask /api/* endpoints
 * when a live backend is reachable (local Flask dev proxy or Vercel Python serverless).
 * Never fabricates or mocks API responses.
 */

export interface BackendHealthStatus {
  connected: boolean;
  backendLabel: string;
  studentsCount?: number;
  attendanceCount?: number;
  lastChecked: string;
}

class ApiClient {
  public health: BackendHealthStatus = {
    connected: false,
    backendLabel: 'Checking backend...',
    lastChecked: '',
  };

  public async checkHealth(): Promise<BackendHealthStatus> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch('/api/health', {
        method: 'GET',
        credentials: 'include',
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        this.health = {
          connected: false,
          backendLabel: `Browser SQLite Mirror (API returned HTTP ${res.status})`,
          lastChecked: new Date().toLocaleTimeString(),
        };
        return this.health;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        this.health = {
          connected: false,
          backendLabel: 'Browser Persistent Storage Mode (Static Host)',
          lastChecked: new Date().toLocaleTimeString(),
        };
        return this.health;
      }

      const data = await res.json();
      if (data && data.status === 'ok') {
        this.health = {
          connected: true,
          backendLabel: `${data.backend || 'Python Flask + SQLite3'}${data.vercel ? ' (Vercel Serverless)' : ''}`,
          studentsCount: data.students,
          attendanceCount: data.attendance_records,
          lastChecked: new Date().toLocaleTimeString(),
        };
        return this.health;
      }
    } catch {
      // Static deployment or Flask server offline
    }

    this.health = {
      connected: false,
      backendLabel: 'Browser Persistent Storage Mode (Flask /api offline)',
      lastChecked: new Date().toLocaleTimeString(),
    };
    return this.health;
  }

  public async request(path: string, options: RequestInit = {}): Promise<any | null> {
    if (!this.health.connected) return null;
    try {
      const res = await fetch(path, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return null;
      const body = await res.json();
      return { ok: res.ok, status: res.status, body };
    } catch {
      return null;
    }
  }
}

export const apiClient = new ApiClient();
