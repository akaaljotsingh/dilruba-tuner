import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AudioCaptureService } from '../../core/audio/audio-capture.service';
import { PwaService } from '../../core/pwa/pwa.service';
import { IconComponent, IconName } from '../../shared/components/icon.component';
import { LogoComponent } from '../../shared/components/logo.component';
import { TonicPickerComponent } from '../../shared/components/tonic-picker.component';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly short: string;
  readonly icon: IconName;
  readonly exact?: boolean;
}

@Component({
  selector: 'app-main-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IconComponent,
    LogoComponent,
    TonicPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
})
export class MainLayoutComponent {
  protected readonly pwa = inject(PwaService);
  protected readonly engine = inject(AudioCaptureService);

  protected readonly nav: readonly NavItem[] = [
    { path: '/', label: 'Home', short: 'Home', icon: 'home', exact: true },
    { path: '/tuner', label: 'Wire Tuner', short: 'Tuner', icon: 'tuner' },
    { path: '/spectrum', label: 'Sur Spectrum', short: 'Spectrum', icon: 'spectrum' },
    { path: '/instrument', label: 'Instrument', short: 'Strings', icon: 'strings' },
    { path: '/settings', label: 'Settings', short: 'Settings', icon: 'settings' },
  ];
}
