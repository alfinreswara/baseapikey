import type { CreateUsageRecordDto } from '../dto/usage.dto';

export interface UsageRecordedEvent {
  eventName: 'usage.recorded';
  timestamp: Date;
  payload: CreateUsageRecordDto & {
    status: 'SUCCESS' | 'FAILED';
  };
}

export type UsageEvent = UsageRecordedEvent;
