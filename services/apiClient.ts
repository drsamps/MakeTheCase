/**
 * API Client for MySQL backend
 * Replaces the Supabase client with calls to our Express API server
 */

const API_BASE = '/api';

// Auth token management
let authToken: string | null = localStorage.getItem('auth_token');

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('auth_token', token);
  } else {
    localStorage.removeItem('auth_token');
  }
}

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
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

    // Store the token
    setAuthToken(result.token);

    return {
      data: {
        session: { access_token: result.token, role: result.user?.role || 'admin' },
        user: result.user,
      },
      error: null,
    };
  },

  async beginCasLogin() {
    window.location.href = `${API_BASE}/cas/login`;
  },

  applyCasCallbackFromUrl() {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role');
    const fullName = url.searchParams.get('fullName');
    const email = url.searchParams.get('email');

    if (token) {
      setAuthToken(token);
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
    if (!authToken) {
      return { data: { session: null }, error: null };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/session`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        setAuthToken(null);
        return { data: { session: null }, error: null };
      }

      const result = await response.json();
      return {
        data: {
          session: { access_token: authToken, user: result.user },
        },
        error: null,
      };
    } catch {
      return { data: { session: null }, error: null };
    }
  },

  async signOut() {
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
};

// For backwards compatibility with existing code that imports 'supabase'
export const supabase = api;

export default api;

