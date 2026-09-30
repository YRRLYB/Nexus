import type { NexusAPI } from '../shared/types';
declare global {
  interface Window {
    nexus: NexusAPI;
  }
}
