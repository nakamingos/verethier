import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PortalSessionService {
  user: { id: string; name: string } | null = null;
  csrf = '';
  configured = false;
  ready = false;
  busy = false;
  error = '';
  private pending?: Promise<void>;

  load(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (!this.pending) {
      this.pending = this.readSession().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  private async readSession() {
    this.error = '';
    try {
      const response = await fetch('/api/portal/session', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const session = await response.json();
      if (!response.ok) throw new Error('Could not load Discord sign-in.');
      this.user = session.user;
      this.csrf = session.csrf || '';
      this.configured = !!session.configured;
      this.ready = true;
    } catch (error) {
      this.error =
        'Could not load Discord sign-in. Please reload to try again.';
      throw error;
    }
  }

  clear() {
    this.user = null;
    this.csrf = '';
    this.error = '';
  }

  async logout() {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      const response = await fetch('/api/portal/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrf,
        },
        body: '{}',
      });
      if (!response.ok && response.status !== 401)
        throw new Error('Sign-out failed.');
      this.clear();
    } catch {
      this.error = 'Could not sign out. Please try again.';
    } finally {
      this.busy = false;
    }
  }
}
