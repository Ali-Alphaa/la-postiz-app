import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';

@Injectable()
@Activity()
export class InboxActivity {
  constructor(private _inboxService: InboxService) {}

  @ActivityMethod()
  async syncInbox() {
    return this._inboxService.syncAll();
  }
}
