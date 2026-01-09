/**
 * API Client for MySQL backend
 * Replaces the Supabase client with calls to our Express API server
 */

// Use Vite's base URL in production (e.g., '/makethecase/') or '/' in development
// import.meta.env.BASE_URL is provided by Vite and includes the trailing slash
const BASE_URL = import.meta.env.BASE_URL || '/';
// Remove trailing slash, then add /api
const API_BASE = BASE_URL.replace(/\/$/, '') + '/api';

// Export API_BASE for use in direct fetch calls
export function getApiBaseUrl(): string {
  return API_BASE;
}

// Auth token management - separate tokens for admin and student to prevent conflicts
// when multiple tabs are open with different roles
let adminAuthToken: string | null = localStorage.getItem('admin_auth_token');
let studentAuthToken: string | null = localStorage.getItem('student_auth_token');

// Determine current context based on URL hash
function isAdminContext(): boolean {
  return window.location.hash === '#/admin' || window.location.hash.startsWith('#/admin');
}

// Get the appropriate token for the current context
function getActiveToken(): string | null {
  if (isAdminContext()) {
    return adminAuthToken;
  }
  return studentAuthToken;
}

export function setAuthToken(token: string | null, role?: 'admin' | 'student') {
  // Determine role from context if not specified
  const effectiveRole = role || (isAdminContext() ? 'admin' : 'student');
  
  if (effectiveRole === 'admin') {
    adminAuthToken = token;
    if (token) {
      localStorage.setItem('admin_auth_token', token);
    } else {
      localStorage.removeItem('admin_auth_token');
    }
  } else {
    studentAuthToken = token;
    if (token) {
      localStorage.setItem('student_auth_token', token);
    } else {
      localStorage.removeItem('student_auth_token');
    }
  }
  
  // Also maintain legacy auth_token for backward compatibility (use the current context token)
  const activeToken = getActiveToken();
  if (activeToken) {
    localStorage.setItem('auth_token', activeToken);
  }
}

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  const token = getActiveToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// Generic fetch wrapper
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...options.headers,
      },
    });

    const result = await response.json();

    if (!response.ok) {
      return { data: null, error: { message: result.error || 'Request failed' } };
    }

    return result;
  } catch (error) {
    return { data: null, error: { message: (error as Error).message } };
  }
}

// ==================== Auth API ====================

