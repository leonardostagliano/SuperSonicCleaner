import type { DesktopNotchAPI } from '@shared/desktop-notch'

declare global {
  interface Window {
    kuduNotch?: DesktopNotchAPI
  }
}
