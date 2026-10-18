import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { PortalSessionService } from './services/portal-session.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'Bouncer';
  light = false;
  showPortalAuth = false;
  signInDestination = '/admin';
  readonly session = inject(PortalSessionService);
  activeAdmin: PortalAuthSource | null = null;

  constructor() {
    try {
      this.light = localStorage.getItem('bouncer-theme') === 'light';
    } catch {}
    document.documentElement.dataset['theme'] = this.light ? 'light' : 'dark';
  }

  onRouteActivate(component: unknown, path?: string) {
    this.activeAdmin = isPortalAuthSource(component) ? component : null;
    this.showPortalAuth = path === 'admin' || path === 'help' || path === 'member';
    this.signInDestination = path === 'member' ? '/member' : '/admin';
    if (path === 'help') void this.session.load().catch(() => {});
  }

  async logout() {
    if (this.activeAdmin) await this.activeAdmin.logout();
    else await this.session.logout();
  }

  toggleTheme() {
    this.light = !this.light;
    document.documentElement.dataset['theme'] = this.light ? 'light' : 'dark';
    try {
      localStorage.setItem('bouncer-theme', this.light ? 'light' : 'dark');
    } catch {}
  }
}

interface PortalAuthSource {
  user: { name: string } | null;
  busy: boolean;
  logout(): Promise<void>;
}

function isPortalAuthSource(component: unknown): component is PortalAuthSource {
  return (
    typeof component === 'object' &&
    component !== null &&
    'user' in component &&
    'busy' in component &&
    'logout' in component &&
    typeof component.logout === 'function'
  );
}
