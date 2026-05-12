import type { TerminalApi } from '../../preload';

declare global {
  interface Window {
    terminalApi: TerminalApi;
  }
}
