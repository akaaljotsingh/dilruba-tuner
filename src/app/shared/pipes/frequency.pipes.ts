import { Pipe, PipeTransform } from '@angular/core';

/** 138.591 → "138.6 Hz" (or "—" when unavailable). */
@Pipe({ name: 'hz' })
export class HzPipe implements PipeTransform {
  transform(value: number | null | undefined, digits = 1, unit = true): string {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—';
    const d = value >= 1000 ? Math.max(0, digits - 1) : digits;
    return `${value.toFixed(d)}${unit ? ' Hz' : ''}`;
  }
}

/** -4.26 → "−4.3¢", 0 → "0.0¢" */
@Pipe({ name: 'cents' })
export class CentsPipe implements PipeTransform {
  transform(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const rounded = Number(value.toFixed(digits));
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
    return `${sign}${Math.abs(rounded).toFixed(digits)}¢`;
  }
}
