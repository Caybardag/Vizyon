import { EventEmitter } from 'node:events';
import type { SSEMessage } from '../src/types/automation';

class AppEventBus extends EventEmitter {
  broadcast(message: SSEMessage): void {
    this.emit('sse', message);
  }
}

export const eventBus = new AppEventBus();
eventBus.setMaxListeners(100);
