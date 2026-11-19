import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResolvedString } from '../../core/models/string-configuration.model';
import { SAPTAKS, SWARAS, SwaraId } from '../../core/models/swara.model';
import { InstrumentStore } from '../../core/state/instrument.store';
import { IconComponent } from '../../shared/components/icon.component';
import { SwaraLabelComponent } from '../../shared/components/swara-label.component';
import { HzPipe } from '../../shared/pipes/frequency.pipes';

const EDITABLE_SAPTAKS = SAPTAKS.filter((s) => s.offset >= -2 && s.offset <= 2);

/** Editor for one wire's target swara, saptak and fine offset. */
@Component({
  selector: 'app-string-row',
  imports: [RouterLink, SwaraLabelComponent, HzPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = string();
    <div class="row">
      <div class="who">
        <span class="badge display"
          ><app-swara-label [swara]="s.swara" [saptak]="s.saptak" mode="short"
        /></span>
        <input
          class="input name"
          [value]="s.name"
          (change)="rename($event)"
          [attr.aria-label]="'Name of ' + s.name"
          maxlength="40"
        />
      </div>
      <label class="field sw">
        <span class="label">Swara</span>
        <select class="select" (change)="setSwara($event)" [attr.aria-label]="s.name + ' swara'">
          @for (sw of swaras; track sw.id) {
            <option [value]="sw.id" [selected]="sw.id === s.swara">{{ sw.name }}</option>
          }
        </select>
      </label>
      <label class="field sp">
        <span class="label">Saptak</span>
        <select class="select" (change)="setSaptak($event)" [attr.aria-label]="s.name + ' saptak'">
          @for (sp of saptaks; track sp.offset) {
            <option [value]="sp.offset" [selected]="sp.offset === s.saptak">{{ sp.name }}</option>
          }
        </select>
      </label>
      <label class="field fine">
        <span class="label">Fine (¢)</span>
        <input
          class="input"
          type="number"
          min="-50"
          max="50"
          step="1"
          [value]="s.centsOffset"
          (change)="setCents($event)"
          [attr.aria-label]="s.name + ' fine offset in cents'"
        />
      </label>
      <div class="result">
        <span class="west">{{ s.westernLabel }}</span>
        <span class="hz numeric">{{ s.targetFrequency | hz: 2 }}</span>
      </div>
      <a
        class="icon-btn tune"
        [routerLink]="['/tuner']"
        [queryParams]="{ string: s.id }"
        [attr.aria-label]="'Tune ' + s.name"
      >
        <app-icon name="tuner" />
      </a>
    </div>
  `,
  styles: `
    .row {
      display: grid;
      gap: 10px 12px;
      align-items: end;
      padding: 14px 0;
      border-bottom: 1px solid var(--line);
      grid-template-columns: 1fr 96px;
      grid-template-areas: 'who tune' 'sw sw' 'sp fine' 'result result';
      @media (min-width: 820px) {
        grid-template-columns: minmax(180px, 1.3fr) minmax(130px, 1fr) minmax(
            120px,
            0.9fr
          ) 84px minmax(110px, auto) 44px;
        grid-template-areas: 'who sw sp fine result tune';
      }
    }
    .who {
      grid-area: who;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .badge {
      flex: none;
      width: 46px;
      height: 44px;
      display: grid;
      place-items: center;
      border-radius: 10px;
      background: var(--bg-elevated);
      border: 1px solid var(--line);
      font-size: 1.3rem;
      font-weight: 600;
      color: var(--gold);
    }
    .name {
      font-weight: 560;
    }
    .sw {
      grid-area: sw;
    }
    .sp {
      grid-area: sp;
    }
    .fine {
      grid-area: fine;
      min-width: 0;
    }
    .result {
      min-height: 28px;
    }
    .result {
      grid-area: result;
      display: flex;
      gap: 10px;
      align-items: baseline;
      justify-content: flex-start;
      min-height: 44px;
      align-items: center;
      @media (min-width: 820px) {
        display: grid;
        gap: 0;
        justify-items: end;
      }
    }
    .west {
      font-weight: 650;
    }
    .hz {
      color: var(--text-muted);
      font-size: 0.86rem;
    }
    .tune {
      grid-area: tune;
      justify-self: end;
    }
  `,
})
export class StringRowComponent {
  private readonly store = inject(InstrumentStore);
  readonly string = input.required<ResolvedString>();
  protected readonly swaras = SWARAS;
  protected readonly saptaks = EDITABLE_SAPTAKS;

  protected rename(e: Event): void {
    this.store.updateString(this.string().id, {
      name: (e.target as HTMLInputElement).value.trim(),
    });
  }
  protected setSwara(e: Event): void {
    this.store.updateString(this.string().id, {
      swara: (e.target as HTMLSelectElement).value as SwaraId,
    });
  }
  protected setSaptak(e: Event): void {
    this.store.updateString(this.string().id, {
      saptak: Number((e.target as HTMLSelectElement).value),
    });
  }
  protected setCents(e: Event): void {
    this.store.updateString(this.string().id, {
      centsOffset: Number((e.target as HTMLInputElement).value) || 0,
    });
  }
}
