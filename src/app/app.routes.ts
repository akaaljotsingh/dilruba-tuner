import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Dilruba Sur Tuner',
    loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'tuner',
    title: 'Wire Tuner · Dilruba Sur Tuner',
    loadComponent: () =>
      import('./features/wire-tuner/wire-tuner.component').then((m) => m.WireTunerComponent),
  },
  {
    path: 'spectrum',
    title: 'Sur Spectrum · Dilruba Sur Tuner',
    loadComponent: () =>
      import('./features/sur-spectrum/sur-spectrum.component').then((m) => m.SurSpectrumComponent),
  },
  {
    path: 'instrument',
    title: 'Instrument · Dilruba Sur Tuner',
    loadComponent: () =>
      import('./features/instrument-settings/instrument-settings.component').then(
        (m) => m.InstrumentSettingsComponent,
      ),
  },
  {
    path: 'settings',
    title: 'Settings · Dilruba Sur Tuner',
    loadComponent: () =>
      import('./features/app-settings/app-settings.component').then((m) => m.AppSettingsComponent),
  },
  { path: '**', redirectTo: '' },
];
