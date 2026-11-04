import type { SepiaApi } from '../shared/types';

declare global {
  interface Window {
    sepia: SepiaApi;
  }
}

export {};
