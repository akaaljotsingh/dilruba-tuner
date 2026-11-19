import { StringConfiguration } from './string-configuration.model';

export const MIN_MAIN_STRINGS = 1;
export const MAX_MAIN_STRINGS = 8;
export const MIN_SYMPATHETIC_STRINGS = 0;
export const MAX_SYMPATHETIC_STRINGS = 30;

export interface InstrumentConfiguration {
  readonly version: 1;
  readonly name: string;
  readonly strings: readonly StringConfiguration[];
}
