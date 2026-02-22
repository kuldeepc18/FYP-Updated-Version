import { apiClient, API_ENDPOINTS } from '@/config/api';

interface User {
  id: string;
  email: string;
  name: string;
  balance: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
}

interface LoginResponse {
  token: string;
  user: User;
}

interface RegisterResponse {
  token: string;
  user: User;
}

class AuthService {
  private readonly STORAGE_KEY = 'ktrade_auth';

  async login(email: string, password: string): Promise<AuthState> {
    try {
      const response = await apiClient.post<LoginResponse>(
        API_ENDPOINTS.AUTH.LOGIN,
        { email, password }
      );

      const authState: AuthState = {
        user: response.data.user,
        token: response.data.token,
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(authState));
      return authState;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Login failed. Please check your credentials.'
      );
    }
  }

  async register(email: string, password: string, name: string): Promise<AuthState> {
    try {
      const response = await apiClient.post<RegisterResponse>(
        API_ENDPOINTS.AUTH.REGISTER,
        { email, password, name }
      );

      const authState: AuthState = {
        user: response.data.user,
        token: response.data.token,
      };

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(authState));
      return authState;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Registration failed. Please try again.'
      );
    }
  }

  async logout(): Promise<void> {
    try {
      await apiClient.post(API_ENDPOINTS.AUTH.LOGOUT);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  getAuthState(): AuthState | null {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return null;

    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  isAuthenticated(): boolean {
    return this.getAuthState() !== null;
  }

  getUser(): User | null {
    const authState = this.getAuthState();
    return authState?.user || null;
  }

  getToken(): string | null {
    const authState = this.getAuthState();
    return authState?.token || null;
  }
}

export const authService = new AuthService();
