import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'Bouncer';
  light = false;
  constructor() {
    try {
      this.light = localStorage.getItem('bouncer-theme') === 'light';
    } catch {}
    document.documentElement.dataset['theme'] = this.light ? 'light' : 'dark';
  }
  toggleTheme() {
    this.light = !this.light;
    document.documentElement.dataset['theme'] = this.light ? 'light' : 'dark';
    try {
      localStorage.setItem('bouncer-theme', this.light ? 'light' : 'dark');
    } catch {}
  }
}
