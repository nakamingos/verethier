import { Component, EventEmitter, OnDestroy } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnDestroy {
  title = 'Bouncer';
  light = false;
  showSignIn = false;
  portalAuth: PortalAuthSource | null = null;
  private signInVisibilitySubscription?: Subscription;

  constructor() {
    try {
      this.light = localStorage.getItem('bouncer-theme') === 'light';
    } catch {}
    document.documentElement.dataset['theme'] = this.light ? 'light' : 'dark';
  }

  onRouteActivate(component: unknown) {
    this.signInVisibilitySubscription?.unsubscribe();
    this.showSignIn = false;
    this.portalAuth = null;
    if (isPortalAuthSource(component)) {
      this.portalAuth = component;
      this.signInVisibilitySubscription = component.signInVisibility.subscribe(
        (visible) => (this.showSignIn = visible),
      );
    }
  }

  ngOnDestroy() {
    this.signInVisibilitySubscription?.unsubscribe();
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
  signInVisibility: EventEmitter<boolean>;
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
    typeof component.logout === 'function' &&
    'signInVisibility' in component &&
    component.signInVisibility instanceof EventEmitter
  );
}
