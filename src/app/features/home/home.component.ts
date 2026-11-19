import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PwaService } from '../../core/pwa/pwa.service';
import { InstrumentStore } from '../../core/state/instrument.store';
import { SettingsStore } from '../../core/state/settings.store';
import { AudioStatusComponent } from '../../shared/components/audio-status.component';
import { IconComponent } from '../../shared/components/icon.component';
import { ListenButtonComponent } from '../../shared/components/listen-button.component';
import { SwaraLabelComponent } from '../../shared/components/swara-label.component';
import { TonicPickerComponent } from '../../shared/components/tonic-picker.component';
import { HzPipe } from '../../shared/pipes/frequency.pipes';

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    IconComponent,
    ListenButtonComponent,
    AudioStatusComponent,
    TonicPickerComponent,
    SwaraLabelComponent,
    HzPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  protected readonly settings = inject(SettingsStore);
  protected readonly instrument = inject(InstrumentStore);
  protected readonly pwa = inject(PwaService);

  protected readonly mapping = computed(() => this.settings.mapper().mappingTable());
  protected readonly summary = computed(() => {
    const m = this.instrument.mainCount();
    const t = this.instrument.sympatheticCount();
    return `${m} Main ${m === 1 ? 'String' : 'Strings'} · ${t} Taraf ${t === 1 ? 'String' : 'Strings'}`;
  });

  protected install(): void {
    void this.pwa.promptInstall();
  }
}
