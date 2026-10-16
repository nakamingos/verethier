import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'wallet-check',
    loadComponent: () => import('./routes/wallet-check/wallet-check.component').then(m => m.WalletCheckComponent),
  },
  {
    path: 'verify/:data',
    loadComponent: () => import('./routes/verify/verify.component').then(m => m.VerifyComponent),

  }
];
