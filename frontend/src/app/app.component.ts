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
    if (isSignInVisibilitySource(component)) {
      this.signInVisibilitySubscription =
        component.signInVisibility.subscribe(
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

interface SignInVisibilitySource {
  signInVisibility: EventEmitter<boolean>;
}

function isSignInVisibilitySource(
  component: unknown,
): component is SignInVisibilitySource {
  return (
    typeof component === 'object' &&
    component !== null &&
    'signInVisibility' in component &&
    component.signInVisibility instanceof EventEmitter
  );
}