export const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const result = await response.json();

    if (!response.ok) {
      return { data: null, error: { message: result.error || 'Login failed' } };
    }

    // Store the token as admin (signInWithPassword is only used for admin login)
    setAuthToken(result.token, 'admin');

    return {
      data: {
        session: { access_token: result.token, role: result.user?.role || 'admin' },
        user: result.user,
      },
      error: null,
    };
  },

  async beginCasLogin(role?: 'student' | 'admin') {
    const url = role ? `${API_BASE}/cas/login?role=${role}` : `${API_BASE}/cas/login`;
    window.location.href = url;
  },

  applyCasCallbackFromUrl() {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role') as 'admin' | 'student' | null;
    const fullName = url.searchParams.get('fullName');
    const email = url.searchParams.get('email');

    if (token) {
      // Store token with the appropriate role from CAS callback
      setAuthToken(token, role || 'student');
      url.searchParams.delete('token');
      url.searchParams.delete('role');
      url.searchParams.delete('fullName');
      url.searchParams.delete('email');
      const newUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
      window.history.replaceState({}, '', newUrl);
      return { token, role: role || null, fullName: fullName || null, email: email || null };
    }
    return null;
  },

  async getSession() {
    const token = getActiveToken();
    if (!token) {
      return { data: { session: null }, error: null };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/session`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        // Clear the token for the current context
        setAuthToken(null);
        return { data: { session: null }, error: null };
      }

      const result = await response.json();
      return {
        data: {
          session: { access_token: token, user: result.user },
        },
        error: null,
      };
    } catch {
      return { data: { session: null }, error: null };
    }
  },

  async signOut() {
    // Clear token for current context
    setAuthToken(null);
    return { error: null };
  },
};

// ==================== Query Builder ====================

type QueryFilter = {
  column: string;
  op: 'eq' | 'neq' | 'in';
  value: any;
};

type QueryOrder = {
  column: string;
  ascending: boolean;
};

class QueryBuilder<T> {
  private tableName: string;
  private selectColumns: string = '*';
  private filters: QueryFilter[] = [];
  private orders: QueryOrder[] = [];
  private isSingle: boolean = false;
  private insertData: Record<string, any> | null = null;
  private updateData: Record<string, any> | null = null;
  private isDelete: boolean = false;

  constructor(table: string) {
    this.tableName = table;
  }

  select(columns: string = '*') {
    this.selectColumns = columns;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ column, op: 'neq', value });
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }

  order(column: string, { ascending = true }: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending });
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  insert(data: Record<string, any>) {
    this.insertData = data;
    return this;
  }

  update(data: Record<string, any>) {
    this.updateData = data;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  private buildQueryString(): string {
    const params = new URLSearchParams();

    // Add filters as query params
    for (const filter of this.filters) {
      if (filter.op === 'eq') {
        params.append(filter.column, String(filter.value));
      } else if (filter.op === 'in') {
        params.append(`${filter.column}s`, filter.value.join(','));
      }
    }

    return params.toString();
  }

  async then<TResult1 = { data: T | T[] | null; error: { message: string } | null }>(
    resolve: (value: { data: T | T[] | null; error: { message: string } | null }) => TResult1
  ): Promise<TResult1> {
    let result: { data: T | T[] | null; error: { message: string } | null };

    if (this.insertData) {
      // POST request
      result = await apiFetch<T>(`/${this.tableName}`, {
        method: 'POST',
        body: JSON.stringify(this.insertData),
      });
    } else if (this.updateData) {
      // PATCH request - need an ID from filters (supports both 'id', 'section_id', and 'case_id')
      const idFilter = this.filters.find(f => (f.column === 'id' || f.column === 'section_id' || f.column === 'case_id') && f.op === 'eq');
      if (!idFilter) {
        result = { data: null, error: { message: 'Update requires an id, section_id, or case_id filter' } };
      } else {
        result = await apiFetch<T>(`/${this.tableName}/${idFilter.value}`, {
          method: 'PATCH',
          body: JSON.stringify(this.updateData),
        });
      }
    } else if (this.isDelete) {
      // DELETE request - need an ID from filters
      const idFilter = this.filters.find(f => (f.column === 'id' || f.column === 'section_id' || f.column === 'case_id') && f.op === 'eq');
      if (!idFilter) {
        result = { data: null, error: { message: 'Delete requires an id, section_id, or case_id filter' } };
      } else {
        result = await apiFetch<T>(`/${this.tableName}/${idFilter.value}`, {
          method: 'DELETE',
        });
      }
    } else {
      // GET request
      const queryString = this.buildQueryString();
      
      // Check if we're querying by ID (supports both 'id' and 'section_id')
      const idFilter = this.filters.find(f => (f.column === 'id' || f.column === 'section_id') && f.op === 'eq');
      
      if (idFilter && this.isSingle) {
        result = await apiFetch<T>(`/${this.tableName}/${idFilter.value}`);
      } else {
        const endpoint = queryString ? `/${this.tableName}?${queryString}` : `/${this.tableName}`;
        result = await apiFetch<T[]>(endpoint);
        
        if (this.isSingle && result.data && Array.isArray(result.data)) {
          result = { data: result.data[0] || null, error: null };
        }
      }
    }

    return resolve(result);
  }
}

// ==================== Main API Object ====================

export const api = {
  auth,

  from<T = any>(table: string): QueryBuilder<T> {
    // Map table names to API endpoints
    const tableMap: Record<string, string> = {
      models: 'models',
      sections: 'sections',
      students: 'students',
      evaluations: 'evaluations',
      cases: 'cases',
    };

    const endpoint = tableMap[table] || table;
    return new QueryBuilder<T>(endpoint);
  },

  // Direct HTTP methods for REST API calls
  async get<T = any>(endpoint: string): Promise<{ data: T | null; error: { message: string } | null }> {
    return apiFetch<T>(endpoint, { method: 'GET' });
  },

  async post<T = any>(endpoint: string, body?: any): Promise<{ data: T | null; error: { message: string } | null }> {
    return apiFetch<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async patch<T = any>(endpoint: string, body?: any): Promise<{ data: T | null; error: { message: string } | null }> {
    return apiFetch<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async delete<T = any>(endpoint: string): Promise<{ data: T | null; error: { message: string } | null }> {
    return apiFetch<T>(endpoint, { method: 'DELETE' });
  },
};

// For backwards compatibility with existing code that imports 'supabase'
export const supabase = api;

export default api;

