import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'help',
    loadComponent: () =>
      import('./routes/help/help.component').then((m) => m.HelpComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'admin' },
  {
    path: 'admin',
    loadComponent: () =>
      import('./routes/admin/admin.component').then((m) => m.AdminComponent),
  },
  {
    path: 'member',
    loadComponent: () =>
      import('./routes/member/member.component').then((m) => m.MemberComponent),
  },
  {
    path: 'wallet-check',
    loadComponent: () =>
      import('./routes/wallet-check/wallet-check.component').then(
        (m) => m.WalletCheckComponent,
      ),
  },
  {
    path: 'verify/:data',
    loadComponent: () =>
      import('./routes/verify/verify.component').then((m) => m.VerifyComponent),
  },
];
