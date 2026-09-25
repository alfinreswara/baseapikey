import type { CreateUsageRecordDto } from '../dto/usage.dto';
import type { UsageRecordedEvent } from '../events/usage.events';

import type { UsageTrackingService } from './usage-tracking.service';

export interface IUsageRecorder {
  record(dto: CreateUsageRecordDto): void;
}

export class AsyncUsageRecorder implements IUsageRecorder {
  private readonly eventListeners: ((event: UsageRecordedEvent) => void)[] = [];

  constructor(private readonly usageTrackingService: UsageTrackingService) {}

  record(dto: CreateUsageRecordDto): void {
    // Non-blocking asynchronous execution via setImmediate
    setImmediate(() => {
      this.usageTrackingService
        .recordUsage(dto)
        .then(() => {
          const event: UsageRecordedEvent = {
            eventName: 'usage.recorded',
            timestamp: new Date(),
            payload: {
              ...dto,
              status: dto.statusCode < 400 ? 'SUCCESS' : 'FAILED',
            },
          };
          this.notifyListeners(event);
        })
        .catch(() => {
          // Silent catch to ensure main request flow is never impacted
        });
    });
  }

  onEvent(listener: (event: UsageRecordedEvent) => void): void {
    this.eventListeners.push(listener);
  }

  private notifyListeners(event: UsageRecordedEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener error
      }
    }
  }
}
