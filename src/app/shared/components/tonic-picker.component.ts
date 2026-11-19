import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { pitchClassName } from '../../core/music/western-note-mapper';
import { SettingsStore } from '../../core/state/settings.store';

/** Compact "Sa = C#" selector, kept visible throughout the app. */
@Component({
  selector: 'app-tonic-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="tonic" [class.large]="large()">
      <span class="sa">Sa</span>
      <span class="eq">=</span>
      <select [value]="store.tonicPitchClass()" (change)="onChange($event)" aria-label="Tonic (Sa)">
        @for (n of names(); track n.pc) {
          <option [value]="n.pc" [selected]="n.pc === store.tonicPitchClass()">{{ n.name }}</option>
        }
      </select>
    </label>
  `,
  styles: `
    .tonic {
      position: relative;
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      padding: 6px 30px 6px 14px;
      min-height: 40px;
      align-items: center;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      background: var(--surface);
      cursor: pointer;
      font-family: var(--font-display);
      font-size: 1.15rem;
      color: var(--text);
      &::after {
        content: '';
        position: absolute;
        right: 13px;
        top: 50%;
        width: 6px;
        height: 6px;
        border-right: 1.5px solid var(--text-muted);
        border-bottom: 1.5px solid var(--text-muted);
        transform: translateY(-70%) rotate(45deg);
        pointer-events: none;
      }
      &:focus-within {
        border-color: var(--accent);
      }
    }
    .sa {
      color: var(--gold);
      font-weight: 700;
    }
    .eq {
      color: var(--text-faint);
    }
    select {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      padding: 0;
      outline: none;
      option {
        background: #1e1b1f;
        color: #efe6d4;
        font-family: var(--font-ui);
      }
    }
    .large {
      font-size: 1.5rem;
      padding: 8px 34px 8px 18px;
    }
  `,
})
export class TonicPickerComponent {
  protected readonly store = inject(SettingsStore);
  readonly large = input(false);
  protected readonly names = computed(() => {
    const acc = this.store.settings().accidentals;
    return Array.from({ length: 12 }, (_, pc) => ({ pc, name: pitchClassName(pc, acc) }));
  });

  protected onChange(event: Event): void {
    this.store.setTonic(Number((event.target as HTMLSelectElement).value));
  }
}
